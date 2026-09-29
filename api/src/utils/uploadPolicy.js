import path from "path";

// Evidence/vault upload policy: the declared MIME type is client-controlled, so a
// file is only accepted when its extension is one of those legitimately used for
// that MIME type. Content is verified separately (magic bytes + ClamAV) in scanFile.js.
const EXTENSIONS_BY_MIME = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-powerpoint": [".ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "text/plain": [".txt", ".log"],
  "text/csv": [".csv"],
  "application/zip": [".zip"],
  "application/x-zip-compressed": [".zip"],
};

export const ALLOWED_MIME = new Set(Object.keys(EXTENSIONS_BY_MIME));

export function isAllowedUpload(file) {
  const allowed = EXTENSIONS_BY_MIME[file?.mimetype];
  if (!allowed) return false;
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  return allowed.includes(ext);
}

// multer fileFilter shared by the evidence and vault routers.
export const uploadFileFilter = (req, file, cb) => {
  if (isAllowedUpload(file)) return cb(null, true);
  cb(Object.assign(new Error("File type not allowed"), { status: 400 }), false);
};
