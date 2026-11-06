// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { adminEmails, isAdminEmail } from "./admin-auth.ts";

const env = (v: string | undefined) => ({ SG16_ADMIN_EMAILS: v }) as unknown as NodeJS.ProcessEnv;
const SRC = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

test("unset or empty means nobody is an operator (fails closed)", () => {
  assert.deepEqual(adminEmails(env(undefined)), []);
  assert.deepEqual(adminEmails(env("")), []);
  assert.deepEqual(adminEmails(env(" , ,not-an-email")), []);
  assert.equal(isAdminEmail("anyone@example.com", env(undefined)), false);
});

test("only listed emails are operators, case and spacing do not matter", () => {
  const e = env(" Owner@Example.com , second@example.com ");
  assert.equal(isAdminEmail("owner@example.com", e), true);
  assert.equal(isAdminEmail("OWNER@EXAMPLE.COM", e), true);
  assert.equal(isAdminEmail("second@example.com", e), true);
  assert.equal(isAdminEmail("third@example.com", e), false);
  assert.equal(isAdminEmail("owner@example.com.evil.com", e), false);
  assert.equal(isAdminEmail("", e), false);
  assert.equal(isAdminEmail(null, e), false);
});

test("the operator-only routes really call the server-side check", () => {
  for (const rel of ["app/api/admin/route.ts", "app/api/health/route.ts", "app/api/models/route.ts", "app/api/brain/route.ts"]) {
    assert.match(read(rel), /isAdminRequest\(/, `${rel} must check isAdminRequest`);
  }
  assert.match(read("app/api/admin/route.ts"), /403/);
});

test("the public health answer carries no engine, model or counter detail", () => {
  const src = read("app/api/health/route.ts");
  const publicReply = src.slice(src.indexOf("if (!(await isAdminRequest(req)))"), src.indexOf("return Response.json(\n    {\n      ok: database,\n      admin: true"));
  assert.match(publicReply, /ok: database, database, brain/);
  assert.doesNotMatch(publicReply, /metrics|heart|lastAnswered|engines|charter|persistence/);
});

test("there is no fake session cookie any more", () => {
  assert.equal(fs.existsSync(path.join(SRC, "app/api/session/route.ts")), false);
  for (const rel of ["components/chrome/Sidebar.tsx", "app/signed-out/page.tsx"]) {
    assert.doesNotMatch(read(rel), /api\/session|sg16_auth/, rel);
  }
});

test("Sign Out is only offered to someone who is really signed in", () => {
  const sidebar = read("components/chrome/Sidebar.tsx");
  assert.match(sidebar, /signedIn \? \(/);
  assert.match(sidebar, /href="\/login"/);
});
