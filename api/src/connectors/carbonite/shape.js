// Helpers for coping with the Carbonite Dashboard Service's unconfirmed SOAP
// response shapes. The XML parser (soapClient.js) turns a single child element
// into an object and repeated siblings into an array, and the WCF data-contract
// may wrap collections one level deeper (e.g. a `DeviceList` element holding
// `DeviceInfo` elements). These normalise both away.

// Returns `value` as an array: [] for null/undefined, [value] for a scalar or
// object, value itself if already an array.
export function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const COLLECTION_KEYS = ["DeviceList", "DeviceInfo", "Devices", "DashboardDeviceInfo"];
const ENVELOPE_KEYS = new Set(["Status", "OverallStatus", "ErrorDetails"]);

// Given a parsed `<{Op}Result>` object, returns { rows, recognised }:
//   - recognised:false  → the result is not a shape this connector knows how to
//     read (caller emits a `status:"error"` row, never a guessed pass/fail).
//   - recognised:true, rows:[]  → a genuinely empty device collection.
//   - recognised:true, rows:[...]  → the device rows, flattened.
export function deviceRows(result) {
  if (result === null || result === undefined) return { rows: [], recognised: false };
  if (Array.isArray(result)) return { rows: result, recognised: true };
  if (typeof result !== "object") return { rows: [], recognised: false };

  for (const key of COLLECTION_KEYS) {
    if (key in result) {
      const coll = result[key];
      if (coll === null || coll === undefined) return { rows: [], recognised: true };
      if (Array.isArray(coll)) return { rows: coll, recognised: true };
      if (typeof coll === "object") {
        // e.g. { DeviceList: { DeviceInfo: [...] } } or { DeviceList: { DeviceInfo: {...} } }
        const inner = Object.keys(coll).filter((k) => !ENVELOPE_KEYS.has(k));
        if (inner.length === 1) return { rows: asArray(coll[inner[0]]), recognised: true };
        return { rows: [coll], recognised: true };
      }
      return { rows: [], recognised: false };
    }
  }

  return { rows: [], recognised: false };
}
