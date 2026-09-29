// F-05 follow-up — SSRF regression suite for the mobile scanner
// (api/src/scanner/mobile.js), discovered during the independent security
// review of the F-05 fix: mobile.js's fetchText() calls the raw global
// fetch() directly and never goes through safeFetch(), so the destination
// validation added for scanWebsite() does not apply to scanMobileApp().
//
// PHASE 1 (reproduce-only): these tests encode the SECURE behavior
// scanMobileApp() should eventually have. Against the CURRENT
// implementation, tests 1 and 2 (the two confirmed bypass paths) are
// expected to FAIL. Test 3 (redirect) is expected to FAIL for the same
// reason. Test 4 is a positive control that must pass both before and after
// any fix.
//
// Every test uses a local http.createServer() bound to 127.0.0.1, or a
// mocked global.fetch — no real store front-end, metadata service, or
// third-party infrastructure is ever contacted.

import { describe, test, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { scanMobileApp } from "../scanner/mobile.js";

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

// A real fetch Response's `.url` is read-only and defaults to "" unless the
// object comes from an actual fetch() call. Use a plain object shaped like
// the subset of Response that mobile.js reads.
function fakeResponse({ url, status = 200, body = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    // safeFetch() reads res.headers.get("location") on every response (real
    // or mocked) to check for a redirect. A real Headers instance gives us
    // .get() returning null for an absent header, matching native fetch.
    headers: new Headers(),
    text: async () => body,
  };
}

describe("F-05 follow-up — mobile scanner SSRF via the `policy` parameter", () => {
  test("1. a loopback privacy-policy URL should not be reached", async () => {
    const hits = [];
    const internal = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res.writeHead(200, { "content-type": "text/html", "x-internal-proof": "yes" })
        .end("<html><body>internal-secret@example.test</body></html>");
    });

    // Mock only the "store" fetch (a real Play Store URL) so no real internet
    // call happens; the policy URL below is a real loopback server and must
    // go through the actual, unmocked network path.
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      if (String(url).includes("play.google.com")) {
        return fakeResponse({ url: String(url), body: "<html><head><title>App</title></head><body></body></html>" });
      }
      return originalFetch(url, opts);
    });

    await scanMobileApp("https://play.google.com/store/apps/details?id=com.example", {
      privacyPolicyUrl: `http://127.0.0.1:${internal.port}/policy`,
    }).catch(() => {});

    // Secure expected behavior: the `policy` field must go through the same
    // SSRF boundary as everything else, so the internal server should never
    // see a request.
    expect(hits, JSON.stringify(hits)).toHaveLength(0);
  });
});

describe("F-05 follow-up — mobile scanner SSRF via the main `url` parameter", () => {
  test("2. a loopback main URL disguised via detectStore()'s substring match should not be reached", async () => {
    const hits = [];
    const internal = await trackedServer((req, res) => {
      hits.push({ method: req.method, url: req.url });
      res.writeHead(200, { "content-type": "text/html", "x-internal-proof": "yes" })
        .end("<html><head><title>INTERNAL_SECRET_TITLE</title></head></html>");
    });

    // detectStore() does a bare substring test on the raw URL string, not on
    // its actual hostname — embedding "play.google.com" anywhere is enough.
    const decoyUrl = `http://127.0.0.1:${internal.port}/admin?x=play.google.com`;

    await scanMobileApp(decoyUrl, {}).catch(() => {});

    expect(hits, JSON.stringify(hits)).toHaveLength(0);
  });
});

describe("F-05 follow-up — mobile scanner SSRF via redirect", () => {
  test("3. a redirect from the policy URL to a loopback destination should not be followed unvalidated", async () => {
    const hitsInternal = [];
    const internal = await trackedServer((req, res) => {
      hitsInternal.push({ method: req.method, url: req.url });
      res.writeHead(200, { "x-internal-proof": "yes" }).end("<html><head><title>INTERNAL</title></head></html>");
    });
    // Stands in for an otherwise-reachable server whose response redirects
    // to an internal destination.
    const redirector = await trackedServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/` }).end();
    });

    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      if (String(url).includes("play.google.com")) {
        return fakeResponse({ url: String(url), body: "<html><head><title>App</title></head><body></body></html>" });
      }
      return originalFetch(url, opts);
    });

    await scanMobileApp("https://play.google.com/store/apps/details?id=com.example", {
      privacyPolicyUrl: `http://127.0.0.1:${redirector.port}/`,
    }).catch(() => {});

    // Secure expected behavior: the redirect target must be independently
    // validated. mobile.js's fetchText() uses fetch()'s default
    // redirect: "follow" with no revalidation at all.
    expect(hitsInternal, JSON.stringify(hitsInternal)).toHaveLength(0);
  });
});

describe("F-05 follow-up — legitimate mobile scanning must keep working (positive control)", () => {
  test("4. a normal public-looking store + policy destination is still scanned successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("play.google.com")) {
        return fakeResponse({
          url: String(url),
          body: "<html><head><title>Example App</title></head><body>Data safety: this app may collect these data types.</body></html>",
        });
      }
      return fakeResponse({
        url: String(url),
        body: "<html><body>We collect your personal data. Contact: privacy@example-app.test</body></html>",
      });
    });

    const signals = await scanMobileApp("https://play.google.com/store/apps/details?id=com.example.app", {
      privacyPolicyUrl: "https://example-app.test/privacy",
    });

    expect(signals.reachable).toBe(true);
    expect(signals.appTitle).toBe("Example App");
    expect(signals.privacyPolicy.reachable).toBe(true);
    expect(signals.privacyPolicy.contactEmail).toBe("privacy@example-app.test");
    expect(signals.privacyPolicy.topics.dataCollected).toBe(true);
  });
});
