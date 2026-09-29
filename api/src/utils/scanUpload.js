import fs from "fs";
import { scanFile } from "./scanFile.js";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// F-16 — scan a multer disk upload (logos, spreadsheet imports) before the handler runs:
// magic bytes must match the declared/expected type (so SVG or spoofed "images" are
// refused — only PNG/JPEG/GIF/WebP pass as images) and ClamAV must give a clean verdict.
// These uploads are not evidence, so there is no quarantine: if the scanner is
// unavailable the upload is refused and can be retried. `expectedMime` overrides the
// client-declared type (e.g. imports are always checked as .xlsx).
export function scanDiskUpload({ expectedMime } = {}) {
  return async (req, res, next) => {
    if (!req.file) return next();
    let result;
    try {
      result = await scanFile(req.file.path, expectedMime || req.file.mimetype);
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      return next(e);
    }
    if (result.safe) return next();
    fs.unlink(req.file.path, () => {});
    if (result.unavailable) {
      return res.status(503).json({ error: "The malware scanner is temporarily unavailable. Please try again shortly.", code: "SCANNER_UNAVAILABLE" });
    }
    return res.status(400).json({ error: `File rejected: ${result.reason}` });
  };
}

export const scanXlsxUpload = () => scanDiskUpload({ expectedMime: XLSX });
