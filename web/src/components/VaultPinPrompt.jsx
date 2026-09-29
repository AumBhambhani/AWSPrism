import { useState } from "react";
import { apiFetch } from "../api/client";
import { setVaultToken } from "../utils/vaultSession";

// Inline unlock card for pages that show vault evidence outside the vault itself.
// Only rendered after the API answered VAULT_PIN_REQUIRED, i.e. an admin has set a PIN.
export default function VaultPinPrompt({ token, onUnlocked, message = "Linked vault evidence is protected by the vault PIN." }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    if (pin.length !== 6) { setError("Enter a 6-digit PIN"); return; }
    setVerifying(true);
    setError("");
    try {
      const data = await apiFetch("/api/vault/pin/verify", { token, method: "POST", body: JSON.stringify({ pin }) });
      setVaultToken(data?.token || null);
      setPin("");
      onUnlocked?.();
    } catch (e) {
      setError(e.message || "Incorrect PIN");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 20 }}>🔐</span>
      <div style={{ flex: "1 1 200px", fontSize: 13, color: "var(--text2)" }}>{message}</div>
      <input
        type="password"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={e => e.key === "Enter" && verify()}
        placeholder="••••••"
        aria-label="Vault PIN"
        style={{ width: 120, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 16, textAlign: "center", letterSpacing: 4 }}
      />
      <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={verify} disabled={verifying}>
        {verifying ? "Verifying…" : "Unlock"}
      </button>
      {error && <div style={{ width: "100%", fontSize: 12, color: "var(--red)" }}>✗ {error}</div>}
    </div>
  );
}
