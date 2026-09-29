import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { Gauge, TrendLine, Heatmap, Meter } from "../components/Charts.jsx";
import ExecutiveExportMenu from "../components/ExecutiveExportMenu.jsx";
import Logo from "../components/Logo";
import NotificationBell from "../components/NotificationBell.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";

const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function DeltaNote({ delta }) {
  if (!delta) return <span className="exec-kpi-note">no change this period</span>;
  const up = delta > 0;
  return (
    <span className={`exec-kpi-note ${up ? "exec-up" : "exec-down"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)} pts vs previous
    </span>
  );
}

export default function Executive({ token, user, company, theme, onThemeToggle, onLogout }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [months, setMonths] = useState(6);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    apiFetch(`/api/dashboard/management?months=${months}`, { token })
      .then((d) => { if (active) { setData(d); setLoading(false); } })
      .catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [token, months]);

  const cs = data?.controlStatus || {};
  const ev = data?.evidenceStatus || {};
  const trendPoints = (data?.readinessTrend || []).filter((p) => p.value != null);
  const collectedPct =
    ev.collected + ev.pending + ev.overdue > 0
      ? Math.round((ev.collected / (ev.collected + ev.pending + ev.overdue)) * 100)
      : 0;
  const heatmapEmpty = (data?.riskHeatmap || []).flat().every((n) => n === 0);
  const readinessTone =
    (data?.readiness ?? 0) >= 75 ? "exec-tone-good" : (data?.readiness ?? 0) >= 40 ? "exec-tone-warn" : "exec-tone-bad";

  return (
    <div className="dash-shell fade-in" id="print-area">
      <div className="dash-header no-print">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ height: 48, overflow: "hidden", display: "flex", alignItems: "center" }}>
            <Logo style={{ height: 68, display: "block", transform: "scale(0.85)", transformOrigin: "center center" }} />
          </div>
          <div>
            <div className="dash-title">Executive overview</div>
            {company?.name && <div className="dash-sub">{company.name}</div>}
          </div>
        </div>
        <div className="dash-header-actions">
          <div className="dash-segment">
            <Link to="/dashboard" className="dash-segment-btn">Detailed</Link>
            <span className="dash-segment-btn active">Executive</span>
          </div>
          <GlassSelect
            value={months}
            onChange={(val) => setMonths(Number(val))}
            options={[
              { value: 6, label: "Last 6 months" },
              { value: 12, label: "Last 12 months" },
            ]}
          />
          <NotificationBell token={token} />
          <ExecutiveExportMenu data={data} company={company} />
          <UserMenu
            user={user}
            company={company}
            theme={theme}
            onThemeToggle={onThemeToggle}
            onLogout={onLogout}
          />
        </div>
      </div>

      {error && <div className="error-text" style={{ padding: "0 28px 16px" }}>{error}</div>}

      {loading ? (
        <div className="tracker-loading">
          <div className="loading-spinner" />
          <p>Loading executive overview…</p>
        </div>
      ) : data ? (
        <div className="exec-grid">
          {/* KPI row */}
          <div className="exec-kpis">
            <div className={`exec-kpi ${readinessTone}`}>
              <span className="exec-kpi-value">{data.readiness}%</span>
              <span className="exec-kpi-label">Overall readiness</span>
              <DeltaNote delta={data.readinessDelta} />
            </div>
            <div className="exec-kpi exec-tone-neutral">
              <span className="exec-kpi-value">{cs.total}</span>
              <span className="exec-kpi-label">Total controls</span>
              <span className="exec-kpi-note">{cs.notAssessed} not yet approved</span>
            </div>
            <div className="exec-kpi exec-tone-warn">
              <span className="exec-kpi-value">{data.openRisks}</span>
              <span className="exec-kpi-label">Open risks</span>
              <span className="exec-kpi-note">{data.highRisks} high severity</span>
            </div>
            <div className="exec-kpi exec-tone-bad">
              <span className="exec-kpi-value">{ev.overdue}</span>
              <span className="exec-kpi-label">Overdue evidence</span>
              <span className="exec-kpi-note">needs attention</span>
            </div>
          </div>

          <p className="exec-scope-note">
            Readiness and control status count <strong>approved</strong> assessments only —
            work still in review does not contribute.
          </p>

          {/* Trend + heatmap */}
          <div className="exec-row-2">
            <section className="exec-panel">
              <h4>Compliance trend</h4>
              {trendPoints.length >= 2 ? (
                <TrendLine data={data.readinessTrend} color="var(--teal)" />
              ) : (
                <p className="exec-empty">Not enough history yet — check back next month.</p>
              )}
            </section>
            <section className="exec-panel">
              <h4>Risk heatmap</h4>
              {heatmapEmpty ? (
                <p className="exec-empty">No risk findings — connect an integration to populate this.</p>
              ) : (
                <Heatmap
                  grid={data.riskHeatmap}
                  xLabels={data.riskHeatmapAxes.impact}
                  yLabels={data.riskHeatmapAxes.likelihood}
                />
              )}
            </section>
          </div>

          {/* Control status + evidence */}
          <div className="exec-row-2">
            <section className="exec-panel">
              <h4>Control status</h4>
              <div className="exec-tiles">
                <div className="exec-tile exec-tone-good"><span>{cs.compliant}</span><i>Compliant</i></div>
                <div className="exec-tile exec-tone-warn"><span>{cs.partial}</span><i>Partially compliant</i></div>
                <div className="exec-tile exec-tone-bad"><span>{cs.nonCompliant}</span><i>Non-compliant</i></div>
                <div className="exec-tile exec-tone-neutral"><span>{cs.notAssessed}</span><i>Not approved</i></div>
              </div>
            </section>
            <section className="exec-panel">
              <h4>Evidence status</h4>
              <div className="exec-evidence-row">
                <Gauge value={collectedPct} size={112} stroke={10} caption="Collected" color="var(--green)" />
                <ul className="exec-legend">
                  <li><span className="exec-dot exec-tone-good" />Collected<b>{ev.collected}</b></li>
                  <li><span className="exec-dot exec-tone-warn" />Pending<b>{ev.pending}</b></li>
                  <li><span className="exec-dot exec-tone-bad" />Overdue<b>{ev.overdue}</b></li>
                </ul>
              </div>
            </section>
          </div>

          {/* Ownership */}
          <section className="exec-panel">
            <h4>Readiness by control owner</h4>
            {data.departments.length === 0 ? (
              <p className="exec-empty">Assign owners to controls to see this breakdown.</p>
            ) : (
              <table className="exec-table">
                <thead>
                  <tr><th>Owner</th><th>Controls</th><th>Approved</th><th>Readiness</th></tr>
                </thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={d.name}>
                      <td>{d.name}</td>
                      <td>{d.controls}</td>
                      <td className="exec-muted">{d.assessed ?? 0}</td>
                      <td>
                        <span className="exec-meter-cell">
                          <Meter value={d.readiness} color="var(--teal)" />
                          <i>{d.assessed ? `${d.readiness}%` : "—"}</i>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Top risks */}
          <section className="exec-panel">
            <h4>Top risks</h4>
            {data.topRisks.length === 0 ? (
              <p className="exec-empty">No open risks.</p>
            ) : (
              <ul className="exec-risk-list">
                {data.topRisks.map((r) => (
                  <li key={r.title}>
                    <span>{r.title}</span>
                    <span className={`exec-pill exec-sev-${r.severity}`}>{SEV_LABEL[r.severity] || r.severity}</span>
                    <b>{r.count}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
