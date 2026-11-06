import { NextRequest, NextResponse } from "next/server";
import { BrainGatewayError, brainCheckout, brainGetBilling } from "@/lib/brain-gateway";
import { HUMANITARIAN_REGION, PASSES } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PASS_IDS: ReadonlySet<string> = new Set(PASSES.map((pass) => pass.id));

export async function GET() {
  try {
    const info = await brainGetBilling();
    return NextResponse.json({ ok: true, source: "core", billing: info });
  } catch (error) {
    // Display-only fallback. Checkout itself remains fail-closed while the
    // host is unavailable or Dodo is not configured.
    return NextResponse.json({
      ok: true,
      source: "display-only-constants",
      billing: {
        currency: "USD",
        humanitarian_region: HUMANITARIAN_REGION,
        passes: Object.fromEntries(PASSES.map((pass) => [pass.id, {
          label: pass.label,
          price: pass.price,
          hours: pass.hours,
        }])),
        gateway: { provider: "dodo-payments", mode: "unavailable" },
        error: error instanceof BrainGatewayError ? error.message : "core unreachable",
      },
    });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    pass?: unknown;
    return_url?: unknown;
  } | null;
  const passId = typeof body?.pass === "string" ? body.pass : "";
  if (!PASS_IDS.has(passId)) {
    return NextResponse.json({ error: "Unknown pass tier." }, { status: 400 });
  }
  const returnUrl = typeof body?.return_url === "string" ? body.return_url.slice(0, 512) : undefined;

  try {
    const result = await brainCheckout({ pass: passId, return_url: returnUrl });
    return NextResponse.json(result);
  } catch (error) {
    const coreStatus = error instanceof BrainGatewayError ? error.status : undefined;
    const status = coreStatus && [400, 403, 429].includes(coreStatus) ? coreStatus : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout is unavailable." },
      { status },
    );
  }
}
