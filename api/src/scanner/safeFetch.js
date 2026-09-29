// safeFetch.js — the ONE authoritative SSRF-safe outbound HTTP boundary for the
// DPDPA scanner (F-05). Every scanner-originated request (homepage, HTTP→HTTPS
// redirect probe, privacy/cookie/terms link probing, policy-body fetch) must
// go through this module, via scanner.js's fetchWithTimeout().
//
// Two validation layers, because a literal IP in a URL never triggers a DNS
// lookup at connect time (verified empirically — Node's net/tls `lookup`
// option is only invoked for hostnames, not IP literals):
//
//   1. Synchronous pre-flight (assertUrlPolicy): protocol allowlist, no
//      userinfo, public-web port policy, and — for a literal IP host —
//      direct address classification before any network I/O happens at all.
//
//   2. Connect-time pinning (createPinnedLookup, wired into an undici Agent's
//      `connect.lookup`): for a real hostname, resolves via dns.lookup(),
//      rejects the destination if ANY returned address is non-public, and
//      hands the *exact same validated address(es)* back to the socket layer
//      for the real connection. There is no second, independent resolution —
//      this is what defeats DNS-rebinding/TOCTOU. TLS SNI/Host/certificate
//      verification still use the real hostname (untouched by pinning), so
//      no unsafe TLS workaround is needed.
//
// Redirects are followed manually (redirect: "manual" on every request) so
// every hop — including ones introduced by a scanner-discovered absolute
// link — is re-validated from scratch through the same two layers.

import dns from "node:dns";
import net from "node:net";
import { Agent } from "undici";

export class SsrfBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// IPv4 / IPv6 public-address classification — explicit CIDR arithmetic, no
// string-prefix blacklist and no third-party IP-range dependency.
// ---------------------------------------------------------------------------

function ipv4ToLong(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let long = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    long = (long << 8) | n;
  }
  return long >>> 0;
}

function ipv4InCidr(ipLong, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const rangeLong = ipv4ToLong(range);
  return (ipLong & mask) === (rangeLong & mask);
}

// Every non-globally-routable IPv4 range: "this" network, RFC1918 private
// space, CGNAT, loopback, link-local (incl. the cloud metadata address),
// IETF protocol assignments, documentation ranges, benchmarking, multicast,
// and reserved/broadcast.
const IPV4_NON_PUBLIC_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isPublicIPv4(ip) {
  const long = ipv4ToLong(ip);
  if (long === null) return false;
  return !IPV4_NON_PUBLIC_CIDRS.some((cidr) => ipv4InCidr(long, cidr));
}

// Expands a (possibly "::"-compressed, possibly embedded-IPv4) IPv6 literal
// into 8 16-bit groups, or returns null if it isn't a valid address.
function parseIPv6Groups(rawIp) {
  let ip = rawIp;
  const zoneIdx = ip.indexOf("%");
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  const parsePart = (part) => {
    if (part.includes(".")) {
      const long = ipv4ToLong(part);
      if (long === null) return null;
      return [(long >>> 16) & 0xffff, long & 0xffff];
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    return [parseInt(part, 16)];
  };

  const parseGroups = (s) => {
    if (s === "") return [];
    const groups = [];
    for (const part of s.split(":")) {
      const parsed = parsePart(part);
      if (parsed === null) return null;
      groups.push(...parsed);
    }
    return groups;
  };

  const doubleColonIdx = ip.indexOf("::");
  let groups;
  if (doubleColonIdx !== -1) {
    if (ip.indexOf("::", doubleColonIdx + 1) !== -1) return null; // more than one "::"
    const head = parseGroups(ip.slice(0, doubleColonIdx));
    const tail = parseGroups(ip.slice(doubleColonIdx + 2));
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill(0), ...tail];
  } else {
    groups = parseGroups(ip);
  }
  return groups && groups.length === 8 ? groups : null;
}

