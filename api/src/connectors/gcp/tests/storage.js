import { paginate } from "./pagination.js";

export async function checkBucketsNotPubliclyAccessible(storage, projectId) {
  const buckets = await paginate(
    (params) => storage.buckets.list(params),
    { project: projectId },
    "items"
  );
  if (buckets.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No Cloud Storage buckets found", evidencePayload: {} }];
  }
  return buckets.map((bucket) => {
    const enforced = bucket.iamConfiguration?.publicAccessPrevention === "enforced";
    return {
      resourceId: bucket.name,
      status: enforced ? "pass" : "fail",
      message: enforced
        ? `${bucket.name} enforces public access prevention`
        : `${bucket.name} does not enforce public access prevention (publicAccessPrevention=${bucket.iamConfiguration?.publicAccessPrevention || "inherited"})`,
      evidencePayload: { bucket: bucket.name, publicAccessPrevention: bucket.iamConfiguration?.publicAccessPrevention || "inherited", uniformBucketLevelAccess: Boolean(bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled) },
    };
  });
}

export const storageTests = [
  {
    key: "gcp.storage.buckets_not_publicly_accessible",
    title: "Cloud Storage buckets enforce public access prevention",
    failTitle: "Cloud Storage bucket does not enforce public access prevention",
    severityDefault: "critical",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkBucketsNotPubliclyAccessible(clients.storage, clients.projectId),
  },
];
