import { Donut, AreaChart, BarMeter } from "./charts";

/* Illustrative sample data for the hero product mockup. Not real tenant data. */

const CONTROL_TILES = [
  { label: "Total controls", value: "1,248", tone: "neutral" },
  { label: "Compliant", value: "842", tone: "good" },
  { label: "Partially compliant", value: "276", tone: "warn" },
  { label: "Non-compliant", value: "130", tone: "bad" },
];

const RISK_TREND = [22, 24, 21, 26, 25, 29, 27, 31, 28, 24, 20, 18];

const EVIDENCE = [
  { label: "Collected", value: "1,062", tone: "good" },
  { label: "Pending", value: "152", tone: "warn" },
  { label: "Overdue", value: "34", tone: "bad" },
];

const DEPARTMENTS = [
  { name: "IT & Security", owner: "Alice", controls: 320, readiness: 82 },
  { name: "Legal & Compliance", owner: "Janice", controls: 210, readiness: 79 },
  { name: "Data Protection", owner: "Alex", controls: 180, readiness: 74 },
  { name: "Human Resources", owner: "Sarah", controls: 140, readiness: 71 },
  { name: "Finance", owner: "Michael", controls: 130, readiness: 68 },
];

const TOP_RISKS = [
  { name: "Third-party access", level: "High", count: 12 },
  { name: "Data retention gaps", level: "High", count: 9 },
  { name: "Access reviews overdue", level: "Medium", count: 7 },
  { name: "Unpatched systems", level: "Medium", count: 6 },
  { name: "Change management", level: "Low", count: 4 },
];

export default function ComplianceCommandCenter() {
  return (
    <div className="hp-ccc" role="img" aria-label="Prism compliance command centre dashboard preview">
      <div className="hp-ccc-bar">
        <span className="hp-ccc-title">Compliance Command Center</span>
        <span className="hp-ccc-chip">Last 30 days</span>
      </div>

      <div className="hp-ccc-grid">
        <section className="hp-ccc-panel hp-ccc-readiness">
          <h4>Overall readiness</h4>
          <Donut value={78} caption="Good" color="var(--teal)" />
          <p className="hp-ccc-delta hp-ccc-up">▲ 6 pts this month</p>
        </section>

        <section className="hp-ccc-panel hp-ccc-controls">
          <h4>Control status</h4>
          <div className="hp-ccc-tiles">
            {CONTROL_TILES.map((t) => (
              <div key={t.label} className={`hp-ccc-tile hp-tone-${t.tone}`}>
                <span className="hp-ccc-tile-value">{t.value}</span>
                <span className="hp-ccc-tile-label">{t.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="hp-ccc-panel hp-ccc-trend">
          <h4>Open risk trend</h4>
          <AreaChart data={RISK_TREND} width={300} height={96} color="var(--amber)" />
          <p className="hp-ccc-delta hp-ccc-down">▼ 4 risks closed since Apr</p>
        </section>

        <section className="hp-ccc-panel hp-ccc-evidence">
          <h4>Evidence status</h4>
          <div className="hp-ccc-evidence-row">
            <Donut value={85} size={104} stroke={10} caption="Collected" color="var(--green)" />
            <ul className="hp-ccc-legend">
              {EVIDENCE.map((e) => (
                <li key={e.label}>
                  <span className={`hp-dot hp-tone-${e.tone}`} />
                  {e.label}
                  <b>{e.value}</b>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="hp-ccc-panel hp-ccc-dept">
          <h4>Department ownership</h4>
          <div className="hp-ccc-table-wrap">
            <table className="hp-ccc-table">
              <thead>
                <tr><th>Department</th><th>Owner</th><th>Controls</th><th>Readiness</th></tr>
              </thead>
              <tbody>
                {DEPARTMENTS.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="hp-ccc-muted">{d.owner}</td>
                    <td>{d.controls}</td>
                    <td>
                      <span className="hp-ccc-meter-cell">
                        <BarMeter value={d.readiness} color="var(--teal)" />
                        <i>{d.readiness}%</i>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="hp-ccc-panel hp-ccc-risks">
          <h4>Top risks</h4>
          <ul className="hp-ccc-risk-list">
            {TOP_RISKS.map((r) => (
              <li key={r.name}>
                <span>{r.name}</span>
                <span className={`hp-ccc-pill hp-level-${r.level.toLowerCase()}`}>{r.level}</span>
                <b>{r.count}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
