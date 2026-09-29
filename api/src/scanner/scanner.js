// scanner.js — crawls a website and extracts privacy/compliance signals.
// Uses Node's built-in fetch (Node >=18) + cheerio for static analysis.
// If `playwright` is installed, an optional headless pass detects cookies/trackers
// that are only set by JavaScript at runtime (more accurate for consent checks).

import * as cheerio from 'cheerio';
import dns from 'node:dns';
import { promisify } from 'node:util';
import { safeFetch } from './safeFetch.js';

const resolve4 = promisify(dns.resolve4);

const UA =
  'Mozilla/5.0 (compatible; ComplianceScanner/1.0; +https://example.com/compliance-bot)';

// ---------------------------------------------------------------------------
// Signature libraries
// ---------------------------------------------------------------------------

// Known third-party trackers / data-collecting scripts.
const TRACKER_SIGNATURES = [
  { name: 'Google Analytics', category: 'analytics', patterns: ['google-analytics.com', 'googletagmanager.com', 'gtag(', "ga('create", 'analytics.js', '/gtag/js'] },
  { name: 'Google Ads / DoubleClick', category: 'advertising', patterns: ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'google_conversion'] },
  { name: 'Meta / Facebook Pixel', category: 'advertising', patterns: ['connect.facebook.net', 'fbq(', 'facebook-jssdk', 'fbevents.js'] },
  { name: 'Hotjar', category: 'analytics', patterns: ['static.hotjar.com', 'hotjar.com', 'hj('] },
  { name: 'Microsoft Clarity', category: 'analytics', patterns: ['clarity.ms', 'clarity("set"'] },
  { name: 'LinkedIn Insight', category: 'advertising', patterns: ['snap.licdn.com', '_linkedin_data_partner', 'px.ads.linkedin.com'] },
  { name: 'Twitter / X Ads', category: 'advertising', patterns: ['static.ads-twitter.com', 'analytics.twitter.com', 'twq('] },
  { name: 'TikTok Pixel', category: 'advertising', patterns: ['analytics.tiktok.com', 'ttq.'] },
  { name: 'HubSpot', category: 'marketing', patterns: ['js.hs-scripts.com', 'js.hsforms.net', 'hs-analytics'] },
  { name: 'Segment', category: 'analytics', patterns: ['cdn.segment.com', 'analytics.track'] },
  { name: 'Mixpanel', category: 'analytics', patterns: ['mixpanel', 'cdn.mxpnl.com'] },
  { name: 'Amplitude', category: 'analytics', patterns: ['amplitude.com', 'cdn.amplitude.com'] },
  { name: 'Intercom', category: 'marketing', patterns: ['widget.intercom.io', 'intercomcdn'] },
  { name: 'Adobe Analytics', category: 'analytics', patterns: ['omtrdc.net', 'demdex.net', '2o7.net', 'adobedtm.com'] },
  { name: 'Yandex Metrica', category: 'analytics', patterns: ['mc.yandex.ru', 'yandex_metrika'] },
  { name: 'Criteo', category: 'advertising', patterns: ['static.criteo.net', 'criteo'] },
  { name: 'Taboola', category: 'advertising', patterns: ['taboola.com'] },
  { name: 'Outbrain', category: 'advertising', patterns: ['outbrain.com'] },
  { name: 'Cloudflare Insights', category: 'analytics', patterns: ['cloudflareinsights.com'] },
  { name: 'Pinterest Tag', category: 'advertising', patterns: ['ct.pinterest.com', 'pintrk('] },
  { name: 'Snapchat Pixel', category: 'advertising', patterns: ['sc-static.net', 'snaptr('] },
];

// Pre-lowercase all patterns once at module load to avoid per-call allocations.
for (const sig of TRACKER_SIGNATURES) sig.patterns = sig.patterns.map((p) => p.toLowerCase());

