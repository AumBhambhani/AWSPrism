// F-05 SSRF regression suite — DPDPA public scanner (scanner.js / routes/dpdpa.js).
//
// PHASE 1 (reproduce-only): these tests encode the SECURE behavior the scanner
// should eventually have (reject non-public / redirect / discovered-link
// destinations before connecting). Against the CURRENT implementation, the
// tests below that assert "the internal server received zero requests" or
// "fetch was never called" are expected to FAIL, because no destination
// validation exists today. Two tests are deliberately confirmatory, not
// red/green (see comments), and one is a positive control that must keep
// passing after any future fix.
//
// Every test uses either a local http.createServer() bound to 127.0.0.1, or a
// mocked global.fetch — no real cloud metadata endpoint, production system, or
// third-party host is ever contacted.

import { describe, test, expect, vi, afterEach } from "vitest";
import http from "node:http";
import dns from "node:dns";
import express from "express";
import request from "supertest";
import { scanWebsite } from "../scanner/scanner.js";
import dpdpaRouter from "../routes/dpdpa.js";
import {
  safeFetch,
  SsrfBlockedError,
  isPublicIPv4,
  isPublicIPv6,
  isPublicAddress,
  createPinnedLookup,
} from "../scanner/safeFetch.js";

// A real fetch Response's `.url` is read-only and defaults to "" when the
// object isn't produced by an actual fetch() call, which would make
// scanWebsite's `new URL(res.url)` throw and mask what we're testing. Use a
// plain object shaped like the subset of Response that scanner.js reads.
function fakeResponse({ url, status = 200, body = "", headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(headers),
    text: async () => body,
  };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const openServers = [];
async function trackedServer(handler) {
  const s = await startServer(handler);
  openServers.push(s);
  return s;
}

afterEach(async () => {
  while (openServers.length) {
    const s = openServers.pop();
    await s.close();
  }
  vi.restoreAllMocks();
});

describe("F-05 SSRF — loopback destinations (scanWebsite)", () => {
  test("1a. a literal 127.0.0.1 target should not be reached", async () => {
    const hits = [];
    const { port } = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res
        .writeHead(200, { "content-type": "text/html", "x-internal-proof": "yes" })
        .end("<html><head><title>INTERNAL_SECRET_TITLE</title></head><body></body></html>");
    });

    await scanWebsite(`http://127.0.0.1:${port}/`).catch(() => {});

    // Secure expected behavior: zero requests should ever reach the loopback
    // service. Currently the homepage fetch plus policy-path probing all land
    // on it, so this assertion fails.
    expect(hits, JSON.stringify(hits)).toHaveLength(0);
  });

  test("1b. the 'localhost' hostname should not be reached", async () => {
    const hits = [];
    const { port } = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res.writeHead(200, { "x-internal-proof": "yes" }).end("<html></html>");
    });

    await scanWebsite(`http://localhost:${port}/`).catch(() => {});

    expect(hits, JSON.stringify(hits)).toHaveLength(0);
  });
});

describe("F-05 SSRF — arbitrary port", () => {
  test("2. a non-standard high port on a loopback host should not be reached", async () => {
    const hits = [];
    const { port } = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res.writeHead(200).end("<html></html>");
    });
    expect([80, 443]).not.toContain(port); // sanity: this is genuinely a non-standard port

    await scanWebsite(`http://127.0.0.1:${port}/`).catch(() => {});

    // Secure expected behavior: no application-level port allowlist exists
    // today, so the scanner connects to whatever port is given.
    expect(hits, JSON.stringify(hits)).toHaveLength(0);
  });
});

describe("F-05 SSRF — redirect to an internal destination", () => {
  test("3. a redirect from the scanned target to a loopback destination is followed without revalidation", async () => {
    const hitsInternal = [];
    const internal = await trackedServer((req, res) => {
      hitsInternal.push({ method: req.method, url: req.url });
      res
        .writeHead(200, { "x-internal-proof": "yes" })
        .end("<html><head><title>INTERNAL_SECRET_TITLE</title></head></html>");
    });
    const attacker = await trackedServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/` }).end();
    });

    await scanWebsite(`http://127.0.0.1:${attacker.port}/`).catch(() => {});

    // Secure expected behavior: the redirect target must be independently
    // validated. fetchWithTimeout uses `redirect: "follow"` with no
    // revalidation, so the internal server currently does receive the request.
    expect(hitsInternal, JSON.stringify(hitsInternal)).toHaveLength(0);
  });
});

