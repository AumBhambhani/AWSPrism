export async function checkDefenderForCloudEnabled(security) {
  const { value: pricings } = await security.pricings.list();
  const results = (pricings || []).map((pricing) => {
    const enabled = pricing.pricingTier === "Standard";
    return {
      resourceId: pricing.id || pricing.name,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `Defender for Cloud is enabled for ${pricing.name}`
        : `Defender for Cloud is not enabled for ${pricing.name} (tier: ${pricing.pricingTier})`,
      evidencePayload: { resourceType: pricing.name, pricingTier: pricing.pricingTier },
    };
  });
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No Defender for Cloud pricing configurations found", evidencePayload: {} });
  }
  return results;
}

export async function checkActivityLogDiagnosticsEnabled(monitor, subscriptionId) {
  const { value: settings } = await monitor.diagnosticSettings.list(`/subscriptions/${subscriptionId}`);
  const results = (settings || []).map((setting) => ({
    resourceId: setting.id || setting.name,
    status: "pass",
    message: `Diagnostic setting "${setting.name}" is configured for the subscription Activity Log`,
    evidencePayload: { name: setting.name },
  }));
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "fail", message: "No diagnostic settings are configured for the subscription Activity Log", evidencePayload: {} });
  }
  return results;
}

export const loggingTests = [
  { key: "azure.security.defender_enabled", title: "Microsoft Defender for Cloud is enabled", failTitle: "Microsoft Defender for Cloud is not enabled", severityDefault: "medium", isoReferences: ["A.12.1.1"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkDefenderForCloudEnabled(clients.security) },
  { key: "azure.logging.activity_log_diagnostics_enabled", title: "Activity Log diagnostic settings are configured", failTitle: "No diagnostic settings are configured for the subscription Activity Log", severityDefault: "critical", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkActivityLogDiagnosticsEnabled(clients.monitor, clients.subscriptionId) },
];
