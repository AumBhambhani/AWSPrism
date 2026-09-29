// F-12: when the malware scanner is temporarily unavailable, evidence uploads are held
// in quarantine and the API answers 202 { status: "pending_scan", message }.
export const isPendingScan = (res) => res?.status === "pending_scan";

export const pendingScanMessage = (res) =>
  res?.message || "The malware scanner is temporarily unavailable. Your file has been quarantined and will be added automatically once it has been scanned.";
