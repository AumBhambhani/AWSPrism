import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaAws, FaMicrosoft, FaGithub, FaUserShield, FaTicketAlt, FaShieldAlt, FaCrow, FaSalesforce, FaHdd, FaNetworkWired } from "react-icons/fa";
import { SiZoho, SiGoogle, SiGooglecloud } from "react-icons/si";
import { apiFetch } from "../api/client.js";
import CredentialFields from "../components/CredentialFields.jsx";
import GithubAppWalkthrough from "../components/GithubAppWalkthrough.jsx";

const STATUS_COLOR = {
  connected: "var(--green)",
  pending:   "var(--text3)",
  error:     "var(--red)",
  revoked:   "var(--text3)",
};

const PROVIDER_ICON = {
  aws: { Icon: FaAws, color: "#FF9900" },
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
  github: { Icon: FaGithub, color: "#181717" },
  purview: { Icon: FaMicrosoft, color: "#8661C5" },
  zoho: { Icon: SiZoho, color: "#E61E25" },
  entra_id: { Icon: FaMicrosoft, color: "#0078D4" },
  microsoft_365: { Icon: FaMicrosoft, color: "#D83B01" },
  microsoft_teams: { Icon: FaMicrosoft, color: "#6264A7" },
  microsoft_defender: { Icon: FaMicrosoft, color: "#0D6EFD" },
  google_workspace: { Icon: SiGoogle, color: "#4285F4" },
  gcp: { Icon: SiGooglecloud, color: "#4285F4" },
  onetrust: { Icon: FaUserShield, color: "#24B47E" },
  servicenow: { Icon: FaTicketAlt, color: "#293E40" },
  privy: { Icon: FaShieldAlt, color: "#2D6DF6" },
  crowdstrike: { Icon: FaCrow, color: "#FC0000" },
  salesforce: { Icon: FaSalesforce, color: "#00A1E0" },
  acronis: { Icon: FaHdd, color: "#0068B7" },
  commvault: { Icon: FaHdd, color: "#CC0000" },
  carbonite: { Icon: FaHdd, color: "#8DC63F" },
  "carbonite-server": { Icon: FaHdd, color: "#6DBE45" },
  sophos: { Icon: FaShieldAlt, color: "#0A2E57" },
  check_point_mgmt: { Icon: FaShieldAlt, color: "#E5261F" },
  check_point: { Icon: FaShieldAlt, color: "#E5261F" },
  check_point_cloudguard: { Icon: FaShieldAlt, color: "#E5261F" },
  akamai: { Icon: FaNetworkWired, color: "#0099CC" },
};

// CrowdStrike Falcon regions are fully separate API hosts with no cross-region
// routing — the region is captured explicitly and its base URL stored alongside
// (rather than derived at call time) so a tenant's region is unambiguous.
const CROWDSTRIKE_REGION_BASE_URLS = {
  "us-1": "https://api.crowdstrike.com",
  "us-2": "https://api.us-2.crowdstrike.com",
  "eu-1": "https://api.eu-1.crowdstrike.com",
  "us-gov-1": "https://api.laggar.gcw.crowdstrike.com",
  "us-gov-2": "https://api.us-gov-2.crowdstrike.mil",
};

// Check Point Infinity Portal regional gateways — an API key only authenticates
// against the gateway for its region, so the resolved URL is stored explicitly.
const CHECK_POINT_REGION_GATEWAYS = {
  eu: "https://cloudinfra-gw.portal.checkpoint.com",
  us: "https://cloudinfra-gw-us.portal.checkpoint.com",
  ap: "https://cloudinfra-gw-ap.portal.checkpoint.com",
};

// Display order for known categories; anything else falls back to
// alphabetical after these, so a new connector's category never needs a
// code change here to show up — it just lands at the end.
const CATEGORY_ORDER = ["cloud", "devops", "identity", "collaboration", "endpoint_security", "network_security", "data_governance", "backup", "business_apps"];
const CATEGORY_LABEL = {
  cloud: "Cloud",
  devops: "DevOps",
  identity: "Identity",
  collaboration: "Collaboration",
  endpoint_security: "Endpoint Security",
  network_security: "Network Security",
  data_governance: "Data Governance",
  backup: "Backup & Recovery",
  business_apps: "Business Apps",
};

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function groupCatalogByCategory(catalog) {
  const byCategory = new Map();
  for (const c of catalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }
  return [...byCategory.entries()].sort(([a], [b]) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function StatusPill({ status }) {
  const color = STATUS_COLOR[status] || "var(--text3)";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      background: `${color}18`, padding: "2px 8px",
      borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {status}
    </span>
  );
}

const CADENCE_OPTIONS = [6, 12, 24, 72, 168];

function randomExternalId() {
  return `prism-${crypto.randomUUID().slice(0, 8)}`;
}

function trustPolicyFor(principalArn, externalId) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: principalArn || "<ask your Prism administrator for this deployment's AWS principal ARN>" },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": externalId || "<external-id>" } }
    }]
  }, null, 2);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function JsonBlock({ label, json }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 600 }}>{label}</span>
        <CopyButton text={json} />
      </div>
      <pre style={{ fontSize: 11, overflowX: "auto", padding: 10, background: "var(--bg3)", borderRadius: 6, margin: 0 }}>
        {json}
      </pre>
    </div>
  );
}

function AwsRoleWalkthrough({ token, roleArn, setRoleArn, externalId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/aws/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const trustPolicy = trustPolicyFor(setupInfo?.principalArn, externalId);
  const permissionsPolicy = setupInfo?.permissionsPolicy ? JSON.stringify(setupInfo.permissionsPolicy, null, 2) : null;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In AWS IAM → Roles → Create role → <strong>Custom trust policy</strong>, paste the Trust Policy JSON below.</li>
        <li>On the permissions step, create/attach an inline policy using the Permissions Policy JSON below (grants read-only access only).</li>
        <li>Name the role (e.g. <code>prism-readonly</code>) and create it.</li>
        <li>Copy the role's ARN into the field below, then click Connect.</li>
      </ol>

      {setupInfo?.principalError && (
        <p className="error-text" style={{ fontSize: 12 }}>{setupInfo.principalError}</p>
      )}
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <JsonBlock label="Trust policy JSON" json={trustPolicy} />
      {permissionsPolicy && <JsonBlock label="Permissions policy JSON (read-only)" json={permissionsPolicy} />}

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-role-arn">Role ARN <span style={{ color: "var(--text3)", fontWeight: 400 }}>(from step 4 above)</span></label>
        <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/prism-readonly" />
      </div>
    </div>
  );
}

function AzureServicePrincipalWalkthrough({ token, tenantId, setTenantId, subscriptionId, setSubscriptionId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/azure/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const roleDefinition = setupInfo?.roleDefinition ? JSON.stringify(setupInfo.roleDefinition, null, 2) : null;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Microsoft Entra ID → App registrations → New registration. Name it (e.g. <code>prism-readonly</code>).</li>
        <li>Under Certificates &amp; secrets → New client secret. Copy the value immediately — it's shown only once.</li>
        <li>Copy the Application (client) ID and Directory (tenant) ID from the app's Overview page.</li>
        <li>In your Subscription → Access control (IAM) → Add role assignment, using the role definition JSON below (or the built-in Reader role for a quicker start), assigned to the app registration.</li>
        <li>Paste the Tenant ID, Subscription ID, Client ID, and Client Secret below, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {roleDefinition && <JsonBlock label="Role definition JSON" json={roleDefinition} />}

      <div className="form-group">
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-subscription-id">Subscription ID</label>
        <input id="conn-subscription-id" required value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
    </div>
  );
}

