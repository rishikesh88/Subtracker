import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encryption at rest for OAuth tokens.
 *
 * A Gmail refresh token is a long-lived key to somebody's mailbox. Held in
 * plaintext, anyone who reads the database -- a leaked connection string, a
 * stolen backup, a support query run against production -- can read every
 * connected inbox, and revoking that access means revoking every user's grant.
 * Encrypted, the database alone is not enough.
 *
 * AES-256-GCM, so ciphertext is authenticated: a tampered value fails to
 * decrypt rather than silently returning wrong bytes.
 *
 * Stored as `v1.<iv>.<tag>.<ciphertext>`, base64url. The version prefix does
 * the real work during rollout -- see `decryptToken`.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

/**
 * Resolves the key on first use rather than at import.
 *
 * Deliberately not read at module load: the server should still boot, serve
 * health checks and let people sign in if the variable is missing. Only
 * mailbox operations fail, and they fail loudly. The alternative -- quietly
 * writing plaintext when the key is absent -- would mean a misconfigured
 * deploy silently produces exactly the problem this module exists to prevent.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. OAuth tokens cannot be encrypted or read. " +
        "Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }

  // Accept base64 or hex so the value can be pasted from either generator.
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    key = Buffer.from(raw.trim(), "hex");
  } else {
    key = Buffer.from(raw.trim(), "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        "Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }

  cachedKey = key;
  return key;
}

/** True when a stored value is already in this module's format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(VERSION + ".");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns anything without the version prefix unchanged.
 *
 * This is what makes the rollout safe without a data migration. Rows written
 * before this shipped hold plaintext; they keep working, and each is replaced
 * with ciphertext the next time its token is refreshed and written back. No
 * bulk UPDATE against the database, and no window where the app is deployed
 * but the data is not yet in the format it expects.
 *
 * The cost is that a plaintext token stays readable until that row is next
 * written. `npm run tokens:status` reports how many are left.
 */
export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const parts = stored.split(".");
  if (parts.length !== 4) {
    throw new Error("Stored token is malformed: expected v1.<iv>.<tag>.<ciphertext>");
  }

  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Encrypts the named fields of a row about to be written. Null and undefined pass through. */
export function encryptFields<T extends Record<string, any>>(row: T, fields: readonly (keyof T)[]): T {
  const out: Record<string, any> = { ...row };
  for (const field of fields) {
    const value = out[field as string];
    if (typeof value === "string" && value.length > 0 && !isEncrypted(value)) {
      out[field as string] = encryptToken(value);
    }
  }
  return out as T;
}

/** Decrypts the named fields of a row just read. Null and undefined pass through. */
export function decryptFields<T extends Record<string, any>>(row: T, fields: readonly (keyof T)[]): T {
  const out: Record<string, any> = { ...row };
  for (const field of fields) {
    const value = out[field as string];
    if (typeof value === "string" && value.length > 0) {
      out[field as string] = decryptToken(value);
    }
  }
  return out as T;
}
