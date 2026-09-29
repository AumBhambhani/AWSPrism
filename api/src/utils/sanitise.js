/**
 * Central sanitisation helpers.
 * All free-text user input should pass through these before being stored.
 */

// Strip HTML tags and null-bytes from a string.
// React escapes on render, but data may be consumed by emails, PDFs, or audit logs.
export function sanitiseText(value, maxLength = 2000) {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/\0/g, "")                        // null bytes
    .replace(/<[^>]*>/g, "")                   // HTML tags
    .replace(/javascript\s*:/gi, "")           // inline JS attempts
    .trim();
  return s.length === 0 ? null : s.slice(0, maxLength);
}

// Validate a URL — only http/https allowed. Returns null for anything else.
export function sanitiseUrl(value) {
  if (!value) return null;
  const s = String(value).trim();
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return s.slice(0, 2048);
  } catch {
    return null;
  }
}

// Sanitise an object of fields in one call.
// Pass a map of { fieldName: "text" | "url" | "skip" }
// Fields not listed are left untouched.
export function sanitiseFields(body, schema) {
  const out = { ...body };
  for (const [field, type] of Object.entries(schema)) {
    if (out[field] === undefined) continue;
    if (type === "text") out[field] = sanitiseText(out[field]);
    else if (type === "url")  out[field] = sanitiseUrl(out[field]);
  }
  return out;
}
