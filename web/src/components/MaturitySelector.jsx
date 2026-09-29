const levels = [
  { value: 1, label: "Ad-hoc" },
  { value: 2, label: "Repeatable" },
  { value: 3, label: "Defined" },
  { value: 4, label: "Managed" },
  { value: 5, label: "Optimised" }
];

export default function MaturitySelector({ value, onChange }) {
  return (
    <div className="maturity-grid">
      {levels.map((level) => (
        <button
          key={level.value}
          type="button"
          className={`maturity-item ${value === level.value ? "active" : ""}`}
          onClick={() => onChange(level.value)}
        >
          <strong>{level.value}</strong>
          <span>{level.label}</span>
        </button>
      ))}
    </div>
  );
}