function ZohoWalkthrough({ token, dataCenter, setDataCenter, orgId, setOrgId }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [selectedProducts, setSelectedProducts] = useState(null); // null = not yet loaded

  useEffect(() => {
    apiFetch("/api/integrations/zoho/setup-info", { token })
      .then(info => {
        setSetupInfo(info);
        // Default all products selected
        setSelectedProducts(new Set(info.products.map(p => p.key)));
      })
      .catch(e => setSetupError(e.message));
  }, [token]);

  const toggleProduct = (productKey) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productKey)) next.delete(productKey);
      else next.add(productKey);
      return next;
    });
  };

  const scopeString = setupInfo && selectedProducts
    ? setupInfo.products
        .filter(p => selectedProducts.has(p.key))
        .flatMap(p => p.scopes)
        .join(",")
    : "";

  const apiConsoleUrl = dataCenter === "cloud.ca"
    ? "https://api-console.zohocloud.ca"
    : dataCenter === "com" || !dataCenter
      ? "https://api-console.zoho.com"
      : `https://api-console.zoho.${dataCenter}`;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Select your Zoho data center below — this must match the <code>zoho.&lt;tld&gt;</code> domain your org uses to sign in.</li>
        <li>Go to <strong><a href={apiConsoleUrl} target="_blank" rel="noreferrer">{apiConsoleUrl}</a></strong> as an org admin and create a new <strong>Self Client</strong> (or Server-based Application). You will receive a Client ID and Client Secret.</li>
        <li>In the client's <strong>Generate Code</strong> tab, paste the scope string below (select only the products Zoho has provisioned for your org), set the expiry, and generate a grant code.</li>
        <li>Immediately exchange the grant code for tokens:<br />
          <code style={{ fontSize: 10 }}>POST https://accounts.zoho.{'{'}dataCenter{'}'}/oauth/v2/token</code> with <code>grant_type=authorization_code</code>. The response contains an <strong>access_token</strong> and a <strong>refresh_token</strong> — copy the refresh token.
        </li>
        <li>Enter your Org ID (numeric, from the Zoho org settings), then paste the Client ID, Client Secret, and Refresh Token into the fields below and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="zoho-dc">Data center</label>
        <select id="zoho-dc" value={dataCenter} onChange={e => setDataCenter(e.target.value)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", fontSize: 13 }}>
          {(setupInfo?.dataCenters || []).map(dc => (
            <option key={dc.value} value={dc.value}>{dc.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="zoho-org-id">Org ID <span style={{ color: "var(--text3)", fontWeight: 400 }}>(numeric, from Zoho org settings)</span></label>
        <input id="zoho-org-id" value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="60012345678" />
      </div>

      {setupInfo?.products && selectedProducts && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>
            Products to audit <span style={{ fontWeight: 400, color: "var(--text3)" }}>(uncheck products your org hasn't provisioned)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 8 }}>
            {setupInfo.products.map(p => (
              <label key={p.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--text2)" }}>
                <input type="checkbox" checked={selectedProducts.has(p.key)} onChange={() => toggleProduct(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Generated scope string (paste into Zoho API Console → Generate Code):</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}
    </div>
  );
}

function OneTrustWalkthrough({ token, hostname, setHostname }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/onetrust/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const scopeString = (setupInfo?.scopes || []).map(s => s.scope).join(" ");

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In OneTrust, go to <strong>Global Settings → Access Management → Client Credentials</strong> and create a new Client Credential (as a OneTrust admin).</li>
        <li>Grant it the read scopes below — one per module Prism audits. A module whose scope is missing is simply skipped (its checks report <em>not applicable</em>).</li>
        <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>.</li>
        <li>Enter your OneTrust <strong>hostname</strong> (the tenant domain you sign in with) below, paste the Client ID and Client Secret, and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="onetrust-hostname">OneTrust hostname</label>
        <input
          id="onetrust-hostname"
          required
          value={hostname}
          onChange={e => setHostname(e.target.value)}
          placeholder={setupInfo?.hostnameHint ? "acme.my.onetrust.com" : "acme.my.onetrust.com"}
        />
        {setupInfo?.hostnameHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.hostnameHint}</div>
        )}
      </div>

      {setupInfo?.scopes && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Read scopes to grant on the Client Credential</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: "0 0 8px", paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.scopes.map(s => (
              <li key={s.scope}><code>{s.scope}</code> — {s.note}</li>
            ))}
          </ul>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={2}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceNowWalkthrough({ token, instanceUrl, setInstanceUrl }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/servicenow/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const tableString = (setupInfo?.tables || []).map(t => t.table).join("\n");

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In ServiceNow, confirm the system property <code>glide.oauth.inbound.client.credential.grant_type.enabled</code> is <strong>true</strong>.</li>
        <li>Under <strong>System OAuth → Application Registry</strong>, create <em>"an OAuth API endpoint for external clients"</em> (leave Client ID / Secret to auto-generate, do not enable Public Client).</li>
        <li>Create a dedicated integration user with <strong>Web service access only</strong> checked, and set it as the <strong>OAuth Application User</strong> on the registry record.</li>
        <li>Grant that user <code>snc_platform_rest_api_access</code> plus a read-only role covering the tables below. A table its roles can't read is skipped (those checks report <em>not applicable</em>).</li>
        <li>Enter the instance base URL below, paste the Client ID and Client Secret, and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="servicenow-instance-url">ServiceNow instance URL</label>
        <input
          id="servicenow-instance-url"
          required
          value={instanceUrl}
          onChange={e => setInstanceUrl(e.target.value)}
          placeholder="acme.service-now.com"
        />
        {setupInfo?.instanceUrlHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.instanceUrlHint}</div>
        )}
      </div>

      {setupInfo?.roleHint && (
        <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10, lineHeight: 1.6 }}>{setupInfo.roleHint}</div>
      )}

      {setupInfo?.tables && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Tables the integration user must be able to read</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: "0 0 8px", paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.tables.map(t => (
              <li key={t.table}><code>{t.table}</code> — {t.note}</li>
            ))}
          </ul>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={tableString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={tableString} />
          </div>
        </div>
      )}
    </div>
  );
}

function CrowdStrikeWalkthrough({ token, cloudRegion, setCloudRegion }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/crowdstrike/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const regions = setupInfo?.regions || [
    { value: "us-1", label: "US-1 (falcon.crowdstrike.com)" },
    { value: "us-2", label: "US-2 (falcon.us-2.crowdstrike.com)" },
    { value: "eu-1", label: "EU-1 (falcon.eu-1.crowdstrike.com)" },
    { value: "us-gov-1", label: "US-GOV-1 (falcon.laggar.gcw.crowdstrike.com)" },
    { value: "us-gov-2", label: "US-GOV-2 (falcon.us-gov-2.crowdstrike.mil)" },
  ];
  const scopeString = (setupInfo?.scopes || []).map(s => s.scope).join("\n");

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In the Falcon console, go to <strong>Support and resources → API Clients and Keys</strong> and click <strong>Add new API client</strong> (e.g. name it "Prism Compliance Reader").</li>
        <li>Grant only the <strong>read</strong> scopes below — nothing broader. A scope you leave off simply skips that check (it reports <em>not applicable</em>).</li>
        <li>Save, then copy the <strong>Client ID</strong> and <strong>Client Secret</strong> — CrowdStrike shows the secret only once.</li>
        <li>Select your Falcon <strong>region</strong> below, paste the Client ID and Client Secret, and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="crowdstrike-region">Falcon cloud region</label>
        <select
          id="crowdstrike-region"
          required
          value={cloudRegion}
          onChange={e => setCloudRegion(e.target.value)}
        >
          {regions.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {setupInfo?.regionHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.regionHint}</div>
        )}
      </div>

      {setupInfo?.scopes && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Read scopes to grant on the API client</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: "0 0 8px", paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.scopes.map(s => (
              <li key={s.scope}><code>{s.scope}</code> — {s.note}</li>
            ))}
          </ul>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}
    </div>
  );
}

function SophosWalkthrough({ token }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/sophos/setup-info", { token })
      .then(setSetupInfo)
      .catch((error) => setSetupError(error.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In Sophos Central Admin, open Global Settings > API Credentials and add a credential.",
    "Assign the narrowest read-only service-principal role covering the products to audit.",
    "Copy the Client ID and Client Secret shown at creation time.",
    "Paste both values below. Prism discovers the tenant and regional API host automatically.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 10px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((step, index) => <li key={index}>{step}</li>)}
      </ol>
      {setupInfo?.roleHint && <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{setupInfo.roleHint}</div>}
      {setupInfo?.scopeNote && <div style={{ fontSize: 11, color: "var(--text3)" }}>{setupInfo.scopeNote}</div>}
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Could not load setup info: {setupError}</p>}
    </div>
  );
}

