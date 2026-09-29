import { describe, test, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

describe("credentialCrypto", () => {
  test("round-trips a plaintext secret", () => {
    const plaintext = JSON.stringify({ accessKeyId: "AKIA123", secretAccessKey: "shh" });
    const encrypted = encryptSecret(plaintext);
    expect(encrypted.ciphertext).not.toContain("AKIA123");
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  test("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-secret";
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  test("throws when the auth tag has been tampered with", () => {
    const encrypted = encryptSecret("secret-value");
    const tampered = { ...encrypted, authTag: encryptSecret("other").authTag };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("throws when CREDENTIAL_ENCRYPTION_KEY is missing", () => {
    const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow("CREDENTIAL_ENCRYPTION_KEY is not set");
    process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });
});
