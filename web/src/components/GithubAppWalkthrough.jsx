import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";

export default function GithubAppWalkthrough({ connectionId, token }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch(`/api/integrations/${connectionId}/github/setup-info`, { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [connectionId, token]);

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Click "Create GitHub App on GitHub" below — GitHub will show you exactly the read-only permissions Prism is requesting.</li>
        <li>Confirm creating the App. GitHub sends you back here automatically.</li>
        <li>Click "Install the App" and choose which repositories Prism can read.</li>
      </ol>
      <p style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px" }}>
        You'll need to be an <strong>Owner</strong> of the GitHub organization to complete the install step — repo admin access or the "GitHub App manager" role isn't enough. If you're not an owner, ask one to run through this instead.
      </p>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo && (
        <form action={`https://github.com/settings/apps/new?state=${encodeURIComponent(setupInfo.state)}`} method="post">
          <input type="hidden" name="manifest" value={JSON.stringify(setupInfo.manifest)} />
          <button type="submit" className="btn btn-primary">Create GitHub App on GitHub</button>
        </form>
      )}
    </div>
  );
}