// Known Consent Management Platforms (cookie banners).
const CMP_SIGNATURES = [
  { name: 'OneTrust', patterns: ['onetrust', 'optanon', 'cookielaw.org', 'cookiepro'] },
  { name: 'Cookiebot', patterns: ['cookiebot', 'consent.cookiebot'] },
  { name: 'Usercentrics', patterns: ['usercentrics', 'app.usercentrics.eu'] },
  { name: 'Didomi', patterns: ['didomi', 'sdk.privacy-center.org'] },
  { name: 'Quantcast Choice', patterns: ['quantcast', 'qc-cmp', '__cmp'] },
  { name: 'TrustArc', patterns: ['trustarc', 'consent.truste', 'truste'] },
  { name: 'CookieYes', patterns: ['cookieyes', 'cookie-law-info'] },
  { name: 'Termly', patterns: ['termly.io', 'app.termly.io'] },
  { name: 'Iubenda', patterns: ['iubenda', 'cdn.iubenda.com'] },
  { name: 'Osano', patterns: ['osano', 'cmp.osano.com'] },
  { name: 'Complianz', patterns: ['complianz', 'cmplz'] },
  { name: 'Borlabs Cookie', patterns: ['borlabs-cookie', 'borlabscookie'] },
];
for (const sig of CMP_SIGNATURES) sig.patterns = sig.patterns.map((p) => p.toLowerCase());

// Personal-data form field hints.
const PERSONAL_DATA_FIELDS = [
  'email', 'e-mail', 'phone', 'mobile', 'tel', 'name', 'fname', 'lname', 'firstname',
  'lastname', 'address', 'city', 'zip', 'postal', 'pincode', 'dob', 'birth', 'age',
  'gender', 'aadhaar', 'aadhar', 'pan', 'passport', 'ssn', 'creditcard', 'card',
  'cvv', 'account', 'ifsc', 'company', 'designation',
];

// Data-driven CDN detection — mirrors the TRACKER_SIGNATURES pattern.
const CDN_SIGNATURES = [
  { name: 'Cloudflare',     headerKeys: ['cf-ray'],              serverSubstrings: ['cloudflare'] },
  { name: 'AWS CloudFront', headerKeys: ['x-amz-cf-id', 'x-amz-cf-pop'] },
  { name: 'AWS S3',         headerKeys: ['x-amz-request-id'],   serverSubstrings: ['amazons3'] },
  { name: 'Azure CDN',      headerKeys: ['x-azure-ref'] },
  { name: 'Google Cloud',   headerKeys: ['x-goog-hash'],        serverSubstrings: ['gws'] },
  { name: 'Vercel',         headerKeys: ['x-vercel-id'] },
  { name: 'Netlify',        headerKeys: ['x-netlify-request-id'] },
  { name: 'Akamai',         headerKeys: ['x-akamai-transformed'], serverSubstrings: ['akamai'] },
  { name: 'Fastly',         serverSubstrings: ['fastly'] },
  { name: 'Nginx',          serverSubstrings: ['nginx'] },
  { name: 'Apache',         serverSubstrings: ['apache'] },
];