function groupsToIPv4(g) {
  return `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
}

export function isPublicIPv6(rawIp) {
  const g = parseIPv6Groups(rawIp.replace(/^\[|\]$/g, ""));
  if (!g) return false;

  if (g.every((x) => x === 0)) return false; // :: (unspecified)
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1 (loopback)

  // IPv4-mapped ::ffff:0:0/96 — validate the embedded IPv4 address.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isPublicIPv4(groupsToIPv4(g));
  }
  // Deprecated IPv4-compatible ::a.b.c.d (top 96 bits zero, not already handled above).
  if (g.slice(0, 6).every((x) => x === 0)) {
    return isPublicIPv4(groupsToIPv4(g));
  }
  // NAT64 well-known prefix 64:ff9b::/96 — also embeds an IPv4 address.
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4(groupsToIPv4(g));
  }

  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation

  return true;
}

export function isPublicAddress(address, family) {
  const fam = family || net.isIP(address);
  if (fam === 4) return isPublicIPv4(address);
  if (fam === 6) return isPublicIPv6(address);
  return false;
}

// ---------------------------------------------------------------------------
// URL-level policy — protocol, credentials, port, literal-IP destinations.
// ---------------------------------------------------------------------------

function stripBrackets(hostname) {
  return hostname.replace(/^\[|\]$/g, "");
}

function effectivePort(url) {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function assertUrlPolicy(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError("Credentials in the destination URL are not permitted");
  }
  const port = effectivePort(url);
  const allowed = url.protocol === "https:" ? port === 443 : port === 80;
  if (!allowed) {
    throw new SsrfBlockedError(`Port ${port} is not permitted for public web scanning`);
  }

  // Literal IP hosts never trigger a DNS lookup at connect time, so they must
  // be classified here, synchronously, before any fetch is attempted.
  const hostname = stripBrackets(url.hostname);
  const family = net.isIP(hostname);
  if (family && !isPublicAddress(hostname, family)) {
    throw new SsrfBlockedError(`Destination resolves to a non-public address (${hostname})`);
  }
}

// ---------------------------------------------------------------------------
// Connect-time DNS pinning for hostname destinations.
// ---------------------------------------------------------------------------

export function createPinnedLookup() {
  return function pinnedLookup(hostname, options, callback) {
    const family = net.isIP(hostname);
    if (family) {
      // Defense in depth — assertUrlPolicy already rejects literal-IP
      // destinations, so this path is only reachable for a redirect/link
      // whose host somehow bypassed that check.
      if (!isPublicAddress(hostname, family)) {
        callback(new SsrfBlockedError(`Destination resolves to a non-public address (${hostname})`));
        return;
      }
      callback(null, options?.all ? [{ address: hostname, family }] : hostname, family);
      return;
    }

    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(new SsrfBlockedError(`DNS resolution failed for ${hostname}: ${err.message}`));
        return;
      }
      if (!addresses || addresses.length === 0) {
        callback(new SsrfBlockedError(`DNS resolution returned no addresses for ${hostname}`));
        return;
      }
      // If ANY resolved address is non-public, reject the whole destination —
      // this also blocks the mixed public/private DNS-answer attack variant.
      for (const { address, family: fam } of addresses) {
        if (!isPublicAddress(address, fam)) {
          callback(new SsrfBlockedError(`${hostname} resolves to a non-public address (${address})`));
          return;
        }
      }
      // Pin to exactly the address(es) we just validated — the real socket
      // connection uses this, not a second independent resolution.
      if (options?.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

// ---------------------------------------------------------------------------
// The hardened fetch.
// ---------------------------------------------------------------------------

export async function safeFetch(input, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const wantsManualRedirect = opts.redirect === "manual";
  const { redirect: _ignoredRedirect, ...restOpts } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup() } });

  try {
    let currentUrl = typeof input === "string" ? new URL(input) : input;
    let redirects = 0;

    while (true) {
      assertUrlPolicy(currentUrl);

      const res = await fetch(currentUrl.toString(), {
        ...restOpts,
        redirect: "manual", // always manual internally — we validate every hop ourselves
        signal: controller.signal,
        dispatcher,
      });

      const location = res.headers.get("location");
      const isRedirect = res.status >= 300 && res.status < 400 && !!location;
      if (!isRedirect || wantsManualRedirect) {
        return res;
      }

      redirects += 1;
      if (redirects > MAX_REDIRECTS) {
        throw new SsrfBlockedError(`Too many redirects (>${MAX_REDIRECTS})`);
      }
      currentUrl = new URL(location, currentUrl);
    }
  } finally {
    clearTimeout(timer);
    dispatcher.close().catch(() => {});
  }
}
