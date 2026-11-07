// Run with: npm test
// The heart-bridge streams. A slow or long answer is cut honestly instead of being thrown away.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { OllamaBridgeError, ollamaChat, trimToSentence } from "./ollama-brain.ts";

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

beforeEach(() => {
  process.env.SG16_OLLAMA_URL = "http://127.0.0.1:11434";
  process.env.SG16_OLLAMA_TIMEOUT_MS = "1000"; // the smallest budget the bridge accepts
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...realEnv };
});

const line = (o: unknown) => JSON.stringify(o) + "\n";
const piece = (content: string) => line({ model: "saiftechglobal/sg16-brain:Q4_K_M", message: { role: "assistant", content }, done: false });
const done = (reason = "stop") => line({ model: "saiftechglobal/sg16-brain:Q4_K_M", message: { role: "assistant", content: "" }, done: true, done_reason: reason });

/** A streaming Response that emits `chunks`, then either ends or stalls until the request is aborted. */
function streamOf(chunks: string[], opts: { stall?: boolean; signal?: AbortSignal } = {}): Response {
  const enc = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      if (!opts.stall) {
        controller.close();
        return;
      }
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        opts.signal?.addEventListener("abort", stop);
        const t = setInterval(() => cancelled && stop(), 10);
        setTimeout(() => clearInterval(t), 5000);
      });
      try {
        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
      } catch {
        /* already closed */
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, { status: 200 });
}

function stubFetch(make: (init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return make(init);
  }) as typeof fetch;
  return calls;
}

test("a normal stream is joined into one reply", async () => {
  const calls = stubFetch(() => streamOf([piece("Hello "), piece("there, "), piece("friend."), done()]));
  const turn = await ollamaChat({ message: "hi" });
  assert.equal(turn.reply, "Hello there, friend.");
  assert.equal(turn.truncated, false);
  assert.equal(turn.source, "ollama");
  assert.equal(calls[0].body.stream, true);
});

test("the request carries the token cap, the history and the fixed system prompt first", async () => {
  const calls = stubFetch(() => streamOf([piece("ok"), done()]));
  await ollamaChat({ message: "and then?", history: [{ role: "user", content: "first" }, { role: "assistant", content: "answer" }], maxTokens: 123 });
  const b = calls[0].body as { messages: { role: string; content: string }[]; options: { num_predict: number } };
  assert.equal(b.options.num_predict, 123);
  assert.deepEqual(b.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(b.messages[3].content, "and then?");
});

test("chunks split in the middle of a line are still read correctly", async () => {
  const whole = piece("split ") + piece("across ") + piece("packets.") + done();
  const cut = [whole.slice(0, 17), whole.slice(17, 60), whole.slice(60)];
  stubFetch(() => streamOf(cut));
  assert.equal((await ollamaChat({ message: "hi" })).reply, "split across packets.");
});

test("an answer that ends on the token cap is marked truncated and cut at a sentence", async () => {
  stubFetch(() => streamOf([piece("First sentence is complete. Second sentence is also complete. Third is cut in"), done("length")]));
  const turn = await ollamaChat({ message: "hi" });
  assert.equal(turn.truncated, true);
  assert.equal(turn.reply, "First sentence is complete. Second sentence is also complete. …");
});

test("out of time with most of an answer written: the partial answer is returned, not thrown away", async () => {
  const text = "This is a long answer that was still being written when the time ran out. It already says plenty. And here is a third sentence that is cut off mid-wo";
  stubFetch((init) => streamOf([piece(text)], { stall: true, signal: init.signal as AbortSignal }));
  const t0 = Date.now();
  const turn = await ollamaChat({ message: "tell me a lot" });
  assert.ok(Date.now() - t0 < 3000, "must stop at the budget");
  assert.equal(turn.truncated, true);
  assert.match(turn.reply, /already says plenty\. …$/);
});

test("out of time with almost nothing written: it fails with a timeout so the ladder can fall back", async () => {
  stubFetch((init) => streamOf([piece("Hmm")], { stall: true, signal: init.signal as AbortSignal }));
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "timeout");
});

test("daemon errors: http status, error chunk, empty answer, unreadable data, unreachable", async () => {
  stubFetch(() => new Response("boom", { status: 500 }));
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "http-error");

  stubFetch(() => streamOf([line({ error: "model not found" })]));
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "bad-payload");

  stubFetch(() => streamOf([done()]));
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "bad-payload");

  stubFetch(() => streamOf(["this is not json\n"]));
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "bad-payload");

  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(() => ollamaChat({ message: "x" }), (e: unknown) => e instanceof OllamaBridgeError && e.kind === "unreachable");
});

test("trimToSentence keeps whole sentences, or whole words when there is no sentence end", () => {
  assert.equal(trimToSentence("One. Two. Thr"), "One. Two.");
  assert.equal(trimToSentence("no punctuation but several words here ok partia"), "no punctuation but several words here ok");
  assert.equal(trimToSentence("Short. and then a very long run of words without any stop at all in sight"), "Short. and then a very long run of words without any stop at all in");
});

test("onDelta receives each piece as it is written, in order", async () => {
  stubFetch(() => streamOf([piece("Hel"), piece("lo "), piece("there."), done()]));
  const seen: string[] = [];
  const turn = await ollamaChat({ message: "hi", onDelta: (t) => seen.push(t) });
  assert.deepEqual(seen, ["Hel", "lo ", "there."]);
  assert.equal(turn.reply, "Hello there.");
});

test("a failing onDelta callback never breaks the answer", async () => {
  stubFetch(() => streamOf([piece("fine "), piece("answer."), done()]));
  const turn = await ollamaChat({
    message: "hi",
    onDelta: () => {
      throw new Error("display broke");
    },
  });
  assert.equal(turn.reply, "fine answer.");
});

test("when the person leaves, the request to the model is closed at once", async () => {
  const leave = new AbortController();
  let upstreamClosed = false;
  stubFetch((init) => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(piece("This answer is long enough to count as written so far, and then the person closes the page. ")));
        init.signal?.addEventListener("abort", () => {
          upstreamClosed = true;
          try {
            c.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
          } catch {
            /* closed */
          }
        });
      },
    });
    return new Response(body, { status: 200 });
  });
  const pending = ollamaChat({ message: "x", signal: leave.signal });
  await new Promise((r) => setTimeout(r, 30));
  leave.abort();
  const t0 = Date.now();
  await pending.catch(() => undefined);
  assert.ok(upstreamClosed, "the model request must be aborted");
  assert.ok(Date.now() - t0 < 500);
});
