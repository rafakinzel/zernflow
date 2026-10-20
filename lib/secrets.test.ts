import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  isEncrypted,
  needsReencryption,
  rotationInProgress,
} from "./secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");
const original = process.env.ENCRYPTION_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original;
});

describe("with a key configured", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  it("round-trips a credential", () => {
    const secret = "ac-token-abc123";
    const stored = encryptSecret(secret);

    expect(stored).not.toContain(secret);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("produces a different ciphertext each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("still reads a credential stored before encryption existed", () => {
    expect(decryptSecret("plaintext-legacy-key")).toBe("plaintext-legacy-key");
  });

  it("refuses a tampered envelope instead of returning garbage", () => {
    const stored = encryptSecret("secret");
    const tampered = stored.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("reports encryption as available", () => {
    expect(encryptionAvailable()).toBe(true);
  });
});

describe("without a key configured", () => {
  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it("stores the value unchanged rather than failing the save", () => {
    expect(encryptSecret("ac-token")).toBe("ac-token");
    expect(encryptionAvailable()).toBe(false);
  });

  it("throws on an encrypted value so a wrong key is not sent to the vendor", () => {
    process.env.ENCRYPTION_KEY = KEY;
    const stored = encryptSecret("ac-token");
    delete process.env.ENCRYPTION_KEY;

    expect(() => decryptSecret(stored)).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("a key of the wrong size", () => {
  it("falls back to plaintext rather than throwing on every save", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(8, 1).toString("base64");
    expect(encryptSecret("ac-token")).toBe("ac-token");
    expect(encryptionAvailable()).toBe(false);
  });
});

describe("rotating a key", () => {
  const OLD = Buffer.alloc(32, 1).toString("base64");
  const NEW = Buffer.alloc(32, 2).toString("base64");
  const previously = process.env.ENCRYPTION_KEY_PREVIOUS;

  afterEach(() => {
    if (previously === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = previously;
  });

  /** Seals a value with whichever key is current, then swaps in the new one. */
  function sealedUnderOldKey(secret: string) {
    process.env.ENCRYPTION_KEY = OLD;
    const stored = encryptSecret(secret);
    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD;
    return stored;
  }

  // The whole point: swapping the key must not take the stored credentials
  // down with it, or a rotation means the bot stops sending until every
  // vendor key is typed in again by hand.
  it("still reads a credential sealed with the outgoing key", () => {
    const stored = sealedUnderOldKey("zernio-key-xyz");
    expect(decryptSecret(stored)).toBe("zernio-key-xyz");
  });

  it("writes new values under the new key only", () => {
    sealedUnderOldKey("anything");
    const fresh = encryptSecret("written-after-the-swap");

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decryptSecret(fresh)).toBe("written-after-the-swap");
  });

  it("knows which stored values are still on the old key", () => {
    const old = sealedUnderOldKey("old-one");
    const fresh = encryptSecret("new-one");

    expect(needsReencryption(old)).toBe(true);
    expect(needsReencryption(fresh)).toBe(false);
  });

  it("reports whether a rotation is under way", () => {
    sealedUnderOldKey("anything");
    expect(rotationInProgress()).toBe(true);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(rotationInProgress()).toBe(false);
  });

  // Re-encrypting is what lets the old key be deleted afterwards. Once it is
  // done the outgoing key is no longer needed to read anything.
  it("survives dropping the old key once everything is re-encrypted", () => {
    const stored = sealedUnderOldKey("needs-rewriting");
    const rewritten = encryptSecret(decryptSecret(stored));

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decryptSecret(rewritten)).toBe("needs-rewriting");
    expect(needsReencryption(rewritten)).toBe(false);
  });

  it("refuses a value neither key opens, rather than returning rubbish", () => {
    process.env.ENCRYPTION_KEY = OLD;
    const stored = encryptSecret("sealed-with-a-third-key");

    process.env.ENCRYPTION_KEY = NEW;
    process.env.ENCRYPTION_KEY_PREVIOUS = Buffer.alloc(32, 9).toString("base64");

    expect(() => decryptSecret(stored)).toThrow();
    // Still flagged as pending, so the report shows it instead of hiding it.
    expect(needsReencryption(stored)).toBe(true);
  });

  it("treats a plaintext value as pending once a key exists", () => {
    process.env.ENCRYPTION_KEY = NEW;
    expect(needsReencryption("plain-old-token")).toBe(true);
  });
});
