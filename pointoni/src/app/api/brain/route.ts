import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, persistenceMode } from "@/db";
import { aiModels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeeded } from "@/lib/seed";
import { generateReply } from "@/lib/ai-engine";
import { consumeBucket, resolveTier } from "@/lib/identity";
import {
  BrainGatewayError,
  MAX_BRAIN_MESSAGE_CHARS,
  brainChat,
  brainForgetSession,
  brainHealth,
  brainIntrospect,
} from "@/lib/brain-gateway";
import { ollamaChat, ollamaEnabled, ollamaHealth, ollamaMaxTokens, ollamaTimeoutMs } from "@/lib/ollama-brain";
import { clientIdentity, directProbe, sharedRateLimiter } from "@/lib/rate-limit";
import { publicEngine } from "@/lib/public-engine";
import { isAdminRequest } from "@/lib/admin-gate";
import { projectFromHeaders } from "@/lib/project-keys";
import { gateTextFor, sanitizeHistory } from "@/lib/chat-history";
import { CODE_HINT, codeTokenBudget, isCodeLike, resolveMode } from "@/lib/code-mode";
import { ENGLISH_FALLBACK_HINT, WEAK_LANGUAGE_NOTE, weakLanguage } from "@/lib/language";
import { checkHuman, sharedHumanDeps, turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";
import { BUSY_TEXT, answerDeadlineMs, answerMetrics, lastAnswer, queueWaitMs, recordAnswer, runLadder, sharedLimiter, type Engine } from "@/lib/answer-ladder";
import { charterDigest, type CharterBody } from "@/lib/charter-prompt";
import { warmFallbackLine, warmRateLimitLine, tierChip } from "@/lib/warm-alias";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SG16_MODEL_ID = "sg16-brain";
// shown when an answer had to be cut at the time limit (the history on the device makes "continue" work)
const CUT_NOTE = '\n\n(I ran out of time for this answer. Say "continue" and I will go on.)';

function rateLimitedLine(scope: "visitor" | "global"): string {
  if (scope === "global") return "I'm very busy right now - please try again in a moment.";
  return "You're sending messages very quickly - please wait a few seconds and try again.";
}

// a chat message is at most 8k chars; anything near this size is not a chat
const MAX_BODY_BYTES = 64 * 1024;

// /api/brain — the sovereign chat routing point.
//
// Same request/response contract as /api/chat so the ChatPanel UI and the
// session archive stay 100% compatible, but self-hosted models are answered
// by the SG16 core itself (Q16.16 mathematics through the master door),
// reached server-side via the brain gateway. Non-self-hosted grid models keep
// their orchestrator relay behavior. If the core link is down, the request
// is still answered locally and flagged `brain: "fallback-local"` so the
// interface never strands the pilot.

type BrainSource = Engine;

// The ladder, top to bottom (see lib/answer-ladder.ts):
//   core gate → screens the message first; blocked gets the core's refusal
//   ollama    → SG16 Brain (Q4_K_M) on the operator's own metal answers clean messages
//   core      → the deterministic Q16.16 runtime if Ollama fails or times out
//   fallback  → the local guard channel so the pilot is never stranded

// GET /api/brain?probe=health        -> core reachability + stack status
// GET /api/brain?sessions=1          -> session list
// GET /api/brain?session=<id>        -> messages for a session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // whether the page should show the Turnstile widget (the site key is public by design)
  if (searchParams.get("probe") === "turnstile") {
    return NextResponse.json({ enabled: turnstileEnabled(), siteKey: turnstileSiteKey() });
  }

  if (searchParams.get("probe") === "health") {
    // Anyone may learn whether the brain is up; the stack detail is for the operator only.
    if (!(await isAdminRequest(req))) {
      const up = await brainHealth().then(() => true).catch(() => false);
      return NextResponse.json({ ok: up, brain: up ? "online" : "offline" }, { status: up ? 200 : 503 });
    }
    // The operator gets the whole honest picture: the core first, then the
    // heart-bridge, plus which law the answer would be spoken under.
    const heart = await ollamaHealth();
    try {
      const health = await brainHealth();
      return NextResponse.json({
        ok: true,
        brain: "online",
        persistence: persistenceMode,
        core: health,
        heart,
        lastAnswered: lastAnswer(),
        metrics: answerMetrics(),
        charter: charterDigest(),
      });
    } catch (err) {
      const status = err instanceof BrainGatewayError && err.status === 429 ? 429 : 503;
      return NextResponse.json(
        {
          ok: false,
          brain: "offline",
          // the bridge may still be holding the platform up on its own
          degradedTo: ollamaEnabled() && heart.status === "online" ? "ollama" : null,
          persistence: persistenceMode,
          heart,
          charter: charterDigest(),
          error: err instanceof Error ? err.message : "core unreachable",
        },
        { status },
      );
    }
  }

  const sessionId = searchParams.get("session");

  // This server keeps no conversation history for anyone: it lives on the visitor's own device
  // (see lib/device-vault.ts). These endpoints stay so older clients get a clear, harmless answer.
  if (sessionId) {
    return NextResponse.json(
      { error: "Conversation history is kept on your device, not on this server.", stored: false, storedOn: "device" },
      { status: 404 },
    );
  }
  return NextResponse.json({ sessions: [], stored: false, storedOn: "device" });
}

