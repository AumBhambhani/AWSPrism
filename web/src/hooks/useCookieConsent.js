import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client.js';

const CONSENT_KEY = 'cookie_consent';

const defaultChoices = {
  strictly_necessary: true, // always on
  functional: false,
  analytics: false,
  marketing: false,
};

export function useCookieConsent() {
  const [consent, setConsent] = useState(null);
  const [language, setLanguage] = useState('en');
  const [serverVersion, setServerVersion] = useState(null);
  const [forceOpen, setForceOpen] = useState(false);

  // Allow programmatic re-opening (e.g. from footer "Cookie Settings" link)
  useEffect(() => {
    const handler = () => setForceOpen(true);
    window.addEventListener('open-cookie-banner', handler);
    return () => window.removeEventListener('open-cookie-banner', handler);
  }, []);

  // Load saved consent from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(CONSENT_KEY);
    if (saved) {
      try {
        setConsent(JSON.parse(saved));
      } catch {
        /* ignore corrupt data */
      }
    }
  }, []);

  // Fetch current consent policy version from backend
  // Use /api/prefs/version as primary URL to avoid Brave Shields / EasyPrivacy blocking
  // URLs that contain "consent" or "cookie". Falls back with a 2s timeout.
  useEffect(() => {
    let settled = false;
    const fallbackTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setServerVersion('1.0');
      }
    }, 2000);

    apiFetch('/api/prefs/version')
      .then((res) => {
        if (!settled) {
          settled = true;
          setServerVersion(res.version || '1.0');
        }
      })
      .catch(() => {
        // Try the original endpoint as fallback
        return apiFetch('/api/consent/version')
          .then((res) => {
            if (!settled) {
              settled = true;
              setServerVersion(res.version || '1.0');
            }
          })
          .catch(() => {
            if (!settled) {
              settled = true;
              setServerVersion('1.0');
            }
          });
      })
      .finally(() => clearTimeout(fallbackTimer));
  }, []);

  // Non-blocking backend log
  async function _log(action, choices, version) {
    try {
      await apiFetch('/api/consent', {
        method: 'POST',
        body: JSON.stringify({
          language,
          consent_version: version,
          choices,
          action,
        }),
      });
    } catch {
      /* non-blocking */
    }
  }

  // Persist consent locally and to backend
  function _save(action, choices) {
    const version = serverVersion || '1.0';
    const record = { action, choices, version, timestamp: Date.now() };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    setConsent(record);
    setForceOpen(false);
    _log(action, choices, version);
  }

  // Public actions
  const acceptAll = () =>
    _save('accepted_all', {
      strictly_necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    });

  const rejectAll = () => _save('rejected_all', defaultChoices);

  const saveCustom = (choices) =>
    _save('custom', { ...defaultChoices, ...choices, strictly_necessary: true });

  const withdraw = () => _save('withdrawn', defaultChoices);

  // Link anonymous consent log to authenticated user after login
  async function linkConsentToUser(token) {
    try {
      await apiFetch('/api/consent/link', { method: 'PATCH', token });
    } catch {
      /* non-blocking */
    }
  }

  // Show banner if: forced open, OR no consent saved, OR policy version changed
  const needsBanner =
    forceOpen ||
    (serverVersion !== null && (consent === null || consent.version !== serverVersion));

  return {
    consent,
    needsBanner,
    language,
    setLanguage,
    acceptAll,
    rejectAll,
    saveCustom,
    withdraw,
    linkConsentToUser,
  };
}
