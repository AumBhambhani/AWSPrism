// Low-level self-assessment scoring primitives, shared by
// utils/selfAssessmentReport.js (the orchestrator / email summary) and
// utils/readinessAssessment.js (the deterministic Big-4 report engine) without
// creating an import cycle between them.

export const SCORE_VALUE = { YES: 1, PARTIAL: 0.5, NO: 0 };

// Score bands — the label + colour used wherever a questionnaire score is shown.
// This is a questionnaire-completeness / self-report score, NOT a compliance
// rating (see the report's §6 note).
export const SCORE_BANDS = [
  { min: 80, label: "Strong", color: "#15803D", bg: "#DCFCE7" },
  { min: 60, label: "Moderate", color: "#B45309", bg: "#FEF3C7" },
  { min: 40, label: "Developing", color: "#C2410C", bg: "#FFEDD5" },
  { min: 0, label: "Needs work", color: "#B91C1C", bg: "#FEE2E2" },
];
export const NOT_ASSESSED_BAND = { label: "Not assessed", color: "#8B85A0", bg: "#F7F6FC" };

export function scoreBand(pct) {
  if (pct === null) return NOT_ASSESSED_BAND;
  return SCORE_BANDS.find(b => pct >= b.min);
}

export function scoreSubmission(answers) {
  let total = 0, scored = 0;
  for (const value of Object.values(answers || {})) {
    if (!(value in SCORE_VALUE)) continue; // skips NA and unrecognised values
    total++;
    scored += SCORE_VALUE[value];
  }
  return total > 0 ? Math.round((scored / total) * 100) : null;
}
