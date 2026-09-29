import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function isYes(v) {
  return String(v ?? "").toLowerCase() === "yes" || v === true;
}

function hostPayload(host, details) {
  return buildEvidencePayload({
    resourceType: "crowdstrike_host",
    resourceId: String(host?.device_id ?? host?.hostname ?? "unknown"),
    resourceName: host?.hostname ? String(host.hostname) : String(host?.device_id ?? "unknown"),
    region: null,
    details,
  });
}

// Hosts whose sensor has not checked in for longer than the staleness threshold
// (default 30 days) must not be left silently unmanaged — each is flagged for a
// decommission-vs-offline determination and reconciliation against the asset
// inventory. The Falcon API exposes no "reviewed" flag, so a stale host is
// reported rather than passed.
async function checkStaleEndpointsReviewed(clients) {
  const hosts = await clients.listHosts();
  const thresholdDays = clients.THRESHOLDS.STALE_HOST_DAYS;

  if (hosts.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "not_applicable",
        message: "No hosts are present in the Falcon tenant to evaluate for staleness",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_host", resourceId: "hosts", resourceName: "Host inventory", region: null, details: { hosts: 0, thresholdDays } }),
      },
    ];
  }

  const stale = hosts
    .map((h) => ({ host: h, age: daysSince(h.last_seen) }))
    .filter(({ age }) => age != null && age > thresholdDays);

  if (stale.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "pass",
        message: `All ${hosts.length} host(s) have checked in within the last ${thresholdDays} days`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_host", resourceId: "hosts", resourceName: "Host inventory", region: null, details: { hosts: hosts.length, thresholdDays, staleHosts: 0 } }),
      },
    ];
  }

  return stale.map(({ host, age }) => ({
    resourceId: String(host.device_id ?? host.hostname),
    status: "fail",
    message: `Host "${host.hostname ?? host.device_id}" last checked in ${Math.round(age)} days ago (> ${thresholdDays}) — confirm it is decommissioned rather than simply offline, and reconcile it against the asset inventory`,
    evidencePayload: hostPayload(host, {
      lastSeen: host.last_seen,
      daysSinceLastSeen: Math.round(age),
      thresholdDays,
      platform: host.platform_name ?? null,
      sensorVersion: host.agent_version ?? null,
    }),
  }));
}

// A sensor reporting reduced functionality mode (RFM) is installed but not
// providing full protection — commonly a license/policy misassignment or sensor
// tampering. Any host in RFM is a finding.
async function checkUnmanagedReducedFunctionality(clients) {
  const hosts = await clients.listHosts();

  if (hosts.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "not_applicable",
        message: "No hosts are present in the Falcon tenant to evaluate for reduced functionality mode",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_host", resourceId: "hosts", resourceName: "Host inventory", region: null, details: { hosts: 0 } }),
      },
    ];
  }

  const degraded = hosts.filter((h) => isYes(h.reduced_functionality_mode));

  if (degraded.length === 0) {
    return [
      {
        resourceId: "hosts",
        status: "pass",
        message: `None of the ${hosts.length} host(s) report reduced functionality mode`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_host", resourceId: "hosts", resourceName: "Host inventory", region: null, details: { hosts: hosts.length, reducedFunctionalityHosts: 0 } }),
      },
    ];
  }

  return degraded.map((host) => ({
    resourceId: String(host.device_id ?? host.hostname),
    status: "fail",
    message: `Host "${host.hostname ?? host.device_id}" is running in reduced functionality mode — the sensor is installed but not providing full protection`,
    evidencePayload: hostPayload(host, {
      reducedFunctionalityMode: true,
      platform: host.platform_name ?? null,
      sensorVersion: host.agent_version ?? null,
      lastSeen: host.last_seen ?? null,
    }),
  }));
}

export const hostTests = [
  {
    key: "crowdstrike.host.stale_endpoints_reviewed",
    title: "No endpoints have gone stale without review",
    failTitle: "A stale endpoint has been left unmanaged without review",
    severityDefault: "high",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Malware Protection"],
    run: (clients) => checkStaleEndpointsReviewed(clients),
  },
  {
    key: "crowdstrike.host.unmanaged_reduced_functionality",
    title: "No hosts are running in reduced functionality / sensor-degraded mode",
    failTitle: "A host is running with a degraded / reduced-functionality sensor",
    severityDefault: "high",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Malware Protection"],
    run: (clients) => checkUnmanagedReducedFunctionality(clients),
  },
];
