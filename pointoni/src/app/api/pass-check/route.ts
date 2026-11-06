import { NextRequest, NextResponse } from "next/server";
import { BrainGatewayError, brainVerifyPass } from "@/lib/brain-gateway";
import { clientIdentity, sharedRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/pass-check {pass} - "is this pass genuine and unexpired?" Used when a person restores a
// saved pass file. Nothing is stored and nothing about the caller is recorded.
export async function POST(req: NextRequest) {
  if (!sharedRateLimiter().check(clientIdentity(req.headers)).ok) {
    return NextResponse.json({ valid: false, error: "Too many checks. Try again in a moment." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { pass?: unknown } | null;
  const pass = typeof body?.pass === "string" ? body.pass.trim() : "";
  if (!/^[A-Za-z0-9_-]{40,3000}$/.test(pass)) {
    return NextResponse.json({ valid: false, error: "That is not a pass." }, { status: 400 });
  }
  try {
    const verified = await brainVerifyPass(pass);
    return NextResponse.json({ valid: true, pass: verified.record.pass, expires_at: verified.record.expires_at });
  } catch (err) {
    const status = err instanceof BrainGatewayError && err.status === 403 ? 403 : 503;
    return NextResponse.json(
      { valid: false, error: status === 403 ? "This pass is not valid, or it has expired." : "The host could not check the pass right now." },
      { status },
    );
  }
}
