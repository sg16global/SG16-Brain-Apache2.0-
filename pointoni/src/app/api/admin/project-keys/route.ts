import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-gate";
import { createProjectKey, isValidProjectName, projectKeySecret, revokedProjects } from "@/lib/project-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Operator only. A key is signed on the spot and returned ONCE; the server stores nothing, so the
// operator copies it now. See lib/project-keys.ts for how a project is stopped.
async function guard(req: NextRequest) {
  if (await isAdminRequest(req)) return null;
  const signedIn = Boolean(req.headers.get("authorization"));
  return NextResponse.json(
    { error: signedIn ? "This account is not an operator." : "Operator sign-in required." },
    { status: signedIn ? 403 : 401 },
  );
}

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return NextResponse.json({ configured: projectKeySecret() !== null, revoked: revokedProjects() });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const secret = projectKeySecret();
  if (!secret) {
    return NextResponse.json({ error: "SG16_PROJECT_KEY_SECRET is not set on this server (32+ characters)." }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { project?: unknown } | null;
  const project = typeof body?.project === "string" ? body.project.trim().toLowerCase() : "";
  if (!isValidProjectName(project)) {
    return NextResponse.json({ error: "Project name: 1-40 characters, lowercase letters, digits and dashes." }, { status: 400 });
  }
  return NextResponse.json(
    { project, key: createProjectKey(project, secret), shownOnce: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
