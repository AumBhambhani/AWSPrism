export default function ScoreGates({ gates }) {
  return (
    <div className="score-gates">
      {gates.map((gate, i) => (
        <div key={i} className="gate-item">
          <span className={`gate-indicator ${gate.met ? "gate-met" : "gate-unmet"}`}>
            {gate.met ? "✓" : "✗"}
          </span>
          <span className="gate-label">{gate.label}</span>
        </div>
      ))}
    </div>
  );
}
