// rules.js — the compliance checklist.
// Each rule evaluates the signals collected by the scanner and returns a status.
// Frameworks: GDPR (EU 2016/679 + ePrivacy) and DPDPA (India Digital Personal
// Data Protection Act, 2023). A rule may apply to one or BOTH.
//
// status: 'pass' | 'partial' | 'fail' | 'na'
//   pass = 1.0, partial = 0.5, fail = 0.0, na = excluded from scoring
// severity: 'critical' | 'high' | 'medium' | 'low'  (drives weight + risk view)

const SEVERITY_WEIGHT = { critical: 5, high: 3, medium: 2, low: 1 };

function P(status, detail, recommendation = '') {
  return { status, detail, recommendation };
}

// Pull topic coverage from the analyzed privacy policy (safe defaults).
function topics(s) {
  return (s.privacyPolicy && s.privacyPolicy.topics) || {};
}

export const RULES = [
  // ---------------------------------------------------------------------
  // TRANSPARENCY & NOTICE
  // ---------------------------------------------------------------------
  {
    id: 'privacy-policy-present',
    framework: 'BOTH',
    category: 'Transparency & Notice',
    severity: 'critical',
    title: 'Privacy policy / notice is published and reachable',
    reference: 'GDPR Art. 12–14 · DPDPA s.5 (Notice)',
    evaluate(s) {
      if (s.privacyPolicy?.found && s.privacyPolicy?.reachable)
        return P('pass', `Privacy policy found at ${s.privacyPolicy.url}`);
      if (s.privacyPolicy?.found)
        return P('partial', `A privacy link exists (${s.policyLinks?.privacy}) but the page could not be loaded/parsed.`, 'Ensure the privacy policy page returns HTTP 200 and is publicly accessible.');
      return P('fail', 'No privacy policy link was found on the homepage.', 'Publish a clear privacy policy/notice and link it in the site footer.');
    },
  },
  {
    id: 'notice-completeness',
    framework: 'BOTH',
    category: 'Transparency & Notice',
    severity: 'high',
    title: 'Notice describes what data is collected, why, and how it is used',
    reference: 'GDPR Art. 13 · DPDPA s.5(1)(i)',
    evaluate(s) {
      const t = topics(s);
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      const have = [t.dataCollected, t.purpose].filter(Boolean).length;
      if (have === 2) return P('pass', 'Policy describes the data collected and the purpose of processing.');
      if (have === 1) return P('partial', 'Policy partially covers data collected / purpose.', 'State both the categories of personal data collected and the specific purpose for each.');
      return P('fail', 'Policy does not clearly describe data collected or purpose.', 'Add an itemised description of personal data and the purpose of processing.');
    },
  },
  {
    id: 'policy-last-updated',
    framework: 'BOTH',
    category: 'Transparency & Notice',
    severity: 'low',
    title: 'Policy shows an effective / last-updated date',
    reference: 'GDPR Art. 12 (transparency) · DPDPA s.5',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return s.privacyPolicy.lastUpdatedMentioned
        ? P('pass', 'Policy includes an effective / last-updated date.')
        : P('partial', 'No effective / last-updated date detected.', 'Add a clearly visible "Last updated" date.');
    },
  },
  {
    id: 'language-availability',
    framework: 'DPDPA',
    category: 'Transparency & Notice',
    severity: 'medium',
    title: 'Notice available in English or a scheduled Indian language',
    reference: 'DPDPA s.5(3)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      // We can only verify English automatically; flag the multilingual obligation.
      return P('partial', 'English notice detected. DPDPA s.5(3) also requires the option of any language in the Eighth Schedule of the Constitution.', 'Offer the notice in English and at least the relevant scheduled Indian language(s) for your user base.');
    },
  },

  // ---------------------------------------------------------------------
  // CONSENT & COOKIES
  // ---------------------------------------------------------------------
  {
    id: 'cookie-consent-banner',
    framework: 'BOTH',
    category: 'Consent & Cookies',
    severity: 'high',
    title: 'Cookie/consent mechanism is present',
    reference: 'GDPR Art. 7 + ePrivacy Art. 5(3) · DPDPA s.6',
    evaluate(s) {
      if (s.cookieBanner?.cmp) return P('pass', `Consent platform detected: ${s.cookieBanner.cmp}.`);
      if (s.cookieBanner?.found) return P('partial', 'Generic cookie/consent markup detected, but no recognised consent platform.', 'Use a configurable consent banner that blocks non-essential cookies until consent.');
      const hasTrackers = (s.trackers || []).length > 0;
      return hasTrackers
        ? P('fail', 'Trackers are present but no cookie/consent mechanism was detected.', 'Add a consent banner that gates analytics/advertising cookies behind opt-in.')
        : P('partial', 'No consent banner detected (and no obvious trackers).', 'If you set any non-essential cookies, add a consent banner.');
    },
  },
  {
    id: 'pre-consent-cookies',
    framework: 'BOTH',
    category: 'Consent & Cookies',
    severity: 'critical',
    title: 'No non-essential cookies/trackers set before consent',
    reference: 'GDPR ePrivacy Art. 5(3) · DPDPA s.6 (prior consent)',
    evaluate(s) {
      // Best signal comes from the headless pass; fall back to header cookies + trackers.
      if (s.headless?.available) {
        const n = s.headless.preConsentCookieCount || 0;
        const trackers = (s.trackers || []).filter((t) => t.category !== 'functional').length;
        if (n === 0 && trackers === 0) return P('pass', 'No cookies set before any consent interaction.');
        if (n <= 2 && trackers === 0) return P('partial', `${n} cookie(s) set before consent (may be strictly necessary).`, 'Verify these are strictly necessary; otherwise gate them behind consent.');
        return P('fail', `${n} cookie(s) and ${trackers} tracker(s) load before consent.`, 'Block analytics/advertising cookies and tags until the user opts in.');
      }
      // Static fallback.
      const trackers = (s.trackers || []).filter((t) => t.category === 'advertising' || t.category === 'analytics');
      const setCookies = (s.cookies || []).length;
      if (trackers.length === 0 && setCookies === 0) return P('pass', 'No tracking scripts or cookies detected on initial load.');
      if (trackers.length > 0) return P('fail', `Tracking scripts detected on initial load: ${trackers.map((t) => t.name).join(', ')}.`, 'Defer these tags until after consent (run a headless scan for exact pre-consent cookies).');
      return P('partial', `${setCookies} cookie(s) set on initial response; run a headless scan to confirm they are essential.`, 'Run with --headless for an accurate pre-consent cookie audit.');
    },
  },
  {
    id: 'consent-withdrawal',
    framework: 'BOTH',
    category: 'Consent & Cookies',
    severity: 'high',
    title: 'Users can withdraw consent / opt out',
    reference: 'GDPR Art. 7(3) · DPDPA s.6(4)–(6)',
    evaluate(s) {
      const t = topics(s);
      if (t.rightToObjectOrWithdraw) return P('pass', 'Policy describes withdrawing consent / opting out.');
      if (s.cookieBanner?.cmp) return P('partial', 'A consent platform is present (often allows re-opening preferences) but withdrawal is not described in the policy.', 'State explicitly how users withdraw consent, "as easily as it was given".');
      return P('fail', 'No consent withdrawal / opt-out mechanism described.', 'Provide an easy way to withdraw consent and describe it in the notice.');
    },
  },
  {
    id: 'form-consent',
    framework: 'BOTH',
    category: 'Consent & Cookies',
    severity: 'medium',
    title: 'Data-collection forms reference consent / privacy terms',
    reference: 'GDPR Art. 7 · DPDPA s.6(1)',
    evaluate(s) {
      const forms = (s.forms || []).filter((f) => f.collectsPersonalData);
      if (forms.length === 0) return P('na', 'No personal-data forms detected on the homepage.');
      const withConsent = forms.filter((f) => f.hasConsentCheckbox).length;
      if (withConsent === forms.length) return P('pass', `All ${forms.length} personal-data form(s) include a consent/privacy reference.`);
      if (withConsent > 0) return P('partial', `${withConsent}/${forms.length} forms reference consent.`, 'Add an unticked consent checkbox + privacy link to every form collecting personal data.');
      return P('fail', `${forms.length} form(s) collect personal data without a visible consent reference.`, 'Add explicit, opt-in consent and a privacy-policy link to data-collection forms.');
    },
  },

  // ---------------------------------------------------------------------
  // TRACKERS & THIRD PARTIES
  // ---------------------------------------------------------------------
  {
    id: 'third-party-disclosure',
    framework: 'BOTH',
    category: 'Trackers & Third Parties',
    severity: 'high',
    title: 'Third-party sharing / processors disclosed in policy',
    reference: 'GDPR Art. 13(1)(e) · DPDPA s.5(1)(i) + Data Processor obligations',
    evaluate(s) {
      const t = topics(s);
      const trackers = s.trackers || [];
      if (trackers.length > 0 && !t.thirdPartySharing) return P('fail', `${trackers.length} third-party tracker(s) present but the policy does not disclose third-party sharing.`, 'Disclose all third parties/processors and the data shared with them.');
      if (t.thirdPartySharing) return P('pass', 'Policy discloses third-party sharing / service providers.');
      return P('partial', 'No third-party sharing disclosure detected (and few/no trackers found).', 'If you use any processors, disclose them in the notice.');
    },
  },
  {
    id: 'tracker-inventory',
    framework: 'BOTH',
    category: 'Trackers & Third Parties',
    severity: 'medium',
    title: 'Volume of advertising/analytics trackers is controlled',
    reference: 'GDPR Art. 5(1)(c) data minimisation · DPDPA s.6 (purpose limitation)',
    evaluate(s) {
      const ad = (s.trackers || []).filter((t) => t.category === 'advertising');
      const all = s.trackers || [];
      if (all.length === 0) return P('pass', 'No third-party trackers detected.');
      if (ad.length === 0 && all.length <= 2) return P('pass', `${all.length} analytics/functional tracker(s); no advertising trackers.`);
      if (ad.length <= 2) return P('partial', `${all.length} tracker(s) detected (${ad.length} advertising).`, 'Review necessity of each tag; remove unused advertising trackers.');
      return P('fail', `${all.length} trackers including ${ad.length} advertising trackers (${ad.map((t) => t.name).join(', ')}).`, 'Reduce advertising trackers and ensure each is consent-gated and disclosed.');
    },
  },

  // ---------------------------------------------------------------------
  // DATA PRINCIPAL / SUBJECT RIGHTS
  // ---------------------------------------------------------------------
  {
    id: 'right-access',
    framework: 'BOTH',
    category: 'Data Principal / Subject Rights',
    severity: 'high',
    title: 'Right to access personal data is described',
    reference: 'GDPR Art. 15 · DPDPA s.11',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).rightsAccess
        ? P('pass', 'Right to access is described.')
        : P('fail', 'Right to access not described.', 'Describe how users can request access to their personal data.');
    },
  },
  {
    id: 'right-correction-erasure',
    framework: 'BOTH',
    category: 'Data Principal / Subject Rights',
    severity: 'high',
    title: 'Right to correction and erasure is described',
    reference: 'GDPR Art. 16 & 17 · DPDPA s.12',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      const t = topics(s);
      const have = [t.rightsRectification, t.rightsErasure].filter(Boolean).length;
      if (have === 2) return P('pass', 'Both correction and erasure rights are described.');
      if (have === 1) return P('partial', 'Only one of correction / erasure is described.', 'Describe both the right to correct and the right to erase personal data.');
      return P('fail', 'Neither correction nor erasure rights are described.', 'Add rights to correction and erasure of personal data.');
    },
  },
  {
    id: 'right-portability',
    framework: 'GDPR',
    category: 'Data Principal / Subject Rights',
    severity: 'medium',
    title: 'Right to data portability is described',
    reference: 'GDPR Art. 20',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).rightsPortability
        ? P('pass', 'Right to data portability is described.')
        : P('partial', 'Right to data portability not detected.', 'Describe portability where processing is based on consent/contract and automated.');
    },
  },
  {
    id: 'right-nominate',
    framework: 'DPDPA',
    category: 'Data Principal / Subject Rights',
    severity: 'low',
    title: 'Right to nominate is described',
    reference: 'DPDPA s.14',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).nomination
        ? P('pass', 'Right to nominate (in case of death/incapacity) is described.')
        : P('partial', 'Right to nominate not detected.', 'Add the DPDPA s.14 right to nominate another individual to exercise rights.');
    },
  },

  // ---------------------------------------------------------------------
  // SECURITY
  // ---------------------------------------------------------------------
  {
    id: 'https',
    framework: 'BOTH',
    category: 'Security',
    severity: 'critical',
    title: 'Site served over HTTPS',
    reference: 'GDPR Art. 32 · DPDPA s.8(5) (reasonable security safeguards)',
    evaluate(s) {
      if (s.https && s.httpsRedirect) return P('pass', 'Site is served over HTTPS and HTTP redirects to HTTPS.');
      if (s.https) return P('partial', 'HTTPS is available, but HTTP→HTTPS redirect was not confirmed.', 'Force a redirect from http:// to https://.');
      return P('fail', 'Site is not served over HTTPS.', 'Install a TLS certificate and serve all traffic over HTTPS.');
    },
  },
  {
    id: 'hsts',
    framework: 'BOTH',
    category: 'Security',
    severity: 'medium',
    title: 'HSTS (Strict-Transport-Security) enabled',
    reference: 'GDPR Art. 32 · DPDPA s.8(5)',
    evaluate(s) {
      return s.securityHeaders?.hsts
        ? P('pass', 'Strict-Transport-Security header present.')
        : P('partial', 'No HSTS header.', 'Add Strict-Transport-Security to enforce HTTPS.');
    },
  },
  {
    id: 'security-headers',
    framework: 'BOTH',
    category: 'Security',
    severity: 'medium',
    title: 'Baseline security headers configured',
    reference: 'GDPR Art. 32 · DPDPA s.8(5)',
    evaluate(s) {
      const h = s.securityHeaders || {};
      const present = ['csp', 'xContentTypeOptions', 'xFrameOptions', 'referrerPolicy'].filter((k) => h[k]);
      if (present.length >= 3) return P('pass', `Security headers present: ${present.join(', ')}.`);
      if (present.length >= 1) return P('partial', `Only ${present.join(', ')} present.`, 'Add Content-Security-Policy, X-Content-Type-Options, X-Frame-Options and Referrer-Policy.');
      return P('fail', 'No baseline security headers detected.', 'Add CSP, X-Content-Type-Options, X-Frame-Options and Referrer-Policy.');
    },
  },
  {
    id: 'permissions-policy',
    framework: 'BOTH',
    category: 'Security',
    severity: 'low',
    title: 'Permissions-Policy header configured',
    reference: 'GDPR Art. 32 · DPDPA s.8(5) (browser feature restrictions)',
    evaluate(s) {
      const h = s.securityHeaders || {};
      if (h.permissionsPolicy) return P('pass', `Permissions-Policy header present: restricts browser features.`);
      return P('partial', 'No Permissions-Policy header detected.', 'Add Permissions-Policy to restrict access to camera, microphone, geolocation, and other sensitive browser APIs.');
    },
  },
  {
    id: 'server-info-disclosure',
    framework: 'BOTH',
    category: 'Security',
    severity: 'low',
    title: 'Server version information not exposed',
    reference: 'GDPR Art. 32 · DPDPA s.8(5) (information disclosure prevention)',
    evaluate(s) {
      const h = s.securityHeaders || {};
      const serverHeader = h.server || '';
      const poweredBy = h.poweredBy || '';
      // Check if version numbers are exposed
      const versionPattern = /\d+\.\d+/;
      const serverExposesVersion = versionPattern.test(serverHeader);
      const poweredByExposed = !!poweredBy;
      
      if (!serverExposesVersion && !poweredByExposed) return P('pass', 'Server version and technology stack are not exposed in headers.');
      if (poweredByExposed && serverExposesVersion) return P('fail', `Server exposes version (${serverHeader}) and X-Powered-By (${poweredBy}).`, 'Remove version numbers from the Server header and remove the X-Powered-By header entirely to prevent information disclosure.');
      if (poweredByExposed) return P('partial', `X-Powered-By header exposed: ${poweredBy}.`, 'Remove the X-Powered-By header to prevent technology stack disclosure.');
      return P('partial', `Server header includes version: ${serverHeader}.`, 'Remove version numbers from the Server header to reduce attack surface.');
    },
  },
  {
    id: 'secure-cookies',
    framework: 'BOTH',
    category: 'Security',
    severity: 'medium',
    title: 'Cookies use Secure / HttpOnly / SameSite flags',
    reference: 'GDPR Art. 32 · DPDPA s.8(5)',
    evaluate(s) {
      const cookies = s.cookies || [];
      if (cookies.length === 0) return P('na', 'No cookies set on the initial response.');
      const weak = cookies.filter((c) => !c.secure || c.sameSite === 'unset');
      if (weak.length === 0) return P('pass', 'All initial cookies use Secure + SameSite.');
      return P('partial', `${weak.length}/${cookies.length} cookie(s) lack Secure/SameSite: ${weak.map((c) => c.name).join(', ')}.`, 'Set Secure, HttpOnly (where applicable) and SameSite on all cookies.');
    },
  },
  {
    id: 'security-described',
    framework: 'BOTH',
    category: 'Security',
    severity: 'low',
    title: 'Policy describes security safeguards',
    reference: 'GDPR Art. 32 · DPDPA s.8(5)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).security
        ? P('pass', 'Policy describes security safeguards.')
        : P('partial', 'No description of security safeguards.', 'Describe the technical and organisational security measures in place.');
    },
  },

  // ---------------------------------------------------------------------
  // HOSTING & INFRASTRUCTURE
  // ---------------------------------------------------------------------
  {
    id: 'hosting-ip-identified',
    framework: 'BOTH',
    category: 'Hosting & Infrastructure',
    severity: 'medium',
    title: 'Hosting infrastructure and IP identified',
    reference: 'GDPR Art. 32 · DPDPA s.8(5) (security assessment)',
    evaluate(s) {
      const h = s.hosting || {};
      if (h.ip && h.cdn) return P('pass', `Server IP: ${h.ip} · Infrastructure: ${h.cdn}${h.server ? ' (' + h.server + ')' : ''}.`);
      if (h.ip) return P('pass', `Server IP: ${h.ip}${h.server ? ' · Server: ' + h.server : ''}.`);
      return P('partial', 'Unable to resolve server IP address.', 'Ensure DNS is properly configured and the server is reachable.');
    },
  },
  {
    id: 'cdn-protection',
    framework: 'BOTH',
    category: 'Hosting & Infrastructure',
    severity: 'medium',
    title: 'CDN or DDoS protection in place',
    reference: 'GDPR Art. 32(1)(b) availability · DPDPA s.8(5)',
    evaluate(s) {
      const h = s.hosting || {};
      if (h.cdn && ['Cloudflare', 'AWS CloudFront', 'Akamai', 'Fastly', 'Azure CDN', 'Google Cloud'].includes(h.cdn)) {
        return P('pass', `CDN/DDoS protection detected: ${h.cdn}.`);
      }
      if (h.cdn) return P('pass', `Infrastructure provider detected: ${h.cdn}.`);
      return P('partial', 'No CDN or DDoS protection layer detected.', 'Consider using a CDN/WAF (Cloudflare, AWS CloudFront, Akamai) to protect against DDoS attacks and ensure service availability.');
    },
  },
  {
    id: 'waf-protection',
    framework: 'BOTH',
    category: 'Hosting & Infrastructure',
    severity: 'high',
    title: 'Web Application Firewall (WAF) detected',
    reference: 'GDPR Art. 32(1)(b)(d) · DPDPA s.8(5) (reasonable security safeguards)',
    evaluate(s) {
      const h = s.hosting || {};
      if (h.waf) {
        const details = (h.wafDetails || []).join('; ');
        return P('pass', `WAF detected: ${h.waf}. ${details}`);
      }
      // Check if CDN likely includes WAF capabilities
      if (h.cdn && ['Cloudflare', 'Akamai', 'AWS CloudFront'].includes(h.cdn)) {
        return P('partial', `CDN provider (${h.cdn}) typically includes WAF capabilities, but WAF-specific headers were not confirmed.`, 'Verify that WAF rules are actively configured on your CDN provider to protect against OWASP Top 10 threats, SQL injection, XSS, and bot attacks.');
      }
      return P('fail', 'No Web Application Firewall (WAF) detected.', 'Deploy a WAF to protect against common web attacks (SQL injection, XSS, CSRF, bot attacks). Options include Cloudflare WAF, AWS WAF, Akamai Kona, Imperva, or ModSecurity.');
    },
  },
  {
    id: 'hosting-data-location',
    framework: 'BOTH',
    category: 'Hosting & Infrastructure',
    severity: 'medium',
    title: 'Data hosting location is disclosed in privacy notice',
    reference: 'GDPR Art. 13(1)(f) · DPDPA s.16–17 (transfer restrictions)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      const t = topics(s);
      const h = s.hosting || {};
      if (t.internationalTransfer || t.dataHostingLocation) return P('pass', 'Privacy policy discloses data hosting/transfer locations.');
      if (h.cdn) return P('partial', `Hosting infrastructure identified (${h.cdn}) but data hosting location not explicitly disclosed in privacy notice.`, 'Disclose where personal data is hosted (country/region) and identify your cloud service provider(s) in the privacy notice.');
      return P('fail', 'Data hosting location is not disclosed in the privacy notice.', 'Specify where personal data is stored, identify hosting providers, and disclose any cross-border transfer practices.');
    },
  },
  {
    id: 'ip-origin-protection',
    framework: 'BOTH',
    category: 'Hosting & Infrastructure',
    severity: 'low',
    title: 'Origin IP is protected (not directly exposed)',
    reference: 'GDPR Art. 32 · DPDPA s.8(5) (infrastructure security)',
    evaluate(s) {
      const h = s.hosting || {};
      if (!h.ip) return P('na', 'IP could not be resolved.');
      // If behind a CDN, origin is likely protected
      if (h.cdn && ['Cloudflare', 'AWS CloudFront', 'Akamai', 'Fastly', 'Azure CDN'].includes(h.cdn)) {
        return P('pass', `Origin IP is protected behind ${h.cdn} (IP ${h.ip} belongs to CDN edge).`);
      }
      return P('partial', `Server IP ${h.ip} appears to be directly exposed without a reverse proxy/CDN layer.`, 'Consider placing the origin server behind a CDN or reverse proxy to hide the actual server IP and add a layer of protection against direct attacks.');
    },
  },

  // ---------------------------------------------------------------------
  // GOVERNANCE & ACCOUNTABILITY
  // ---------------------------------------------------------------------
  {
    id: 'grievance-officer',
    framework: 'DPDPA',
    category: 'Governance & Accountability',
    severity: 'critical',
    title: 'Grievance Officer / contact for redressal published',
    reference: 'DPDPA s.8(9) & s.13 (Right to grievance redressal)',
    evaluate(s) {
      const t = topics(s);
      if (t.grievanceOfficer || s.grievanceOfficerOnPage) return P('pass', 'Grievance Officer / grievance redressal contact is published.');
      if (s.privacyPolicy?.contactEmail || s.contactEmailOnPage) return P('partial', 'A contact email exists but no named Grievance Officer.', 'Publish the name/title and contact of a Grievance Officer as required by DPDPA s.13.');
      return P('fail', 'No Grievance Officer or grievance-redressal contact found.', 'Publish a Grievance Officer contact — mandatory for Data Fiduciaries under DPDPA s.13.');
    },
  },
  {
    id: 'dpo-contact',
    framework: 'GDPR',
    category: 'Governance & Accountability',
    severity: 'high',
    title: 'Data Protection Officer / contact point published',
    reference: 'GDPR Art. 13(1)(b) & Art. 37',
    evaluate(s) {
      const t = topics(s);
      if (t.dataProtectionOfficer || s.dpoOnPage) return P('pass', 'DPO / data-protection contact is published.');
      if (s.privacyPolicy?.contactEmail || s.contactEmailOnPage) return P('partial', 'A contact email exists but no DPO/data-protection contact named.', 'Name a DPO or data-protection contact point.');
      return P('fail', 'No DPO / data-protection contact found.', 'Publish a data-protection contact (DPO where required by Art. 37).');
    },
  },
  {
    id: 'contact-channel',
    framework: 'BOTH',
    category: 'Governance & Accountability',
    severity: 'medium',
    title: 'A contact channel for privacy requests exists',
    reference: 'GDPR Art. 12 · DPDPA s.13',
    evaluate(s) {
      const email = s.privacyPolicy?.contactEmail || s.contactEmailOnPage;
      return email
        ? P('pass', `Contact channel detected (${email}).`)
        : P('fail', 'No contact email/channel for privacy requests found.', 'Provide an email or form to submit privacy requests.');
    },
  },
  {
    id: 'retention',
    framework: 'BOTH',
    category: 'Governance & Accountability',
    severity: 'medium',
    title: 'Data retention is addressed',
    reference: 'GDPR Art. 13(2)(a) · DPDPA s.8(7) (erasure on purpose completion)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).retention
        ? P('pass', 'Retention / storage period is addressed.')
        : P('fail', 'Retention period not addressed.', 'State retention periods and deletion once the purpose is served (DPDPA s.8(7)).');
    },
  },
  {
    id: 'breach-process',
    framework: 'BOTH',
    category: 'Governance & Accountability',
    severity: 'low',
    title: 'Breach notification is mentioned',
    reference: 'GDPR Art. 33–34 · DPDPA s.8(6)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).breachNotification
        ? P('pass', 'Breach notification is mentioned.')
        : P('partial', 'No mention of breach notification.', 'Note that breaches are reported to the Board/affected users (DPDPA s.8(6)).');
    },
  },

  // ---------------------------------------------------------------------
  // CHILDREN'S DATA
  // ---------------------------------------------------------------------
  {
    id: 'children-data',
    framework: 'BOTH',
    category: "Children's Data",
    severity: 'high',
    title: "Children's data / age handling is addressed",
    reference: 'GDPR Art. 8 · DPDPA s.9 (verifiable parental consent)',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      const t = topics(s);
      if (t.childrenDataExcluded) return P('pass', "Policy explicitly states children's data is not collected — no further obligation under DPDPA s.9.");
      if (t.childrenData && s.ageGate) return P('pass', "Children's data is addressed and an age signal is present.");
      if (t.childrenData) return P('partial', "Policy addresses children's data, but no age-gate detected on the page.", 'For users likely under 18 (India) / under 16 (EU), implement verifiable parental consent (DPDPA s.9) and avoid tracking/targeted ads to children.');
      return P('fail', "Children's data handling is not addressed.", 'Add a children\'s-data section: verifiable parental consent and no behavioural tracking/targeted advertising directed at children (DPDPA s.9).');
    },
  },

  // ---------------------------------------------------------------------
  // CROSS-BORDER TRANSFERS
  // ---------------------------------------------------------------------
  {
    id: 'international-transfer',
    framework: 'GDPR',
    category: 'Cross-border Transfers',
    severity: 'medium',
    title: 'International data transfers disclosed (with safeguards)',
    reference: 'GDPR Art. 44–49',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).internationalTransfer
        ? P('pass', 'International transfers and safeguards are disclosed.')
        : P('partial', 'No international-transfer disclosure detected.', 'If data leaves the EEA, disclose transfers and safeguards (SCCs/adequacy).');
    },
  },
  {
    id: 'supervisory-authority',
    framework: 'GDPR',
    category: 'Cross-border Transfers',
    severity: 'low',
    title: 'Right to lodge a complaint with a supervisory authority',
    reference: 'GDPR Art. 13(2)(d) & Art. 77',
    evaluate(s) {
      if (!s.privacyPolicy?.reachable) return P('na', 'Privacy policy could not be analyzed.');
      return topics(s).supervisoryAuthority
        ? P('pass', 'Right to complain to a supervisory authority is described.')
        : P('partial', 'No mention of the right to lodge a complaint with a supervisory authority.', 'Add the right to complain to the relevant DPA (and to the Data Protection Board of India for DPDPA).');
    },
  },
];

export { SEVERITY_WEIGHT };
