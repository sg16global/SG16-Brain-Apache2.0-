import { isAdminEmail } from "@/lib/admin-auth";
import { verifyToken } from "@/lib/identity";

function bearer(req: Request): string | null {
  const m = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") ?? "");
  return m && m[1].length <= 512 ? m[1] : null;
}

/**
 * True only for a request carrying the signed operator token (issued by the operator login) whose
 * email is listed in SG16_ADMIN_EMAILS. Stateless: nothing is looked up or stored, so it also keeps
 * working across restarts. Project keys, passes and the owner header never make someone an operator.
 */
export async function isAdminRequest(req: Request): Promise<boolean> {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  return Boolean(payload && isAdminEmail(payload.email));
}
