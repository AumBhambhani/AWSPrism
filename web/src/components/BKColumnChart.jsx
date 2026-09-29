import React, { useState, useRef, useEffect } from "react";

/**
 * Extracts a clean short category code and title from a module label string.
 * Examples:
 * - "D10 - Audit & Evidence Readiness" -> { code: "D10", name: "Audit & Evidence Readiness" }
 * - "G - Governance & Accountability"   -> { code: "G",   name: "Governance & Accountability" }
 * - "A2 - Assurance & Evidence"        -> { code: "A2",  name: "Assurance & Evidence" }
 * - "Operational Excellence — Org"     -> { code: "OPS", name: "Organization" }
 */
function extractModuleLabel(rawLabel, rawName) {
  const s = (rawLabel || rawName || "").trim();
  if (!s) return { code: "", fullTitle: "" };

  const fullTitle = rawName || rawLabel || s;

  // Pattern: "D10 - Title", "G - Title", "A2 - Title", "CC1.1: Title", "SEC-01 - Title"
  const match = s.match(/^([A-Za-z0-9_.]+(?:\s*[-–—:]\s*[0-9]+)?)\s*[-–—:]\s*(.+)$/);
  if (match) {
    const code = match[1].trim();
    const rest = match[2].trim();
    if (code.length <= 8) {
      return { code, title: rest, fullTitle };
    }
  }

  // Pattern: "Operational Excellence — Prepare"
  if (s.includes("—") || s.includes("–") || s.includes("-")) {
    const parts = s.split(/[\s–—-]+/).filter(Boolean);
    if (parts.length >= 2) {
      const code = parts[0].length <= 5 ? parts[0] : parts[0].slice(0, 3).toUpperCase();
      const rest = parts.slice(1).join(" ");
      return { code, title: rest, fullTitle };
    }
  }

  // Single word or short label
  if (s.length <= 6) {
    return { code: s, title: s, fullTitle };
  }

  // Default: first word or truncated
  const firstWord = s.split(/\s+/)[0];
  const code = firstWord.length <= 6 ? firstWord : s.slice(0, 5) + "…";
  return { code, title: s, fullTitle };
}

/**
 * BKColumnChart — Intelligent Responsive Column Chart
 * 
 * Dynamically scales and optimizes layout for:
 * - Small datasets (1–10 items): Wider pillars (36–48px), bold clean category codes, spacious styling
 * - Medium datasets (11–24 items): Medium pillars (20–32px), clean centered/angled codes
 * - Large datasets (25–50+ items): High-density pillars (6–18px), -45° angled codes with intelligent striding
 */
