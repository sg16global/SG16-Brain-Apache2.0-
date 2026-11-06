#!/usr/bin/env node
// SG16 BRAIN CORE — one-time setup of a FRESH Cloudflare account (2026-11-06).
//
// The fresh deployment shares nothing with the old account. This script, run
// once from brain-core/ after `npx wrangler login` (logged in to the NEW
// account), creates the Worker's own new resources:
//
//   KV namespace  sg16-keys   -> binding KEYS
//   D1 database   sg16_logs   -> binding LOGS, with schema.sql loaded
//
// and writes their new ids into wrangler.jsonc. It never touches anything that
// already exists: if wrangler.jsonc already holds ids, it stops.
//
//   node scripts/fresh-setup.mjs          show the account and what would be created
//   node scripts/fresh-setup.mjs --yes    create them
//
// Then commit wrangler.jsonc (the ids are not secret) and follow
// docs/FRESH-DEPLOY.md for the secrets and the first deploy.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const configArg = args.indexOf("--config");
const configPath = configArg >= 0 ? args[configArg + 1] : join(root, "wrangler.jsonc");

const KV_NAME = "sg16-keys";
const D1_NAME = "sg16_logs";
const KV_LINE = '{ "binding": "KEYS" }';
const D1_LINE = '{ "binding": "LOGS", "database_name": "sg16_logs" }';

// tests replace wrangler with canned answers (FRESH_SETUP_FAKE=1); nothing is called then
function wrangler(argv, { capture = true } = {}) {
  if (process.env.FRESH_SETUP_FAKE === "1") {
    const cmd = argv.join(" ");
    if (cmd.startsWith("whoami")) return "You are logged in with an API Token, associated with the email test@example.org.\nAccount Name  Account ID\nTest   0123456789abcdef0123456789abcdef\n";
    if (cmd.startsWith("kv namespace create")) return '✨ Success!\n{\n  "kv_namespaces": [\n    {\n      "binding": "KEYS",\n      "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\n    }\n  ]\n}\n';
    if (cmd.startsWith("d1 create")) return '✅ Successfully created DB\n{\n  "d1_databases": [\n    {\n      "binding": "LOGS",\n      "database_name": "sg16_logs",\n      "database_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"\n    }\n  ]\n}\n';
    if (cmd.startsWith("d1 execute")) return "🚣 Executed\n";
    return "";
  }
  const res = spawnSync("npx", ["wrangler", ...argv], {
    cwd: root,
    shell: process.platform === "win32",
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  if (capture) process.stdout.write(out);
  if (res.status !== 0) {
    console.error(`\nwrangler ${argv.join(" ")} failed (exit ${res.status}). Nothing after this step was done.`);
    process.exit(1);
  }
  return out;
}

const config = readFileSync(configPath, "utf8");
if (!config.includes(KV_LINE) || !config.includes(D1_LINE)) {
  console.error(
    "wrangler.jsonc already holds KV / D1 ids (or was edited by hand).\n" +
    "This script only sets up a fresh account once, and never overwrites ids. Nothing was done.",
  );
  process.exit(1);
}

console.log("== The Cloudflare account Wrangler is logged in to ==");
wrangler(["whoami"]);
console.log(
  "\nThis will create, in THAT account:\n" +
  `  KV namespace "${KV_NAME}"  (binding KEYS)\n` +
  `  D1 database  "${D1_NAME}"  (binding LOGS) and load schema.sql into it\n` +
  "and write the two new ids into wrangler.jsonc.\n",
);
if (!yes) {
  console.log("Check that this is the NEW account. To go ahead: node scripts/fresh-setup.mjs --yes");
  process.exit(0);
}

const kvOut = wrangler(["kv", "namespace", "create", KV_NAME, "--update-config=false"]);
const kvId = /"id"\s*:\s*"([0-9a-f]{32})"/.exec(kvOut)?.[1];
if (!kvId) {
  console.error("Could not read the new KV namespace id from wrangler's answer above. Put it into wrangler.jsonc by hand.");
  process.exit(1);
}

const d1Out = wrangler(["d1", "create", D1_NAME, "--update-config=false"]);
const d1Id = /"database_id"\s*:\s*"([0-9a-f-]{36})"/.exec(d1Out)?.[1];
if (!d1Id) {
  console.error(`KV namespace created (id ${kvId}), but the D1 id could not be read from wrangler's answer above.`);
  process.exit(1);
}

const updated = config
  .replace(KV_LINE, `{ "binding": "KEYS", "id": "${kvId}" }`)
  .replace(D1_LINE, `{ "binding": "LOGS", "database_name": "sg16_logs", "database_id": "${d1Id}" }`);
writeFileSync(configPath, updated);
console.log(`\nwrangler.jsonc: KEYS -> ${kvId}, LOGS -> ${d1Id}`);

console.log("\n== Loading schema.sql into the new database ==");
wrangler(["d1", "execute", D1_NAME, "--remote", "--file", "schema.sql", "--yes"], { capture: false });

console.log(
  "\nDone. Next (docs/FRESH-DEPLOY.md):\n" +
  "  1. set the secrets:  npx wrangler secret put SG16_IDENTITY_SECRET   (and the others listed there)\n" +
  "  2. deploy once:      npm run deploy\n" +
  "  3. commit wrangler.jsonc with the new ids before connecting GitHub.",
);
