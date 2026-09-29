import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function data(clients) {
  const result = await clients.getXdrTelemetry();
  if (!result || !Array.isArray(result.items)) return null;
  return result;
}

async function checkQueryable(clients) {
  const result = await data(clients);
  if (!result) return malformed("xdr_query", "XDR query result is malformed");
  return aggregate("xdr_query", "pass", "The Sophos Data Lake completed a baseline query", { rowCount: result.items.length, runId: result.runId ?? null });
}

async function checkCoverage(clients) {
  const [result, endpoints] = await Promise.all([data(clients), clients.listEndpoints()]);
  if (!result || !Array.isArray(endpoints)) return malformed("xdr_query", "XDR telemetry or endpoint inventory is malformed");
  if (!endpoints.length) return empty("xdr_query", "No managed endpoints exist for telemetry coverage comparison");
  const telemetryIds = new Set(result.items.map((item) => String(item.endpoint_id ?? item.endpointId ?? item.meta_hostname ?? item.hostname ?? "")));
  const covered = endpoints.filter((item) => telemetryIds.has(String(item.id)) || telemetryIds.has(String(item.hostname)));
  return aggregate("xdr_query", covered.length === endpoints.length ? "pass" : "fail", `${covered.length} of ${endpoints.length} endpoint(s) appear in the Data Lake telemetry sample`, { endpointCount: endpoints.length, coveredEndpoints: covered.length });
}

async function checkFresh(clients) {
  const result = await data(clients);
  if (!result) return malformed("xdr_query", "XDR telemetry result is malformed");
  if (!result.items.length) return empty("xdr_query", "The baseline Data Lake query returned no endpoint telemetry");
  const thresholdDays = clients.THRESHOLDS.DATALAKE_TELEMETRY_DAYS;
  const invalid = result.items.find((item) => ageInHours(item.timestamp ?? item.time ?? item.last_seen ?? item.lastSeenAt) == null);
  if (invalid) return malformed("xdr_query", "XDR telemetry timestamp is missing or invalid", invalid);
  const stale = result.items.filter((item) => ageInHours(item.timestamp ?? item.time ?? item.last_seen ?? item.lastSeenAt) > thresholdDays * 24);
  return stale.length ? stale.map((item) => row("xdr_query", item, "fail", `Data Lake telemetry is older than ${thresholdDays} days`, { timestamp: item.timestamp ?? item.time ?? item.last_seen ?? item.lastSeenAt, thresholdDays })) : aggregate("xdr_query", "pass", `All sampled Data Lake telemetry is newer than ${thresholdDays} days`, { rowCount: result.items.length, thresholdDays });
}

export const xdrTests = [
  descriptor({ key: "sophos.xdr.data_lake_queryable", title: "The Sophos Data Lake responds to a baseline query", severityDefault: "low", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkQueryable }),
  descriptor({ key: "sophos.xdr.telemetry_coverage", title: "Data Lake telemetry is present for the expected device population", severityDefault: "medium", isoReferences: ["A.12.2.1"], dpdpaControlAreas: ["Malware Protection"], run: checkCoverage }),
  descriptor({ key: "sophos.xdr.no_stale_telemetry", title: "No devices are missing from Data Lake telemetry past the threshold", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkFresh }),
];
