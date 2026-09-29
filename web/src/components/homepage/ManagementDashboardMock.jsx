import Logo from "../Logo";
import { LineChart, Heatmap } from "./charts";

/* Illustrative sample data for the management-dashboard mockup. Not real data. */

const NAV = ["Home", "Dashboard", "Policies", "Risks", "Controls", "Evidence", "Audits", "Reports", "Administration"];

const STATS = [
  { label: "Overall readiness", value: "78%", note: "+6% vs last month", tone: "good" },
  { label: "Total controls", value: "1,248", note: "across 6 departments", tone: "neutral" },
  { label: "Open risks", value: "23", note: "5 high severity", tone: "warn" },
  { label: "Overdue evidence", value: "34", note: "needs attention", tone: "bad" },
];

const TREND = [
  { color: "var(--teal)", data: [58, 61, 60, 64, 67, 66, 70, 73, 72, 76, 78] },
];

const HEAT = [
  [0, 1, 2, 2],
  [1, 1, 2, 3],
  [1, 2, 3, 3],
  [2, 3, 3, 3],
];

export default function ManagementDashboardMock() {
  return (
    <div className="hp-mgmt-mock" role="img" aria-label="Prism management dashboard preview">
      <aside className="hp-mgmt-side">
        <div className="hp-mgmt-side-logo"><Logo /></div>
        <nav>
          {NAV.map((n, i) => (
            <span key={n} className={i === 1 ? "hp-mgmt-nav-active" : ""}>{n}</span>
          ))}
        </nav>
      </aside>

      <div className="hp-mgmt-main">
        <div className="hp-mgmt-head">
          <h4>Executive overview</h4>
          <span className="hp-ccc-chip">This quarter</span>
        </div>

        <div className="hp-mgmt-stats">
          {STATS.map((s) => (
            <div key={s.label} className={`hp-mgmt-stat hp-tone-${s.tone}`}>
              <span className="hp-mgmt-stat-value">{s.value}</span>
              <span className="hp-mgmt-stat-label">{s.label}</span>
              <span className="hp-mgmt-stat-note">{s.note}</span>
            </div>
          ))}
        </div>

        <div className="hp-mgmt-charts">
          <div className="hp-mgmt-card">
            <h5>Compliance trend</h5>
            <LineChart series={TREND} width={420} height={170} />
          </div>
          <div className="hp-mgmt-card">
            <h5>Risk heatmap</h5>
            <Heatmap
              grid={HEAT}
              xLabels={["Low", "Minor", "Major", "Severe"]}
              yLabels={["Rare", "Unlikely", "Likely", "Frequent"]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
