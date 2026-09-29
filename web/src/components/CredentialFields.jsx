export default function CredentialFields({
  authType,
  accessKeyId, setAccessKeyId,
  secretAccessKey, setSecretAccessKey,
  sessionToken, setSessionToken,
  clientId, setClientId,
  clientSecret, setClientSecret,
}) {
  if (authType === "access_key") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-access-key">Access key ID</label>
          <input id="cred-access-key" required value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-secret-key">Secret access key</label>
          <input id="cred-secret-key" type="password" required value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-session-token">Session token (optional)</label>
          <input id="cred-session-token" value={sessionToken} onChange={e => setSessionToken(e.target.value)} />
        </div>
      </>
    );
  }

  if (authType === "oauth2") {
    return (
      <>
        <div className="form-group">
          <label htmlFor="cred-client-id">Client ID</label>
          <input id="cred-client-id" required value={clientId} onChange={e => setClientId(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="cred-client-secret">Client secret</label>
          <input id="cred-client-secret" type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </div>
      </>
    );
  }

  return null;
}