// POST { sessionId?, modelId, message } | { forgetSessionId }
// Tier gate: free guests share a fair-use hourly bucket per device-IP; a
// bound subscriber (Bearer identity/API token) enters WORK mode —
// wider process-local bucket, same configured core path.
export async function POST(req: NextRequest) {
  // Refuse oversized bodies before reading them (messages are capped at 8k chars).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That message is too big to send." }, { status: 413 });
  }

  // Per-visitor limit, before any body parsing or database work. The visitor key
  // is a salted hash held in memory only; nothing about the visitor is stored or
  // logged. Over the limit is a friendly 429, never an error page.
  // The operator's own projects (signed project key) are not visitors: no per-visitor limit and no
  // human check. They still queue for the single model like everyone else.
  const projectKey = projectFromHeaders(req.headers);
  const fromProject = projectKey !== null;
  const visitorKey = clientIdentity(req.headers).key;
  const projectSlots = Number(process.env.SG16_PROJECT_CONCURRENCY);
  const fairShare = projectKey
    ? { owner: `project:${projectKey.project}`, ownerLimit: Number.isInteger(projectSlots) && projectSlots > 0 ? projectSlots : 2 }
    : visitorKey
      ? { owner: `visitor:${visitorKey}`, ownerLimit: 1 }
      : {};
  // the exact inner engine is shown only to project keys and our own direct probes, never to visitors
  // (visitors arrive through the proxy, which also carries the proxy secret - see directProbe)
  const exactEngine = fromProject || directProbe(req.headers);
  const shown = (engine: string) => (exactEngine ? engine : publicEngine(engine));
  const decision = fromProject ? ({ ok: true } as const) : sharedRateLimiter().check(clientIdentity(req.headers));
  if (!decision.ok) {
    recordAnswer("rate-limited");
    return NextResponse.json(
      {
        error: rateLimitedLine(decision.scope),
        rateLimited: true,
        retryAt: Date.now() + decision.retryAfterSec * 1000,
      },
      { status: 429, headers: { "Retry-After": String(decision.retryAfterSec) } },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    sessionId?: unknown;
    modelId?: unknown;
    message?: unknown;
    forgetSessionId?: unknown;
    history?: unknown;
    stream?: unknown;
    turnstileToken?: unknown;
    mode?: unknown;
    humanToken?: unknown;
  } | null;
  const bodyKind: CharterBody = "flagship";

  const tierInfo = await resolveTier(req);
  const bucket = consumeBucket(tierInfo.bucketKey, tierInfo.limit);
  const rateHeaders = {
    "X-Chat-Tier": tierInfo.tier,
    "X-RateLimit-Limit": String(tierInfo.limit),
    "X-RateLimit-Remaining": String(bucket.remaining),
  };
  const json = (payload: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    NextResponse.json(payload, {
      status: init?.status,
      headers: { ...rateHeaders, ...(init?.headers ?? {}) },
    });

  if (!bucket.ok) {
    return json(
      {
        error: warmRateLimitLine(bodyKind, tierInfo.tier),
        tier: tierInfo.tier,
        tierChip: tierChip(bodyKind, tierInfo.tier),
        retryAt: bucket.resetAt,
      },
      { status: 429 },
    );
  }

  if (typeof body?.forgetSessionId === "string") {
    const forgetId = body.forgetSessionId;
    if (forgetId.length > 64) return json({ error: "Session id is invalid." }, { status: 400 });
    await brainForgetSession(forgetId);
    return json({ ok: true, hostContext: "reset", storedHistory: "unchanged" });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  // Chat is locked to the SG16 brain. A modelId in the request is ignored: there is
  // no relay to any other model, for anyone.
  const modelId = SG16_MODEL_ID;
  if (!message) {
    return json({ error: "Message is required." }, { status: 400 });
  }
  if (message.length > MAX_BRAIN_MESSAGE_CHARS) {
    return json(
      { error: `Message too long (${MAX_BRAIN_MESSAGE_CHARS} character limit).` },
      { status: 413 },
    );
  }

  // Optional Cloudflare Turnstile (off unless both keys are set). Fails open to
  // the rate limiter if Cloudflare cannot be reached.
  const human = !fromProject
    ? await checkHuman(
        { turnstileToken: body?.turnstileToken, humanToken: body?.humanToken },
        sharedHumanDeps(),
      )
    : ({ ok: true } as const);
  if (!human.ok) {
    return json(
      { error: "Please complete the quick check below, then send your message again.", turnstileRequired: true },
      { status: 403 },
    );
  }
  const humanExtra = "humanToken" in human && human.humanToken ? { humanToken: human.humanToken } : {};

  // Memory without storage: the device sends the last few answered turns; they serve this one answer.
  // The gate reads them together with the new message, so nothing can be smuggled in through them.
  const history = sanitizeHistory(body?.history);
  const gateText = gateTextFor(history, message);
  const mode = resolveMode(body?.mode, message);
  const technical = isCodeLike(mode);

  await ensureSeeded();
  const modelRows = await db.select().from(aiModels).where(eq(aiModels.id, modelId)).limit(1);
  const model = modelRows[0];
  if (!model) {
    return json({ error: "Unknown model." }, { status: 404 });
  }
  // Queue full: answer at once instead of hanging, and before anything is stored.
  if (ollamaEnabled() && sharedLimiter().saturated()) {
    recordAnswer("busy");
    return json({ error: BUSY_TEXT, busy: true, brain: "busy" }, { status: 503, headers: { "Retry-After": "3" } });
  }

  // ---- the thinking ladder: core → heart-bridge → guard → relay ----------
  // One ladder, used by every body. A turn reports which runtime actually
  // answered (`brain`), so the interface never dresses a lesser engine up as
  // the core (charter §10 honest claims, §19 intellectual honesty).
  const think = async (
    text: string,
    sessionId: string | null,
    live?: { onDelta?: (text: string) => void; signal?: AbortSignal },
  ): Promise<{ content: string; brain: BrainSource; relay: boolean }> => {
    const passToken = tierInfo.passToken;
    const startedAt = performance.now();
    const result = await runLadder(text, {
      // 1. the core's gate screens every message before any model sees it
      gate: () => brainIntrospect(gateText),
      // 2. SG16 Brain (Q4_K_M) via Ollama answers clean messages. The system prompt is the
      //    same for every request of a body (no tier, no context) so Ollama
      //    can reuse the cached prompt start.
      ollama: ollamaEnabled()
        ? async (t) => {
            // a language the model writes badly: say so (in that language) and answer in simple English
            const weak = weakLanguage(t);
            if (weak) live?.onDelta?.(`${WEAK_LANGUAGE_NOTE[weak]}\n\n`);
            const turn = await ollamaChat({
              // raw scripts and build requests: code first, no chatter, room for a whole file
              message: (weak ? t + ENGLISH_FALLBACK_HINT : t) + (technical ? CODE_HINT : ""),
              maxTokens: technical ? codeTokenBudget(ollamaMaxTokens()) : undefined,
              history,
              body: bodyKind,
              mode,
              onDelta: live?.onDelta,
              signal: live?.signal,
            });
            const cut = turn.truncated ? CUT_NOTE : "";
            return `${weak ? WEAK_LANGUAGE_NOTE[weak] + "\n\n" : ""}${turn.reply}${cut}`;
          }
        : null,
      // 3. deterministic core when Ollama fails or times out
      core: async (t) =>
        (await brainChat(t, sessionId ?? `ephemeral-${randomUUID()}`, passToken)).reply,
      // 4. local guard engine so the pilot is never stranded
      local: async (t, detail) => {
        const local = await generateReply(t);
        return [warmFallbackLine("fallback-local", detail), local.content].join("\n\n");
      },
      limiter: sharedLimiter(),
      queueWaitMs: queueWaitMs(),
      deadlineMs: answerDeadlineMs(),
      // fair share of the single model: a project may have a couple of answers going, a visitor one
      ...fairShare,
      // the bridge aborts its own fetch at ollamaTimeoutMs; this is the backstop
      ollamaTimeoutMs: ollamaTimeoutMs() + 5_000,
      signal: live?.signal ?? req.signal,
    });
    recordAnswer(result.engine, result.engine === "busy" ? undefined : performance.now() - startedAt);
    return { content: result.content, brain: result.engine, relay: false };
  };

  const requestedSession = typeof body?.sessionId === "string" ? body.sessionId : null;
  if (requestedSession && requestedSession.length > 64) {
    return json({ error: "Session id is invalid." }, { status: 400 });
  }

  // Nothing is stored here, signed in or not: the transcript is never written to a database.
  // A high-entropy guest handle only lets the core keep short in-memory context for this
  // conversation; it is not an archive or an authentication factor. The visitor's device
  // keeps the history.
  const guestSessionId = requestedSession && /^guest-[0-9a-f-]{36}$/i.test(requestedSession)
    ? requestedSession
    : `guest-${randomUUID()}`;
  const started = performance.now();
  const payloadFor = (turn: { content: string; brain: BrainSource; relay: boolean }) => {
    const now = new Date().toISOString();
    const latencyMs = Math.round(performance.now() - started);
    return {
      sessionId: guestSessionId,
      userMessage: {
        id: randomUUID(), sessionId: guestSessionId, role: "user", content: message,
        modelId: model.id, relay: false, latencyMs: 0, createdAt: now,
      },
      assistantMessage: {
        id: randomUUID(), sessionId: guestSessionId, role: "assistant", content: turn.content,
        modelId: model.id, relay: turn.relay, latencyMs, createdAt: now,
      },
      brain: shown(turn.brain),
      mode,
      tier: tierInfo.tier,
      stored: false,
      tierChip: tierChip(bodyKind, tierInfo.tier),
      ...humanExtra,
    };
  };

  // Streaming: the first word arrives in about a second even though a long answer takes a minute on
  // this hardware. Lines of JSON: {"type":"start"}, {"type":"delta","text":...} ..., then {"type":"done",
  // ...the same payload as a normal reply...}. The "done" text is authoritative; the deltas are for
  // reading along. Everything that can fail early (limits, checks) already answered as plain JSON above.
  if (body?.stream === true) {
    const leave = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            // the person has gone; nothing to write to
          }
        };
        send({ type: "start", sessionId: guestSessionId });
        try {
          const turn = await think(message, guestSessionId, {
            onDelta: (text) => send({ type: "delta", text }),
            signal: AbortSignal.any([req.signal, leave.signal]),
          });
          send({ type: "done", ...payloadFor(turn) });
        } catch {
          send({ type: "error", error: "The Brain could not finish this answer. Please try again." });
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      },
      cancel() {
        leave.abort();
      },
    });
    return new NextResponse(stream, {
      status: 200,
      headers: {
        ...rateHeaders,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        // tell every proxy: send each line as it is written, do not hold or compress it
        "Cache-Control": "no-store, no-transform",
        "Content-Encoding": "identity",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const turn = await think(message, guestSessionId);
  return json(payloadFor(turn));
}
// DELETE /api/brain?session=<id>  - history is on the device; this only clears the core's short
// in-memory context for that conversation.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session");
  if (!sessionId || sessionId.length > 64) {
    return NextResponse.json({ error: "session id required" }, { status: 400 });
  }
  await brainForgetSession(sessionId);
  return NextResponse.json({ ok: true, storedOn: "device", coreContextMayRemain: true });
}
