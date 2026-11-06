// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { readNdjson } from "./ndjson-stream.ts";

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
}
const collect = async (chunks: string[]) => {
  const out: unknown[] = [];
  await readNdjson(bodyOf(chunks), (e) => out.push(e));
  return out;
};

test("events are delivered in order", async () => {
  assert.deepEqual(await collect(['{"a":1}\n{"a":2}\n', '{"a":3}\n']), [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test("a line cut in half between packets is held until it is whole", async () => {
  assert.deepEqual(await collect(['{"type":"delta","te', 'xt":"hi"}\n{"type":', '"done"}\n']), [{ type: "delta", text: "hi" }, { type: "done" }]);
});

test("a last line without a newline still arrives", async () => {
  assert.deepEqual(await collect(['{"a":1}\n{"a":2}']), [{ a: 1 }, { a: 2 }]);
});

test("blank lines and unreadable lines are skipped without stopping the rest", async () => {
  assert.deepEqual(await collect(['\n\n{"a":1}\nnot json at all\n{"a":2}\n']), [{ a: 1 }, { a: 2 }]);
});

test("multi-byte text (Bengali, emoji) split across packets stays intact", async () => {
  const line = JSON.stringify({ text: "\u0986\u09ae\u09bf \u2764\ufe0f" }) + "\n";
  const bytes = new TextEncoder().encode(line);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, 13)); // cuts a character in the middle
      c.enqueue(bytes.slice(13));
      c.close();
    },
  });
  const out: { text: string }[] = [];
  await readNdjson<{ text: string }>(body, (e) => out.push(e));
  assert.deepEqual(out, [{ text: "\u0986\u09ae\u09bf \u2764\ufe0f" }]);
});
