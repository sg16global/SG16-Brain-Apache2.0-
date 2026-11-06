// Run with: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  PROJECT_KEY_PREFIX,
  createProjectKey,
  isValidProjectName,
  projectFromHeaders,
  projectKeySecret,
  revokedProjects,
  verifyProjectKey,
} from "./project-keys.ts";

const SECRET = "s".repeat(40);
const env = (o: Record<string, string | undefined> = {}) => ({ SG16_PROJECT_KEY_SECRET: SECRET, ...o }) as unknown as NodeJS.ProcessEnv;
const req = (key: string) => new Headers({ authorization: `Bearer ${key}` });

test("a key verifies and names its project", () => {
  const key = createProjectKey("my-shop", SECRET);
  assert.ok(key.startsWith(PROJECT_KEY_PREFIX));
  assert.deepEqual(verifyProjectKey(key, SECRET), { project: "my-shop" });
});

test("every key is different even for the same project (random nonce)", () => {
  assert.notEqual(createProjectKey("a1", SECRET), createProjectKey("a1", SECRET));
});

test("a changed key, a changed project, a wrong secret and junk are all refused", () => {
  const key = createProjectKey("my-shop", SECRET);
  const [head, sig] = key.split(".");
  assert.equal(verifyProjectKey(`${head}.${sig.slice(0, -2)}AA`, SECRET), null);
  const other = createProjectKey("other-project", SECRET).split(".")[0];
  assert.equal(verifyProjectKey(`${other}.${sig}`, SECRET), null); // another project's body with this key's signature
  assert.equal(verifyProjectKey(key, "t".repeat(40)), null);
  for (const junk of ["", "sg16p_", "sg16p_abc", "sg16_" + "a".repeat(48), "Bearer x", "x".repeat(500)]) {
    assert.equal(verifyProjectKey(junk, SECRET), null, junk);
  }
});

test("revoking a project name stops its keys; other projects keep working", () => {
  const a = createProjectKey("shop-a", SECRET);
  const b = createProjectKey("shop-b", SECRET);
  assert.equal(verifyProjectKey(a, SECRET, ["shop-a"]), null);
  assert.deepEqual(verifyProjectKey(b, SECRET, ["shop-a"]), { project: "shop-b" });
});

test("project names are restricted; short secrets are refused", () => {
  for (const ok of ["a", "my-shop", "x9", "a".repeat(40)]) assert.equal(isValidProjectName(ok), true, ok);
  for (const bad of ["", "-a", "A", "has space", "a_b", "a".repeat(41), "../x", 5, null]) assert.equal(isValidProjectName(bad), false, String(bad));
  assert.throws(() => createProjectKey("Bad Name", SECRET));
  assert.throws(() => createProjectKey("good", "short"));
  assert.equal(projectKeySecret(env({ SG16_PROJECT_KEY_SECRET: "short" })), null);
});

test("the request helper needs the secret to be configured, the bearer prefix and a valid key", () => {
  const key = createProjectKey("my-shop", SECRET);
  assert.deepEqual(projectFromHeaders(req(key), env()), { project: "my-shop" });
  assert.equal(projectFromHeaders(req(key), env({ SG16_PROJECT_KEY_SECRET: undefined })), null);
  assert.equal(projectFromHeaders(new Headers(), env()), null);
  assert.equal(projectFromHeaders(new Headers({ authorization: key }), env()), null); // no "Bearer"
  assert.equal(projectFromHeaders(req(key), env({ SG16_REVOKED_PROJECTS: " My-Shop , other " })), null);
  assert.deepEqual(revokedProjects(env({ SG16_REVOKED_PROJECTS: " My-Shop , other ,," })), ["my-shop", "other"]);
});

test("nothing about keys is stored: no database or file access in the key code or its route", () => {
  const root = path.resolve(import.meta.dirname, "..");
  for (const rel of ["lib/project-keys.ts", "app/api/admin/project-keys/route.ts"]) {
    if (!fs.existsSync(path.join(root, rel))) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(root, rel), "utf8"), /@\/db|drizzle|node:fs|writeFile|localStorage/, rel);
  }
});
