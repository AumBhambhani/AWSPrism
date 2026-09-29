export function BarChart({ data, valueKey, labelKey, color = "var(--accent)", maxValue }) {
  const max = maxValue || Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="chart-bar-list">
      {data.map((d, i) => {
        const pct = Math.round((d[valueKey] / max) * 100);
        return (
          <div key={i} className="chart-bar-row">
            <div className="chart-bar-label">{d[labelKey]}</div>
            <div className="chart-bar-track">
              <div className="chart-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
            <div className="chart-bar-val">{d[valueKey]}</div>
          </div>
        );
      })}
    </div>
  );
}

export function StackedBarChart({ data }) {
  return (
    <div className="chart-bar-list">
      {data.map((d, i) => {
        const total = d.total || 1;
        const finPct = Math.round((d.finished / total) * 100);
        const inPct = Math.round(((d.assessed - d.finished) / total) * 100);
        return (
          <div key={i} className="chart-bar-row">
            <div className="chart-bar-label">{d.label}</div>
            <div className="chart-bar-track" style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${finPct}%`, background: "var(--green)", borderRadius: "3px 0 0 3px" }} />
              <div style={{ position: "absolute", left: `${finPct}%`, top: 0, height: "100%", width: `${inPct}%`, background: "var(--amber)" }} />
            </div>
            <div className="chart-bar-val">{d.finished}/{d.total}</div>
          </div>
        );
      })}
    </div>
  );
}

export function DonutChart({ segments, size = 130, centerValue, centerCaption = "total", vertical = false }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const midValue = centerValue != null ? centerValue : total;
  const sw = Math.max(8, Math.round(size * 0.11));
  const r = size / 2 - sw / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const valSize = Math.max(18, Math.round(size * 0.24));
  const capSize = Math.max(10, Math.round(size * 0.085));
  let offset = 0;
  const arcs = segments.map(seg => {
    const dash = (seg.value / total) * circ;
    const arc = { ...seg, dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div
      className={`chart-donut-wrap ${vertical ? "chart-donut-vertical" : ""}`}
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
        gap: vertical ? 16 : 20,
        width: "100%",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ flexShrink: 0, textRendering: "geometricPrecision", shapeRendering: "geometricPrecision" }}
      >
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--dp-surface-2, rgba(226, 232, 240, 0.8))" strokeWidth={sw} />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth={sw}
            strokeDasharray={`${arc.dash} ${circ - arc.dash}`}
            strokeDashoffset={-arc.offset + circ / 4}
            strokeLinecap="round"
          />
        ))}
        <text
          x={cx}
          y={cy}
          dy={centerCaption ? "-0.10em" : "0.34em"}
          textAnchor="middle"
          fontSize={valSize}
          fontWeight="700"
          fontFamily="var(--dp-font-mono, monospace)"
          fill="var(--dp-ink, #0F172A)"
          style={{ letterSpacing: "-0.03em" }}
        >
          {midValue}
        </text>
        {centerCaption && (
          <text
            x={cx}
            y={cy}
            dy="1.15em"
            textAnchor="middle"
            fontSize={capSize}
            fontWeight="700"
            fontFamily="var(--dp-font-sans, sans-serif)"
            fill="var(--dp-quiet, #64748B)"
            style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
          >
            {centerCaption}
          </text>
        )}
      </svg>
      <div
        className="chart-donut-legend"
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        {segments.map((seg, i) => (
          <div
            key={i}
            className="chart-legend-item"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              fontSize: 13.5,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="chart-legend-dot" style={{ background: seg.color, width: 8, height: 8, borderRadius: 999, flexShrink: 0 }} />
              <span className="chart-legend-label" style={{ color: "var(--dp-quiet, #475569)", fontWeight: 500, fontSize: 13.5 }}>{seg.label}</span>
            </span>
            <span className="chart-legend-val" style={{ color: "var(--dp-ink, #0F172A)", fontFamily: "var(--dp-font-mono, monospace)", fontWeight: 700, fontSize: 13.5 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Executive-dashboard primitives ──────────────────────────────────────────
// Flat, token-driven charts for the /executive view and the restyled /dashboard.

export function Gauge({ value = 0, size = 132, stroke = 12, color = "var(--teal)", caption }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (v / 100) * circ;
  return (
    <div className="exec-gauge" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${v}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dp-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="exec-gauge-value">
          {v}%
        </text>
        {caption && (
          <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="exec-gauge-caption">
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}

export function TrendLine({ data = [], width = 460, height = 170, color = "var(--teal)", pad = 16 }) {
  const pts = data
    .map((d, i) => ({ i, month: d.month, value: d.value }))
    .filter((d) => d.value != null);
  const hasLine = pts.length >= 2;
  const vals = pts.map((p) => p.value);
  const max = hasLine ? Math.max(...vals) : 100;
  const min = hasLine ? Math.min(...vals) : 0;
  const span = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);
  const xy = (d) => [
    pad + d.i * stepX,
    pad + (height - pad * 2) * (1 - (d.value - min) / span),
  ];

  // Break the polyline into contiguous segments across null gaps.
  const segments = [];
  let cur = [];
  let prevIdx = null;
  for (const p of pts) {
    if (prevIdx != null && p.i !== prevIdx + 1) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    cur.push(p);
    prevIdx = p.i;
  }
  if (cur.length) segments.push(cur);

  const labels = data.length
    ? [data[0], data[Math.floor((data.length - 1) / 2)], data[data.length - 1]].map((d) =>
        d.month?.slice(2)
      )
    : [];

  return (
    <div className="exec-trend">
      <svg className="exec-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Compliance trend">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={width - pad}
            y1={pad + (height - pad * 2) * f}
            y2={pad + (height - pad * 2) * f}
            className="exec-chart-grid"
          />
        ))}
        {hasLine &&
          segments.map((seg, si) => (
            <polyline
              key={si}
              points={seg.map((d) => xy(d).join(",")).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        {hasLine &&
          pts.map((d) => {
            const [x, y] = xy(d);
            return <circle key={d.i} cx={x} cy={y} r="2.5" fill={color} />;
          })}
      </svg>
      {labels.length > 0 && (
        <div className="exec-trend-axis">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const HEAT_RAMP = ["var(--green)", "var(--teal)", "var(--amber)", "var(--red)"];

export function Heatmap({ grid = [], xLabels = [], yLabels = [] }) {
  const max = Math.max(1, ...grid.flat());
  const shade = (n) => {
    if (n === 0) return "var(--dp-surface-2)";
    const idx = Math.min(HEAT_RAMP.length - 1, Math.ceil((n / max) * HEAT_RAMP.length) - 1);
    return HEAT_RAMP[Math.max(0, idx)];
  };
  return (
    <div className="exec-heatmap">
      <div className="exec-heatmap-ylabel">Likelihood</div>
      <div className="exec-heatmap-body">
        <div
          className="exec-heatmap-grid"
          style={{ gridTemplateColumns: `repeat(${xLabels.length || 1}, 1fr)` }}
        >
          {grid.flatMap((row, ri) =>
            row.map((n, ci) => (
              <span
                key={`${ri}-${ci}`}
                className="exec-heat-cell"
                style={{ background: shade(n) }}
                title={`${yLabels[ri] ?? ri} × ${xLabels[ci] ?? ci}: ${n}`}
              >
                {n > 0 ? n : ""}
              </span>
            ))
          )}
        </div>
        <div
          className="exec-heatmap-xaxis"
          style={{ gridTemplateColumns: `repeat(${xLabels.length || 1}, 1fr)` }}
        >
          {xLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <div className="exec-heatmap-xlabel">Impact</div>
      </div>
    </div>
  );
}

export function Meter({ value = 0, color = "var(--teal)" }) {
  return (
    <span className="exec-meter" aria-hidden="true">
      <span
        className="exec-meter-fill"
        style={{ width: `${Math.max(3, Math.min(100, value))}%`, background: color }}
      />
    </span>
  );
}

export { RingChart } from "./RingChart.jsx";
export { BKColumnChart } from "./BKColumnChart.jsx";


