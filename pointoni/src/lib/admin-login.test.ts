// Run with: npm test
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { hashPassword, verifyPassword } from "./admin-password.ts";
import { adminLogin, resetAdminLoginLimits } from "./admin-login.ts";

const PASSWORD = "correct horse battery staple";
const HASH = hashPassword(PASSWORD);
const env = (over: Record<string, string | undefined> = {}) =>
  ({ SG16_ADMIN_EMAILS: "owner@example.com", SG16_ADMIN_PASSWORD_HASH: HASH, ...over }) as unknown as NodeJS.ProcessEnv;
const sign = (email: string) => `token-for-${email}`;
const login = (email: unknown, password: unknown, e = env(), net = "net-1", now = 1_000_000) =>
  adminLogin({ email, password, networkKey: net }, sign, e, now);

beforeEach(() => resetAdminLoginLimits());

test("password hash: right password verifies, wrong one does not, hashes are salted", () => {
  assert.equal(verifyPassword(PASSWORD, HASH), true);
  assert.equal(verifyPassword("wrong password!!", HASH), false);
  assert.notEqual(hashPassword(PASSWORD), HASH); // new salt every time
  assert.match(HASH, /^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/);
  assert.ok(!HASH.includes(PASSWORD));
});

test("password hash: malformed or hostile settings are refused, not trusted", () => {
  for (const bad of ["", "plain-text-password", "scrypt:1:1:1:a:b", "scrypt:99999999999:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "md5:1:2:3:4:5"]) {
    assert.equal(verifyPassword(PASSWORD, bad), false, bad);
  }
});

test("the operator gets a token with the right email and password", () => {
  const r = login("Owner@Example.com", PASSWORD);
  assert.deepEqual(r, { ok: true, token: "token-for-owner@example.com", email: "owner@example.com" });
});

test("a wrong password, a stranger's email and a correct password on the wrong email all get the same answer", () => {
  const a = login("owner@example.com", "not the password");
  const b = login("stranger@example.com", "not the password");
  const c = login("stranger@example.com", PASSWORD); // right password, email not registered
  for (const r of [a, b, c]) assert.deepEqual(r, { ok: false, status: 401, error: "Email or password is wrong." });
});

test("a server with no operator password or no operator email refuses everyone", () => {
  assert.equal(login("owner@example.com", PASSWORD, env({ SG16_ADMIN_PASSWORD_HASH: undefined })).ok, false);
  assert.equal((login("owner@example.com", PASSWORD, env({ SG16_ADMIN_EMAILS: "" })) as { status: number }).status, 503);
});

test("empty or oversized input is rejected before any password work", () => {
  assert.equal((login("", "x") as { status: number }).status, 400);
  assert.equal((login("owner@example.com", "x".repeat(300)) as { status: number }).status, 400);
  assert.equal((login({}, 5) as { status: number }).status, 400);
});

test("guessing is locked out after 5 tries, then allowed again after the window", () => {
  for (let i = 0; i < 5; i++) assert.equal((login("owner@example.com", `guess-${i}`) as { status: number }).status, 401);
  assert.equal((login("owner@example.com", PASSWORD) as { status: number }).status, 429); // even the right one is refused now
  assert.equal(login("owner@example.com", PASSWORD, env(), "net-1", 1_000_000 + 11 * 60_000).ok, true);
});

test("a lockout for one visitor does not lock out another network", () => {
  for (let i = 0; i < 5; i++) login("owner@example.com", `guess-${i}`, env(), "attacker");
  assert.equal(login("owner@example.com", PASSWORD, env(), "owner-home").ok, true);
});

test("a flood across many networks is stopped by the global cap", () => {
  let last = 0;
  for (let i = 0; i < 45; i++) last = (login("owner@example.com", `g${i}`, env(), `net-${i}`) as { status: number }).status;
  assert.equal(last, 429);
});
