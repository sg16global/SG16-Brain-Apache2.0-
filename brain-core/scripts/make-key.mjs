#!/usr/bin/env node
// Mint one API key and print the exact wrangler command that registers it in
// Workers KV. Every consumer — owner, project, user — gets keys this way;
// the owner is simply user #1.
//
//   node scripts/make-key.mjs                     # owner (user 1, platform)
//   node scripts/make-key.mjs --user 2 --project pointoni
//
// The key is printed ONCE; only its SHA-256 goes into KV.

import crypto from "node:crypto";
import process from "node:process";

const args = process.argv.slice(2);
const get = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const user = Number(get("user", 1));
const project = get("project", "platform");

const bytes = crypto.randomBytes(16);
const key = "sg16_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const hash = crypto.createHash("sha256").update(key).digest("hex");
const id = "k_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
const record = { id, user, project, created: Date.now(), revoked: false };

console.log("API key (store it now — shown once):\n");
console.log(key);
console.log("\nRegister it in KV with:\n");
console.log(`npx wrangler kv key put --binding KEYS "${hash}" '${JSON.stringify(record)}'`);
console.log(`\nOptional per-project policy:`);
console.log(`npx wrangler kv key put --binding KEYS "policy:${project}" '{"rpm":60,"max_queue_ms":45000,"require_json":false,"blocked_patterns":[]}'`);
