const SEVERITY_COLOR = {
  critical: "var(--red)",
  high:     "var(--red)",
  medium:   "var(--amber)",
  low:      "var(--text3)",
};

export default function SeverityPill({ severity }) {
  const color = SEVERITY_COLOR[severity] || "var(--text3)";
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, color, textTransform: "uppercase",
      letterSpacing: "0.04em", whiteSpace: "nowrap", background: `${color}18`,
      padding: "2px 8px", borderRadius: 20, border: `1px solid ${color}40`
    }}>
      {severity}
    </span>
  );
}
