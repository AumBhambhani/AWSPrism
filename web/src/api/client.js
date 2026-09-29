import { getVaultToken } from "../utils/vaultSession.js";

const API_URL = import.meta.env.VITE_API_URL || "";

// Vault routes are PIN-gated; send the unlocked vault session (if any) automatically.
function withVaultToken(path, headers) {
  if (!path.startsWith("/api/vault") || headers["X-Vault-Token"]) return headers;
  const t = getVaultToken();
  return t ? { ...headers, "X-Vault-Token": t } : headers;
}

function httpError(error, status) {
  const err = new Error(error.error || `HTTP ${status}`);
  err.status = status;
  if (error.code) err.code = error.code;
  return err;
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  timeout: 30000,         // 30 seconds per request
  maxRetries: 3,          // Max retry attempts before cooldown
  cooldownMs: 30 * 60 * 1000, // 30 minutes cooldown after max retries
  maxConcurrent: 20,      // Max concurrent in-flight requests (queue limit)
  uploadTimeout: 120000,  // 2 minutes for file uploads
};

// ═══════════════════════════════════════════════════════════════════
// COOLDOWN MANAGER (persisted in localStorage, scoped per user)
// ═══════════════════════════════════════════════════════════════════

// Decode JWT payload without verification to extract a user identifier.
// Used only for scoping localStorage keys — no trust decisions are made.
let _currentToken = null;

function getUserScope() {
  if (_currentToken) {
    try {
      const payload = JSON.parse(atob(_currentToken.split(".")[1]));
      const id = payload.userId || payload.sub || payload.email;
      if (id) return String(id);
    } catch {}
  }
  return "guest";
}

function cooldownKey() { return `prism_api_cooldown_${getUserScope()}`; }
function retryKey() { return `prism_api_retries_${getUserScope()}`; }

function getCooldownState() {
  try {
    const raw = localStorage.getItem(cooldownKey());
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (Date.now() > state.expiresAt) {
      localStorage.removeItem(cooldownKey());
      localStorage.removeItem(retryKey());
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function getRetryCount() {
  try {
    return parseInt(localStorage.getItem(retryKey()) || "0", 10);
  } catch {
    return 0;
  }
}

function incrementRetryCount() {
  const count = getRetryCount() + 1;
  localStorage.setItem(retryKey(), String(count));
  if (count >= CONFIG.maxRetries) {
    const state = {
      activatedAt: Date.now(),
      expiresAt: Date.now() + CONFIG.cooldownMs,
      reason: `Too many failed requests (${count} retries). Cooling down for 30 minutes.`,
    };
    localStorage.setItem(cooldownKey(), JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("api:cooldown-activated", { detail: state }));
  }
  return count;
}

function resetRetryCount() {
  localStorage.removeItem(retryKey());
}

/** Check if the client is in cooldown. Returns { active, remainingMs, reason } */
export function getCooldownInfo() {
  const state = getCooldownState();
  if (!state) return { active: false, remainingMs: 0, reason: null };
  return {
    active: true,
    remainingMs: Math.max(0, state.expiresAt - Date.now()),
    reason: state.reason,
  };
}

/** Manually clear the cooldown (e.g. admin override) */
export function clearCooldown() {
  localStorage.removeItem(cooldownKey());
  localStorage.removeItem(retryKey());
  window.dispatchEvent(new CustomEvent("api:cooldown-cleared"));
}

// ═══════════════════════════════════════════════════════════════════
// REQUEST QUEUE (fail fast when overloaded)
// ═══════════════════════════════════════════════════════════════════
let inFlightCount = 0;

function acquireSlot() {
  if (inFlightCount >= CONFIG.maxConcurrent) {
    const err = new Error("Too many requests in progress. Please wait and try again.");
    err.code = "QUEUE_FULL";
    throw err;
  }
  inFlightCount++;
}

function releaseSlot() {
  inFlightCount = Math.max(0, inFlightCount - 1);
}

// ═══════════════════════════════════════════════════════════════════
// TIMEOUT WRAPPER using AbortController
// ═══════════════════════════════════════════════════════════════════
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const signal = controller.signal;

  // Merge any existing signal
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort());
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return fetch(url, { ...options, signal })
    .then((response) => {
      clearTimeout(timeoutId);
      return response;
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        timeoutError.code = "TIMEOUT";
        throw timeoutError;
      }
      throw err;
    });
}

