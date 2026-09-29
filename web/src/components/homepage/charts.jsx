/*
 * Lightweight, dependency-free SVG chart primitives for the marketing homepage
 * mockups. All values are illustrative sample data — none of these hit an API.
 * Colours come from CSS custom properties so both themes stay coherent.
 */

export function Donut({
  value = 0,
  size = 132,
  stroke = 12,
  color = "var(--teal)",
  track = "var(--hp-mock-track)",
  caption,
  sub,
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(100, value)) / 100 * circ;

  return (
    <div className="hp-donut" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
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
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="hp-donut-value">
          {value}%
        </text>
        {caption && (
          <text x="50%" y="63%" textAnchor="middle" dominantBaseline="middle" className="hp-donut-caption">
            {caption}
          </text>
        )}
      </svg>
      {sub && <span className="hp-donut-sub">{sub}</span>}
    </div>
  );
}

function buildPath(data, w, h, pad) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = (w - pad * 2) / (data.length - 1);
  return data.map((d, i) => {
    const x = pad + i * step;
    const y = pad + (h - pad * 2) * (1 - (d - min) / span);
    return [x, y];
  });
}

export function AreaChart({ data = [], width = 320, height = 120, color = "var(--teal)", pad = 8 }) {
  const pts = buildPath(data, width, height, pad);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = [
    `M ${pts[0][0]},${height - pad}`,
    ...pts.map((p) => `L ${p[0]},${p[1]}`),
    `L ${pts[pts.length - 1][0]},${height - pad}`,
    "Z",
  ].join(" ");
  const gid = `hp-area-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg className="hp-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Trend">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={pad} x2={width - pad} y1={height * f} y2={height * f} className="hp-chart-grid" />
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function LineChart({ series = [], width = 520, height = 200, pad = 14 }) {
  return (
    <svg className="hp-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Compliance trend">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad} x2={width - pad} y1={pad + (height - pad * 2) * f} y2={pad + (height - pad * 2) * f} className="hp-chart-grid" />
      ))}
      {series.map((s, si) => {
        const pts = buildPath(s.data, width, height, pad);
        const line = pts.map((p) => p.join(",")).join(" ");
        return (
          <g key={si}>
            <polyline points={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function BarMeter({ value = 0, color = "var(--teal)" }) {
  return (
    <span className="hp-barmeter" aria-hidden="true">
      <span className="hp-barmeter-fill" style={{ width: `${Math.max(4, Math.min(100, value))}%`, background: color }} />
    </span>
  );
}

const HEAT_COLORS = ["var(--green)", "var(--teal)", "var(--amber)", "var(--red)"];

export function Heatmap({ grid = [], xLabels = [], yLabels = [] }) {
  return (
    <div className="hp-heatmap">
      <div className="hp-heatmap-ylabel">Likelihood</div>
      <div className="hp-heatmap-body">
        <div className="hp-heatmap-grid" style={{ gridTemplateColumns: `repeat(${xLabels.length}, 1fr)` }}>
          {grid.flatMap((row, ri) =>
            row.map((sev, ci) => (
              <span
                key={`${ri}-${ci}`}
                className="hp-heat-cell"
                style={{ background: HEAT_COLORS[sev] }}
                title={`${yLabels[ri]} × ${xLabels[ci]}`}
              />
            ))
          )}
        </div>
        <div className="hp-heatmap-xaxis" style={{ gridTemplateColumns: `repeat(${xLabels.length}, 1fr)` }}>
          {xLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <div className="hp-heatmap-xlabel">Impact</div>
      </div>
    </div>
  );
}
