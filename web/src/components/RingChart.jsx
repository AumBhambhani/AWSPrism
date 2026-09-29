import React, { useState } from "react";

/**
 * RingChart — Composable Multi-Ring Progress Chart
 * Inspired by BK Lit UI Charts.
 * Features:
 * - Concentric progress arcs with animated spring/bezier entry
 * - Background tracks with subtle tint
 * - Interactive hover focus with glow & dimming
 * - Dynamic center readout (shows total or hovered segment)
 * - Synchronized interactive legend with progress bars & badges
 */
export function RingChart({
  data = [],
  size = 148,
  strokeWidth = 7,
  ringGap = 4.5,
  baseInnerRadius,
  defaultCenterValue,
  defaultCenterLabel = "Assessed",
  showLegend = true,
  className = "",
  onItemClick,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const total = data.reduce((s, d) => s + (d.value || 0), 0);
  const maxVal = Math.max(...data.map(d => d.maxValue || d.value || 0), total, 1);

  const cx = size / 2;
  const cy = size / 2;

  // Calculate innermost radius so rings are centered inside viewBox
  const totalRingsWidth = data.length * strokeWidth + Math.max(0, data.length - 1) * ringGap;
  const outerMaxRadius = size / 2 - strokeWidth / 2 - 2;
  const computedInnerRadius = baseInnerRadius ?? Math.max(Math.round(size * 0.18), outerMaxRadius - totalRingsWidth + strokeWidth / 2);

  const activeItem = hoveredIndex !== null ? data[hoveredIndex] : null;
  const centerVal = activeItem ? activeItem.value : (defaultCenterValue !== undefined ? defaultCenterValue : total);
  const centerLabel = activeItem ? activeItem.label : defaultCenterLabel;
  const centerColor = activeItem ? activeItem.color : "var(--dp-ink)";

  return (
    <div
      className={`ring-chart-wrap ${className}`}
      style={{
        display: showLegend ? "flex" : "inline-flex",
        alignItems: "center",
        justifyContent: showLegend ? "flex-start" : "center",
        gap: showLegend ? (size < 130 ? 16 : 24) : 0,
        width: showLegend ? "100%" : "auto",
      }}
    >
      {/* Ring Canvas */}
      <div className="ring-chart-canvas" style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ overflow: "visible", textRendering: "geometricPrecision", shapeRendering: "geometricPrecision" }}
        >
          <defs>
            <filter id="ring-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {data.map((item, index) => {
            // Outermost ring corresponds to index 0, innermost to index (length - 1)
            const r = computedInnerRadius + (data.length - 1 - index) * (strokeWidth + ringGap);
            const circ = 2 * Math.PI * r;
            const itemMax = item.maxValue || total || 1;
            const pct = Math.min(1, Math.max(0, item.value / (itemMax > 0 ? itemMax : 1)));
            const dash = pct * circ;
            const isHovered = hoveredIndex === index;
            const isDimmed = hoveredIndex !== null && !isHovered;

            return (
              <g
                key={item.label || index}
                className="ring-group"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onItemClick && onItemClick(item, index)}
                style={{ cursor: "pointer", transition: "all 0.25s ease" }}
              >
                {/* Background Track */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={item.color || "var(--dp-line)"}
                  strokeWidth={isHovered ? strokeWidth + 1.5 : strokeWidth}
                  strokeOpacity={isDimmed ? 0.08 : 0.16}
                  style={{ transition: "stroke-width 0.2s, stroke-opacity 0.2s" }}
                />

                {/* Progress Arc */}
                {item.value > 0 && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={item.color || "var(--dp-accent)"}
                    strokeWidth={isHovered ? strokeWidth + 2 : strokeWidth}
                    strokeDasharray={`${dash} ${circ - dash}`}
                    strokeDashoffset={circ / 4}
                    strokeLinecap="round"
                    filter={isHovered ? "url(#ring-glow)" : undefined}
                    opacity={isDimmed ? 0.3 : 1}
                    style={{
                      transformOrigin: `${cx}px ${cy}px`,
                      transition: "stroke-dasharray 0.7s cubic-bezier(0.16, 1, 0.3, 1), stroke-width 0.2s, opacity 0.2s, filter 0.2s",
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Center Content Readout */}
        <div
          className="ring-center-content"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            textAlign: "center",
            padding: 4,
          }}
        >
          <span
            className="ring-center-val"
            style={{
              fontFamily: "var(--dp-font-mono, monospace)",
              fontSize: size < 110 ? 16 : size > 160 ? 24 : 20,
              fontWeight: 700,
              color: centerColor,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              transition: "color 0.2s ease",
            }}
          >
            {centerVal}
          </span>
          <span
            className="ring-center-label"
            style={{
              fontFamily: "var(--dp-font-sans, sans-serif)",
              fontSize: size < 110 ? 8 : size > 160 ? 11 : 9.5,
              fontWeight: 600,
              color: "var(--dp-quiet)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginTop: 4,
              maxWidth: size * 0.55,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              transition: "color 0.2s ease",
            }}
          >
            {centerLabel}
          </span>
        </div>
      </div>

      {/* Synchronized Legend */}
      {showLegend && (
        <div className="ring-legend-list" style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1, minWidth: 0 }}>
          {data.map((item, index) => {
            const isHovered = hoveredIndex === index;
            const isDimmed = hoveredIndex !== null && !isHovered;

            return (
              <div
                key={item.label || index}
                className={`ring-legend-item ${isHovered ? "ring-legend-active" : ""}`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onItemClick && onItemClick(item, index)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 14.5,
                  cursor: "pointer",
                  padding: "3px 6px",
                  borderRadius: 6,
                  background: isHovered ? "var(--dp-surface-2)" : "transparent",
                  opacity: isDimmed ? 0.45 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                {/* Status Dot / Ring Pill */}
                <span
                  style={{
                    width: 9.5,
                    height: 9.5,
                    borderRadius: 999,
                    background: item.color || "var(--dp-accent)",
                    boxShadow: isHovered ? `0 0 6px ${item.color}` : "none",
                    flexShrink: 0,
                    transition: "box-shadow 0.2s",
                  }}
                />

                {/* Label */}
                <span
                  style={{
                    color: isHovered ? "var(--dp-accent)" : "var(--dp-ink)",
                    fontFamily: "var(--dp-font-sans, sans-serif)",
                    fontWeight: 600,
                    fontSize: 14.5,
                    letterSpacing: "-0.01em",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "color 0.15s",
                  }}
                >
                  {item.label}
                </span>

                {/* Numeric Value */}
                <span
                  style={{
                    color: "var(--dp-ink)",
                    fontFamily: "var(--dp-font-mono, monospace)",
                    fontWeight: 700,
                    fontSize: 14.5,
                    minWidth: 24,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.value}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RingChart;