// Data-driven WAF detection — same mechanism.
const WAF_SIGNATURES = [
  { name: 'Cloudflare WAF',              headerKeys: ['cf-ray'],                                                         serverSubstrings: ['cloudflare'], detail: 'Cloudflare (cf-ray header detected)' },
  { name: 'AWS WAF',                     headerKeys: ['x-amzn-waf-action', 'x-amzn-requestid', 'x-amz-apigw-id'],                                       detail: 'AWS WAF signatures detected' },
  { name: 'Akamai WAF (Kona Site Defender)', headerKeys: ['x-akamai-transformed', 'akamai-grn'],                       serverSubstrings: ['akamai'],     detail: 'Akamai WAF headers detected' },
  { name: 'Sucuri WAF',                  headerKeys: ['x-sucuri-id', 'x-sucuri-cache'],                                 serverSubstrings: ['sucuri'],     detail: 'Sucuri WAF detected' },
  { name: 'Imperva (Incapsula)',         headerKeys: ['x-iinfo'],       extraCheck: (h) => h['x-cdn'] === 'Imperva',    serverSubstrings: ['incapsula'],  detail: 'Imperva/Incapsula WAF detected' },
  { name: 'Barracuda WAF',               headerKeys: ['barra_counter_session', 'barra_sid'],                                                              detail: 'Barracuda WAF session headers detected' },
  { name: 'F5 BIG-IP ASM',              headerKeys: ['x-wa-info', 'x-cnection'],                                       serverSubstrings: ['big-ip'],     detail: 'F5 BIG-IP WAF detected' },
  { name: 'Fortinet FortiWeb',           headerKeys: ['fortiwafsid'],                                                   serverSubstrings: ['fortiweb'],   detail: 'FortiWeb WAF detected' },
  { name: 'ModSecurity',                 serverSubstrings: ['mod_security', 'modsecurity'],                                                               detail: 'ModSecurity WAF detected' },
  { name: 'Azure Front Door WAF',        headerKeys: ['x-azure-ref', 'x-fd-healthprobe'],                                                                detail: 'Azure Front Door detected' },
  { name: 'Google Cloud Armor',          headerKeys: ['x-goog-iap-generated-response'], extraCheck: (h) => h['via']?.includes('google'),                 detail: 'Google Cloud Armor signatures detected' },
  { name: 'Vercel Firewall',             headerKeys: ['x-vercel-id'],                                                                                    detail: 'Vercel edge network detected' },
  { name: 'DenyAll WAF',                 headerKeys: ['x-backside-transport'],                                          serverSubstrings: ['denyall'],    detail: 'DenyAll WAF detected' },
];

function detectBySignatures(allHeaders, serverHeader, signatures) {
  for (const sig of signatures) {
    const headerHit = sig.headerKeys?.some((k) => allHeaders[k]);
    const serverHit = sig.serverSubstrings?.some((s) => serverHeader.includes(s));
    const extraHit = sig.extraCheck?.(allHeaders);
    if (headerHit || serverHit || extraHit) return sig;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(input) {
  let u = (input || '').trim();
  if (!u) throw new Error('No URL provided');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return new URL(u);
}

// F-05: the only outbound-request primitive in this file. Delegates to
// safeFetch(), the single SSRF-safe boundary — see scanner/safeFetch.js.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  return safeFetch(
    url,
    {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      ...opts,
    },
    timeoutMs
  );
}

// Patterns are pre-lowercased above; haystack is lowercased once here.
function findSignatures(haystack, signatures) {
  const found = [];
  const lower = haystack.toLowerCase();
  for (const sig of signatures) {
    const hit = sig.patterns.find((p) => lower.includes(p));
    if (hit) found.push({ name: sig.name, category: sig.category, evidence: hit });
  }
  return found;
}

function parseSetCookie(headers, host) {
  let raw = [];
  if (typeof headers.getSetCookie === 'function') raw = headers.getSetCookie();
  else {
    const sc = headers.get('set-cookie');
    if (sc) raw = [sc];
  }
  return raw.map((line) => {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const name = pair.split('=')[0];
    const lc = line.toLowerCase();
    const domainAttr = (attrs.find((a) => a.toLowerCase().startsWith('domain=')) || '')
      .split('=')[1];
    return {
      name,
      secure: lc.includes('secure'),
      httpOnly: lc.includes('httponly'),
      sameSite: (lc.match(/samesite=(\w+)/) || [])[1] || 'unset',
      domain: domainAttr || host,
      thirdParty: domainAttr ? !domainAttr.replace(/^\./, '').endsWith(host) : false,
    };
  });
}

function extractSecurityHeaders(headers) {
  return {
    hsts: headers.get('strict-transport-security') || null,
    csp: headers.get('content-security-policy') || null,
    xContentTypeOptions: headers.get('x-content-type-options') || null,
    xFrameOptions: headers.get('x-frame-options') || null,
    referrerPolicy: headers.get('referrer-policy') || null,
    permissionsPolicy: headers.get('permissions-policy') || null,
    corsOrigin: headers.get('access-control-allow-origin') || null,
    server: headers.get('server') || null,
    poweredBy: headers.get('x-powered-by') || null,
  };
}

