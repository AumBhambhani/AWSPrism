// mobile.js — analyze a mobile app's privacy posture from its store listing.
//
// Direct APK static analysis is out of scope here; instead we use the public,
// authoritative signals an app already declares: the Google Play "Data safety"
// section, the Apple App Store privacy labels, the developer contact, and the
// linked privacy policy — then run the same policy-text checklist used for sites.

import * as cheerio from 'cheerio';
import { safeFetch } from './safeFetch.js';

const UA =
  'Mozilla/5.0 (compatible; ComplianceScanner/1.0; +https://example.com/compliance-bot)';

// F-05 follow-up: this used to call the raw global fetch() directly, bypassing
// safeFetch() entirely (both the store-listing URL and the attacker-suppliable
// `policy` URL were fetched with zero destination validation). Delegates to
// safeFetch() — the single SSRF-safe boundary — exactly like scanner.js's
// fetchWithTimeout(). detectStore()'s regex match is a content heuristic only,
// never a security boundary; the resulting URL still goes through safeFetch().
async function fetchText(url, timeoutMs = 20000) {
  const res = await safeFetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' } }, timeoutMs);
  return { ok: res.ok, status: res.status, url: res.url, html: await res.text() };
}

function detectStore(url) {
  if (/play\.google\.com/i.test(url)) return 'google-play';
  if (/apps\.apple\.com|itunes\.apple\.com/i.test(url)) return 'app-store';
  return 'unknown';
}

// Extract the privacy policy URL + developer email from a store page.
function extractFromStore($, html) {
  const out = { privacyPolicyUrl: null, developerEmail: null, developer: null };

  // Collect every privacy-looking link, then prefer the app developer's own
  // policy over the store operator's (Google/Apple) boilerplate privacy links.
  const candidates = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    if ((/privacy/.test(text) || /privacy/i.test(href)) && /^https?:/i.test(href)) candidates.push(href);
  });
  const isStoreOperator = (u) => /policies\.google\.com|support\.google\.com|google\.com\/intl|apple\.com\/(legal|privacy)/i.test(u);
  out.privacyPolicyUrl =
    candidates.find((u) => !isStoreOperator(u)) || candidates[0] || null;

  out.developerEmail = (html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0] || null;

  // Google Play exposes developer name in a known anchor pattern; fall back to meta.
  out.developer =
    $('meta[name="author"]').attr('content') ||
    $('a[href*="/store/apps/dev"], a[href*="/store/apps/developer"]').first().text().trim() ||
    null;

  return out;
}

// Heuristic read of Google Play "Data safety" disclosures.
function extractDataSafety(text) {
  const lower = text.toLowerCase();
  return {
    sectionPresent: /data safety|data shared|data collected/i.test(text),
    sharesData: /data shared with third parties|this app may share these data types/i.test(text),
    collectsData: /data collected|this app may collect these data types/i.test(text),
    encryptionInTransit: /encrypted in transit|data is encrypted/i.test(text),
    deletionRequest: /request that data be deleted|you can request that data be deleted/i.test(text),
    collectsLocation: /\blocation\b/.test(lower),
    collectsContacts: /\bcontacts\b/.test(lower),
    collectsFinancial: /financial info|payment info/.test(lower),
    collectsPII: /personal info|name|email address|phone number/.test(lower),
  };
}