export function BKColumnChart({
  data = [],
  height,
  className = "",
  valueKey,
  primaryColor = "var(--green, #10B981)",
  secondaryColor = "var(--amber, #F59E0B)",
  valueLabel = "Signed Off",
  onBarClick,
}) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const wrapRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width || el.clientWidth || 600);
      const h = Math.round(rect.height || el.clientHeight || height || 200);
      setDimensions((prev) => (prev.width !== w || prev.height !== h ? { width: w, height: h } : prev));
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  if (!data || data.length === 0) {
    return <p className="dash-empty">No data available.</p>;
  }

  const count = data.length;
  const w = dimensions.width || 600;
  const h = dimensions.height || height || 200;

  const paddingLeft = 38;
  const paddingRight = 16;
  const paddingTop = 14;

  const availableWidth = Math.max(40, w - paddingLeft - paddingRight);
  const slotWidth = availableWidth / count;

  // Density states:
  // - spacious: count <= 8 or slotWidth >= 85px (show code or short code + title)
  // - medium: count 9..20 and slotWidth 44..85px (show horizontal bold code)
  // - dense: slotWidth < 44px (show -45° angled code)
  const isSpacious = slotWidth >= 85 && count <= 8;
  const isDense = slotWidth < 44;
  const isVeryDense = slotWidth < 20;

  // Generous bottom padding for angled labels so they never overflow the card bottom
  const paddingBottom = isDense ? 54 : 34;

  const chartHeight = Math.max(40, h - paddingTop - paddingBottom);

  // Dynamic bar width scaling:
  // For small datasets: scale up to 48px wide for a rich, modern look
  // For large datasets: scale down to fit comfortably in slot
  let barWidth;
  if (count <= 6) {
    barWidth = Math.min(48, Math.max(28, slotWidth * 0.42));
  } else if (count <= 12) {
    barWidth = Math.min(40, Math.max(20, slotWidth * 0.52));
  } else if (count <= 25) {
    barWidth = Math.min(28, Math.max(12, slotWidth * 0.62));
  } else {
    barWidth = Math.min(20, Math.max(3.5, slotWidth * 0.72));
  }
  const cornerRadius = Math.min(barWidth / 2, 6);

  // Stride label display when slots are narrow to avoid visual collision, while hover always reveals that item's label
  const labelStride = slotWidth < 15 ? Math.ceil(24 / slotWidth) : (slotWidth < 26 ? 2 : 1);

  return (
    <div
      ref={wrapRef}
      className={`bk-column-chart-wrap ${className}`}
      style={{
        position: "relative",
        width: "100%",
        height: height ? `${height}px` : "100%",
        minHeight: 120,
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "visible",
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          overflow: "visible",
        }}
      >
        <defs>
          <filter id="bk-bar-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Horizontal Grid Lines ── */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = paddingTop + chartHeight * (1 - pct);
          return (
            <g key={pct}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={w - paddingRight}
                y2={y}
                stroke="var(--dp-line, rgba(226, 232, 240, 0.8))"
                strokeDasharray={pct === 0 || pct === 1 ? "none" : "4 4"}
                strokeWidth={pct === 0 ? "1.5" : "1"}
                strokeOpacity={pct === 0 ? 0.8 : 0.45}
              />
              <text
                x={paddingLeft - 6}
                y={y + 3.5}
                textAnchor="end"
                fontFamily="var(--dp-font-mono, monospace)"
                fontSize="10.5"
                fontWeight="600"
                fill="var(--dp-quiet, #94A3B8)"
              >
                {Math.round(pct * 100)}%
              </text>
            </g>
          );
        })}

        {/* ── Columns ── */}
        {data.map((item, idx) => {
          const total = item.total || 1;
          const isSingleMetric = valueKey != null || item.covered !== undefined;
          
          let finCount = 0;
          let inProgressCount = 0;

          if (isSingleMetric) {
            finCount = valueKey ? (item[valueKey] || 0) : (item.covered || item.value || 0);
          } else {
            finCount = item.finished || 0;
            const assessedCount = item.assessed || 0;
            inProgressCount = Math.max(0, assessedCount - finCount);
          }

          const finPct = Math.min(1, Math.max(0, finCount / total));
          const inProgPct = isSingleMetric ? 0 : Math.min(1 - finPct, Math.max(0, inProgressCount / total));

          const x = paddingLeft + idx * slotWidth + (slotWidth - barWidth) / 2;
          const centerX = x + barWidth / 2;

          const finHeight = finPct * chartHeight;
          const inProgHeight = inProgPct * chartHeight;
          const isHovered = hoveredIdx === idx;
          const isDimmed = hoveredIdx !== null && !isHovered;

          // Parse clean category code and title
          const { code, title } = extractModuleLabel(item.label || item.moduleId, item.name);

          // Determine label display string based on available slot width
          let displayLabel = code;
          if (isSpacious && title && title !== code) {
            const maxChars = Math.floor((slotWidth - 20) / 7.5);
            const shortTitle = title.length > maxChars ? `${title.slice(0, maxChars - 1)}…` : title;
            displayLabel = `${code} · ${shortTitle}`;
          }

          const shouldShowLabel = idx % labelStride === 0 || isHovered;

          return (
            <g
              key={item.label || item.moduleId || idx}
              className="bk-col-group"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onBarClick && onBarClick(item, idx)}
              style={{ cursor: "pointer", transition: "opacity 0.2s" }}
              opacity={isDimmed ? 0.35 : 1}
            >
              {/* Wide hover hit area */}
              <rect
                x={paddingLeft + idx * slotWidth}
                y={paddingTop}
                width={slotWidth}
                height={chartHeight + paddingBottom}
                fill="transparent"
              />

              {/* Background Pillar Track */}
              <rect
                x={x}
                y={paddingTop}
                width={barWidth}
                height={chartHeight}
                rx={cornerRadius}
                ry={cornerRadius}
                fill="var(--dp-surface-2, rgba(241, 245, 249, 0.75))"
                stroke="var(--dp-line, rgba(226, 232, 240, 0.7))"
                strokeWidth="1"
              />

              {/* In Progress Bar Segment (Amber) - only in stacked mode */}
              {!isSingleMetric && inProgHeight > 0 && (
                <rect
                  x={x}
                  y={paddingTop + chartHeight - finHeight - inProgHeight}
                  width={barWidth}
                  height={inProgHeight}
                  rx={finHeight === 0 ? cornerRadius : 0}
                  ry={finHeight === 0 ? cornerRadius : 0}
                  fill={secondaryColor}
                  style={{ transition: "height 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }}
                />
              )}

              {/* Primary Filled Bar Segment */}
              {finHeight > 0 && (
                <rect
                  x={x}
                  y={paddingTop + chartHeight - finHeight}
                  width={barWidth}
                  height={finHeight}
                  rx={cornerRadius}
                  ry={cornerRadius}
                  fill={primaryColor}
                  filter={isHovered ? "url(#bk-bar-glow)" : undefined}
                  style={{ transition: "height 0.4s cubic-bezier(0.16, 1, 0.3, 1)" }}
                />
              )}

              {/* X-Axis Category Label */}
              {shouldShowLabel && (
                isDense ? (
                  <text
                    transform={`translate(${centerX + 1}, ${paddingTop + chartHeight + 11}) rotate(-45)`}
                    textAnchor="end"
                    fontFamily="var(--dp-font-sans, sans-serif)"
                    fontSize={isVeryDense ? "9.5" : "10.5"}
                    fontWeight={isHovered ? "800" : "600"}
                    fill={isHovered ? "var(--dp-accent, #4F46E5)" : "var(--dp-ink, #0F172A)"}
                    style={{ transition: "fill 0.15s", pointerEvents: "none" }}
                  >
                    {displayLabel}
                  </text>
                ) : (
                  <text
                    x={centerX}
                    y={paddingTop + chartHeight + 16}
                    textAnchor="middle"
                    fontFamily="var(--dp-font-sans, sans-serif)"
                    fontSize={count <= 10 ? "12" : "11"}
                    fontWeight={isHovered ? "800" : "700"}
                    fill={isHovered ? "var(--dp-accent, #4F46E5)" : "var(--dp-ink, #0F172A)"}
                    style={{ transition: "fill 0.15s", pointerEvents: "none" }}
                  >
                    {displayLabel}
                  </text>
                )
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Interactive Floating Glassmorphic Tooltip ── */}
      {hoveredIdx !== null && data[hoveredIdx] && (() => {
        const colCenter = paddingLeft + hoveredIdx * slotWidth + slotWidth / 2;
        const tooltipHalfWidth = 110;
        const clampedX = Math.max(tooltipHalfWidth + 10, Math.min(w - tooltipHalfWidth - 10, colCenter));

        const item = data[hoveredIdx];
        const isSingleMetric = valueKey != null || item.covered !== undefined;
        const total = item.total || 1;
        const finCount = isSingleMetric
          ? (valueKey ? item[valueKey] : item.covered) || 0
          : item.finished || 0;
        const inProgCount = isSingleMetric ? 0 : Math.max(0, (item.assessed || 0) - (item.finished || 0));

        return (
          <div
            className="bk-tooltip"
            style={{
              position: "absolute",
              top: 6,
              left: `${clampedX}px`,
              transform: "translateX(-50%)",
              maxWidth: Math.max(220, Math.min(380, w - 16)),
              background: "rgba(15, 23, 42, 0.95)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              borderRadius: 10,
              padding: "9px 13px",
              color: "#FFFFFF",
              boxShadow: "0 12px 30px rgba(0, 0, 0, 0.38)",
              pointerEvents: "none",
              zIndex: 100,
              minWidth: 160,
              animation: "bkFadeIn 0.12s ease",
            }}
          >
            <div
              style={{
                fontFamily: "var(--dp-font-sans)",
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 5,
                lineHeight: 1.35,
                wordBreak: "break-word",
              }}
            >
              {item.name || item.label || item.moduleId}
            </div>

            {isSingleMetric ? (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94A3B8", gap: 12 }}>
                <span>{valueLabel}:</span>
                <span style={{ fontFamily: "var(--dp-font-mono)", color: "var(--dp-accent, #818CF8)", fontWeight: 700 }}>
                  {finCount} / {total} ({Math.round((finCount / total) * 100)}%)
                </span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94A3B8", gap: 12 }}>
                  <span>Signed Off:</span>
                  <span style={{ fontFamily: "var(--dp-font-mono)", color: "#10B981", fontWeight: 700 }}>
                    {finCount} / {total} ({Math.round((finCount / total) * 100)}%)
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94A3B8", gap: 12, marginTop: 3 }}>
                  <span>In Progress:</span>
                  <span style={{ fontFamily: "var(--dp-font-mono)", color: "#F59E0B", fontWeight: 700 }}>
                    {inProgCount}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default BKColumnChart;
