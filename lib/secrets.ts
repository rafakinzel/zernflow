/**
 * Encryption for credentials stored in the database.
 *
 * The workspace rows hold vendor API keys, and until now they sat there in
 * plaintext despite the column name. These helpers encrypt them with
 * AES-256-GCM under a key from the environment.
 *
 * Two properties matter more than the cipher choice:
 *
 *  - Reading is backward compatible. Values written before this existed are
 *    plaintext, so `decryptSecret` returns anything that is not in the
 *    envelope format untouched. No migration pass, no downtime, and a key
 *    re-saved in Settings is written encrypted from then on.
 *  - A missing key degrades loudly but does not break the app. Without
 *    ENCRYPTION_KEY the value is stored as it is and `encryptionAvailable()`
 *    reports false so Settings can say so, rather than the deployment
 *    silently losing every stored credential.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** Reads the 32-byte key from ENCRYPTION_KEY, or null when unusable. */
function encryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error(
      `[secrets] ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. Storing credentials unencrypted.`
    );
    return null;
  }
  return key;
}

/** True when a usable ENCRYPTION_KEY is configured. */
export function encryptionAvailable(): boolean {
  return encryptionKey() !== null;
}

/** True when a stored value is in the encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypts a credential for storage. Returns the value unchanged when no key
 * is configured, so a deployment without one keeps working as it did before.
 */
export function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX + iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a stored credential.
 *
 * A value that is not in the envelope format is returned as it is: that is a
 * credential written before encryption existed. A value that IS in the
 * envelope format but cannot be decrypted throws, because returning the
 * ciphertext as if it were a key would send garbage to the vendor and read
 * as "your API key is wrong".
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const key = encryptionKey();
  if (!key) {
    throw new Error(
      "This credential is encrypted but ENCRYPTION_KEY is not set in this environment."
    );
  }

  const [, , ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is malformed.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
