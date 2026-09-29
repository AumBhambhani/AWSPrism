import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import http from "http";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const K = Buffer.from("k").toString("base64");

// Reviewer 7B — 6B1 bypass. settings.js azureConnectionStringError parses keys
// case-insensitively, LAST duplicate wins, key = text before '='. @azure/storage-blob
// getValueInConnString is case-sensitive, FIRST element whose trimmed text startsWith
// the key wins, value = match(key + "=(.*)") anywhere in the element. It also never
// checks AccountName, which is interpolated straight into `${proto}://${AccountName}.blob.${suffix}`.
describe("review7B storage test-connection SSRF (6B1 parser differential)", () => {
  let server, port, hits;
  beforeAll(async () => {
    server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(404); res.end(); });
    server.on("connection", () => { hits.conns = (hits.conns || 0) + 1; });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  const cases = () => ({
    "prefixed key (BlobEndpointZ=..BlobEndpoint=)": `BlobEndpointZ=1BlobEndpoint=http://127.0.0.1:${port}/x;AccountName=a;SharedAccessSignature=sv=1`,
    "duplicate BlobEndpoint (SDK first, validator last)": `BlobEndpoint=http://127.0.0.1:${port}/x;BlobEndpoint=https://a.blob.core.windows.net;SharedAccessSignature=sv=1`,
    "AccountName host injection + duplicate protocol": `DefaultEndpointsProtocol=http;DefaultEndpointsProtocol=https;AccountName=127.0.0.1:${port}/x?;AccountKey=${K};EndpointSuffix=core.windows.net`,
  });


  test.each([0, 1, 2])("FAULT: connection string case %i does not make the API connect to 127.0.0.1", async (i) => {
    const [label, cs] = Object.entries(cases())[i];
    hits = [];
    const c = await createCompany({ domain: `r7b-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r7b.test` });
    const res = await request(app).put("/api/settings/evidence-storage").set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "azure_blob", config: { container: "c" }, secret: { connectionString: cs } });
    console.log(`[r7b] ${label}: status ${res.status} body ${JSON.stringify(res.body)} hits ${JSON.stringify(hits)} conns ${hits.conns || 0}`);
    expect(res.status).toBe(400);
    expect(hits).toEqual([]);
  }, 60000);
});

// Reviewer 7B — friendly() still forwards err.code, which for a RestError is taken from
// the remote reply (x-ms-error-code header / <Code> element): up to 41 remote-chosen chars.
describe("review7B storage error code reflection", () => {
  let server, port;
  beforeAll(async () => {
    server = http.createServer((req, res) => { res.writeHead(403, { "x-ms-error-code": "DbPrimary-internal-10_0_3_7" }); res.end(); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test("HELD: remote-chosen error code text is not reflected to the client", async () => {
    const c = await createCompany({ domain: `r7b-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r7b.test` });
    const cs = `BlobEndpointZ=1BlobEndpoint=http://127.0.0.1:${port}/x;AccountName=a;SharedAccessSignature=sv=1`;
    const res = await request(app).put("/api/settings/evidence-storage").set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "azure_blob", config: { container: "c" }, secret: { connectionString: cs } });
    console.log(`[r7b] code reflection: ${res.status} ${JSON.stringify(res.body)}`);
    expect(JSON.stringify(res.body)).not.toMatch(/DbPrimary/);
  }, 60000);
});