// Check Point Security Management — administrator API key, read-only session.
function CheckPointMgmtWalkthrough({ token, mgmtUrl, setMgmtUrl, deployment, setDeployment, apiKey, setApiKey }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/check_point_mgmt/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In SmartConsole, create a read-only administrator and generate an API key, then Publish.",
    "Self-managed: allow the Management API to accept requests from Prism. Smart-1 Cloud: copy the tenant service URL from the Infinity Portal.",
    "Paste the Management URL and the administrator API key below.",
  ];
  const deployments = setupInfo?.deployments || [
    { value: "self_managed", label: "Self-managed Security Management server" },
    { value: "smart1_cloud", label: "Smart-1 Cloud (Check Point hosted)" },
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="cpm-deployment">Deployment</label>
        <select id="cpm-deployment" value={deployment} onChange={e => setDeployment(e.target.value)}>
          {deployments.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="cpm-url">Management URL</label>
        <input id="cpm-url" required value={mgmtUrl} onChange={e => setMgmtUrl(e.target.value)} placeholder="https://mgmt.example.com" />
        {setupInfo?.mgmtUrlHint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.mgmtUrlHint}</div>}
      </div>
      <div className="form-group">
        <label htmlFor="cpm-key">Administrator API key</label>
        <input id="cpm-key" type="password" required value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste the generated API key" />
        {setupInfo?.roleHint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.roleHint}</div>}
      </div>
    </div>
  );
}

// Check Point Infinity — one Infinity Portal API key pair (covers every service).
function CheckPointWalkthrough({ token, region, setRegion, clientId, setClientId, accessKey, setAccessKey }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/check_point/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In the Infinity Portal, open Global Settings > API Keys > New and create a key covering Logs/Events, XDR/XPR and Endpoint (a user key), or one key per service.",
    "Copy the Client ID and Secret Key, and note your Infinity Portal region.",
    "Select the region and paste the pair below.",
  ];
  const regions = setupInfo?.regions || [
    { value: "eu", label: "EU (cloudinfra-gw.portal.checkpoint.com)" },
    { value: "us", label: "US (cloudinfra-gw-us.portal.checkpoint.com)" },
    { value: "ap", label: "AP (cloudinfra-gw-ap.portal.checkpoint.com)" },
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="cp-region">Infinity Portal region</label>
        <select id="cp-region" required value={region} onChange={e => setRegion(e.target.value)}>
          {regions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {setupInfo?.regionHint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.regionHint}</div>}
      </div>
      <div className="form-group">
        <label htmlFor="cp-client-id">Client ID</label>
        <input id="cp-client-id" required value={clientId} onChange={e => setClientId(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="cp-access-key">Secret Key</label>
        <input id="cp-access-key" type="password" required value={accessKey} onChange={e => setAccessKey(e.target.value)} />
      </div>
      {setupInfo?.services && (
        <ul style={{ fontSize: 11, color: "var(--text2)", margin: "4px 0 0", paddingLeft: 16, lineHeight: 1.6 }}>
          {setupInfo.services.map(s => <li key={s.service}><strong>{s.label}</strong> — {s.note}</li>)}
        </ul>
      )}
      {setupInfo?.scopeNote && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>{setupInfo.scopeNote}</div>}
    </div>
  );
}

// Check Point CloudGuard (Dome9) — API key id + secret, HTTP Basic auth.
function CheckPointCloudguardWalkthrough({ token, dataCenter, setDataCenter, keyId, setKeyId, keySecret, setKeySecret }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/check_point_cloudguard/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In the CloudGuard console, open Settings > Credentials and create an API key with a read-only role.",
    "Copy the API Key ID and Secret (shown once).",
    "Select your data centre (Settings > Account Info) and paste the key id and secret below.",
  ];
  const dataCenters = setupInfo?.dataCenters || [
    { value: "us", label: "US (api.dome9.com)" },
    { value: "eu", label: "EU (api.eu1.dome9.com)" },
    { value: "ap1", label: "AP1 – Sydney" },
    { value: "ap2", label: "AP2 – Singapore" },
    { value: "ap3", label: "AP3 – Mumbai" },
    { value: "ca", label: "Canada" },
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="cg-dc">Data centre</label>
        <select id="cg-dc" required value={dataCenter} onChange={e => setDataCenter(e.target.value)}>
          {dataCenters.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        {setupInfo?.dataCenterHint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.dataCenterHint}</div>}
      </div>
      <div className="form-group">
        <label htmlFor="cg-key-id">API Key ID</label>
        <input id="cg-key-id" required value={keyId} onChange={e => setKeyId(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="cg-key-secret">API Key Secret</label>
        <input id="cg-key-secret" type="password" required value={keySecret} onChange={e => setKeySecret(e.target.value)} />
      </div>
    </div>
  );
}

function AcronisWalkthrough({ token, datacenterUrl, setDatacenterUrl }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/acronis/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In the Cyber Protect Cloud management console, go to Settings → API clients and click Create API client.",
    "Assign it a Read-only administrator role (Acronis has no per-endpoint scopes).",
    "Save, then copy the Client ID and Client secret — the secret is shown only once.",
    "Copy your data-center URL from the browser address bar (e.g. https://us5-cloud.acronis.com), then paste all three below.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo?.modules && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Modules Prism reads</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.modules.map(m => (
              <li key={m.module}><strong>{m.module}</strong> — {m.note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="conn-acronis-dc">Data center URL</label>
        <input
          id="conn-acronis-dc"
          required
          value={datacenterUrl}
          onChange={e => setDatacenterUrl(e.target.value)}
          placeholder="https://us5-cloud.acronis.com"
        />
        {setupInfo?.datacenterUrlHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.datacenterUrlHint}</div>
        )}
      </div>
    </div>
  );
}

// Carbonite Server Backup (self-hosted) — its OData "API - Monitoring" component
// authenticates via a Keycloak client the customer registers with the vendor's
// setup script. Config is { apiDomain, keycloakRealm }; the Client ID / Client
// secret are collected by the shared <CredentialFields> below this walkthrough.
function CarboniteServerWalkthrough({ token, apiDomain, setApiDomain, keycloakRealm, setKeycloakRealm }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/carbonite-server/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "On the server running the Carbonite Server Backup \"API - Monitoring\" component, run the vendor-supplied Keycloak client-registration script.",
    "Register the client at the \"Reseller\" access level, scoped to the single company you want Prism to monitor.",
    "Copy the generated Client ID and Client secret — the secret is shown only once.",
    "Open the API's Swagger UI (https://<your-api-host>/monitoring/swaggerui/index) once to confirm the host is reachable, and note the Keycloak realm name.",
    "Paste the API host, the Keycloak realm, and the Client ID / Client secret below.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo?.accessLevels && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>
            Access levels{setupInfo.recommendedAccessLevel ? ` — use ${setupInfo.recommendedAccessLevel}` : ""}
          </div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.accessLevels.map(a => (
              <li key={a.level}><strong>{a.level}</strong> — {a.note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="conn-cs-apidomain">API host</label>
        <input
          id="conn-cs-apidomain"
          required
          value={apiDomain}
          onChange={e => setApiDomain(e.target.value)}
          placeholder="https://backup.example.com"
        />
        {setupInfo?.apiDomainHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.apiDomainHint}</div>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="conn-cs-realm">Keycloak realm</label>
        <input
          id="conn-cs-realm"
          required
          value={keycloakRealm}
          onChange={e => setKeycloakRealm(e.target.value)}
          placeholder="carbonite"
        />
        {setupInfo?.keycloakRealmHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.keycloakRealmHint}</div>
        )}
      </div>
    </div>
  );
}

