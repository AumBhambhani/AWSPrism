// scorer.js — runs the rule set against scanner signals and computes scores.

import { RULES, SEVERITY_WEIGHT } from './rules.js';

const STATUS_VALUE = { pass: 1, partial: 0.5, fail: 0, na: null };

function gradeFromScore(score) {
  if (score >= 90) return { grade: 'A', label: 'Strong compliance posture' };
  if (score >= 75) return { grade: 'B', label: 'Largely compliant — minor gaps' };
  if (score >= 60) return { grade: 'C', label: 'Partial compliance — action needed' };
  if (score >= 40) return { grade: 'D', label: 'Significant gaps — high risk' };
  return { grade: 'F', label: 'Non-compliant — urgent remediation' };
}

function appliesTo(rule, framework) {
  return rule.framework === 'BOTH' || rule.framework === framework;
}

// Evaluate every rule once, then aggregate per framework.
export function evaluateCompliance(signals) {
  const results = RULES.map((rule) => {
    let outcome;
    try {
      outcome = rule.evaluate(signals);
    } catch (e) {
      outcome = { status: 'na', detail: `Rule error: ${e.message}`, recommendation: '' };
    }
    const weight = SEVERITY_WEIGHT[rule.severity] || 1;
    return {
      id: rule.id,
      framework: rule.framework,
      category: rule.category,
      severity: rule.severity,
      title: rule.title,
      reference: rule.reference,
      weight,
      status: outcome.status,
      detail: outcome.detail,
      recommendation: outcome.recommendation || '',
    };
  });

  const frameworks = {};
  for (const fw of ['GDPR', 'DPDPA']) {
    const applicable = results.filter((r) => appliesTo(r, fw) && r.status !== 'na');
    let earned = 0;
    let possible = 0;
    for (const r of applicable) {
      earned += STATUS_VALUE[r.status] * r.weight;
      possible += r.weight;
    }
    const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    frameworks[fw] = {
      score,
      ...gradeFromScore(score),
      checksEvaluated: applicable.length,
      passed: applicable.filter((r) => r.status === 'pass').length,
      partial: applicable.filter((r) => r.status === 'partial').length,
      failed: applicable.filter((r) => r.status === 'fail').length,
      notApplicable: results.filter((r) => appliesTo(r, fw) && r.status === 'na').length,
    };
  }

  const overall = Math.round((frameworks.GDPR.score + frameworks.DPDPA.score) / 2);

  // Category breakdown (across both frameworks, na excluded).
  const categories = {};
  for (const r of results) {
    if (r.status === 'na') continue;
    const c = (categories[r.category] ||= { earned: 0, possible: 0, items: 0 });
    c.earned += STATUS_VALUE[r.status] * r.weight;
    c.possible += r.weight;
    c.items += 1;
  }
  const categoryScores = Object.entries(categories).map(([name, c]) => ({
    name,
    score: c.possible ? Math.round((c.earned / c.possible) * 100) : 0,
    items: c.items,
  }));

  // Prioritised remediation list (failed/partial, weighted by severity).
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const remediation = results
    .filter((r) => r.status === 'fail' || r.status === 'partial')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'fail' ? -1 : 1;
      return sevRank[a.severity] - sevRank[b.severity];
    })
    .map((r) => ({
      id: r.id,
      severity: r.severity,
      status: r.status,
      title: r.title,
      reference: r.reference,
      recommendation: r.recommendation,
      detail: r.detail,
    }));

  return {
    overall: { score: overall, ...gradeFromScore(overall) },
    frameworks,
    categoryScores,
    results,
    remediation,
  };
}
