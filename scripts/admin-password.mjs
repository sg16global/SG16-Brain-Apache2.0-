#!/usr/bin/env node
// Make the operator password hash for the server's .env. The password is typed here, never stored,
// never sent anywhere; only its salted scrypt hash is printed.
//   node scripts/admin-password.mjs
import crypto from "node:crypto";
import readline from "node:readline";

const N = 32768, R = 8, P = 1;

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // do not echo the password
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const one = await ask("Operator password (12+ characters): ");
if (one.length < 12) { console.error("Too short: use at least 12 characters."); process.exit(1); }
const two = await ask("Type it again: ");
if (one !== two) { console.error("They do not match."); process.exit(1); }
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(one, salt, 32, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
console.log("\nAdd this ONE line to the server's .env (and keep SG16_ADMIN_EMAILS set), then restart sg16-web:\n");
console.log(`SG16_ADMIN_PASSWORD_HASH=${["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(":")}`);
