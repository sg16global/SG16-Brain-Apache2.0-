import { NextRequest, NextResponse } from "next/server";
import { brainConfirmCheckout, BrainGatewayError } from "@/lib/brain-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { session_id?: unknown } | null;
  const sessionId = typeof body?.session_id === "string" ? body.session_id : "";
  if (!sessionId || sessionId.length > 128) {
    return NextResponse.json({ error: "A valid checkout reference is required." }, { status: 400 });
  }
  try {
    const result = await brainConfirmCheckout(sessionId);
    return NextResponse.json(result, { status: result.confirmed ? 200 : 202 });
  } catch (error) {
    const status = error instanceof BrainGatewayError && error.status === 404 ? 404 : 503;
    return NextResponse.json(
      { error: "The SG16 host could not confirm this checkout." },
      { status },
    );
  }
}
