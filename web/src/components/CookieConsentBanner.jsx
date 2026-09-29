import React, { useState } from 'react';
import { useCookieConsent } from '../hooks/useCookieConsent';

export default function CookieConsentBanner() {
  const {
    needsBanner,
    consent,
    acceptAll,
    rejectAll,
    saveCustom,
  } = useCookieConsent();

  const [showPrefs, setShowPrefs] = useState(false);

  if (!needsBanner) return null;

  if (showPrefs) {
    return (
      <PreferenceCenter
        onSave={saveCustom}
        onBack={() => setShowPrefs(false)}
        initialChoices={consent?.choices}
      />
    );
  }

  return (
    <div className="prism-cp-overlay" role="dialog" aria-modal="true" aria-label="Privacy Preferences">
      <div className="prism-cp-box">
        <h2>We use cookies</h2>
        <p>
          We use cookies and similar technologies to improve your experience,
          analyze traffic, and personalize content. You can manage your
          preferences or accept all cookies.
        </p>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        <div className="prism-cp-actions">
          <button className="prism-cp-btn prism-cp-btn-secondary" onClick={() => setShowPrefs(true)}>
            Manage Preferences
          </button>
          <button className="prism-cp-btn prism-cp-btn-secondary" onClick={rejectAll}>
            Reject All
          </button>
          <button className="prism-cp-btn prism-cp-btn-primary" onClick={acceptAll}>
            Accept All
          </button>
        </div>
      </div>
    </div>
  );
}

function PreferenceCenter({ onSave, onBack, initialChoices }) {
  const [choices, setChoices] = useState({
    functional: initialChoices?.functional || false,
    analytics: initialChoices?.analytics || false,
    marketing: initialChoices?.marketing || false,
  });

  const toggle = (key) =>
    setChoices((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="prism-cp-overlay" role="dialog" aria-modal="true" aria-label="Privacy Preferences">
      <div className="prism-cp-box">
        <h2>Cookie Preferences</h2>

        <div className="prism-cp-category">
          <label>
            <input type="checkbox" checked disabled />
            Strictly Necessary (always on)
          </label>
        </div>

        <div className="prism-cp-category">
          <label>
            <input
              type="checkbox"
              checked={choices.functional}
              onChange={() => toggle('functional')}
            />
            Functional Cookies
          </label>
        </div>

        <div className="prism-cp-category">
          <label>
            <input
              type="checkbox"
              checked={choices.analytics}
              onChange={() => toggle('analytics')}
            />
            Analytics Cookies (Google Analytics)
          </label>
        </div>

        <div className="prism-cp-category">
          <label>
            <input
              type="checkbox"
              checked={choices.marketing}
              onChange={() => toggle('marketing')}
            />
            Marketing Cookies
          </label>
        </div>

        <div className="prism-cp-actions">
          <button className="prism-cp-btn prism-cp-btn-secondary" onClick={onBack}>
            Back
          </button>
          <button className="prism-cp-btn prism-cp-btn-primary" onClick={() => onSave(choices)}>
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
