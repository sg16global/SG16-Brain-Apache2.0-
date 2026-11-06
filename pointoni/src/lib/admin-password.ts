// Operator password: kept ONLY as a salted scrypt hash in the server's environment
// (SG16_ADMIN_PASSWORD_HASH). Nothing about it, or about any user, is ever written to a database.
// Format: scrypt:N:r:p:<salt base64url>:<hash base64url>  (colons, so no shell or systemd quoting trouble)
import crypto from "node:crypto";

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 128 * 1024 * 1024;

export function hashPassword(password: string, salt: Buffer = crypto.randomBytes(16)): string {
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

/** A hash nobody can match, used so a wrong email costs the same time as a wrong password. */
export const DUMMY_HASH = hashPassword("this-is-not-a-real-password", Buffer.alloc(16, 7));

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // refuse absurd parameters from a corrupted setting instead of exhausting memory
  if (![n, r, p].every(Number.isInteger) || n < 1024 || n > 1 << 20 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length < 8 || expected.length < 16 || expected.length > 128) return false;
    const actual = crypto.scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
