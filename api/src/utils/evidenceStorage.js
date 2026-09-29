/**
 * Evidence storage abstraction — the single choke point for reading and writing
 * evidence / vault files.
 *
 * Each company picks a backend (company_settings.evidence_storage_backend):
 *   local      — PRISM-managed disk under UPLOAD_DIR (the historical default)
 *   s3         — the company's own S3 bucket (access keys or STS AssumeRole)
 *   azure_blob — the company's own Azure Blob container (connection string)
 *
 * Files are identified by a "storage ref" string of the form "<backend>:<key>"
 * that is persisted in evidence.file_path / evidence_vault.storage_path /
 * evidence_versions.storage_path. A value with no recognised backend prefix
 * (every pre-existing row) is treated as a local ref.
 */
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { query, mapRow } from "../db/index.js";
import { getStorageCredential } from "../db/storageCredentials.js";
import { resolveAwsCredentials } from "../connectors/aws/credentials.js";

const BACKENDS = ["local", "s3", "azure_blob"];

// ─── Storage refs ────────────────────────────────────────────────────────────

export function parseRef(ref) {
  if (typeof ref !== "string" || !ref) return null;
  for (const backend of BACKENDS) {
    const prefix = `${backend}:`;
    if (ref.startsWith(prefix)) return { backend, key: ref.slice(prefix.length) };
  }
  // Legacy row — a bare filesystem path written before this abstraction existed.
  return { backend: "local", key: ref };
}

export function makeRef(backend, key) {
  return `${backend}:${key}`;
}

export function refBackend(ref) {
  return parseRef(ref)?.backend || "local";
}

function randomName(originalName) {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return suffix + path.extname(originalName || "");
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ─── Local backend ──────────────────────────────────────────────────────────

function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || "./uploads");
}

function safeLocalPath(key) {
  const root = uploadRoot();
  const resolved = path.resolve(key);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!resolved.startsWith(safeRoot)) {
    const err = new Error("Invalid file path");
    err.status = 400;
    throw err;
  }
  return resolved;
}

function safeCompanyLocalPath(companyId, key) {
  const resolved = safeLocalPath(key);
  const companyRoot = path.resolve(uploadRoot(), String(companyId));
  const safeCompanyRoot = `${companyRoot}${path.sep}`;
  if (!resolved.startsWith(safeCompanyRoot)) {
    const err = new Error("Invalid tenant storage path");
    err.status = 400;
    throw err;
  }
  return resolved;
}

function assertTenantStorageKey(companyId, parsed, config = {}) {
  if (parsed.backend === "local") {
    safeCompanyLocalPath(companyId, parsed.key);
    return;
  }

  const expectedPrefix = parsed.backend === "s3"
    ? `${s3Key(config, companyId, null, "")}/`
    : `${companyId}/`;
  if (!parsed.key.startsWith(expectedPrefix)) {
    const err = new Error("Invalid tenant storage reference");
    err.status = 400;
    throw err;
  }
}

// Sub-folder inside a company's namespace for a given save scope. Quarantined uploads
// (F-12) are kept apart from released evidence.
function scopeDir(scope) {
  if (scope === "vault" || scope === "version") return "vault";
  if (scope === "quarantine") return "quarantine";
  return null;
}

const localBackend = {
  async save(companyId, { buffer, originalName, scope }) {
    const base = process.env.UPLOAD_DIR || "./uploads";
    const sub = scopeDir(scope);
    const dir = sub ? path.join(base, String(companyId), sub) : path.join(base, String(companyId));
    fs.mkdirSync(dir, { recursive: true });
    const key = path.join(dir, randomName(originalName));
    await fsp.writeFile(key, buffer);
    return key;
  },
  async openStream(key) {
    const resolved = safeLocalPath(key);
    if (!fs.existsSync(resolved)) return null;
    return fs.createReadStream(resolved);
  },
  async delete(key) {
    try {
      const resolved = safeLocalPath(key);
      if (fs.existsSync(resolved)) await fsp.unlink(resolved);
    } catch {
      /* best effort */
    }
  },
  async deleteCompanyPrefix(companyId) {
    const dir = path.resolve(uploadRoot(), String(companyId));
    try {
      safeLocalPath(dir);
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  },
};

// ─── S3 backend ─────────────────────────────────────────────────────────────

async function s3Client({ config, authType, secret }) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const credentials = await resolveAwsCredentials({
    authType,
    config: { region: config.region, roleArn: config.roleArn },
    secret,
  });
  return new S3Client({ region: config.region, credentials });
}

