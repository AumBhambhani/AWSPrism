// Google Analytics 4 — Utility Module
// Replace G-XXXXXXXXXX with your actual GA4 Measurement ID
const GA_ID = import.meta.env.VITE_GA_ID || 'G-FMFEWRE8D8';

/**
 * Dynamically loads the Google Analytics gtag.js script and initializes it.
 * Safe to call multiple times — only loads once.
 */
export function initGA() {
  // Remove the disable flag in case disableGA() was called earlier
  window[`ga-disable-${GA_ID}`] = false;

  // Guard against duplicate loading
  if (window._gaLoaded) return;
  window._gaLoaded = true;

  // Inject the gtag.js script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  // Initialize dataLayer and gtag function
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    anonymize_ip: true, // GDPR: anonymize visitor IP
  });
}

/**
 * Disables GA by setting the official opt-out window property.
 * Any hits sent after this will be blocked by gtag.js.
 */
export function disableGA() {
  window[`ga-disable-${GA_ID}`] = true;
}

/**
 * Send a custom event to GA4.
 * @param {string} eventName - The event name (e.g. 'sign_up', 'purchase')
 * @param {object} params - Optional event parameters
 */
export function trackEvent(eventName, params = {}) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }
}
