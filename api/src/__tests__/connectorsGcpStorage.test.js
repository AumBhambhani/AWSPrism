import { describe, test, expect } from "vitest";
import { checkBucketsNotPubliclyAccessible } from "../connectors/gcp/tests/storage.js";

function storageWith(items) {
  return { buckets: { list: async () => ({ data: { items } }) } };
}

describe("checkBucketsNotPubliclyAccessible", () => {
  test("passes a bucket with public access prevention enforced", async () => {
    const storage = storageWith([{ name: "b1", iamConfiguration: { publicAccessPrevention: "enforced" } }]);
    const results = await checkBucketsNotPubliclyAccessible(storage, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails a bucket left at the inherited default", async () => {
    const storage = storageWith([{ name: "b1", iamConfiguration: { publicAccessPrevention: "inherited" } }]);
    const results = await checkBucketsNotPubliclyAccessible(storage, "p");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no buckets", async () => {
    const storage = storageWith([]);
    const results = await checkBucketsNotPubliclyAccessible(storage, "p");
    expect(results[0].status).toBe("not_applicable");
  });
});
