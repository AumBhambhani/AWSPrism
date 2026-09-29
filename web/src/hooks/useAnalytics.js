import { useEffect } from 'react';
import { useCookieConsent } from './useCookieConsent';
import { initGA, disableGA } from '../utils/analytics';

export function useAnalytics() {
  const { consent } = useCookieConsent();

  useEffect(() => {
    if (consent?.choices?.analytics) {
      initGA();
    } else {
      disableGA();
    }
  }, [consent]);
}
