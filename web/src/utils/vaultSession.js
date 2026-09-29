// Vault PIN session shared across pages. The server binds the token to the user
// and company and expires it after 8h, so a stale or foreign token is simply
// refused and the user is asked for the PIN again.
const KEY = "prism_vault_token";

export function getVaultToken() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export function setVaultToken(token) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable — PIN is re-asked per page */ }
}

export function vaultHeaders() {
  const t = getVaultToken();
  return t ? { "X-Vault-Token": t } : {};
}

export function isVaultPinError(e) {
  return e?.code === "VAULT_PIN_REQUIRED";
}
