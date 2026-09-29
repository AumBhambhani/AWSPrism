import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveCarboniteServerCredentials, resolveApiDomain, keycloakTokenEndpoint } = await import(
  "../connectors/carbonite-server/credentials.js"
);

const VALID_CONFIG = { apiDomain: "backup.example.com", keycloakRealm: "carbonite" };
const VALID_SECRET = { clientId: "prism-reader", clientSecret: "s3cr3t" };

function tokenResponse(body = { access_token: "kc-token-1", expires_in: 300 }) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
}
function errorResponse(status, text = "") {
  return { ok: false, status, json: async () => ({}), text: async () => text, headers: { get: () => null } };
}
function odataResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
}

beforeEach(() => vi.unstubAllGlobals());

describe("resolveApiDomain", () => {
  test.each([
    ["https://backup.example.com", "backup.example.com"],
    ["backup.example.com", "backup.example.com"],
    ["https://backup.example.com/", "backup.example.com"],
    ["https://backup.example.com/monitoring/swaggerui/index", "backup.example.com"],
    ["  HTTPS://Backup.Example.COM  ", "backup.example.com"],
    ["backup.example.com:443", "backup.example.com"],
    ["10.20.30.40", "10.20.30.40"],
  ])("normalises %s -> %s", (input, expected) => {
    expect(resolveApiDomain({ apiDomain: input })).toBe(expected);
  });

  test("throws for an empty value", () => {
    expect(() => resolveApiDomain({})).toThrow(/missing config\.apiDomain/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => resolveApiDomain({ apiDomain: "not a host" })).toThrow(/invalid config\.apiDomain/);
  });
});

describe("keycloakTokenEndpoint", () => {
  test("builds a modern (no /auth prefix) realm token endpoint and encodes the realm", () => {
    expect(keycloakTokenEndpoint("backup.example.com", "carbonite realm")).toBe(
      "https://backup.example.com/realms/carbonite%20realm/protocol/openid-connect/token"
    );
  });
});

describe("resolveCarboniteServerCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveCarboniteServerCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Carbonite Server Backup auth type: api_key");
  });

  test("throws when config.apiDomain is missing", async () => {
    await expect(
      resolveCarboniteServerCredentials({ authType: "oauth2", config: { keycloakRealm: "carbonite" }, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.apiDomain/);
  });

  test("throws when config.keycloakRealm is missing or blank", async () => {
    await expect(
      resolveCarboniteServerCredentials({ authType: "oauth2", config: { apiDomain: "backup.example.com" }, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.keycloakRealm/);
    await expect(
      resolveCarboniteServerCredentials({ authType: "oauth2", config: { ...VALID_CONFIG, keycloakRealm: "   " }, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.keycloakRealm/);
  });

  test("throws when secret.clientId / secret.clientSecret are missing or blank", async () => {
    await expect(
      resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientSecret: "x" } })
    ).rejects.toThrow(/secret\.clientId/);
    await expect(
      resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientId: "x", clientSecret: "  " } })
    ).rejects.toThrow(/secret\.clientSecret/);
  });

  test("does not perform any network I/O during resolution (token is minted lazily)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const creds = await resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(creds.apiRoot).toBe("https://backup.example.com/monitoring");
    expect(creds.host).toBe("backup.example.com");
    expect(creds.realm).toBe("carbonite");
  });
});

describe("resolveCarboniteServerCredentials — token exchange + request()", () => {
  test("mints a client-credentials token once, then attaches it as a Bearer header on OData calls", async () => {
    const fetchMock = vi.fn(async (url, opts) => {
      if (String(url).endsWith("/protocol/openid-connect/token")) return tokenResponse();
      return odataResponse({ value: [{ Id: 1 }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const creds = await resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const a = await creds.request("/odata/Safesets");
    const b = await creds.request("/odata/Agents");
    expect(a).toEqual({ value: [{ Id: 1 }] });
    expect(b).toEqual({ value: [{ Id: 1 }] });

    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/protocol/openid-connect/token"));
    expect(tokenCalls).toHaveLength(1);
    const [tokenUrl, tokenOpts] = tokenCalls[0];
    expect(tokenUrl).toBe("https://backup.example.com/realms/carbonite/protocol/openid-connect/token");
    expect(tokenOpts.method).toBe("POST");
    expect(String(tokenOpts.body)).toContain("grant_type=client_credentials");
    expect(String(tokenOpts.body)).toContain("client_id=prism-reader");

    const odataCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/odata/Safesets"));
    expect(odataCall[0]).toBe("https://backup.example.com/monitoring/odata/Safesets");
    expect(odataCall[1].headers.Authorization).toBe("Bearer kc-token-1");
  });

  test("request() surfaces a non-2xx OData response as an error carrying the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).endsWith("/protocol/openid-connect/token")) return tokenResponse();
      return errorResponse(403, "forbidden");
    }));
    const creds = await resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.request("/odata/Vaults")).rejects.toThrow(/403/);
  });

  test("a failed token request throws with the Keycloak status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errorResponse(401, "invalid_client")));
    const creds = await resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.request("/odata/Companies")).rejects.toThrow(/Keycloak token request failed: 401/);
  });

  test("a token response with no access_token throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse({ token_type: "Bearer" })));
    const creds = await resolveCarboniteServerCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.request("/odata/Companies")).rejects.toThrow(/missing access_token/);
  });
});