// Reuse the website policy analyzer for the linked privacy policy.
async function analyzePolicy(url) {
  const result = { url, reachable: false, wordCount: 0, topics: {}, contactEmail: null, lastUpdatedMentioned: false };
  try {
    const r = await fetchText(url);
    result.reachable = r.ok;
    if (!r.ok) return result;
    const $ = cheerio.load(r.html);
    $('script, style, nav, footer, header').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    result.wordCount = text.split(' ').filter(Boolean).length;
    const has = (arr) => arr.some((k) => text.toLowerCase().includes(k));
    result.topics = {
      dataCollected: has(['information we collect', 'data we collect', 'personal data', 'collect']),
      purpose: has(['purpose', 'how we use', 'why we collect']),
      lawfulBasisOrConsent: has(['consent', 'lawful basis', 'legitimate']),
      rightsAccess: has(['right to access', 'access your', 'request a copy']),
      rightsErasure: has(['delete your', 'erasure', 'deletion', 'right to be forgotten']),
      rightsRectification: has(['correct your', 'rectification', 'update your information']),
      rightToObjectOrWithdraw: has(['withdraw consent', 'opt-out', 'opt out', 'unsubscribe']),
      retention: has(['retention', 'how long', 'retain']),
      security: has(['security', 'encryption', 'safeguard', 'protect your']),
      thirdPartySharing: has(['third party', 'third-party', 'share your', 'service providers']),
      internationalTransfer: has(['international transfer', 'transfer outside', 'cross-border']),
      childrenData: has(['children', 'under 13', 'under 18', 'parental consent', 'minor']),
      grievanceOfficer: has(['grievance officer', 'grievance redressal', 'grievance']),
      dataProtectionOfficer: has(['data protection officer', 'dpo']),
      breachNotification: has(['data breach', 'breach notification', 'security incident']),
    };
    result.contactEmail = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0] || null;
    result.lastUpdatedMentioned = /last updated|effective date|last revised/i.test(text);
    return result;
  } catch {
    return result;
  }
}

// Build a signals object shaped like the website scanner's, so the same
// rules.js / scorer.js can score it.
export async function scanMobileApp(input, { privacyPolicyUrl = null } = {}) {
  const signals = {
    input,
    type: 'mobile-app',
    scannedAt: new Date().toISOString(),
    errors: [],
    trackers: [],
    cookies: [],
    forms: [],
    securityHeaders: {},
  };

  let store = detectStore(input);
  let storeData = {};
  let ppUrl = privacyPolicyUrl;

  if (store !== 'unknown') {
    signals.store = store;
    try {
      const page = await fetchText(input);
      signals.reachable = page.ok;
      const $ = cheerio.load(page.html);
      signals.appTitle = $('title').first().text().trim();
      const ex = extractFromStore($, page.html);
      storeData = ex;
      ppUrl = ppUrl || ex.privacyPolicyUrl;
      signals.developer = ex.developer;
      signals.developerEmail = ex.developerEmail;
      signals.dataSafety = extractDataSafety($('body').text());
    } catch (e) {
      signals.errors.push(`Failed to fetch store listing: ${e.message}`);
    }
  } else if (ppUrl) {
    signals.store = 'direct-policy';
    signals.reachable = true;
  } else {
    signals.errors.push('Provide a Google Play / App Store URL, or a privacy policy URL via --policy.');
    signals.reachable = false;
    return signals;
  }

  // Analyze the privacy policy (mandatory for both stores and both laws).
  if (ppUrl) {
    signals.policyLinks = { privacy: ppUrl };
    signals.privacyPolicy = await analyzePolicy(ppUrl);
    signals.privacyPolicy.found = true;
  } else {
    signals.policyLinks = { privacy: null };
    signals.privacyPolicy = { found: false, reachable: false, wordCount: 0, topics: {} };
  }

  // Shape store data-safety signals into the website-style fields the rules read.
  const ds = signals.dataSafety || {};
  signals.https = true; // app traffic security is judged via policy + data-safety, not TLS of store page
  signals.httpsRedirect = true;
  signals.contactEmailOnPage = signals.developerEmail || signals.privacyPolicy?.contactEmail || null;
  signals.grievanceOfficerOnPage = !!signals.privacyPolicy?.topics?.grievanceOfficer;
  signals.dpoOnPage = !!signals.privacyPolicy?.topics?.dataProtectionOfficer;
  // If the store declares data sharing, treat it as a tracker-presence signal.
  if (ds.sharesData) signals.trackers.push({ name: 'Declared third-party data sharing (store)', category: 'advertising', evidence: 'Data safety: shares data' });

  signals.mobileNotes = [
    'Mobile scoring is based on the store listing + linked privacy policy. For full assurance, also perform SDK/APK static analysis (e.g. trackers via Exodus Privacy) and an in-app consent review.',
    store === 'google-play'
      ? 'Google Play requires a Data safety section and a privacy policy URL.'
      : store === 'app-store'
      ? 'Apple requires privacy "nutrition labels" and a privacy policy URL.'
      : 'Scored from the provided privacy policy URL only.',
  ];

  return signals;
}
