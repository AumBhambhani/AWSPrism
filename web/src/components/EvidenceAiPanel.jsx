/**
 * Renders the cached AI analysis for a single evidence file, shared by the
 * contributor, reviewer and auditor surfaces (QuestionDetail, Review, Evidence
 * Vault, Dashboard drill-down). Analysis is auto-run on upload and stored on the
 * shared evidence_vault item, so this component only ever displays a cached
 * result — it never triggers analysis.
 *
 * Accepts an evidence-like object with camelCased fields:
 *   aiContributorComments, aiReviewerComments, aiGaps, aiSuggestions,
 *   aiAnalyzedAt, aiDateWarning, aiAnalysisStatus, aiAnalyzedVersion, currentVersion
 */

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function EvidenceAiPanel({ evidence, compact = false }) {
  if (!evidence) return null;

  const status = evidence.aiAnalysisStatus;
  const contributor = evidence.aiContributorComments;
  const reviewer = evidence.aiReviewerComments;
  const gaps = asArray(evidence.aiGaps);
  const suggestions = asArray(evidence.aiSuggestions);
  const dateWarning = evidence.aiDateWarning;
  const analyzedAt = evidence.aiAnalyzedAt;

  const analyzedVer = evidence.aiAnalyzedVersion;
  const currentVer = evidence.currentVersion;
  const stale =
    analyzedVer != null && currentVer != null && analyzedVer < currentVer;

  const hasAnalysis =
    contributor || reviewer || gaps.length > 0 || suggestions.length > 0 || dateWarning;

  // In-flight / interrupted auto-analysis.
  if (!hasAnalysis && (status === "running" || status === "queued")) {
    return (
      <div className="ai-feedback-card">
        <div className="ai-feedback-header">
          <span className="ai-feedback-icon">🤖</span>
          <span className="ai-feedback-title">AI analysis in progress…</span>
        </div>
      </div>
    );
  }

  if (!hasAnalysis && status === "failed") {
    return (
      <div className="ai-feedback-card">
        <div className="ai-feedback-body ai-feedback-muted">
          AI analysis could not be completed for this file.
        </div>
      </div>
    );
  }

  if (!hasAnalysis) return null;

  return (
    <div className="ai-feedback-card">
      <div className="ai-feedback-header">
        <span className="ai-feedback-icon">✨</span>
        <span className="ai-feedback-title">AI Analysis</span>
        {analyzedAt && (
          <span className="ai-feedback-timestamp">
            {new Date(analyzedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {stale && (
        <div className="ai-feedback-stale">
          ⚠️ This analysis ran against an earlier version of the file.
        </div>
      )}

      {dateWarning && (
        <div className="ai-feedback-datewarning">
          <span style={{ flexShrink: 0 }}>📅</span>
          <span>{dateWarning}</span>
        </div>
      )}

      {contributor && <div className="ai-feedback-body">{contributor}</div>}

      {gaps.length > 0 && (
        <div className="ai-feedback-gaps">
          <div className="ai-feedback-gaps-header">
            <span className="ai-feedback-gaps-icon">⚠️</span>
            <span>Gaps Identified</span>
          </div>
          <ul className="ai-feedback-gaps-list">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {!compact && suggestions.length > 0 && (
        <div className="ai-feedback-suggestions">
          <div className="ai-feedback-suggestions-header">
            <span>💡</span>
            <span>Suggestions</span>
          </div>
          <ul className="ai-feedback-gaps-list">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {!compact && reviewer && (
        <div className="ai-feedback-reviewer">
          <div className="ai-feedback-reviewer-header">👤 Reviewer Summary</div>
          <div>{reviewer}</div>
        </div>
      )}
    </div>
  );
}