describe("F-05 SSRF — discovered absolute link", () => {
  test("4. an absolute privacy-policy link pointing at a loopback destination is probed and fetched", async () => {
    const hitsInternal = [];
    const internal = await trackedServer((req, res) => {
      hitsInternal.push({ method: req.method, url: req.url });
      res
        .writeHead(200, { "x-internal-proof": "yes", "content-type": "text/html" })
        .end("<html><body>Contact: internal-secret@example.test</body></html>");
    });
    const attacker = await trackedServer((req, res) => {
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(
          `<html><body><footer><a href="http://127.0.0.1:${internal.port}/privacy">Privacy Policy</a></footer></body></html>`
        );
    });

    await scanWebsite(`http://127.0.0.1:${attacker.port}/`).catch(() => {});

    // Secure expected behavior: discovered absolute links must go through the
    // same destination policy as the initial target. Today probeUrls() and
    // analyzePolicy() fetch them unconditionally (HEAD probe + GET).
    expect(hitsInternal, JSON.stringify(hitsInternal)).toHaveLength(0);
  });
});

describe("F-05 SSRF — private / link-local / metadata-style destinations (mocked network)", () => {
  // These destinations are not under our control, so we never make a real
  // connection. Instead we mock global.fetch (the only network primitive
  // scanner.js uses to reach a target) and assert it is never invoked — i.e.
  // that a secure implementation would reject the destination before any
  // outbound call. Today no such check exists, so fetch IS called and the
  // assertion fails.
  test("5. representative RFC1918 private addresses are not rejected before a fetch is attempted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => fakeResponse({ url: String(url), body: "<html><head><title>x</title></head></html>" }));

    for (const host of ["10.1.2.3", "172.16.5.6", "192.168.1.10"]) {
      fetchSpy.mockClear();
      await scanWebsite(`http://${host}/`).catch(() => {});
      expect(fetchSpy, `expected no outbound fetch for private host ${host}`).not.toHaveBeenCalled();
    }
  });

  test("6. link-local / metadata-style destinations are not rejected before a fetch is attempted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => fakeResponse({ url: String(url), body: "<html></html>" }));

    // NOTE: 169.254.169.254 is never actually contacted — fetch is mocked, so
    // this only checks whether the current code path would have called it.
    for (const url of ["http://169.254.169.254/", "http://[fe80::1]/"]) {
      fetchSpy.mockClear();
      await scanWebsite(url).catch(() => {});
      expect(fetchSpy, `expected no outbound fetch for ${url}`).not.toHaveBeenCalled();
    }
  });
});

describe("F-05 SSRF — unauthenticated reachability", () => {
  // Phase 1 (pre-fix): this was confirmatory only — it documented that the
  // vulnerability requires no authentication, since routes/dpdpa.js never
  // chains `authenticate` for /public-scan. Phase 2 (post-fix): the route
  // still requires no auth (that's a deliberate product decision, not part
  // of F-05), but it must now demonstrate the SAME destination-validation
  // fix at the full HTTP-route level, not just inside scanWebsite().
  test("7. POST /dpdpa/public-scan does not reach an internal loopback target, even with no Authorization header", async () => {
    const hits = [];
    const { port } = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res
        .writeHead(200, { "content-type": "text/html", "x-internal-proof": "yes" })
        .end("<html><head><title>INTERNAL</title></head></html>");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/dpdpa", dpdpaRouter);

    const res = await request(app)
      .post("/api/dpdpa/public-scan")
      .send({ url: `http://127.0.0.1:${port}/` });
    // Deliberately no .set("Authorization", ...) — the route is public by
    // design; the security boundary must be the destination check, not auth.

    expect(hits, JSON.stringify(hits)).toHaveLength(0);
    expect(res.status).not.toBe(200);
  });
});

describe("F-05 SSRF — legitimate public scanning must keep working (positive control)", () => {
  // Any future SSRF fix must not break ordinary public scanning. This must
  // pass both now and after remediation.
  test("8. a normal public-looking HTTPS destination is still scanned successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      fakeResponse({
        url: String(url),
        body: "<html><head><title>Example Site</title></head><body><footer></footer></body></html>",
        headers: { "content-type": "text/html" },
      })
    );

    const signals = await scanWebsite("https://example.test/");

    expect(signals.reachable).toBe(true);
    expect(signals.statusCode).toBe(200);
    expect(signals.title).toBe("Example Site");
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — additional coverage of the fix's own security boundary
// (safeFetch.js). These test the hardened mechanism directly rather than
// through scanWebsite(), so IP-classification and DNS-pinning edge cases can
// be exercised precisely without depending on real external DNS/network.
// ---------------------------------------------------------------------------

