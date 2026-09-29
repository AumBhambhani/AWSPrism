// "My departments / All" pill. Renders nothing for users who aren't scoped.
export default function DepartmentScopeToggle({ scope, style }) {
  if (!scope?.scoped) return null;
  const names = (scope.me?.departments || []).map((d) => d.name).join(", ");
  const btn = (value, label, title) => (
    <button
      type="button"
      onClick={() => scope.setMode(value)}
      title={title}
      aria-label={label}
      aria-pressed={scope.mode === value}
      style={{
        border: "none", borderRadius: 999, padding: "5px 12px", fontSize: 12, cursor: "pointer",
        background: scope.mode === value ? "var(--accent)" : "transparent",
        color: scope.mode === value ? "#fff" : "var(--text2)",
        fontWeight: scope.mode === value ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Department scope"
      style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 999, border: "1px solid var(--border2)", ...style }}
    >
      {btn("mine", "My departments", names || "You aren't in any department yet — ask your admin")}
      {btn("all", "All", "Show every department")}
    </div>
  );
}
