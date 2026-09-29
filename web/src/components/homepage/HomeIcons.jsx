import React from "react";

/* Clean, crisp SVG marks for frameworks and technology integrations */
export const MARKS = {
  dpdpa: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#d97706" strokeWidth="2.5" fill="#fef3c7" fillOpacity="0.4" />
      <path d="M24 10 L28 18 L37 19 L30 25 L32 34 L24 29 L16 34 L18 25 L11 19 L20 18 Z" fill="#d97706" />
      <circle cx="24" cy="24" r="5" stroke="#92400e" strokeWidth="1.5" />
    </svg>
  ),
  gdpr: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#1e3a8a" />
      <circle cx="24" cy="12" r="2" fill="#fbbf24" />
      <circle cx="32" cy="15" r="2" fill="#fbbf24" />
      <circle cx="36" cy="24" r="2" fill="#fbbf24" />
      <circle cx="32" cy="33" r="2" fill="#fbbf24" />
      <circle cx="24" cy="36" r="2" fill="#fbbf24" />
      <circle cx="16" cy="33" r="2" fill="#fbbf24" />
      <circle cx="12" cy="24" r="2" fill="#fbbf24" />
      <circle cx="16" cy="15" r="2" fill="#fbbf24" />
    </svg>
  ),
  hipaa: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0284c7" fillOpacity="0.15" stroke="#0284c7" strokeWidth="2" />
      <path d="M24 12v24M12 24h24" stroke="#0284c7" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M19 19h10v10H19z" fill="#0284c7" fillOpacity="0.3" />
    </svg>
  ),
  pci: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#15803d" fillOpacity="0.15" stroke="#15803d" strokeWidth="2" />
      <rect x="11" y="15" width="26" height="18" rx="3" stroke="#15803d" strokeWidth="2.5" />
      <path d="M11 21h26" stroke="#15803d" strokeWidth="2.5" />
      <circle cx="17" cy="27" r="2" fill="#15803d" />
      <rect x="23" y="26" width="10" height="2" rx="1" fill="#15803d" />
    </svg>
  ),
  rbi: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#0f766e" strokeWidth="2.5" fill="#ccfbf1" fillOpacity="0.35" />
      <circle cx="24" cy="24" r="17" stroke="#0f766e" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M24 13v6M18 19h12M19 25h10M24 25v10" stroke="#0f766e" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  iso27001: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#4338ca" fillOpacity="0.15" stroke="#4338ca" strokeWidth="2" />
      <path d="M24 10l12 5v9c0 7.5-5 13-12 15-7-2-12-7.5-12-15v-9l12-5z" stroke="#4338ca" strokeWidth="2.5" fill="#4338ca" fillOpacity="0.2" />
      <path d="M19 23l3.5 3.5 7-7" stroke="#4338ca" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  soc2: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="21" fill="#0369a1" />
      <text x="24" y="21" fill="#ffffff" fontSize="10" fontWeight="700" textAnchor="middle">AICPA</text>
      <text x="24" y="32" fill="#38bdf8" fontSize="11" fontWeight="800" textAnchor="middle">SOC 2</text>
    </svg>
  ),
  cis: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <circle cx="24" cy="24" r="21" stroke="#0d9488" strokeWidth="2.5" fill="#f0fdfa" />
      <path d="M16 24a8 8 0 1116 0 8 8 0 01-16 0" stroke="#0d9488" strokeWidth="3" strokeDasharray="38 12" />
      <text x="24" y="27" fill="#0d9488" fontSize="10" fontWeight="800" textAnchor="middle">CIS</text>
    </svg>
  ),
  certin: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#0f172a" stroke="#0284c7" strokeWidth="2" />
      <circle cx="24" cy="24" r="14" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="24" cy="24" r="6" fill="#38bdf8" />
      <path d="M24 10v4M24 34v4M10 24h4M34 24h4" stroke="#38bdf8" strokeWidth="2" />
    </svg>
  ),
  itgc: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#4f46e5" fillOpacity="0.15" stroke="#4f46e5" strokeWidth="2" />
      <circle cx="24" cy="24" r="10" stroke="#4f46e5" strokeWidth="2" strokeDasharray="4 2" />
      <circle cx="24" cy="24" r="4" fill="#4f46e5" />
    </svg>
  ),
  iso19770: (
    <svg viewBox="0 0 48 48" className="hp-mark-svg" fill="none">
      <rect x="4" y="4" width="40" height="40" rx="8" fill="#dc2626" fillOpacity="0.15" stroke="#dc2626" strokeWidth="2" />
      <rect x="14" y="14" width="20" height="20" rx="3" stroke="#dc2626" strokeWidth="2.5" />
      <path d="M14 20h20M20 14v20" stroke="#dc2626" strokeWidth="2" />
    </svg>
  ),
};

export default function HomeMark({ name, className = "" }) {
  return <span className={`hp-mark ${className}`}>{MARKS[name] || null}</span>;
}
