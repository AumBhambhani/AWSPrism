import { describe, test, expect } from "vitest";
import { checkKeyRotationEnabled } from "../connectors/gcp/tests/kms.js";

function cloudkmsWith(locations, keyRingsByLocation, cryptoKeysByKeyRing) {
  return {
    projects: {
      locations: {
        list: async () => ({ data: { locations } }),
        keyRings: {
          list: async ({ parent }) => ({ data: { keyRings: keyRingsByLocation[parent] || [] } }),
          cryptoKeys: {
            list: async ({ parent }) => ({ data: { cryptoKeys: cryptoKeysByKeyRing[parent] || [] } }),
          },
        },
      },
    },
  };
}

describe("checkKeyRotationEnabled", () => {
  test("passes a symmetric key with a rotation period configured", async () => {
    const cloudkms = cloudkmsWith(
      [{ name: "projects/p/locations/us" }],
      { "projects/p/locations/us": [{ name: "projects/p/locations/us/keyRings/kr1" }] },
      { "projects/p/locations/us/keyRings/kr1": [{ name: "key1", purpose: "ENCRYPT_DECRYPT", rotationPeriod: "7776000s" }] }
    );
    const results = await checkKeyRotationEnabled(cloudkms, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails a symmetric key with no rotation period", async () => {
    const cloudkms = cloudkmsWith(
      [{ name: "projects/p/locations/us" }],
      { "projects/p/locations/us": [{ name: "projects/p/locations/us/keyRings/kr1" }] },
      { "projects/p/locations/us/keyRings/kr1": [{ name: "key1", purpose: "ENCRYPT_DECRYPT" }] }
    );
    const results = await checkKeyRotationEnabled(cloudkms, "p");
    expect(results[0].status).toBe("fail");
  });

  test("ignores asymmetric keys, which structurally have no rotation period", async () => {
    const cloudkms = cloudkmsWith(
      [{ name: "projects/p/locations/us" }],
      { "projects/p/locations/us": [{ name: "projects/p/locations/us/keyRings/kr1" }] },
      { "projects/p/locations/us/keyRings/kr1": [{ name: "key1", purpose: "ASYMMETRIC_SIGN" }] }
    );
    const results = await checkKeyRotationEnabled(cloudkms, "p");
    expect(results[0].status).toBe("not_applicable");
  });

  test("returns not_applicable when there are no locations", async () => {
    const cloudkms = cloudkmsWith([], {}, {});
    const results = await checkKeyRotationEnabled(cloudkms, "p");
    expect(results[0].status).toBe("not_applicable");
  });
});