describe("F-05 SSRF fix — IPv4/IPv6 address classification", () => {
  test("IPv4: public addresses are allowed, non-public ranges are not", () => {
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
    expect(isPublicIPv4("93.184.216.34")).toBe(true);
    expect(isPublicIPv4("127.0.0.1")).toBe(false);
    expect(isPublicIPv4("10.1.2.3")).toBe(false);
    expect(isPublicIPv4("172.20.0.5")).toBe(false);
    expect(isPublicIPv4("192.168.1.1")).toBe(false);
    expect(isPublicIPv4("169.254.169.254")).toBe(false);
    expect(isPublicIPv4("100.64.0.1")).toBe(false); // carrier-grade NAT
    expect(isPublicIPv4("198.51.100.5")).toBe(false); // TEST-NET-2 (documentation)
    expect(isPublicIPv4("224.0.0.1")).toBe(false); // multicast
    expect(isPublicIPv4("255.255.255.255")).toBe(false); // broadcast/reserved
  });

  test("IPv6: public addresses are allowed, loopback/link-local/ULA/multicast are not", () => {
    expect(isPublicIPv6("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIPv6("::1")).toBe(false);
    expect(isPublicIPv6("::")).toBe(false);
    expect(isPublicIPv6("fe80::1")).toBe(false);
    expect(isPublicIPv6("fc00::1")).toBe(false);
    expect(isPublicIPv6("fd12:3456:789a::1")).toBe(false);
    expect(isPublicIPv6("ff02::1")).toBe(false);
    expect(isPublicIPv6("2001:db8::1")).toBe(false); // documentation range
  });

  test("IPv4-mapped IPv6 addresses inherit the embedded IPv4 address's classification", () => {
    expect(isPublicIPv6("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIPv6("::ffff:10.0.0.5")).toBe(false);
    expect(isPublicIPv6("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicIPv6("::ffff:8.8.8.8")).toBe(true);
  });

  test("isPublicAddress dispatches to the correct family-specific check", () => {
    expect(isPublicAddress("127.0.0.1", 4)).toBe(false);
    expect(isPublicAddress("8.8.8.8", 4)).toBe(true);
    expect(isPublicAddress("::1", 6)).toBe(false);
    expect(isPublicAddress("2001:4860:4860::8888", 6)).toBe(true);
  });
});

describe("F-05 SSRF fix — connect-time DNS pinning (createPinnedLookup)", () => {
  test("a DNS resolution failure is rejected, not silently ignored", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_host, _opts, cb) => cb(new Error("ENOTFOUND")));
    const lookup = createPinnedLookup();
    const err = await new Promise((resolve) => lookup("does-not-exist.invalid", { all: true }, (e) => resolve(e)));
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });

  test("a hostname resolving only to a private address is rejected", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_host, _opts, cb) => cb(null, [{ address: "192.168.1.5", family: 4 }]));
    const lookup = createPinnedLookup();
    const err = await new Promise((resolve) => lookup("internal.example", { all: true }, (e) => resolve(e)));
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });

  test("a hostname resolving to a mix of public and private addresses is rejected entirely", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((_host, _opts, cb) =>
      cb(null, [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ])
    );
    const lookup = createPinnedLookup();
    const err = await new Promise((resolve) => lookup("mixed.example", { all: true }, (e) => resolve(e)));
    expect(err).toBeInstanceOf(SsrfBlockedError);
  });

  test("a hostname resolving only to public addresses is pinned to exactly those addresses", async () => {
    const publicAddrs = [{ address: "93.184.216.34", family: 4 }];
    const lookupSpy = vi.spyOn(dns, "lookup").mockImplementation((_host, _opts, cb) => cb(null, publicAddrs));
    const lookup = createPinnedLookup();
    const result = await new Promise((resolve) =>
      lookup("public.example", { all: true }, (err, addresses) => resolve({ err, addresses }))
    );
    expect(result.err).toBeNull();
    // Same reference: the connection uses exactly what was validated, not a
    // second independent resolution — this is what defeats DNS rebinding.
    expect(result.addresses).toBe(publicAddrs);
    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });
});

describe("F-05 SSRF fix — URL-level policy (protocol, credentials, port)", () => {
  test("rejects non-http(s) protocols", async () => {
    await expect(safeFetch("ftp://127.0.0.1/")).rejects.toThrow(SsrfBlockedError);
  });

  test("rejects credentials embedded in the URL", async () => {
    await expect(safeFetch("http://user:pass@93.184.216.34/")).rejects.toThrow(/credentials/i);
  });

  test("rejects a non-standard HTTPS port even for a public-looking literal IPv4 host", async () => {
    await expect(safeFetch("https://93.184.216.34:8443/")).rejects.toThrow(/port/i);
  });

  test("allows the default HTTPS port for a public destination", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => fakeResponse({ url: String(url), body: "<html></html>" }));
    const res = await safeFetch("https://93.184.216.34/");
    expect(res.status).toBe(200);
  });
});

describe("F-05 SSRF fix — redirect chains are re-validated hop by hop", () => {
  test("a chain of public redirects is followed through to the final response", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call < 3) {
        return fakeResponse({ status: 302, headers: { location: `http://93.184.216.${call + 1}/` } });
      }
      return fakeResponse({ status: 200, body: "<html><head><title>Final</title></head></html>" });
    });

    const res = await safeFetch("http://93.184.216.1/");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Final");
    expect(call).toBe(3);
  });

  test("a redirect chain longer than the cap is rejected rather than followed indefinitely", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      fakeResponse({ status: 302, headers: { location: "http://93.184.216.9/next" } })
    );

    await expect(safeFetch("http://93.184.216.9/")).rejects.toThrow(/redirects/i);
  });
});
