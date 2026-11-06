// Run with: npm test
// The platform keeps no user data: no accounts, no profiles, no tickets, no stored tokens.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(SRC, rel));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

test("the account code and pages are gone", () => {
  assert.equal(exists("lib/account-auth.ts"), false);
  for (const page of ["app/account/page.tsx", "app/devices/page.tsx", "app/settings/page.tsx"]) assert.equal(exists(page), false, page);
});

test("no source file touches the user tables or the account helpers", () => {
  const banned = /resolveAccount|account-auth|sovereignIdentities|authCodes|apiTokens|\bstoredFiles\b|\bchatSessions\b|\bchatMessages\b|requestMagicCode|verifyMagicCode|bindVerifiedPlan/;
  const hits = sourceFiles(SRC)
    .filter((f) => !f.endsWith(path.join("db", "schema.ts")))
    .filter((f) => banned.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f));
  assert.deepEqual(hits, []);
});

test("the retired routes only answer 410 and never read or write anything", () => {
  for (const rel of ["app/api/devices/route.ts", "app/api/profile/route.ts", "app/api/tickets/route.ts", "app/api/tokens/route.ts", "app/api/files/route.ts"]) {
    const src = read(rel);
    assert.match(src, /status: 410/, rel);
    assert.doesNotMatch(src, /@\/db|drizzle|node:fs|req\.json|request\.json/, rel);
  }
});

test("the identity route has no sign-up, code or pass-linking flow", () => {
  const src = read("app/api/identity/route.ts");
  assert.match(src, /NO_ACCOUNTS/);
  assert.match(src, /status: 410/);
  assert.doesNotMatch(src, /requestMagicCode|verifyMagicCode|bindVerifiedPlan|getIdentity|@\/db/);
});

test("the sidebar offers no account pages and the admin link stays operator-only", () => {
  const nav = read("components/chrome/nav-items.ts");
  for (const gone of ["/account", "/devices", "/settings"]) assert.doesNotMatch(nav, new RegExp(`href: "${gone}"`), gone);
  assert.match(read("components/chrome/Sidebar.tsx"), /item\.href !== "\/admin" \|\| isAdmin/);
});

test("contact and support send nothing to this server", () => {
  for (const rel of ["app/contact/page.tsx", "app/support/page.tsx"]) {
    const src = read(rel);
    assert.doesNotMatch(src, /fetch\(/, rel);
    assert.match(src, /mailto:/, rel);
  }
});

test("the identity module keeps no database", () => {
  const src = read("lib/identity.ts");
  assert.doesNotMatch(src, /@\/db|drizzle/);
});
