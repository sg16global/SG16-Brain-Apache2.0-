import { NextRequest, NextResponse } from "next/server";
import { adminLogin } from "@/lib/admin-login";
import { isAdminEmail } from "@/lib/admin-auth";
import { signToken, verifyToken } from "@/lib/identity";
import { clientIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// There are NO user accounts on this platform. Visitors chat and subscribe without signing in, and
// the server keeps nothing about them (history and files live on their device; a subscription is
// the signed pass they hold). The only sign-in is the operator's: official email + password.

function bearer(req: NextRequest): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export async function GET() {
  return NextResponse.json({
    service: "SG16 operator sign-in",
    accounts: "none",
    storage: "Nothing about visitors is stored on the server. History and files stay on the visitor's device; a subscription is a signed pass held on the device.",
    operatorLogin: Boolean(process.env.SG16_ADMIN_PASSWORD_HASH && process.env.SG16_ADMIN_EMAILS),
  });
}

const NO_ACCOUNTS = {
  ok: false,
  error: "This platform has no user accounts. You can chat and subscribe without signing in; nothing about you is stored here.",
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "JSON object required" }, { status: 400 });
    }
    const action = String(body.action ?? "");

    // The operator signs in with email + password (no mail service, nothing stored). The lockout key
    // is the visitor's address only when our own proxy vouches for it; a forged header cannot dodge it.
    if (action === "admin-login") {
      const networkKey = clientIdentity(req.headers).key ?? "unverified-network";
      const result = adminLogin({ email: body.email, password: body.password, networkKey }, signToken);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, token: result.token, email: result.email, admin: true });
    }

    // Is this signed token the operator's? (stateless: the signature and the operator list decide)
    if (action === "me") {
      const payload = verifyToken(bearer(req) ?? "");
      if (!payload) return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
      return NextResponse.json({
        ok: true,
        email: payload.email.toLowerCase(),
        plan: null,
        tier: "work",
        admin: isAdminEmail(payload.email),
      });
    }

    // the old email-code sign-up, pass-linking and recovery flows are gone
    if (action === "request" || action === "verify" || action === "bind") {
      return NextResponse.json(NO_ACCOUNTS, { status: 410 });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "identity operation failed" },
      { status: 400 },
    );
  }
}
