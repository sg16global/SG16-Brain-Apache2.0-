import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-gate";
import { projectFromHeaders } from "@/lib/project-keys";
import { MAX_CODE_BYTES, runInSandbox, sandboxEnabled, validate, type Language } from "@/lib/sandbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/run { language: "python" | "node", code, timeoutMs? }
// Runs the script in a throwaway locked-down container (see lib/sandbox.ts). Only the operator and
// signed project keys may call it; visitors get no code execution. Nothing is stored or logged.

// at most two runs at once on this host, so a loop in a project cannot exhaust the machine
let running = 0;
const MAX_RUNNING = Math.max(1, Number(process.env.SG16_SANDBOX_CONCURRENCY) || 2);

export async function POST(req: NextRequest) {
  const project = projectFromHeaders(req.headers);
  if (!project && !(await isAdminRequest(req))) {
    return NextResponse.json({ error: "Running code needs a project key or operator sign-in." }, { status: 401 });
  }
  if (!sandboxEnabled()) {
    return NextResponse.json({ error: "The code sandbox is switched off on this server." }, { status: 503 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CODE_BYTES * 2) {
    return NextResponse.json({ error: "That request is too big." }, { status: 413 });
  }
  const body = (await req.json().catch(() => null)) as { language?: unknown; code?: unknown; timeoutMs?: unknown } | null;
  const problem = validate(body?.language, body?.code);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  if (running >= MAX_RUNNING) {
    return NextResponse.json({ error: "The sandbox is busy, try again in a moment.", busy: true }, { status: 429, headers: { "Retry-After": "3" } });
  }
  running++;
  try {
    const timeoutMs = typeof body?.timeoutMs === "number" ? body.timeoutMs : undefined;
    const result = await runInSandbox(body!.language as Language, body!.code as string, { timeoutMs });
    return NextResponse.json(result, { status: result.error ? 503 : 200 });
  } finally {
    running--;
  }
}
