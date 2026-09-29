import fs from "fs";

// Magic byte signatures for allowed MIME types
const MAGIC = [
  { mime: "application/pdf",    bytes: [0x25, 0x50, 0x44, 0x46] },        // %PDF
  { mime: "image/png",          bytes: [0x89, 0x50, 0x4E, 0x47] },        // PNG
  { mime: "image/jpeg",         bytes: [0xFF, 0xD8, 0xFF] },               // JPEG
  { mime: "image/gif",          bytes: [0x47, 0x49, 0x46, 0x38] },        // GIF8
  { mime: "image/webp",         bytes: [0x52, 0x49, 0x46, 0x46] },        // RIFF (webp)
  { mime: "application/msword", bytes: [0xD0, 0xCF, 0x11, 0xE0] },        // OLE2
  { mime: "text/plain",         bytes: null },                              // no magic — allow
  { mime: "text/csv",           bytes: null },
];

// All OOXML + zip types share the PK magic bytes
const ZIP_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Legacy binary Office formats (.xls/.ppt) are OLE2 compound files, not zips.
const OLE2_MIMES = new Set(["application/vnd.ms-excel", "application/vnd.ms-powerpoint"]);
const OLE2_MAGIC = [0xD0, 0xCF, 0x11, 0xE0];

const TEXT_MIMES = new Set(["text/plain", "text/csv"]);

function checkMagicBytesBuffer(buf, declaredMime) {
  if (ZIP_MIMES.has(declaredMime)) {
    return buf[0] === 0x50 && buf[1] === 0x4B; // PK
  }
  if (OLE2_MIMES.has(declaredMime)) {
    return OLE2_MAGIC.every((b, i) => buf[i] === b);
  }
  if (declaredMime === "image/webp") {
    return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  }

  const entry = MAGIC.find(m => m.mime === declaredMime);
  if (!entry) return false;        // unknown type — reject
  if (!entry.bytes) return true;   // text — no magic check needed
  return entry.bytes.every((b, i) => buf[i] === b);
}

// Disk uploads get exactly the buffer checks (incl. the WEBP marker at bytes 8-12).
function checkMagicBytes(filePath, declaredMime) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  return checkMagicBytesBuffer(buf, declaredMime);
}

let _clamClient = null;
let _clamInitFailedAt = 0;
let _warnedUnconfigured = false;

// Result for "ClamAV is configured but could not scan right now". Callers must not
// accept the file: evidence uploads quarantine it for a later rescan (F-12), anything
// else treats it as a rejection. Never fail open.
const SCANNER_UNAVAILABLE = { safe: false, unavailable: true, reason: "Malware scanner is temporarily unavailable" };

export function isScannerConfigured() {
  return Boolean(process.env.CLAMAV_HOST);
}

async function getClamClient() {
  if (_clamClient) return _clamClient;

  const host = process.env.CLAMAV_HOST;
  const port = parseInt(process.env.CLAMAV_PORT || "3310");
  if (!host) {
    if (!_warnedUnconfigured) {
      console.warn("[scanFile] CLAMAV_HOST not set — uploads are checked for file type only, not malware.");
      _warnedUnconfigured = true;
    }
    return null;
  }

  // Back off briefly after a failed connect, but never give up for the life of the
  // process — clamd restarts and slow signature loads must not disable scanning.
  const retryMs = parseInt(process.env.CLAMAV_RETRY_MS ?? "10000");
  if (_clamInitFailedAt && Date.now() - _clamInitFailedAt < retryMs) return SCANNER_UNAVAILABLE;

  try {
    const { default: NodeClam } = await import("clamscan");
    _clamClient = await new NodeClam().init({
      clamdscan: { host, port, timeout: 15000, active: true },
      preference: "clamdscan",
    });
    _clamInitFailedAt = 0;
    console.log("[scanFile] ClamAV connected at", host, port);
    return _clamClient;
  } catch (e) {
    console.warn("[scanFile] ClamAV unavailable:", e.message);
    _clamInitFailedAt = Date.now();
    return SCANNER_UNAVAILABLE;
  }
}

async function clamScan(run) {
  const clam = await getClamClient();
  if (clam === null) return { safe: true }; // not configured (local dev / tests)
  if (clam === SCANNER_UNAVAILABLE) return SCANNER_UNAVAILABLE;
  try {
    const { isInfected, viruses } = await run(clam);
    if (isInfected === true) return { safe: false, reason: `Malware detected: ${(viruses || []).join(", ")}` };
    // Only an explicit "clean" verdict passes. clamscan resolves isInfected: null (no
    // throw) for replies it can't interpret — an empty reply when clamd restarts mid-scan,
    // "COMMAND READ TIMED OUT" — and those must not be treated as clean.
    if (isInfected === false) return { safe: true };
    console.warn("[scanFile] ClamAV returned no verdict — treating the scanner as unavailable");
    _clamClient = null;
    _clamInitFailedAt = 0;
    return SCANNER_UNAVAILABLE;
  } catch (e) {
    // Scan error (clamd down, timeout) — do not accept the file; reconnect next time.
    console.warn("[scanFile] ClamAV scan error:", e.message);
    _clamClient = null;
    _clamInitFailedAt = 0;
    return SCANNER_UNAVAILABLE;
  }
}

/**
 * Scans an uploaded file for:
 *   1. Magic byte mismatch (spoofed MIME type)
 *   2. Malware via ClamAV (if configured)
 *
 * Returns { safe: true }, { safe: false, reason } or, when ClamAV is configured but
 * cannot scan right now, { safe: false, unavailable: true, reason }.
 */
export async function scanFile(filePath, declaredMime) {
  // 1. Magic bytes
  try {
    if (!checkMagicBytes(filePath, declaredMime)) {
      return { safe: false, reason: "File content does not match its declared type" };
    }
  } catch (e) {
    return { safe: false, reason: "Could not read file for validation" };
  }

  // 2. ClamAV
  return clamScan((clam) => clam.scanFile(filePath));
}

/**
 * Buffer equivalent of scanFile — for callers that hold the upload in memory
 * (multer.memoryStorage) instead of on disk. Same two checks:
 *   1. Magic byte mismatch (spoofed MIME type)
 *   2. Malware via ClamAV (if configured; scanned via stream)
 *
 * Returns { safe: true }, { safe: false, reason } or { safe: false, unavailable: true, reason }.
 */
export async function scanBuffer(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer)) {
    return { safe: false, reason: "Could not read file for validation" };
  }

  // 1. Magic bytes
  if (!checkMagicBytesBuffer(buffer.subarray(0, 12), declaredMime)) {
    return { safe: false, reason: "File content does not match its declared type" };
  }
  // Text types have no signature; a NUL byte means it is really binary content.
  if (TEXT_MIMES.has(declaredMime) && buffer.includes(0)) {
    return { safe: false, reason: "File content does not match its declared type" };
  }

  // 2. ClamAV
  const { Readable } = await import("stream");
  return clamScan((clam) => clam.scanStream(Readable.from(buffer)));
}
