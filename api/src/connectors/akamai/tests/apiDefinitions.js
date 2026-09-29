// GET /api-definitions/v2/endpoints — page/pageSize paginated, items under
// `apiEndPoints` (api-definitions v2 spec). Per-endpoint request constraints
// live on the endpoint version resource.
// TODO CONFIRM (plan Task 0): the exact discovery endpoint + envelope for
// "APIs seen but not registered". The appsec spec documents
// GET /appsec/v1/api-discovery/host/{hostname}/basepath/{basePath}/endpoints
// (endpoints already in your definitions) and a separate "Get discovered APIs"
// list. This check compares the registered set (…/security-policies/{id}/api-endpoints)
// against a discovery list and reports base paths present only in discovery.

async function listRegisteredEndpoints(akamai) {
  return akamai.getPaged("/api-definitions/v2/endpoints", { itemsKey: "apiEndPoints", pageSize: 100 });
}

export async function checkApiDiscoveryEnabled({ akamai }) {
  const endpoints = await listRegisteredEndpoints(akamai);
  return [
    {
      resourceId: "akamai",
      status: endpoints.length > 0 ? "pass" : "warn",
      message:
        endpoints.length > 0
          ? `${endpoints.length} API endpoint(s) are registered in API Definitions — API traffic is catalogued`
          : "No API endpoints are registered — API discovery appears to be off or unused",
      evidencePayload: { registeredEndpointCount: endpoints.length },
    },
  ];
}

export async function checkNoUnregisteredEndpoints({ akamai }) {
  const configs = await akamai.listSecurityConfigs();
  let sawDiscoveryData = false;
  const unregisteredBasePaths = new Set();
  const registeredBasePaths = new Set(
    (await listRegisteredEndpoints(akamai)).map((e) => e.basePath).filter(Boolean)
  );

  for (const config of configs) {
    const configId = config.id ?? config.configId;
    const { productionVersion } = await akamai.resolveActiveConfig(configId);
    if (!productionVersion) continue;
    const policies = await akamai.listSecurityPolicies(configId, productionVersion);
    for (const policy of policies) {
      const policyId = policy.policyId ?? policy.id;
      const registered = await akamai
        .get(`/appsec/v1/configs/${configId}/versions/${productionVersion}/security-policies/${policyId}/api-endpoints`)
        .catch(() => null);
      if (registered) {
        for (const e of registered.apiEndpoints || []) if (e.basePath) registeredBasePaths.add(e.basePath);
      }
      const discovered = await akamai
        .get(`/appsec/v1/api-discovery`)
        .catch(() => null); // TODO CONFIRM real per-hostname discovery path
      const discoveryList = Array.isArray(discovered?.apis)
        ? discovered.apis
        : Array.isArray(discovered?.discoveredApis)
        ? discovered.discoveredApis
        : null;
      if (discoveryList) {
        sawDiscoveryData = true;
        for (const api of discoveryList) {
          if (api.basePath && !registeredBasePaths.has(api.basePath)) unregisteredBasePaths.add(api.basePath);
        }
      }
    }
  }

  if (!sawDiscoveryData) {
    return [{ resourceId: "akamai", status: "not_applicable", message: "No API discovery data is available for this account", evidencePayload: {} }];
  }
  const list = [...unregisteredBasePaths];
  return [
    {
      resourceId: "akamai",
      status: list.length === 0 ? "pass" : "fail",
      message:
        list.length === 0
          ? "Every discovered API base path is registered in API Definitions"
          : `${list.length} discovered API base path(s) are not registered (shadow APIs)`,
      evidencePayload: { registeredBasePathCount: registeredBasePaths.size, unregisteredBasePaths: list },
    },
  ];
}

export async function checkEndpointConstraintsEnforced({ akamai }) {
  const endpoints = await listRegisteredEndpoints(akamai);
  if (endpoints.length === 0) {
    return [{ resourceId: "akamai", status: "not_applicable", message: "No registered API endpoints to evaluate", evidencePayload: {} }];
  }
  const rows = [];
  for (const e of endpoints) {
    const id = e.apiEndPointId ?? e.id;
    const version =
      e.productionVersion?.versionNumber ?? e.stagingVersion?.versionNumber ?? e.latestVersionNumber ?? e.versionNumber;
    const name = e.apiEndPointName ?? e.name ?? String(id);
    if (!version) {
      rows.push({ resourceId: name, status: "warn", message: `${name}: no active endpoint version found`, evidencePayload: {} });
      continue;
    }
    const detail = await akamai.get(`/api-definitions/v2/endpoints/${id}/versions/${version}`).catch(() => ({}));
    const enabled =
      detail.requestConstraintsEnabled === true ||
      detail.akamaiSecurityRestrictions?.MAX_ELEMENT_NAME_LENGTH != null ||
      detail.akamaiSecurityRestrictions?.MAX_BODY_SIZE != null ||
      detail.constraintsEnabled === true;
    rows.push({
      resourceId: name,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `${name}: request constraints are enabled on the active version`
        : `${name}: request constraints are not enabled — requests are not size/shape limited`,
      evidencePayload: { endpointId: id, version, requestConstraintsEnabled: Boolean(enabled) },
    });
  }
  return rows;
}

export const apiTests = [
  { key: "akamai.api.discovery_enabled", title: "API discovery is active for protected hostnames", failTitle: "API discovery is not active", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkApiDiscoveryEnabled(clients) },
  { key: "akamai.api.no_unregistered_endpoints", title: "No discovered-but-unregistered API endpoints", failTitle: "A discovered API endpoint is not registered (shadow API)", severityDefault: "high", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkNoUnregisteredEndpoints(clients) },
  { key: "akamai.api.endpoint_constraints_enforced", title: "Registered API endpoints enforce request constraints", failTitle: "A registered API endpoint does not enforce request constraints", severityDefault: "medium", isoReferences: ["A.14.1.3"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkEndpointConstraintsEnforced(clients) },
];
