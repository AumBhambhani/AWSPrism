import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// The sensor_update policy assigned to a host, as embedded on the device entity
// under `device_policies.sensor_update`.
function hostSensorPolicy(host) {
  return host?.device_policies?.sensor_update ?? host?.device_policies?.["sensor_update"] ?? null;
}

// A policy is the fall-back platform default when its name is "platform_default"
// or it carries the well-known default id.
function isPlatformDefault(policy) {
  const name = String(policy?.name ?? "").toLowerCase();
  return name === "platform_default" || policy?.platform_default === true;
}

// Every host must map to an active, explicitly-assigned (non platform-default)
// sensor update policy, rather than silently falling back to the platform
// default.
async function checkSensorPolicyCompliance(clients) {
  const hosts = await clients.listHosts();
  const policies = await clients.listSensorUpdatePolicies();

  if (hosts.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "not_applicable",
        message: "No hosts are present in the Falcon tenant to evaluate for sensor update policy assignment",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_sensor_policy", resourceId: "hosts", resourceName: "Sensor update policy assignment", region: null, details: { hosts: 0, policies: policies.length } }),
      },
    ];
  }

  const policyById = new Map(policies.map((p) => [String(p.id), p]));

  const offenders = [];
  for (const host of hosts) {
    const assigned = hostSensorPolicy(host);
    const policyId = assigned?.policy_id ? String(assigned.policy_id) : null;
    const policy = policyId ? policyById.get(policyId) : null;
    let reason = null;
    if (!policyId || !assigned) reason = "no sensor update policy is applied";
    else if (assigned.applied === false) reason = "the assigned sensor update policy has not been applied";
    else if (policy && policy.enabled === false) reason = "the assigned sensor update policy is disabled";
    else if (policy && isPlatformDefault(policy)) reason = "the host is on the platform-default sensor update policy";
    // an id we can't resolve from the policy list is treated as assigned, not a finding

    if (reason) {
      offenders.push({ host, reason, policy, policyId });
    }
  }

  if (offenders.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "pass",
        message: `All ${hosts.length} host(s) are assigned an active, explicit sensor update policy`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_sensor_policy", resourceId: "hosts", resourceName: "Sensor update policy assignment", region: null, details: { hosts: hosts.length, policies: policies.length, hostsOnDefaultOrUnmanaged: 0 } }),
      },
    ];
  }

  return offenders.map(({ host, reason, policy, policyId }) => ({
    resourceId: String(host.device_id ?? host.hostname),
    status: "fail",
    message: `Host "${host.hostname ?? host.device_id}" — ${reason}. Assign the host's group an explicit sensor update policy under Host setup and management > Sensor update policies.`,
    evidencePayload: buildEvidencePayload({
      resourceType: "crowdstrike_host",
      resourceId: String(host.device_id ?? host.hostname),
      resourceName: host.hostname ? String(host.hostname) : String(host.device_id),
      region: null,
      details: { assignedPolicyId: policyId, assignedPolicyName: policy?.name ?? null, reason, platform: host.platform_name ?? null },
    }),
  }));
}

// Parse the leading numeric build number out of a Falcon build string
// (e.g. "18110|n-1|tagged|13" → 18110, "n|null" → null).
function buildNumber(build) {
  const n = Number(String(build ?? "").split("|")[0]);
  return Number.isFinite(n) ? n : null;
}
function isDeprecatedBuild(build) {
  return /deprecat/i.test(String(build ?? ""));
}

// Each sensor update policy must pin to a current build for its platform: not a
// deprecated build, and not more than N build releases behind the newest
// production build available for that platform.
async function checkBuildCurrency(clients) {
  const policies = await clients.listSensorUpdatePolicies();

  let availableBuilds;
  try {
    availableBuilds = await clients.listSensorBuilds();
  } catch {
    availableBuilds = null;
  }

  const active = policies.filter((p) => p.enabled !== false && !isPlatformDefault(p));
  const evaluable = active.filter((p) => (p.settings?.build ?? p.settings?.["build"]) != null);

  if (evaluable.length === 0) {
    return [
      {
        resourceId: "sensor-update-policies",
        status: "not_applicable",
        message: "No active sensor update policy exposes a pinned build to evaluate",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_sensor_policy", resourceId: "sensor-update-policies", resourceName: "Sensor update policies", region: null, details: { policies: policies.length, activePolicies: active.length } }),
      },
    ];
  }

  const maxBehind = clients.THRESHOLDS.SENSOR_BUILDS_BEHIND;

  // Newest production build number per platform, when the builds catalogue is
  // readable.
  const newestByPlatform = new Map();
  if (Array.isArray(availableBuilds)) {
    for (const b of availableBuilds) {
      const platform = String(b.platform ?? b.platform_name ?? "").toLowerCase();
      const stage = String(b.stage ?? b.build_stage ?? "").toLowerCase();
      if (stage && stage !== "prod" && stage !== "ga" && stage !== "") continue;
      const n = buildNumber(b.build ?? b.sensor_version ?? b.name);
      if (n == null) continue;
      if (!newestByPlatform.has(platform) || n > newestByPlatform.get(platform)) newestByPlatform.set(platform, n);
    }
  }

  const rows = [];
  for (const policy of evaluable) {
    const build = policy.settings?.build ?? policy.settings?.["build"];
    const platform = String(policy.platform_name ?? policy.platform ?? "").toLowerCase();
    const n = buildNumber(build);
    const newest = newestByPlatform.get(platform);

    let status = "pass";
    let message = `Sensor update policy "${policy.name}" pins to build "${build}"`;

    if (isDeprecatedBuild(build)) {
      status = "fail";
      message = `Sensor update policy "${policy.name}" pins to a deprecated build ("${build}") — move it to a current, supported build under Sensor update policies`;
    } else if (newest != null && n != null && newest - n > maxBehind) {
      status = "fail";
      message = `Sensor update policy "${policy.name}" pins to build ${n}, more than ${maxBehind} releases behind the newest production build (${newest}) for ${platform || "its platform"}`;
    } else if (newest == null) {
      status = "not_applicable";
      message = `Sensor update policy "${policy.name}" pins to build "${build}" — the sensor build catalogue was not readable, so currency could not be confirmed automatically`;
    }

    rows.push({
      resourceId: String(policy.id ?? policy.name),
      status,
      message,
      evidencePayload: buildEvidencePayload({
        resourceType: "crowdstrike_sensor_policy",
        resourceId: String(policy.id ?? policy.name),
        resourceName: String(policy.name ?? policy.id),
        region: null,
        details: { pinnedBuild: build, pinnedBuildNumber: n, newestProdBuild: newest ?? null, platform: platform || null, maxBuildsBehind: maxBehind },
      }),
    });
  }
  return rows;
}

export const sensorPolicyTests = [
  {
    key: "crowdstrike.sensor.policy_compliance",
    title: "All managed hosts are assigned an active sensor update policy",
    failTitle: "A host is not assigned an active, explicit sensor update policy",
    severityDefault: "high",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Malware Protection"],
    run: (clients) => checkSensorPolicyCompliance(clients),
  },
  {
    key: "crowdstrike.sensor.build_currency",
    title: "Sensor update policies pin to a current (not deprecated) sensor build",
    failTitle: "A sensor update policy pins to a deprecated or out-of-date build",
    severityDefault: "medium",
    isoReferences: ["A.12.6.1"],
    dpdpaControlAreas: ["Vulnerability Management"],
    run: (clients) => checkBuildCurrency(clients),
  },
];