function SalesforceWalkthrough({
  token,
  loginUrl, setLoginUrl,
  sfClientId, setSfClientId,
  username, setUsername,
  apiVersion, setApiVersion,
  privateKey, setPrivateKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/salesforce/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "Generate an RSA keypair locally (openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout salesforce.key -out salesforce.crt).",
    "In Salesforce Setup > App Manager, create a New Connected App: enable OAuth, set any callback URL, and upload salesforce.crt under \"Use digital signatures\".",
    "Select the OAuth scopes \"api\" and \"refresh_token, offline_access\" — nothing broader.",
    "Save, wait for propagation, then set Permitted Users to \"Admin approved users are pre-authorized\" and pre-authorize the integration user's profile/permission set.",
    "Copy the Consumer Key (Client ID) and paste the contents of salesforce.key as the private key below.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect (OAuth 2.0 JWT Bearer flow)</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo?.permissions && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Read-only permission set for the integration user</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.permissions.map(p => (
              <li key={p.permission}><code>{p.permission}</code> — {p.note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="sf-login-url">My Domain login URL</label>
        <input id="sf-login-url" required value={loginUrl} onChange={e => setLoginUrl(e.target.value)} placeholder="https://acme.my.salesforce.com" />
        {setupInfo?.loginUrlHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.loginUrlHint}</div>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="sf-client-id">Consumer Key (Client ID)</label>
        <input id="sf-client-id" required value={sfClientId} onChange={e => setSfClientId(e.target.value)} placeholder="3MVG9…" />
      </div>

      <div className="form-group">
        <label htmlFor="sf-username">Integration user username</label>
        <input id="sf-username" required value={username} onChange={e => setUsername(e.target.value)} placeholder="prism-integration@acme.com" />
      </div>

      <div className="form-group">
        <label htmlFor="sf-api-version">API version <span style={{ color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
        <input id="sf-api-version" value={apiVersion} onChange={e => setApiVersion(e.target.value)} placeholder="v61.0" />
      </div>

      <div className="form-group">
        <label htmlFor="sf-private-key">Private key (contents of salesforce.key)</label>
        <textarea
          id="sf-private-key"
          required
          value={privateKey}
          onChange={e => setPrivateKey(e.target.value)}
          rows={4}
          placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
          style={{ fontSize: 11, fontFamily: "monospace", resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function PrivyWalkthrough({ token, baseUrl, setBaseUrl }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/privy/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Privy, go to <strong>Settings → API Keys</strong> and issue a read-only API key (or ask your IDfy account team).</li>
        <li>The key is scoped to the modules your tenant has licensed — a module Prism audits that the key can't reach is simply skipped (its checks report <em>not applicable</em>).</li>
        <li>Enter your Privy <strong>tenant domain</strong> below, paste the API key, and click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="privy-base-url">Privy tenant domain</label>
        <input
          id="privy-base-url"
          required
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="acme.privybyidfy.com"
        />
        {setupInfo?.baseUrlHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.baseUrlHint}</div>
        )}
      </div>

      {setupInfo?.apiKeyHint && (
        <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 10, lineHeight: 1.6 }}>{setupInfo.apiKeyHint}</div>
      )}

      {setupInfo?.modules && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Modules Prism audits</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.modules.map(m => (
              <li key={m.module}><strong>{m.module}</strong> — {m.note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CommvaultWalkthrough({ token, webconsoleUrl, setWebconsoleUrl, accessToken, setAccessToken }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/commvault/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In Command Center, open your user menu (top-right) → Access Tokens, and click Add.",
    "Set the scope to \"Custom\" and add exactly the API endpoints listed below to the allowlist.",
    "Generate the token and copy it — it is shown only once.",
    "Copy your CommCell WebConsole base URL from the browser address bar, then paste both below.",
  ];
  const apiEndpoints = setupInfo?.accessTokenSetup?.apiEndpoints || ["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Custom-scope API endpoints (paste into the token's allowlist)</div>
        <code style={{ fontSize: 11, color: "var(--text2)", display: "block", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {apiEndpoints.join("\n")}
        </code>
      </div>

      <div className="form-group">
        <label htmlFor="conn-commvault-url">WebConsole base URL</label>
        <input
          id="conn-commvault-url"
          required
          value={webconsoleUrl}
          onChange={e => setWebconsoleUrl(e.target.value)}
          placeholder="https://commvault.example.com"
        />
        {setupInfo?.webconsoleUrlHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.webconsoleUrlHint}</div>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="conn-commvault-token">Custom-scope access token</label>
        <input
          id="conn-commvault-token"
          type="password"
          required
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          placeholder="Paste the generated token"
        />
      </div>
    </div>
  );
}

// Akamai — connects with a read-only API client (.edgerc block: host,
// client_token, client_secret, access_token) plus an optional account switch
// key for partner-managed accounts. config = { host, accountSwitchKey? };
// secret = { clientToken, clientSecret, accessToken }.
function AkamaiWalkthrough({
  token,
  host, setHost,
  clientToken, setClientToken,
  clientSecret, setClientSecret,
  accessToken, setAccessToken,
  accountSwitchKey, setAccountSwitchKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/akamai/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In Control Center open Identity & Access → API clients and click Create API client.",
    "Set the client to read-only and grant the four READ-ONLY scopes listed below (grant nothing broader).",
    "Create credentials and download the .edgerc block — it has host, client_token, client_secret and access_token.",
    "Paste those four values below. Add the account switch key only if this is a partner-managed account.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo?.scopes && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Grant these READ-ONLY scopes</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.scopes.map(s => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}
      {setupInfo?.controlCenterPath && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>{setupInfo.controlCenterPath}</div>
      )}

      <div className="form-group">
        <label htmlFor="conn-akamai-host">API host</label>
        <input id="conn-akamai-host" required value={host} onChange={e => setHost(e.target.value)} placeholder="akab-xxxx.luna.akamaiapis.net" />
        {setupInfo?.hostHint && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.hostHint}</div>}
      </div>
      <div className="form-group">
        <label htmlFor="conn-akamai-client-token">Client token</label>
        <input id="conn-akamai-client-token" required value={clientToken} onChange={e => setClientToken(e.target.value)} placeholder="akab-…" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-akamai-client-secret">Client secret</label>
        <input id="conn-akamai-client-secret" type="password" required value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="Paste the client_secret value" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-akamai-access-token">Access token</label>
        <input id="conn-akamai-access-token" type="password" required value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="akab-…" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-akamai-ask">Account switch key <span style={{ color: "var(--text3)" }}>(optional — partner-managed accounts only)</span></label>
        <input id="conn-akamai-ask" value={accountSwitchKey} onChange={e => setAccountSwitchKey(e.target.value)} placeholder="1-ABCDEF:1-ABCDE" />
      </div>
    </div>
  );
}

// OpenText Carbonite Core Endpoint Backup — connects with a dashboard-generated
// API key (used as the SOAP CallingContext token) + the account email + the
// dashboard host. Ships beta: the SOAP wire format is unverified.
function CarboniteWalkthrough({ token, dashboardHost, setDashboardHost, email, setEmail, apiKey, setApiKey }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/carbonite/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const steps = setupInfo?.steps || [
    "In the Core Endpoint Backup dashboard, open Key Management and generate an API key with read access to dashboard / device data.",
    "Copy the API key (shown only once) and note the account email it belongs to.",
    "Find your dashboard host from the browser address bar while signed in (e.g. https://dashboard.carbonite.com).",
    "Paste the dashboard host, account email, and API key below.",
  ];

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {setupInfo?.betaNote && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10, fontStyle: "italic" }}>{setupInfo.betaNote}</div>
      )}

      {setupInfo?.operations && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Dashboard Service operations Prism reads</div>
          <ul style={{ fontSize: 11, color: "var(--text2)", margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {setupInfo.operations.map(o => (
              <li key={o.operation}><strong>{o.operation}</strong> — {o.note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="conn-carbonite-host">Dashboard host</label>
        <input
          id="conn-carbonite-host"
          required
          value={dashboardHost}
          onChange={e => setDashboardHost(e.target.value)}
          placeholder="https://dashboard.carbonite.com"
        />
        {setupInfo?.dashboardHostHint && (
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{setupInfo.dashboardHostHint}</div>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="conn-carbonite-email">Account email</label>
        <input
          id="conn-carbonite-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="admin@yourcompany.com"
        />
      </div>

      <div className="form-group">
        <label htmlFor="conn-carbonite-key">API key</label>
        <input
          id="conn-carbonite-key"
          type="password"
          required
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Paste the generated API key"
        />
      </div>
    </div>
  );
}

function PurviewWalkthrough({ token, tenantId, setTenantId, purviewAccountName, setPurviewAccountName }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/purview/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const permissions = setupInfo?.permissions;

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In Microsoft Entra ID → App registrations → New registration. Name it (e.g. <code>prism-readonly</code>), then under Certificates &amp; secrets → New client secret — copy the value immediately, it's shown only once.</li>
        <li>
          <strong>In the Purview governance portal</strong> (not Azure IAM — this is a separate, commonly-confused system) → Data Map → Collections → your root collection → Role assignments, grant the app registration both:
          {permissions?.purviewRbacRoles && (
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {permissions.purviewRbacRoles.map(r => (
                <li key={r.roleName}><strong>{r.roleName}</strong> ({r.scope}) — {r.note}</li>
              ))}
            </ul>
          )}
        </li>
        <li>
          Under the app registration's API permissions → Add a permission → Office 365 Management APIs → Application permissions, add:
          {permissions?.office365ManagementApiPermissions && (
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {permissions.office365ManagementApiPermissions.permissions.map(p => <li key={p}><code>{p}</code></li>)}
            </ul>
          )}
          then click <strong>Grant admin consent</strong> — {permissions?.office365ManagementApiPermissions?.note}
        </li>
        {permissions?.prerequisites?.map(p => <li key={p}>{p}</li>)}
        <li>Copy the Tenant ID (Overview page) and your Purview account name, plus the Client ID and Client Secret, into the fields below, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-purview-account-name">Purview account name</label>
        <input id="conn-purview-account-name" required value={purviewAccountName} onChange={e => setPurviewAccountName(e.target.value)} placeholder="my-purview-account" />
      </div>
    </div>
  );
}

// Shared walkthrough for all four Microsoft connectors that share the same
// tenantId + clientId + clientSecret credential shape (Entra ID, M365, Teams, Defender).

const MS_CONNECTOR_NAME = {
  entra_id: "Microsoft Entra ID",
  microsoft_365: "Microsoft 365",
  microsoft_teams: "Microsoft Teams",
  microsoft_defender: "Microsoft Defender for Endpoint",
};

function MicrosoftWalkthrough({ providerKey, tenantId, setTenantId, token }) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch(`/api/integrations/${providerKey}/setup-info`, { token })
      .then(info => setSetupInfo(info))
      .catch(e => setSetupError(e.message));
  }, [token, providerKey]);

  const p = setupInfo?.permissions;
  const name = MS_CONNECTOR_NAME[providerKey] || providerKey;
  const isDefender = providerKey === "microsoft_defender";

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect — {name}</div>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>
          In <strong>Microsoft Entra ID → App registrations → New registration</strong>, name it (e.g. <code>prism-compliance</code>).{" "}
          {p?.sharedAppNote && <span style={{ color: "var(--text3)" }}>{p.sharedAppNote}</span>}
        </li>
        <li>
          Under <strong>Certificates &amp; secrets → New client secret</strong> — copy the value immediately (shown only once).
          Note the <strong>Application (client) ID</strong> and <strong>Directory (tenant) ID</strong> from the app's Overview page.
        </li>

        {/* Graph permissions (all connectors except Defender show this block) */}
        {p?.graphPermissions && (
          <li>
            <strong>API permissions → Add a permission → Microsoft Graph → Application permissions</strong>, add:
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {p.graphPermissions.map(({ permission, note }) => (
                <li key={permission}><code>{permission}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
              ))}
            </ul>
          </li>
        )}

        {/* Exchange permission (M365 only) */}
        {p?.exchangePermission && (
          <li>
            <strong>API permissions → Add a permission → APIs my organization uses → {p.exchangePermission.resource} → Application permissions</strong>, add <code>{p.exchangePermission.permission}</code>.
            {" "}<span style={{ color: "var(--text3)" }}>{p.exchangePermission.note}</span>
          </li>
        )}

        {/* WindowsDefenderATP permissions (Defender only) */}
        {p?.windowsDefenderATPPermissions && (
          <li>
            <strong>API permissions → Add a permission → APIs my organization uses → WindowsDefenderATP → Application permissions</strong>, add:
            {p.resourceNote && <span style={{ color: "var(--text3)" }}> ({p.resourceNote})</span>}
            <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
              {p.windowsDefenderATPPermissions.map(({ permission, note }) => (
                <li key={permission}><code>{permission}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
              ))}
            </ul>
          </li>
        )}

        {/* Admin consent */}
        <li>
          Click <strong>Grant admin consent for &lt;tenant&gt;</strong>.
          {p?.consentNote && <span style={{ color: "var(--text3)" }}> {p.consentNote}</span>}
        </li>

        {/* Entra role assignment (M365 only) */}
        {p?.entraRoleAssignment && (
          <li>
            <strong>Assign the <code>{p.entraRoleAssignment.role}</code> Entra ID role</strong> to the app's service principal.
            {" "}<span style={{ color: "var(--text3)" }}>{p.entraRoleAssignment.note}</span>
          </li>
        )}

        {/* TCM enrollment (Teams only) */}
        {p?.tcmNote && (
          <li>
            <strong>Enroll the TCM service principal</strong> (one-time tenant setup).{" "}
            <span style={{ color: "var(--text3)" }}>{p.tcmNote}</span>
          </li>
        )}

        {/* Defender token-audience note */}
        {p?.tokenAudienceNote && (
          <li style={{ color: "var(--text3)" }}><em>Note: {p.tokenAudienceNote}</em></li>
        )}

        <li>Paste the Tenant ID, Client ID, and Client Secret into the fields below and click Connect.</li>
      </ol>

      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-tenant-id">Tenant ID</label>
        <input id="conn-tenant-id" required value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000 or contoso.onmicrosoft.com" />
      </div>
    </div>
  );
}

function GoogleWorkspaceWalkthrough({
  token,
  adminEmail, setAdminEmail,
  customerId, setCustomerId,
  clientEmail, setClientEmail,
  privateKey, setPrivateKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/google_workspace/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  const scopeString = setupInfo?.scopes ? setupInfo.scopes.join(",") : "";

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, create or choose a project, then enable the <strong>Admin SDK API</strong>, <strong>Chrome Policy API</strong>, and <strong>Cloud Identity API</strong> under APIs &amp; Services → Library.</li>
        <li>Under <strong>IAM &amp; Admin → Service Accounts → Create Service Account</strong>, no project IAM roles are needed. Note its email and, on its Details tab, its numeric <strong>Client ID</strong>.</li>
        <li>On that service account, enable <strong>Domain-wide Delegation</strong> (Advanced settings).</li>
        <li>Under <strong>Keys → Add Key → Create new key → JSON</strong>, download the key — you'll paste its <code>client_email</code> and <code>private_key</code> fields below.</li>
        <li>As a Workspace <strong>super admin</strong>, go to <strong>Admin Console → Security → API Controls → Domain-wide Delegation → Manage Domain Wide Delegation</strong>, and add the service account's numeric Client ID with the scope list below.</li>
        <li>Enter the admin's email (the account the service account impersonates), the service account's email and private key, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      {scopeString && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>OAuth scope list (paste into Domain-wide Delegation):</div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <textarea
              readOnly
              value={scopeString}
              rows={3}
              style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text1)", resize: "vertical" }}
            />
            <CopyButton text={scopeString} />
          </div>
        </div>
      )}

      <div className="form-group">
        <label htmlFor="conn-admin-email">Admin email <span style={{ color: "var(--text3)", fontWeight: 400 }}>(impersonation target)</span></label>
        <input id="conn-admin-email" required type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@customer-domain.com" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-customer-id">Workspace customer ID <span style={{ color: "var(--text3)", fontWeight: 400 }}>(optional — defaults to the admin's own domain)</span></label>
        <input id="conn-customer-id" value={customerId} onChange={e => setCustomerId(e.target.value)} placeholder="C0xxxxxxx" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-client-email">Service account email</label>
        <input id="conn-client-email" required value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="prism-connector@my-project.iam.gserviceaccount.com" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-private-key">Private key <span style={{ color: "var(--text3)", fontWeight: 400 }}>(the JSON key's "private_key" field, including BEGIN/END lines)</span></label>
        <textarea
          id="conn-private-key" required value={privateKey} onChange={e => setPrivateKey(e.target.value)}
          rows={4} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
          style={{ width: "100%", fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function GcpWalkthrough({
  token,
  projectId, setProjectId,
  clientEmail, setClientEmail,
  privateKey, setPrivateKey,
}) {
  const [setupInfo, setSetupInfo] = useState(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    apiFetch("/api/integrations/gcp/setup-info", { token })
      .then(setSetupInfo)
      .catch(e => setSetupError(e.message));
  }, [token]);

  return (
    <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 8 }}>How to connect</div>
      <ol style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a>, select the project to audit and enable the Compute Engine, Cloud SQL Admin, Cloud KMS, IAM, and Cloud Resource Manager APIs under APIs &amp; Services → Library.</li>
        <li>Under <strong>IAM &amp; Admin → Service Accounts → Create Service Account</strong>, create a service account (no domain-wide delegation needed for this connector).</li>
        <li>Under <strong>IAM &amp; Admin → IAM → Grant Access</strong>, grant the service account these roles:
          <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
            {(setupInfo?.roles || []).map(({ role, note }) => (
              <li key={role}><code>{role}</code>{note && <span style={{ color: "var(--text3)" }}> — {note}</span>}</li>
            ))}
          </ul>
        </li>
        <li>Under <strong>Keys → Add Key → Create new key → JSON</strong>, download the key — paste its <code>client_email</code> and <code>private_key</code> fields below.</li>
        <li>Enter the project ID, then click Connect.</li>
      </ol>

      {setupError && <p className="error-text" style={{ fontSize: 12 }}>Couldn't load setup info: {setupError}</p>}

      <div className="form-group">
        <label htmlFor="conn-project-id">Project ID</label>
        <input id="conn-project-id" required value={projectId} onChange={e => setProjectId(e.target.value)} placeholder="my-gcp-project" />
      </div>
      <div className="form-group">
        <label htmlFor="conn-gcp-client-email">Service account email</label>
        <input id="conn-gcp-client-email" required value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="prism-connector@my-gcp-project.iam.gserviceaccount.com" />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="conn-gcp-private-key">Private key <span style={{ color: "var(--text3)", fontWeight: 400 }}>(the JSON key's "private_key" field, including BEGIN/END lines)</span></label>
        <textarea
          id="conn-gcp-private-key" required value={privateKey} onChange={e => setPrivateKey(e.target.value)}
          rows={4} placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
          style={{ width: "100%", fontSize: 11, fontFamily: "monospace", padding: 6, borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg1)", color: "var(--text1)", resize: "vertical" }}
        />
      </div>
    </div>
  );
}

function AddIntegrationWizard({ provider, token, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [roleArn, setRoleArn] = useState("");
  const [externalId] = useState(randomExternalId);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [purviewAccountName, setPurviewAccountName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  // Zoho-specific state
  const [dataCenter, setDataCenter] = useState("com");
  const [orgId, setOrgId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  // OneTrust-specific state (tenant hostname; client id/secret reuse the generic fields)
  const [hostname, setHostname] = useState("");
  // ServiceNow-specific state (instance base URL; client id/secret reuse the generic fields)
  const [instanceUrl, setInstanceUrl] = useState("");
  // CrowdStrike-specific state (Falcon cloud region; client id/secret reuse the generic fields)
  const [cloudRegion, setCloudRegion] = useState("us-1");
  // Acronis-specific state (Cyber Protect Cloud data-center URL; client id/secret reuse the generic fields)
  const [datacenterUrl, setDatacenterUrl] = useState("");
  // Salesforce-specific state (JWT Bearer flow — consumer key + integration
  // username live in config; the private key is the only secret)
  const [sfLoginUrl, setSfLoginUrl] = useState("");
  const [sfClientId, setSfClientId] = useState("");
  const [sfUsername, setSfUsername] = useState("");
  const [sfApiVersion, setSfApiVersion] = useState("v61.0");
  // Privy-specific state (tenant domain + bearer API key)
  const [privyBaseUrl, setPrivyBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  // Commvault-specific state (CommCell WebConsole base URL + Custom-scope access token)
  const [cvWebconsoleUrl, setCvWebconsoleUrl] = useState("");
  const [cvAccessToken, setCvAccessToken] = useState("");
  // Carbonite Server Backup-specific state (API - Monitoring host + Keycloak realm;
  // Client ID / secret reuse the shared clientId/clientSecret state below)
  const [csApiDomain, setCsApiDomain] = useState("");
  const [csKeycloakRealm, setCsKeycloakRealm] = useState("");
  // Carbonite Core Endpoint Backup-specific state (SOAP Dashboard host + account
  // email; the API key reuses the shared apiKey state below)
  const [cbDashboardHost, setCbDashboardHost] = useState("");
  const [cbEmail, setCbEmail] = useState("");
  // Check Point Security Management-specific state (Management URL + deployment;
  // the administrator API key reuses the shared apiKey state below)
  const [cpmMgmtUrl, setCpmMgmtUrl] = useState("");
  const [cpmDeployment, setCpmDeployment] = useState("self_managed");
  // Check Point Infinity-specific state (region + one Infinity Portal key pair)
  const [cpRegion, setCpRegion] = useState("eu");
  const [cpClientId, setCpClientId] = useState("");
  const [cpAccessKey, setCpAccessKey] = useState("");
  // Check Point CloudGuard-specific state (data centre + Dome9 key id/secret)
  const [cgDataCenter, setCgDataCenter] = useState("us");
  const [cgKeyId, setCgKeyId] = useState("");
  const [cgKeySecret, setCgKeySecret] = useState("");
  // Akamai-specific state (.edgerc host + client_token/client_secret/access_token,
  // plus an optional account switch key for partner-managed accounts)
  const [akHost, setAkHost] = useState("");
  const [akClientToken, setAkClientToken] = useState("");
  const [akClientSecret, setAkClientSecret] = useState("");
  const [akAccessToken, setAkAccessToken] = useState("");
  const [akAccountSwitchKey, setAkAccountSwitchKey] = useState("");
  // Google Workspace-specific state (domain-wide delegation service account)
  const [adminEmail, setAdminEmail] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  // GCP-specific state (reuses clientEmail/privateKey above — same JSON-key
  // credential shape, just without domain-wide delegation)
  const [projectId, setProjectId] = useState("");
  const [authType, setAuthType] = useState(provider.authType);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tracks the connection created by a prior (possibly failed) submit attempt,
  // so a retry after a credentials-step failure reuses it instead of creating
  // a second, orphaned, credential-less connection.
  const [createdConnection, setCreatedConnection] = useState(null);
  const [githubSetupStarted, setGithubSetupStarted] = useState(false);

  const handleStartGithubSetup = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let connection = createdConnection;
      if (!connection) {
        connection = await apiFetch("/api/integrations", {
          token, method: "POST",
          body: JSON.stringify({ integrationKey: provider.key, name, config: {} })
        });
        setCreatedConnection(connection);
      }
      setGithubSetupStarted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const config = authType === "api_key"
        ? provider.key === "commvault"
          ? { webconsoleUrl: cvWebconsoleUrl }
          : provider.key === "carbonite"
          ? { dashboardHost: cbDashboardHost }
          : provider.key === "check_point_mgmt"
          ? { mgmtUrl: cpmMgmtUrl, deployment: cpmDeployment }
          : provider.key === "check_point"
          ? { region: cpRegion, gatewayUrl: CHECK_POINT_REGION_GATEWAYS[cpRegion] }
          : provider.key === "check_point_cloudguard"
          ? { dataCenter: cgDataCenter }
          : provider.key === "akamai"
          ? { host: akHost, accountSwitchKey: akAccountSwitchKey || undefined }
          : { baseUrl: privyBaseUrl }
        : authType === "oauth2"
        ? provider.key === "zoho"
          ? { dataCenter, orgId }
          : provider.key === "onetrust"
          ? { hostname }
          : provider.key === "servicenow"
          ? { instanceUrl }
          : provider.key === "crowdstrike"
          ? { cloudRegion, baseUrl: CROWDSTRIKE_REGION_BASE_URLS[cloudRegion] }
          : provider.key === "sophos"
          ? {}
          : provider.key === "acronis"
          ? { datacenterUrl }
          : provider.key === "carbonite-server"
          ? { apiDomain: csApiDomain, keycloakRealm: csKeycloakRealm }
          : provider.key === "salesforce"
          ? { loginUrl: sfLoginUrl, clientId: sfClientId, username: sfUsername, apiVersion: sfApiVersion || undefined }
          : provider.key === "purview"
            ? { tenantId, purviewAccountName }
            : provider.key === "azure"
              ? { tenantId, subscriptionId }
              : provider.key === "google_workspace"
                ? { adminEmail, customerId: customerId || undefined }
                : provider.key === "gcp"
                  ? { projectId }
                  : { tenantId }
        : authType === "iam_role" ? { region, roleArn } : { region };
      const secret = authType === "api_key"
        ? provider.key === "commvault"
          ? { accessToken: cvAccessToken }
          : provider.key === "carbonite"
          ? { email: cbEmail, apiKey }
          : provider.key === "check_point_mgmt"
          ? { apiKey }
          : provider.key === "check_point"
          ? { clientId: cpClientId, accessKey: cpAccessKey }
          : provider.key === "check_point_cloudguard"
          ? { keyId: cgKeyId, keySecret: cgKeySecret }
          : provider.key === "akamai"
          ? { clientToken: akClientToken, clientSecret: akClientSecret, accessToken: akAccessToken }
          : { apiKey }
        : authType === "oauth2"
        ? provider.key === "zoho"
          ? { clientId, clientSecret, refreshToken }
          : provider.key === "google_workspace" || provider.key === "gcp"
            ? { clientEmail, privateKey }
            : provider.key === "salesforce"
              ? { privateKey }
              : { clientId, clientSecret }
        : authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };

      let connection = createdConnection;
      if (!connection) {
        connection = await apiFetch("/api/integrations", {
          token, method: "POST",
          body: JSON.stringify({ integrationKey: provider.key, name, config })
        });
        setCreatedConnection(connection);
      }

      const updated = await apiFetch(`/api/integrations/${connection.id}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });

      setCreatedConnection(null);
      onCreated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Once the GitHub connection exists, GithubAppWalkthrough renders its own
  // <form> that posts to github.com. Nesting that inside this wizard's form
  // would produce invalid (and Playwright-ambiguous) nested <form> elements,
  // so this outer wrapper degrades to a plain <div> at that point — by then
  // it has no submit button of its own anyway.
  const WizardFormTag = provider.key === "github" && githubSetupStarted ? "div" : "form";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-title">Connect {provider.name}</div>

        <WizardFormTag onSubmit={WizardFormTag === "form" ? (provider.key === "github" ? handleStartGithubSetup : handleSubmit) : undefined}>
          {error && <p className="error-text">{error}</p>}
          <div className="form-group">
            <label htmlFor="conn-name">Connection name</label>
            <input id="conn-name" required value={name} onChange={e => setName(e.target.value)} placeholder={`My ${provider.name}`} />
          </div>

          {provider.key === "github" ? (
            githubSetupStarted && createdConnection ? (
              <GithubAppWalkthrough connectionId={createdConnection.id} token={token} />
            ) : null
          ) : (
            <>
              {provider.key === "aws" ? (
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {["iam_role", "access_key"].map(t => (
                    <button type="button" key={t}
                      className="btn btn-ghost"
                      style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                      onClick={() => setAuthType(t)}
                    >
                      {t === "iam_role" ? "IAM Role" : "Access Keys"}
                    </button>
                  ))}
                </div>
              ) : null}

              {provider.key !== "azure" && provider.key !== "github" && provider.key !== "purview" && provider.key !== "zoho" && provider.key !== "onetrust" && provider.key !== "servicenow" && provider.key !== "privy" && provider.key !== "crowdstrike" && provider.key !== "sophos" && provider.key !== "salesforce" && provider.key !== "acronis" && provider.key !== "commvault" && provider.key !== "carbonite" && provider.key !== "carbonite-server" && provider.key !== "google_workspace" && provider.key !== "gcp" &&
               provider.key !== "check_point_mgmt" && provider.key !== "check_point" && provider.key !== "check_point_cloudguard" && provider.key !== "akamai" &&
               !["entra_id", "microsoft_365", "microsoft_teams", "microsoft_defender"].includes(provider.key) && (
                <div className="form-group">
                  <label htmlFor="conn-region">Region</label>
                  <input id="conn-region" value={region} onChange={e => setRegion(e.target.value)} />
                </div>
              )}

              {authType === "iam_role" ? (
                provider.key === "aws" ? (
                  <AwsRoleWalkthrough token={token} roleArn={roleArn} setRoleArn={setRoleArn} externalId={externalId} />
                ) : (
                  <div className="form-group">
                    <label htmlFor="conn-role-arn">Role ARN</label>
                    <input id="conn-role-arn" required value={roleArn} onChange={e => setRoleArn(e.target.value)} />
                  </div>
                )
              ) : authType === "api_key" ? (
                provider.key === "commvault" ? (
                  <CommvaultWalkthrough
                    token={token}
                    webconsoleUrl={cvWebconsoleUrl} setWebconsoleUrl={setCvWebconsoleUrl}
                    accessToken={cvAccessToken} setAccessToken={setCvAccessToken}
                  />
                ) : provider.key === "carbonite" ? (
                  <CarboniteWalkthrough
                    token={token}
                    dashboardHost={cbDashboardHost} setDashboardHost={setCbDashboardHost}
                    email={cbEmail} setEmail={setCbEmail}
                    apiKey={apiKey} setApiKey={setApiKey}
                  />
                ) : provider.key === "check_point_mgmt" ? (
                  <CheckPointMgmtWalkthrough
                    token={token}
                    mgmtUrl={cpmMgmtUrl} setMgmtUrl={setCpmMgmtUrl}
                    deployment={cpmDeployment} setDeployment={setCpmDeployment}
                    apiKey={apiKey} setApiKey={setApiKey}
                  />
                ) : provider.key === "check_point" ? (
                  <CheckPointWalkthrough
                    token={token}
                    region={cpRegion} setRegion={setCpRegion}
                    clientId={cpClientId} setClientId={setCpClientId}
                    accessKey={cpAccessKey} setAccessKey={setCpAccessKey}
                  />
                ) : provider.key === "check_point_cloudguard" ? (
                  <CheckPointCloudguardWalkthrough
                    token={token}
                    dataCenter={cgDataCenter} setDataCenter={setCgDataCenter}
                    keyId={cgKeyId} setKeyId={setCgKeyId}
                    keySecret={cgKeySecret} setKeySecret={setCgKeySecret}
                  />
                ) : provider.key === "akamai" ? (
                  <AkamaiWalkthrough
                    token={token}
                    host={akHost} setHost={setAkHost}
                    clientToken={akClientToken} setClientToken={setAkClientToken}
                    clientSecret={akClientSecret} setClientSecret={setAkClientSecret}
                    accessToken={akAccessToken} setAccessToken={setAkAccessToken}
                    accountSwitchKey={akAccountSwitchKey} setAccountSwitchKey={setAkAccountSwitchKey}
                  />
                ) : (
                  <>
                    <PrivyWalkthrough token={token} baseUrl={privyBaseUrl} setBaseUrl={setPrivyBaseUrl} />
                    <div className="form-group">
                      <label htmlFor="conn-api-key">API key</label>
                      <input id="conn-api-key" type="password" required value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="pk_live_…" />
                    </div>
                  </>
                )
              ) : authType === "oauth2" ? (
                <>
                  {provider.key === "zoho" ? (
                    <ZohoWalkthrough
                      token={token}
                      dataCenter={dataCenter} setDataCenter={setDataCenter}
                      orgId={orgId} setOrgId={setOrgId}
                    />
                  ) : provider.key === "onetrust" ? (
                    <OneTrustWalkthrough
                      token={token}
                      hostname={hostname} setHostname={setHostname}
                    />
                  ) : provider.key === "servicenow" ? (
                    <ServiceNowWalkthrough
                      token={token}
                      instanceUrl={instanceUrl} setInstanceUrl={setInstanceUrl}
                    />
                  ) : provider.key === "crowdstrike" ? (
                    <CrowdStrikeWalkthrough
                      token={token}
                      cloudRegion={cloudRegion} setCloudRegion={setCloudRegion}
                    />
                  ) : provider.key === "sophos" ? (
                    <SophosWalkthrough token={token} />
                  ) : provider.key === "acronis" ? (
                    <AcronisWalkthrough
                      token={token}
                      datacenterUrl={datacenterUrl} setDatacenterUrl={setDatacenterUrl}
                    />
                  ) : provider.key === "carbonite-server" ? (
                    <CarboniteServerWalkthrough
                      token={token}
                      apiDomain={csApiDomain} setApiDomain={setCsApiDomain}
                      keycloakRealm={csKeycloakRealm} setKeycloakRealm={setCsKeycloakRealm}
                    />
                  ) : provider.key === "salesforce" ? (
                    <SalesforceWalkthrough
                      token={token}
                      loginUrl={sfLoginUrl} setLoginUrl={setSfLoginUrl}
                      sfClientId={sfClientId} setSfClientId={setSfClientId}
                      username={sfUsername} setUsername={setSfUsername}
                      apiVersion={sfApiVersion} setApiVersion={setSfApiVersion}
                      privateKey={privateKey} setPrivateKey={setPrivateKey}
                    />
                  ) : provider.key === "purview" ? (
                    <PurviewWalkthrough
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                      purviewAccountName={purviewAccountName} setPurviewAccountName={setPurviewAccountName}
                    />
                  ) : ["entra_id", "microsoft_365", "microsoft_teams", "microsoft_defender"].includes(provider.key) ? (
                    <MicrosoftWalkthrough
                      providerKey={provider.key}
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                    />
                  ) : provider.key === "google_workspace" ? (
                    <GoogleWorkspaceWalkthrough
                      token={token}
                      adminEmail={adminEmail} setAdminEmail={setAdminEmail}
                      customerId={customerId} setCustomerId={setCustomerId}
                      clientEmail={clientEmail} setClientEmail={setClientEmail}
                      privateKey={privateKey} setPrivateKey={setPrivateKey}
                    />
                  ) : provider.key === "gcp" ? (
                    <GcpWalkthrough
                      token={token}
                      projectId={projectId} setProjectId={setProjectId}
                      clientEmail={clientEmail} setClientEmail={setClientEmail}
                      privateKey={privateKey} setPrivateKey={setPrivateKey}
                    />
                  ) : (
                    <AzureServicePrincipalWalkthrough
                      token={token}
                      tenantId={tenantId} setTenantId={setTenantId}
                      subscriptionId={subscriptionId} setSubscriptionId={setSubscriptionId}
                    />
                  )}
                  {provider.key !== "google_workspace" && provider.key !== "gcp" && provider.key !== "salesforce" && (
                    <CredentialFields
                      authType="oauth2"
                      clientId={clientId} setClientId={setClientId}
                      clientSecret={clientSecret} setClientSecret={setClientSecret}
                    />
                  )}
                  {provider.key === "zoho" && (
                    <div className="form-group">
                      <label htmlFor="conn-refresh-token">Refresh Token <span style={{ color: "var(--text3)", fontWeight: 400 }}>(from step 4 above)</span></label>
                      <input id="conn-refresh-token" required type="password" value={refreshToken} onChange={e => setRefreshToken(e.target.value)} placeholder="1000.yyyy…zzzz…" />
                    </div>
                  )}
                </>
              ) : (
                <CredentialFields
                  authType={authType}
                  accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
                  secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
                  sessionToken={sessionToken} setSessionToken={setSessionToken}
                />
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {!(provider.key === "github" && githubSetupStarted) && (
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {provider.key === "github"
                  ? (submitting ? "Starting…" : "Start GitHub setup")
                  : (submitting ? "Connecting…" : "Connect")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={provider.key === "github" && githubSetupStarted ? () => onCreated(createdConnection) : onClose}
            >
              {provider.key === "github" && githubSetupStarted ? "Close" : "Cancel"}
            </button>
          </div>
        </WizardFormTag>
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [catalog, setCatalog] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizardProvider, setWizardProvider] = useState(null);
  // Keyed by connection id — a schedule change on one row must not disable
  // or otherwise affect the controls on any other row.
  const [savingSchedule, setSavingSchedule] = useState({});

  const load = useCallback(async () => {
    const [catalogData, connData] = await Promise.all([
      apiFetch("/api/integrations/catalog", { token }),
      apiFetch("/api/integrations", { token }),
    ]);
    setCatalog(catalogData || []);
    setConnections(connData || []);
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const githubError = searchParams.get("githubError");
    if (githubError) {
      setError(githubError);
      navigate("/settings/integrations", { replace: true });
    }
    // Only ever meant to run once, reading whatever GitHub's redirect put on
    // the URL at load time — not on every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreated = async () => {
    // The create+credentials steps already succeeded by the time this fires,
    // so close the wizard regardless of whether the post-create reload
    // succeeds — but surface a reload failure via the page's error banner
    // instead of letting it become an unhandled promise rejection.
    setWizardProvider(null);
    try {
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (e, connectionId, name) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${name}"? This failed connection attempt will be permanently removed.`)) return;
    try {
      await apiFetch(`/api/integrations/${connectionId}`, { token, method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // The PATCH route requires both fields together, so every call sends the
  // connection's current value for whichever field didn't change alongside
  // the one that did.
  const handleScheduleChange = async (e, connectionId, patch) => {
    e.stopPropagation();
    setError("");
    setSavingSchedule(s => ({ ...s, [connectionId]: true }));
    try {
      const updated = await apiFetch(`/api/integrations/${connectionId}/schedule`, {
        token, method: "PATCH",
        body: JSON.stringify(patch)
      });
      setConnections(cs => cs.map(c => c.id === connectionId ? updated : c));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSchedule(s => ({ ...s, [connectionId]: false }));
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      {wizardProvider && (
        <AddIntegrationWizard
          provider={wizardProvider}
          token={token}
          onClose={() => setWizardProvider(null)}
          onCreated={handleCreated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Settings — Integrations</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/findings")}>Findings</button>
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          <h2>Connections</h2>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr" }}>
              <span>Name</span>
              <span>Provider</span>
              <span>Status</span>
              <span>Last run</span>
              <span>Cadence</span>
              <span>Auto-collect</span>
              <span></span>
            </div>
            {connections.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No connections yet — pick a connector below to get started.</span></div>
            )}
            {connections.map(c => {
              const cadence = c.collectionFrequencyHours ?? 24;
              const autoCollect = c.autoCollectEnabled ?? true;
              const savingThis = !!savingSchedule[c.id];
              return (
                <div
                  key={c.id}
                  className="admin-row"
                  style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr", cursor: "pointer" }}
                  onClick={() => navigate(`/settings/integrations/${c.id}`)}
                >
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{c.integrationKey}</span>
                  <span><StatusPill status={c.status} /></span>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>
                    {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "Never"}
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    <select
                      aria-label="Collection cadence"
                      value={cadence}
                      disabled={!isLeadOrAdmin || savingThis}
                      style={{ fontSize: 12 }}
                      onChange={(e) => handleScheduleChange(e, c.id, {
                        collectionFrequencyHours: Number(e.target.value),
                        autoCollectEnabled: autoCollect,
                      })}
                    >
                      {CADENCE_OPTIONS.map(h => <option key={h} value={h}>Every {h}h</option>)}
                    </select>
                  </span>
                  <span onClick={e => e.stopPropagation()}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: isLeadOrAdmin ? "pointer" : "default" }}>
                      <input
                        type="checkbox"
                        aria-label="Auto-collect enabled"
                        checked={autoCollect}
                        disabled={!isLeadOrAdmin || savingThis}
                        onChange={(e) => handleScheduleChange(e, c.id, {
                          collectionFrequencyHours: cadence,
                          autoCollectEnabled: e.target.checked,
                        })}
                      />
                      Auto
                    </label>
                  </span>
                  <span>
                    {isLeadOrAdmin && c.status === "error" && (
                      <button className="btn btn-ghost" style={{ color: "var(--red)", fontSize: 12, padding: "4px 8px" }} onClick={(e) => handleDelete(e, c.id, c.name)}>Delete</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-section">
          <h2>Available connectors</h2>
          {groupCatalogByCategory(catalog).map(([category, providers]) => (
            <div key={category} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
                {CATEGORY_LABEL[category] || titleCase(category)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {providers.map(c => {
                  const iconEntry = PROVIDER_ICON[c.key];
                  // `beta` connectors are fully functional — they carry the badge
                  // but are still connectable; only `coming_soon` (filtered out
                  // server-side anyway) and non-admins are non-interactive.
                  const usable = c.status === "active" || c.status === "beta";
                  const clickable = isLeadOrAdmin && usable;
                  return (
                    <div
                      key={c.key}
                      className="card"
                      title={c.name}
                      style={{
                        padding: 20, minWidth: 160, display: "flex", flexDirection: "column",
                        alignItems: "center", gap: 8, cursor: clickable ? "pointer" : "default",
                        opacity: usable ? 1 : 0.5,
                      }}
                      onClick={() => clickable && setWizardProvider(c)}
                    >
                      {iconEntry
                        ? <iconEntry.Icon size={36} color={iconEntry.color} aria-label={c.name} />
                        : <div style={{ fontWeight: 600 }}>{c.name}</div>}
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        {c.status === "active" ? c.name : `${c.name} · ${c.status.replace("_", " ")}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
