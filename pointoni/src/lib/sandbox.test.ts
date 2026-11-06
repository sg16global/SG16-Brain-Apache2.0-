import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { dockerArgs, runInSandbox, validate, MAX_OUTPUT_BYTES, MAX_CODE_BYTES } from "./sandbox.ts";

function fakeChild(script: (c: { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; emit: (e: string, ...a: unknown[]) => void }) => void) {
  const ee = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: (s?: string) => boolean; killed: boolean };
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  ee.stdin = new PassThrough();
  ee.killed = false;
  ee.kill = () => { ee.killed = true; return true; };
  setImmediate(() => script(ee));
  return ee as unknown as ChildProcess;
}

test("every run is isolated: no network, read-only, no capabilities, no privilege gain, capped, unprivileged", () => {
  const args = dockerArgs("python", "sg16-run-x").join(" ");
  for (const flag of [
    "--rm", "--pull never", "--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges",
    "--pids-limit 64", "--memory 128m", "--memory-swap 128m", "--cpus 0.5", "--user 65534:65534", "noexec",
  ]) assert.ok(args.includes(flag), flag);
  assert.doesNotMatch(args, /--privileged|--network host|-v |--volume|docker\.sock/);
  assert.match(dockerArgs("node", "n").join(" "), /node -$/);
  assert.match(args, /python -I -$/);
});

test("the code never reaches the command line: it goes in on stdin", async () => {
  let seen = "";
  let argv: string[] = [];
  const r = await runInSandbox("python", "print('$(rm -rf /)')", {}, {
    spawn: (_c, a) => { argv = a; return fakeChild((c) => { c.stdin.on("data", (d) => (seen += d)); c.stdout.write("ok\n"); setImmediate(() => c.emit("close", 0)); }); },
    kill: () => undefined,
  });
  assert.equal(seen, "print('$(rm -rf /)')");
  assert.ok(!argv.join(" ").includes("rm -rf"));
  assert.equal(r.ok, true);
  assert.equal(r.stdout, "ok\n");
});

test("a failing script reports its exit code and stderr", async () => {
  const r = await runInSandbox("node", "x", {}, {
    spawn: () => fakeChild((c) => { c.stderr.write("boom"); setImmediate(() => c.emit("close", 1)); }),
    kill: () => undefined,
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 1);
  assert.equal(r.stderr, "boom");
});

test("a script that runs too long is killed (container and client) and reported as timed out", async () => {
  const killed: string[] = [];
  const r = await runInSandbox("python", "while True: pass", { timeoutMs: 1000 }, {
    spawn: () => fakeChild(() => undefined),
    kill: (n) => killed.push(n),
  });
  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
  assert.equal(killed.length, 1);
  assert.match(killed[0], /^sg16-run-/);
});

test("output is capped and a flood stops the run", async () => {
  const killed: string[] = [];
  const r = await runInSandbox("python", "x", {}, {
    spawn: () => fakeChild((c) => { c.stdout.write("a".repeat(MAX_OUTPUT_BYTES * 2)); }),
    kill: (n) => killed.push(n),
  });
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.length <= MAX_OUTPUT_BYTES);
  assert.equal(killed.length, 1);
});

test("missing docker is reported plainly", async () => {
  const r = await runInSandbox("python", "x", {}, {
    spawn: () => fakeChild((c) => c.emit("error", new Error("spawn docker ENOENT"))),
    kill: () => undefined,
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /docker is not installed/);
});

test("input checks: language, empty code, oversized code", () => {
  assert.equal(validate("python", "print(1)"), null);
  assert.match(validate("ruby", "x") ?? "", /language/);
  assert.match(validate("python", "  ") ?? "", /required/);
  assert.match(validate("node", "x".repeat(MAX_CODE_BYTES + 1)) ?? "", /too large/);
});

test("the run route is closed to visitors and off unless enabled", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "../app/api/run/route.ts"), "utf8");
  assert.match(src, /projectFromHeaders/);
  assert.match(src, /isAdminRequest/);
  assert.ok(src.indexOf("401") < src.indexOf("sandboxEnabled()"), "auth is checked before anything else");
  assert.match(src, /sandboxEnabled\(\)/);
});