// Returns true if any keyword is found — avoids building a filtered array.
function hasAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Policy link discovery + analysis
// ---------------------------------------------------------------------------

const PRIVACY_PATTERNS = [
  /privacy[\s-]?(policy|notice|statement|center|centre)/i,
  /\bprivacy\b/i,
  /data[\s-]?(policy|protection|notice|privacy)/i,
  /personal[\s-]?data/i,
  /information[\s-]?policy/i,
  /gdpr/i,
  /dpdp(a)?/i,
];

const COOKIE_PATTERNS = [
  /cookie[\s-]?(policy|notice|consent|settings|preferences)/i,
  /\bcookies\b/i,
];

const TERMS_PATTERNS = [
  /terms[\s-]?(of[\s-]?(use|service|conditions))?/i,
  /\btos\b/i,
  /conditions[\s-]?of[\s-]?use/i,
  /user[\s-]?agreement/i,
  /legal[\s-]?notice/i,
];

const COMMON_PRIVACY_PATHS = [
  '/privacy', '/privacy-policy', '/privacy-notice', '/privacy-statement',
  '/legal/privacy', '/legal/privacy-policy', '/policies/privacy',
  '/data-policy', '/data-protection', '/gdpr', '/dpdpa',
  '/en/privacy', '/en/privacy-policy',
];

const COMMON_TERMS_PATHS = [
  '/terms', '/terms-of-service', '/terms-of-use', '/terms-and-conditions',
  '/legal/terms', '/legal', '/tos',
];

const COMMON_COOKIE_PATHS = [
  '/cookie-policy', '/cookies', '/cookie-notice', '/legal/cookies',
];