function s3Key(config, companyId, scope, name) {
  return [config.prefix, String(companyId), scopeDir(scope), name]
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ""))
    .join("/");
}

function makeS3Backend({ config, authType, secret }) {
  return {
    async save(companyId, { buffer, originalName, scope, contentType }) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client({ config, authType, secret });
      const key = s3Key(config, companyId, scope, randomName(originalName));
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || undefined,
      }));
      return key;
    },
    async openStream(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client({ config, authType, secret });
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return res.Body;
      } catch (err) {
        if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client({ config, authType, secret });
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch {
        /* best effort */
      }
    },
    async deleteCompanyPrefix(companyId) {
      const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client({ config, authType, secret });
      const prefix = s3Key(config, companyId, null, "").replace(/\/$/, "") + "/";
      let ContinuationToken;
      do {
        const list = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket, Prefix: prefix, ContinuationToken,
        }));
        const objects = (list.Contents || []).map((o) => ({ Key: o.Key }));
        if (objects.length) {
          await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects } }));
        }
        ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },
  };
}

// ─── Azure Blob backend ─────────────────────────────────────────────────────

// The connection string decides where the API connects, so it is parsed here — strictly
// — and the client is built from the checked parts; it is never handed to the SDK's own
// parser, which reads duplicate/malformed keys differently (closure reviews 6B/7B). Only
// Azure's public blob endpoints over HTTPS are reachable. Also applied at connect time,
// so a string saved before this check can't be used either.
const AZURE_SUFFIXES = new Set(["core.windows.net", "core.chinacloudapi.cn", "core.usgovcloudapi.net"]);
const AZURE_KEYS = new Set(["DefaultEndpointsProtocol", "AccountName", "AccountKey", "EndpointSuffix", "BlobEndpoint", "SharedAccessSignature"]);

export function parseAzureConnectionString(cs) {
  const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (typeof cs !== "string" || cs.length > 4096) fail("Invalid connection string");
  const parts = {};
  for (const raw of cs.split(";")) {
    const seg = raw.trim();
    if (!seg) continue;
    const i = seg.indexOf("=");
    if (i <= 0) fail("Invalid connection string segment");
    const key = seg.slice(0, i);
    const value = seg.slice(i + 1);
    if (!AZURE_KEYS.has(key)) fail(`Unsupported connection string key: ${key.slice(0, 40)}`);
    if (key in parts) fail(`Duplicate connection string key: ${key}`);
    if (!value) fail(`Empty value for ${key}`);
    parts[key] = value;
  }
  if (parts.DefaultEndpointsProtocol !== undefined && parts.DefaultEndpointsProtocol !== "https") fail("The connection string must use HTTPS");
  const suffix = parts.EndpointSuffix ?? "core.windows.net";
  if (!AZURE_SUFFIXES.has(suffix)) fail("The connection string must use an Azure Storage endpoint");
  if (parts.AccountName !== undefined && !/^[a-z0-9]{1,24}$/.test(parts.AccountName)) fail("AccountName must be 3-24 lowercase letters or digits");

  let url;
  if (parts.BlobEndpoint !== undefined) {
    let u;
    try { u = new URL(parts.BlobEndpoint); } catch { fail("BlobEndpoint is not a valid URL"); }
    const host = u.hostname.toLowerCase();
    const okHost = [...AZURE_SUFFIXES].some((sfx) => new RegExp(`^[a-z0-9]{1,24}\\.blob\\.${sfx.replace(/\./g, "\\.")}$`).test(host));
    if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash
        || !["", "/"].includes(u.pathname) || !okHost) {
      fail("BlobEndpoint must be an https://<account>.blob.core.windows.net address");
    }
    url = `https://${host}`;
  } else {
    if (!parts.AccountName) fail("The connection string needs an AccountName or a BlobEndpoint");
    url = `https://${parts.AccountName}.blob.${suffix}`;
  }

  if (parts.AccountKey !== undefined) {
    if (!parts.AccountName) fail("AccountKey requires AccountName");
    if (!/^[A-Za-z0-9+/=]+$/.test(parts.AccountKey)) fail("AccountKey is not valid base64");
    return { url, accountName: parts.AccountName, accountKey: parts.AccountKey };
  }
  if (parts.SharedAccessSignature !== undefined) {
    const sas = parts.SharedAccessSignature.replace(/^\?/, "");
    if (!/^[A-Za-z0-9%&=._~+\/:-]+$/.test(sas)) fail("SharedAccessSignature contains invalid characters");
    return { url, sas };
  }
  fail("The connection string needs an AccountKey or a SharedAccessSignature");
}