// ═══════════════════════════════════════════════════════════════════
// CORE API FETCH (with timeout, queue, cooldown)
// ═══════════════════════════════════════════════════════════════════
export const apiFetch = async (path, options = {}) => {
  // Check cooldown first (fail fast)
  const cooldown = getCooldownState();
  if (cooldown) {
    const remaining = Math.ceil((cooldown.expiresAt - Date.now()) / 60000);
    const err = new Error(`Request blocked: cooldown active (${remaining} min remaining). Too many failed attempts.`);
    err.code = "COOLDOWN";
    err.cooldown = cooldown;
    throw err;
  }

  // Check queue capacity (fail fast)
  acquireSlot();

  try {
    const { token, timeout, ...fetchOptions } = options;
    if (token) _currentToken = token;
    const headers = withVaultToken(path, {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    });

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const requestTimeout = timeout || CONFIG.timeout;

    const rawBody = fetchOptions.body;
    const serializedBody =
      rawBody && typeof rawBody === "object" && !(rawBody instanceof FormData)
        ? JSON.stringify(rawBody)
        : rawBody;

    const response = await fetchWithTimeout(
      `${API_URL}${path}`,
      { ...fetchOptions, headers, body: serializedBody },
      requestTimeout
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Request failed" }));
      // A rejected session (expired, or revoked by a password reset) — send the user to log in again.
      // Only the auth middleware's codes mean the session is dead — a 401 for a wrong PIN or
      // password confirmation must not sign the user out.
      if (response.status === 401 && token && ["SESSION_INVALID", "SESSION_REVOKED"].includes(error.code)) {
        window.dispatchEvent(new CustomEvent("auth:session-expired", { detail: { code: error.code, message: error.error } }));
      }
      if (response.status === 403 && error.code) {
        if (["COMPANY_REJECTED", "COMPANY_SUSPENDED"].includes(error.code)) {
          window.dispatchEvent(new CustomEvent("auth:company-blocked", { detail: { code: error.code, message: error.error } }));
        } else if (["TRIAL_EXPIRED", "SUBSCRIPTION_EXPIRED"].includes(error.code)) {
          window.dispatchEvent(new CustomEvent("auth:billing-blocked", { detail: { code: error.code, message: error.error } }));
        }
      }

      // Server returned 408 or 504 — treat as timeout for retry purposes
      if (response.status === 408 || response.status === 504) {
        const timeoutErr = new Error(error.error || `Server timeout (${response.status})`);
        timeoutErr.code = "TIMEOUT";
        throw timeoutErr;
      }

      throw httpError(error, response.status);
    }

    // Successful response — reset retry counter
    resetRetryCount();

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;

    return response.json();
  } catch (err) {
    // Track timeouts and network errors for retry/cooldown
    if (err.code === "TIMEOUT" || err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError")) {
      const count = incrementRetryCount();
      err.retryCount = count;
      err.maxRetries = CONFIG.maxRetries;
      err.canRetry = count < CONFIG.maxRetries;
    }
    throw err;
  } finally {
    releaseSlot();
  }
};

// ═══════════════════════════════════════════════════════════════════
// API UPLOAD (with timeout, queue, cooldown)
// ═══════════════════════════════════════════════════════════════════
export const apiUpload = async (path, file, body = {}, token, extraHeaders = {}) => {
  // Check cooldown
  const cooldown = getCooldownState();
  if (cooldown) {
    const remaining = Math.ceil((cooldown.expiresAt - Date.now()) / 60000);
    const err = new Error(`Upload blocked: cooldown active (${remaining} min remaining).`);
    err.code = "COOLDOWN";
    throw err;
  }

  acquireSlot();

  try {
    const form = new FormData();
    if (file) form.append("file", file);
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) form.append(k, v);
    }

    let headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    Object.assign(headers, extraHeaders);
    headers = withVaultToken(path, headers);

    const response = await fetchWithTimeout(
      `${API_URL}${path}`,
      { method: "POST", headers, body: form },
      CONFIG.uploadTimeout
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Upload failed" }));
      throw httpError(error, response.status);
    }

    resetRetryCount();
    return response.json();
  } catch (err) {
    if (err.code === "TIMEOUT" || err.message?.includes("Failed to fetch")) {
      const count = incrementRetryCount();
      err.retryCount = count;
      err.maxRetries = CONFIG.maxRetries;
      err.canRetry = count < CONFIG.maxRetries;
    }
    throw err;
  } finally {
    releaseSlot();
  }
};

// ═══════════════════════════════════════════════════════════════════
// API DOWNLOAD (unchanged, just returns URL)
// ═══════════════════════════════════════════════════════════════════
export const apiDownload = (path) => {
  return `${API_URL}${path}`;
};
