// Storage refs ("local:/app/uploads/…", s3 keys, bare legacy paths) reveal server
// layout and must never reach API clients. The UI only needs to know whether a
// file exists, so string values of these keys are replaced by `true`.
const PATH_KEYS = new Set(["storagePath", "storage_path", "filePath", "file_path"]);

export function redactStoragePaths(value) {
  if (Array.isArray(value)) return value.map(redactStoragePaths);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = PATH_KEYS.has(k) && typeof v === "string" && v ? true : redactStoragePaths(v);
    }
    return out;
  }
  return value;
}

export function redactStoragePathsMiddleware(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(redactStoragePaths(body));
  next();
}