async function azureContainer({ config, secret }) {
  const { BlobServiceClient, StorageSharedKeyCredential, AnonymousCredential } = await import("@azure/storage-blob");
  const p = parseAzureConnectionString(secret.connectionString);
  const client = p.accountKey
    ? new BlobServiceClient(p.url, new StorageSharedKeyCredential(p.accountName, p.accountKey))
    : new BlobServiceClient(`${p.url}?${p.sas}`, new AnonymousCredential());
  return client.getContainerClient(config.container);
}

function azureKey(companyId, scope, name) {
  return [String(companyId), scopeDir(scope), name]
    .filter(Boolean)
    .join("/");
}

function makeAzureBackend({ config, secret }) {
  return {
    async save(companyId, { buffer, originalName, scope, contentType }) {
      const container = await azureContainer({ config, secret });
      const key = azureKey(companyId, scope, randomName(originalName));
      await container.getBlockBlobClient(key).uploadData(buffer, {
        blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
      });
      return key;
    },
    async openStream(key) {
      const container = await azureContainer({ config, secret });
      try {
        const res = await container.getBlockBlobClient(key).download();
        return res.readableStreamBody;
      } catch (err) {
        if (err?.statusCode === 404 || err?.code === "BlobNotFound") return null;
        throw err;
      }
    },
    async delete(key) {
      try {
        const container = await azureContainer({ config, secret });
        await container.getBlockBlobClient(key).deleteIfExists();
      } catch {
        /* best effort */
      }
    },
    async deleteCompanyPrefix(companyId) {
      const container = await azureContainer({ config, secret });
      for await (const blob of container.listBlobsFlat({ prefix: `${companyId}/` })) {
        await container.getBlockBlobClient(blob.name).deleteIfExists();
      }
    },
  };
}

// ─── Backend resolution ─────────────────────────────────────────────────────

const _cache = new Map(); // companyId -> { backend, config, authType, secret }

export function invalidateStorage(companyId) {
  _cache.delete(Number(companyId));
}

async function loadStorageConfig(companyId) {
  const cid = Number(companyId);
  if (_cache.has(cid)) return _cache.get(cid);

  const result = await query(
    "SELECT evidence_storage_backend, evidence_storage_config FROM company_settings WHERE company_id = $1",
    [cid]
  );
  const row = mapRow(result);
  const backend = row?.evidenceStorageBackend || "local";
  const config = row?.evidenceStorageConfig || {};

  let authType = null;
  let secret = null;
  if (backend !== "local") {
    const cred = await getStorageCredential(cid);
    if (!cred) {
      throw new Error(`Evidence storage for company ${cid} is set to "${backend}" but no credentials are stored`);
    }
    authType = cred.authType;
    secret = cred.secret;
  }

  const entry = { backend, config, authType, secret };
  _cache.set(cid, entry);
  return entry;
}

/** Build a backend handler from an explicit descriptor (used by the migration runner). */
export function getBackendHandler({ backend, config, authType, secret }) {
  if (backend === "s3") return makeS3Backend({ config, authType, secret });
  if (backend === "azure_blob") return makeAzureBackend({ config, secret });
  return localBackend;
}

