// Who may see the operator console. Only verified emails listed in SG16_ADMIN_EMAILS
// (comma separated). Unset or empty means NOBODY is an operator: it fails closed.
// Pure, no framework imports, so it is unit-tested directly.

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SG16_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes("@"));
}

export function isAdminEmail(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!email) return false;
  return adminEmails(env).includes(email.trim().toLowerCase());
}