function extractLinks($, baseUrl) {
  const candidates = { privacy: [], cookie: [], terms: [] };

  const tryLink = (href, text) => {
    if (!href) return;
    let abs;
    try { abs = new URL(href, baseUrl).toString(); } catch { return; }
    if (/^(mailto:|tel:|javascript:|#)/.test(href)) return;
    const combined = (text + ' ' + href).toLowerCase();

    if (PRIVACY_PATTERNS.some((r) => r.test(combined))) candidates.privacy.push(abs);
    if (COOKIE_PATTERNS.some((r) => r.test(combined))) candidates.cookie.push(abs);
    if (TERMS_PATTERNS.some((r) => r.test(combined))) candidates.terms.push(abs);
  };

  // Footer first — most reliable location for policy links.
  const footerSel = 'footer, [class*="footer" i], [id*="footer" i], [class*="bottom" i], [role="contentinfo"]';
  $(footerSel).find('a[href]').each((_, el) => tryLink($(el).attr('href'), $(el).text().trim()));

  // All page links (duplicates removed by Set below).
  $('a[href]').each((_, el) => tryLink($(el).attr('href'), $(el).text().trim()));

  // <link rel="..."> in <head>.
  $('link[rel]').each((_, el) => {
    const rel = ($(el).attr('rel') || '').toLowerCase();
    const href = $(el).attr('href');
    if (!href) return;
    if (/privacy|data.polic/.test(rel)) {
      try { candidates.privacy.push(new URL(href, baseUrl).toString()); } catch {}
    }
  });

  return {
    privacy: [...new Set(candidates.privacy)],
    cookie: [...new Set(candidates.cookie)],
    terms: [...new Set(candidates.terms)],
  };
}

async function probeUrls(candidates, baseUrl, commonPaths) {
  const toTry = [
    ...candidates,
    ...commonPaths.map((p) => { try { return new URL(p, baseUrl).toString(); } catch { return null; } }).filter(Boolean),
  ];
  const unique = [...new Set(toTry)];
  // Fan out all probes in parallel — first 200 OK wins.
  try {
    return await Promise.any(
      unique.map(async (url) => {
        const r = await fetchWithTimeout(url, { method: 'HEAD' }, 8000);
        if (!r.ok) throw new Error('not ok');
        return r.url || url;
      })
    );
  } catch {
    return candidates[0] || null;
  }
}

async function findPolicyLinks($, baseUrl) {
  const candidates = extractLinks($, baseUrl);

  const [privacy, cookie, terms] = await Promise.all([
    probeUrls(candidates.privacy, baseUrl, COMMON_PRIVACY_PATHS),
    probeUrls(candidates.cookie, baseUrl, COMMON_COOKIE_PATHS),
    probeUrls(candidates.terms, baseUrl, COMMON_TERMS_PATHS),
  ]);

  return { privacy, cookie, terms };
}

async function analyzePolicy(url) {
  const result = {
    url,
    reachable: false,
    wordCount: 0,
    topics: {},
    lastUpdatedMentioned: false,
  };
  try {
    const res = await fetchWithTimeout(url);
    result.reachable = res.ok;
    if (!res.ok) return result;
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    result.wordCount = text.split(' ').filter(Boolean).length;

    result.topics = {
      lawfulBasisOrConsent:    hasAny(text, ['lawful basis', 'legal basis', 'consent', 'legitimate interest', 'legitimate use']),
      dataCollected:           hasAny(text, ['information we collect', 'data we collect', 'personal data', 'personal information', 'collect']),
      purpose:                 hasAny(text, ['purpose', 'how we use', 'why we collect', 'use your']),
      rightsAccess:            hasAny(text, ['right to access', 'access your', 'request a copy', 'access information']),
      rightsErasure:           hasAny(text, ['erasure', 'right to be forgotten', 'delete your', 'deletion', 'erase']),
      rightsRectification:     hasAny(text, ['rectification', 'correct your', 'correction', 'update your information']),
      rightsPortability:       hasAny(text, ['data portability', 'portability', 'transfer your data']),
      rightToObjectOrWithdraw: hasAny(text, ['withdraw consent', 'withdraw your consent', 'object to', 'opt-out', 'opt out', 'unsubscribe']),
      retention:               hasAny(text, ['retention', 'how long', 'retain', 'storage period', 'keep your']),
      security:                hasAny(text, ['security', 'safeguard', 'encryption', 'protect your', 'security measures']),
      thirdPartySharing:       hasAny(text, ['third party', 'third-party', 'share your', 'disclose', 'service providers']),
      internationalTransfer:   hasAny(text, ['international transfer', 'transfer outside', 'cross-border', 'outside the', 'standard contractual clauses', 'adequacy']),
      dataHostingLocation:     hasAny(text, ['hosted in', 'data center', 'data centre', 'servers located', 'stored in', 'aws', 'amazon web services', 'google cloud', 'microsoft azure', 'hosting provider', 'data is stored']),
      childrenData:            hasAny(text, ['children', 'under 13', 'under 18', 'minor', 'parental consent', 'child']),
      childrenDataExcluded:    /do not (collect|process|knowingly collect|store|gather).{0,60}(child|minor|under \d+)|not (directed|intended) (at|for|toward).{0,30}(child|minor)|not knowingly collect.{0,60}(child|minor)|children.{0,60}(not|do not|does not|never).{0,60}(collect|process|use|store)|we (do not|don't) collect.{0,60}(child|minor)|service.{0,30}not (designed|intended).{0,30}(child|minor)/i.test(text),
      breachNotification:      hasAny(text, ['data breach', 'breach notification', 'security incident', 'notify you']),
      grievanceOfficer:        hasAny(text, ['grievance officer', 'grievance redressal', 'grievance']),
      dataProtectionOfficer:   hasAny(text, ['data protection officer', 'dpo', 'data protection board']),
      consentManager:          hasAny(text, ['consent manager']),
      nomination:              hasAny(text, ['nominate', 'nomination']),
      supervisoryAuthority:    hasAny(text, ['supervisory authority', 'lodge a complaint', 'data protection authority', 'ico', 'cnil']),
    };

    result.contactEmail = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0] || null;
    result.lastUpdatedMentioned = /last updated|effective date|last revised|last modified/i.test(text);
    result.grievanceOfficerNamed = /grievance officer/i.test(text);
    return result;
  } catch {
    return result;
  }
}

// ---------------------------------------------------------------------------
// Optional headless pass (Playwright) — runtime cookies & banner detection
// ---------------------------------------------------------------------------

async function headlessPass(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return null;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    const requestHosts = new Set();
    page.on('request', (req) => { try { requestHosts.add(new URL(req.url()).host); } catch {} });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const cookies = await ctx.cookies();
    const bodyHtml = await page.content();
    const bannerVisible = await page
      .evaluate(() => {
        const txt = document.body.innerText.toLowerCase();
        return /cookie|consent|we use cookies|accept all|privacy/.test(txt) &&
          !!document.querySelector('[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]');
      })
      .catch(() => false);
    return {
      preConsentCookies: cookies.map((c) => ({
        name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
      })),
      thirdPartyHosts: [...requestHosts],
      bannerVisible,
      runtimeHtml: bodyHtml,
    };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function scanWebsite(input, { headless = false, deep = true } = {}) {
  const target = normalizeUrl(input);
  const host = target.hostname.replace(/^www\./, '');
  const started = Date.now();

  const signals = {
    input,
    url: target.toString(),
    host,
    scannedAt: new Date().toISOString(),
    errors: [],
  };

  // 1. Fetch the homepage and check HTTP→HTTPS redirect concurrently.
  let res, html = '';
  try {
    res = await fetchWithTimeout(target.toString());
    signals.statusCode = res.status;
    signals.finalUrl = res.url;
    signals.https = new URL(res.url).protocol === 'https:';
    signals.headers = Object.fromEntries(res.headers.entries());
    signals.securityHeaders = extractSecurityHeaders(res.headers);
    signals.cookies = parseSetCookie(res.headers, host);
    html = await res.text();
  } catch (e) {
    signals.errors.push(`Failed to fetch site: ${e.message}`);
    signals.reachable = false;
    return signals;
  }
  signals.reachable = true;

  // 1b. HTTP→HTTPS redirect check (independent of DNS — run concurrently below).
  const httpsRedirectPromise = signals.https
    ? fetchWithTimeout('http://' + host, { redirect: 'manual' }, 10000)
        .then((r) => {
          const loc = r.headers.get('location') || '';
          return (r.status >= 300 && r.status < 400 && loc.startsWith('https')) || r.status === 200;
        })
        .catch(() => null)
    : Promise.resolve(false);

  // 1c. DNS + hosting info (runs concurrently with redirect check).
  const hostingPromise = resolve4(host)
    .then((ips) => {
      const serverHeader = (signals.securityHeaders.server || '').toLowerCase();
      const allHeaders = signals.headers || {};

      const cdnSig = detectBySignatures(allHeaders, serverHeader, CDN_SIGNATURES);
      const cdn = cdnSig?.name || null;

      const wafDetails = [];
      let waf = null;
      for (const sig of WAF_SIGNATURES) {
        const headerHit = sig.headerKeys?.some((k) => allHeaders[k]);
        const serverHit = sig.serverSubstrings?.some((s) => serverHeader.includes(s));
        const extraHit = sig.extraCheck?.(allHeaders);
        if (headerHit || serverHit || extraHit) {
          waf = waf || sig.name;
          wafDetails.push(sig.detail);
        }
      }

      return {
        ip: ips[0] || null,
        allIps: ips,
        server: signals.securityHeaders.server || null,
        poweredBy: signals.securityHeaders.poweredBy || null,
        cdn,
        disclosed: cdn || (signals.securityHeaders.server || null),
        waf,
        wafDetails,
      };
    })
    .catch((e) => ({
      ip: null, allIps: [], server: signals.securityHeaders.server || null,
      poweredBy: signals.securityHeaders.poweredBy || null, cdn: null, error: e.message,
    }));

  // Await both concurrently.
  [signals.httpsRedirect, signals.hosting] = await Promise.all([httpsRedirectPromise, hostingPromise]);

  // 1d. TLS info — built after httpsRedirect is known.
  signals.tls = { enabled: signals.https, redirect: signals.httpsRedirect };

  // 2. Parse HTML.
  const $ = cheerio.load(html);
  signals.title = $('title').first().text().trim();

  // 3. Trackers — search the raw HTML once (script tags are a subset of it).
  signals.trackers = findSignatures(html, TRACKER_SIGNATURES);

  // 4. Cookie consent banner / CMP.
  const cmps = findSignatures(html, CMP_SIGNATURES);
  const genericBanner =
    /we use cookies|cookie policy|accept (all )?cookies|cookie consent|manage cookies/i.test(html) ||
    $('[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]').length > 0;
  signals.cookieBanner = {
    found: cmps.length > 0 || genericBanner,
    cmp: cmps[0]?.name || null,
    allCmps: cmps.map((c) => c.name),
    method: cmps.length > 0 ? 'CMP detected' : genericBanner ? 'Generic banner markup' : 'none',
  };

  // 5. Policy links.
  signals.policyLinks = await findPolicyLinks($, res.url);

  // 6. Forms collecting personal data.
  signals.forms = [];
  $('form').each((_, el) => {
    const fields = [];
    $(el).find('input, select, textarea').each((__, f) => {
      const nm = (($(f).attr('name') || '') + ' ' + ($(f).attr('id') || '') + ' ' +
        ($(f).attr('type') || '') + ' ' + ($(f).attr('placeholder') || '')).toLowerCase();
      if (PERSONAL_DATA_FIELDS.some((p) => nm.includes(p))) fields.push(nm.trim().split(/\s+/)[0]);
    });
    const formHtml = $.html(el).toLowerCase();
    const hasConsent =
      /consent|i agree|privacy policy|terms|opt-in/.test(formHtml) &&
      $(el).find('input[type="checkbox"]').length > 0;
    if (fields.length > 0) {
      signals.forms.push({
        action: $(el).attr('action') || res.url,
        method: ($(el).attr('method') || 'get').toUpperCase(),
        collectsPersonalData: true,
        personalFields: [...new Set(fields)],
        hasConsentCheckbox: hasConsent,
        secureSubmission: signals.https,
      });
    }
  });

  // 7. Page-level signals.
  const pageText = $('body').text();
  signals.grievanceOfficerOnPage = /grievance officer|grievance redressal/i.test(pageText);
  signals.dpoOnPage = /data protection officer|\bdpo\b/i.test(pageText);
  signals.contactEmailOnPage = (pageText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0] || null;
  signals.ageGate = /are you (over|at least) \d+|date of birth|age verification|under 18|under 13/i.test(pageText);

  // 8. Deep-analyze the privacy policy.
  if (deep && signals.policyLinks.privacy) {
    signals.privacyPolicy = await analyzePolicy(signals.policyLinks.privacy);
  } else {
    signals.privacyPolicy = { url: signals.policyLinks.privacy, reachable: false, wordCount: 0, topics: {} };
  }
  signals.privacyPolicy.found = !!signals.policyLinks.privacy;

  // 9. Optional headless runtime pass.
  if (headless) {
    try {
      const hp = await headlessPass(res.url);
      if (hp) {
        signals.headless = {
          available: true,
          preConsentCookieCount: hp.preConsentCookies.length,
          preConsentCookies: hp.preConsentCookies,
          thirdPartyHostCount: hp.thirdPartyHosts.filter((h) => !h.endsWith(host)).length,
          bannerVisible: hp.bannerVisible,
        };
        const runtimeTrackers = findSignatures(hp.runtimeHtml, TRACKER_SIGNATURES);
        const names = new Set(signals.trackers.map((t) => t.name));
        for (const t of runtimeTrackers) if (!names.has(t.name)) signals.trackers.push(t);
      } else {
        signals.headless = { available: false, note: 'Playwright not installed (run: npx playwright install chromium)' };
      }
    } catch (e) {
      signals.headless = { available: false, error: e.message };
    }
  }

  signals.scanDurationMs = Date.now() - started;
  return signals;
}
