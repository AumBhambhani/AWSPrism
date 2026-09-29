import fs from "fs";
import path from "path";
import multer from "multer";
import { query } from "../db/index.js";

// Company logos (tenant settings + superadmin branding). Files live in
// UPLOAD_DIR/logos, which app.js serves at /api/logos. The extension comes from the
// magic-byte-verified type (F-16), never from the client's filename.
const LOGO_EXTENSIONS = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || "./uploads");
export const logosDir = () => path.join(uploadRoot(), "logos");

export const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdir(logosDir(), { recursive: true }, (err) => cb(err, logosDir()));
    },
    filename: (req, file, cb) => {
      const suffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, "logo-" + suffix + LOGO_EXTENSIONS[file.mimetype]);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (LOGO_EXTENSIONS[file.mimetype]) cb(null, true);
    else cb(Object.assign(new Error("Only PNG, JPEG, GIF or WebP logos are allowed"), { status: 400 }));
  },
});

// Local file behind a stored logo_url, or null. Covers the current /api/logos/<file>
// form and the legacy /uploads/<file> form (saved in the upload root, never served).
export function logoFilePath(logoUrl) {
  if (typeof logoUrl !== "string") return null;
  const name = path.basename(logoUrl);
  if (!/^logo-[\w.-]+$/.test(name)) return null;
  const dir = logoUrl.startsWith("/api/logos/") ? logosDir() : uploadRoot();
  const full = path.resolve(dir, name);
  return full.startsWith(dir + path.sep) ? full : null;
}

// Point the company at its new logo and delete the file it replaces.
export async function saveCompanyLogo(companyId, filename) {
  const logoUrl = `/api/logos/${filename}`;
  const previous = await query("SELECT logo_url FROM company_settings WHERE company_id = $1", [companyId]);
  await query(
    `INSERT INTO company_settings (company_id, logo_url)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET logo_url = $2, updated_at = NOW()`,
    [companyId, logoUrl]
  );
  const old = logoFilePath(previous.rows[0]?.logo_url);
  if (old && path.basename(old) !== filename) {
    await fs.promises.rm(old, { force: true }).catch((e) => console.error("[logo] could not remove replaced logo:", e.message)); // nosemgrep
  }
  return logoUrl;
}
