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

/** Reads a 32-byte key from an environment variable, or null when unusable. */
function readKey(name: string): Buffer | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error(
      `[secrets] ${name} must decode to 32 bytes, got ${key.length}. Ignoring it.`
    );
    return null;
  }
  return key;
}

/** The key new values are written with. */
function encryptionKey(): Buffer | null {
  return readKey("ENCRYPTION_KEY");
}

/**
 * The key being rotated out, when one is set.
 *
 * Rotation is two deploys, not one. Set ENCRYPTION_KEY_PREVIOUS to the old
 * key alongside the new ENCRYPTION_KEY and nothing breaks while the stored
 * values are still sealed with the old one: reads fall back, writes use the
 * new key. Once everything has been re-encrypted, drop the variable. Without
 * this a rotation would take every stored credential down with it until each
 * one was re-entered by hand.
 */
function previousKey(): Buffer | null {
  return readKey("ENCRYPTION_KEY_PREVIOUS");
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

  const keys = [encryptionKey(), previousKey()].filter(
    (k): k is Buffer => k !== null
  );

  if (keys.length === 0) {
    throw new Error(
      "This credential is encrypted but ENCRYPTION_KEY is not set in this environment."
    );
  }

  const [, , ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is malformed.");
  }

  // The current key is tried first, so the common case costs one attempt and
  // only values still sealed with the outgoing key pay for the second.
  for (const key of keys) {
    try {
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
    } catch {
      // Wrong key: the auth tag fails. Try the next one.
    }
  }

  throw new Error(
    "This credential could not be decrypted with the configured key. If the key was just rotated, set ENCRYPTION_KEY_PREVIOUS to the old one."
  );
}

/**
 * Whether a stored value would be written differently today.
 *
 * True for a plaintext value once a key exists, and for a value sealed with
 * the outgoing key. Used to report what is left to re-encrypt without
 * decrypting anything for display.
 */
export function needsReencryption(stored: string): boolean {
  if (!stored) return false;
  const current = encryptionKey();
  if (!current) return false;
  if (!isEncrypted(stored)) return true;

  const [, , ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return false;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      current,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return false;
  } catch {
    return true;
  }
}

/** True when a key is being rotated out right now. */
export function rotationInProgress(): boolean {
  return previousKey() !== null;
}
