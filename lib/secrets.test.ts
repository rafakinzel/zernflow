import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  isEncrypted,
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
