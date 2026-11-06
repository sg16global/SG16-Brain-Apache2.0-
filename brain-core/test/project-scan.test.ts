// Project Vital Scan + chat history folding tests.
// The scan engine is a faithful port of the old host's SCAN-CORE v1: the zip
// reader, pattern banks, checks and scoring must behave identically.

import test from "node:test";
import assert from "node:assert/strict";

import {
  unzip,
  buildReport,
  projectScanRoute,
} from "../src/project-scan.ts";
import { recentHistory } from "../src/design-compat.ts";

// -------------------------------------------------------------- recent turns

test("recentHistory keeps recent turns as chat turns inside the 8K budget and ignores garbage", () => {
  const history = [
    { role: "user", content: "What is 2+2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "and times 10?" },
    { role: "assistant", content: "40" },
  ];
  assert.deepEqual(recentHistory(history, "now divide by 4"), history);

  // budget: huge turns are dropped from the oldest side
  const big = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(900),
  }));
  const kept = recentHistory(big, "hello");
  const size = kept.reduce((n, t) => n + t.content.length + t.role.length + 4, "hello".length);
  assert.ok(size <= 8192);
  assert.ok(kept.length > 0 && kept.length <= 6, "only the last turns are kept");

  // garbage and empty histories give no turns
  assert.deepEqual(recentHistory("not-an-array" as never, "hi"), []);
  assert.deepEqual(recentHistory([{ role: "bogus", content: "x" }], "hi"), []);
  assert.deepEqual(recentHistory([], "hi"), []);
});

// ------------------------------------------------------------------- zip

/** Build a minimal STORED (method 0) zip archive in memory. */
function storedZip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (any)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, e.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

test("unzip reads stored archives and rejects non-zip bytes", async () => {
  const zip = storedZip([
    { name: "src/app.js", data: Buffer.from("console.log('hi');\n", "utf8") },
    { name: "README.md", data: Buffer.from("# demo\n", "utf8") },
  ]);
  const entries = await unzip(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, "src/app.js");
  assert.equal(entries[0].data.toString("utf8"), "console.log('hi');\n");

  await assert.rejects(() => unzip(Buffer.from("definitely not a zip")), /Not a ZIP archive/);
});

// ------------------------------------------------------------------ report

test("buildReport finds secrets, debug leftovers, and redacts evidence", () => {
  const files = [
    {
      path: "app.js",
      data: Buffer.from(
        'const apiKey = "sk_live_abcdefghijklmnop1234";\nconsole.log("boot");\n// TODO: clean this up\n',
        "utf8",
      ),
    },
  ];
  const report = buildReport(files);
  assert.equal(report.version, "1.0.0");
  assert.equal(report.stats.analyzedFiles, 1);
  assert.ok(report.findings.length >= 2, "secret + console.log findings expected");
  const secret = report.findings.find((f) => f.severity === "critical");
  assert.ok(secret, "the Stripe live key must be critical");
  assert.match(secret!.where, /app\.js:1/);
  assert.match(secret!.snippet, /REDACTED/);
  assert.ok(!secret!.snippet.includes("sk_live_abcdefghijklmnop1234"), "the secret itself must never echo");
  const secretCheck = report.checks.find((c) => c.key === "secret-exposure");
  assert.equal(secretCheck!.status, "fail");
});

// ------------------------------------------------------------------- route

test("projectScanRoute: GET description, POST paste mode, empty body 400", async () => {
  const get = await projectScanRoute(new Request("https://x/api/project-scan"), "/api/project-scan");
  assert.equal(get?.status, 200);
  const desc = (await get?.json()) as { service: string; budgets: { files: number } };
  assert.equal(desc.service, "SG16 Project Vital Scan");
  assert.equal(desc.budgets.files, 300);

  const post = await projectScanRoute(
    new Request("https://x/api/project-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "demo.js", content: 'const x = eval("1+1");\n' }),
    }),
    "/api/project-scan",
  );
  assert.equal(post?.status, 200);
  const report = (await post?.json()) as { stats: { files: number }; findings: { rule: string }[] };
  assert.equal(report.stats.files, 1);
  assert.ok(report.findings.some((f) => /eval/.test(f.rule)));

  const empty = await projectScanRoute(
    new Request("https://x/api/project-scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    "/api/project-scan",
  );
  assert.equal(empty?.status, 400);
  assert.match((await empty?.json()).error, /Nothing scannable/);

  // multipart mode with a loose file
  const form = new FormData();
  form.append("files", new File([Buffer.from("print('hello')\n", "utf8")], "main.py", { type: "text/plain" }));
  const multi = await projectScanRoute(
    new Request("https://x/api/project-scan", { method: "POST", body: form }),
    "/api/project-scan",
  );
  assert.equal(multi?.status, 200);
  const pyReport = (await multi?.json()) as { stats: { languages: { lang: string }[] } };
  assert.ok(pyReport.stats.languages.some((l) => l.lang === "Python"));

  // unclaimed paths pass through
  assert.equal(await projectScanRoute(new Request("https://x/api/other"), "/api/other"), null);
});