async function backendForRef(companyId, ref) {
  const { backend } = parseRef(ref) || { backend: "local" };
  if (backend === "local") return { handler: localBackend, config: {} };
  const cfg = await loadStorageConfig(companyId);
  if (cfg.backend === backend) return { handler: getBackendHandler(cfg), config: cfg.config };
  const e = new Error(
    `This file is stored on ${backend} but the company is now configured for ${cfg.backend}. Storage migration may still be running.`
  );
  e.status = 409;
  throw e;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Persist a file for a company on its configured backend.
 * @returns {Promise<string>} storage ref ("<backend>:<key>")
 */
export async function saveObject(companyId, { buffer, originalName, scope, contentType }) {
  const cfg = await loadStorageConfig(companyId);
  const handler = getBackendHandler(cfg);
  const key = await handler.save(companyId, { buffer, originalName, scope, contentType });
  return makeRef(cfg.backend, key);
}

/** Open a readable stream for a stored ref, or null if the object is missing. */
export async function openObjectStream(companyId, ref) {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  const { handler, config } = await backendForRef(companyId, ref);
  assertTenantStorageKey(companyId, parsed, config);
  const { key } = parsed;
  return handler.openStream(key);
}

/** Read a stored ref fully into a Buffer, or null if missing. */
export async function readObjectBuffer(companyId, ref) {
  const stream = await openObjectStream(companyId, ref);
  if (!stream) return null;
  return streamToBuffer(stream);
}

/** Best-effort delete of a single stored object. */
export async function deleteObject(companyId, ref) {
  const parsed = parseRef(ref);
  if (!parsed) return;
  const { handler, config } = await backendForRef(companyId, ref);
  assertTenantStorageKey(companyId, parsed, config);
  const { key } = parsed;
  await handler.delete(key);
}

/** Remove every object a company has on the given backend (company deletion). */
export async function deleteCompanyObjects(companyId, backend) {
  if (backend === "local") return localBackend.deleteCompanyPrefix(companyId);
  const cfg = await loadStorageConfig(companyId).catch(() => null);
  if (!cfg || cfg.backend !== backend) return;
  await getBackendHandler(cfg).deleteCompanyPrefix(companyId);
}

/**
 * Run `fn` with a real local filesystem path to the object's bytes. For local
 * refs this is the file itself; for remote refs the object is downloaded to a
 * temp file that is removed afterwards. Used by the AI text-extraction paths,
 * which need a path on disk.
 */
export async function withLocalCopy(companyId, ref, fn) {
  const parsed = parseRef(ref);
  if (!parsed) throw new Error("Missing storage ref");

  if (parsed.backend === "local") {
    const resolved = safeCompanyLocalPath(companyId, parsed.key);
    if (!fs.existsSync(resolved)) {
      const err = new Error("File not found on disk");
      err.status = 404;
      throw err;
    }
    return fn(resolved);
  }

  const buffer = await readObjectBuffer(companyId, ref);
  if (!buffer) {
    const err = new Error("File not found in storage");
    err.status = 404;
    throw err;
  }
  const tmp = path.join(os.tmpdir(), `prism-${crypto.randomBytes(8).toString("hex")}${path.extname(parsed.key)}`);
  await fsp.writeFile(tmp, buffer);
  try {
    return await fn(tmp);
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
}

// ─── Connectivity check (used by the settings endpoint) ─────────────────────

export async function testBackend({ backend, config, authType, secret }) {
  if (!BACKENDS.includes(backend)) throw new Error(`Unknown storage backend: ${backend}`);

  const handler = getBackendHandler({ backend, config, authType, secret });
  const probeName = `__prism_connectivity_check__-${crypto.randomBytes(8).toString("hex")}.txt`;
  const body = Buffer.from("prism-ok");
  let key;
  try {
    key = await handler.save("_healthcheck", { buffer: body, originalName: probeName, scope: null, contentType: "text/plain" });
  } catch (err) {
    throw friendly(backend, "write", err);
  }
  try {
    const stream = await handler.openStream(key);
    if (!stream) throw new Error("object not found immediately after write");
    const got = await streamToBuffer(stream);
    if (got.toString() !== "prism-ok") throw new Error("readback content mismatch");
  } catch (err) {
    await handler.delete(key).catch(() => {});
    throw friendly(backend, "read", err);
  }
  await handler.delete(key).catch(() => {});
}

// The provider's raw error text can echo whatever the remote end said (or an internal
// address), so the client only gets the error's code/class and HTTP status; the full
// error is logged (closure review 6B, same rule as F-23).
function friendly(backend, phase, err) {
  const label = backend === "s3" ? "S3" : backend === "azure_blob" ? "Azure Blob Storage" : backend;
  console.error(`[evidenceStorage] connectivity check (${phase}) failed:`, err); // nosemgrep
  const code = [err?.code, err?.Code, err?.name].find((c) => typeof c === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(c) && c !== "Error" && !/^E(CONN|HOST|NOTFOUND|TIMEDOUT|ADDR)/.test(c));
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : Number.isInteger(err?.$metadata?.httpStatusCode) ? err.$metadata.httpStatusCode : null;
  const detail = [code, status ? `HTTP ${status}` : null].filter(Boolean).join(", ");
  const e = new Error(`Could not ${phase} to ${label}${detail ? ` (${detail})` : ""}. Check the bucket/container name, region and credentials.`);
  e.status = 400;
  return e;
}

export { BACKENDS };
