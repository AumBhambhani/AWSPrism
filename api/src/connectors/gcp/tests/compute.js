// instances.aggregatedList's `items` is a map keyed by zone/scope
// ("zones/us-east1-b" → { instances: [...] } | { warning: {...} } when a
// zone has none), not a flat array like every other list endpoint this
// connector calls — so this can't reuse tests/pagination.js's `paginate`.
async function listAllInstances(compute, projectId) {
  const instances = [];
  let pageToken;
  do {
    const { data } = await compute.instances.aggregatedList({ project: projectId, pageToken });
    for (const scope of Object.values(data.items || {})) {
      for (const instance of scope.instances || []) instances.push(instance);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return instances;
}

export async function checkInstancesNoPublicIp(compute, projectId) {
  const instances = await listAllInstances(compute, projectId);
  if (instances.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No Compute Engine instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const hasPublicIp = (instance.networkInterfaces || []).some((ni) => (ni.accessConfigs || []).length > 0);
    return {
      resourceId: String(instance.id),
      status: hasPublicIp ? "fail" : "pass",
      message: hasPublicIp
        ? `${instance.name} has a public IP address configured`
        : `${instance.name} has no public IP address configured`,
      evidencePayload: { instanceName: instance.name, zone: instance.zone?.split("/").pop(), hasPublicIp },
    };
  });
}

export async function checkShieldedVmEnabled(compute, projectId) {
  const instances = await listAllInstances(compute, projectId);
  if (instances.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No Compute Engine instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const shielded = instance.shieldedInstanceConfig || {};
    const compliant = Boolean(shielded.enableVtpm) && Boolean(shielded.enableIntegrityMonitoring);
    return {
      resourceId: String(instance.id),
      status: compliant ? "pass" : "fail",
      message: compliant
        ? `${instance.name} has vTPM and integrity monitoring enabled`
        : `${instance.name} does not have both vTPM and integrity monitoring enabled`,
      evidencePayload: { instanceName: instance.name, zone: instance.zone?.split("/").pop(), enableVtpm: Boolean(shielded.enableVtpm), enableIntegrityMonitoring: Boolean(shielded.enableIntegrityMonitoring) },
    };
  });
}

export const computeTests = [
  {
    key: "gcp.compute.instances_no_public_ip",
    title: "Compute Engine instances are not directly exposed via a public IP address",
    failTitle: "Compute Engine instance has a public IP address configured",
    severityDefault: "critical",
    isoReferences: ["A.13.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkInstancesNoPublicIp(clients.compute, clients.projectId),
  },
  {
    key: "gcp.compute.shielded_vm_enabled",
    title: "Compute Engine instances have Shielded VM protections enabled",
    failTitle: "Compute Engine instance does not have Shielded VM protections enabled",
    severityDefault: "high",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkShieldedVmEnabled(clients.compute, clients.projectId),
  },
];
