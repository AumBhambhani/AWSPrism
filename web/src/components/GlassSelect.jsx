import React, { useState, useRef, useEffect, useMemo } from "react";

/**
 * GlassSelect — Ultra-Crisp Enterprise Glassmorphic Dropdown
 * Features:
 * - Real backdrop-filter glassmorphism with high contrast typography
 * - Scaled, high-legibility fonts (15px) with anti-aliasing & geometric precision
 * - Optional prominent year group divider headers
 * - Smooth hover pill transitions with Indigo checkmark badge
 */
export function GlassSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select...",
  icon,
  className = "",
  style = {},
  align = "right",
  maxHeight = 360,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Find active option label
  const activeOption = options.find((opt) => (typeof opt === "object" ? opt.value === value : opt === value));
  const displayLabel = activeOption
    ? (typeof activeOption === "object" ? activeOption.label : activeOption)
    : placeholder;

  return (
    <div
      ref={containerRef}
      className={`glass-select-wrap ${className}`}
      style={{
        position: "relative",
        display: "inline-block",
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
        ...style,
      }}
    >
      {/* ── Glassmorphic Trigger Button ── */}
      <button
        type="button"
        className={`glass-btn-trigger ${isOpen ? "glass-btn-active" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          width: style.width || "auto",
          background: "var(--dp-surface-gradient, var(--bg2, #EDF3FA))",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--dp-line, rgba(163, 178, 204, 0.6))",
          borderRadius: 12,
          color: "var(--dp-ink, var(--text, #1E293B))",
          fontFamily: "var(--dp-font-sans, var(--sans))",
          fontSize: 14.5,
          fontWeight: 600,
          padding: "9px 16px",
          cursor: "pointer",
          transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: isOpen
            ? "0 0 0 3px rgba(79, 70, 229, 0.25), 0 8px 24px -4px rgba(79, 70, 229, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.9)"
            : "var(--neu-raised-sm, 0 2px 8px -1px rgba(15, 23, 42, 0.06))",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, overflow: "hidden", textOverflow: "ellipsis" }}>
          {icon && <span style={{ display: "flex", alignItems: "center", color: "var(--accent, #4F46E5)", flexShrink: 0 }}>{icon}</span>}
          <span style={{ letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayLabel}</span>
        </span>

        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "var(--dp-quiet, var(--text3, #7E92AB))",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
            flexShrink: 0,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* ── High-Legibility Frosted Glass Popover Menu ── */}
      {isOpen && (
        <div
          className="glass-popup-menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            [align === "right" ? "right" : "left"]: 0,
            zIndex: 2000,
            minWidth: style.width === "100%" ? "100%" : 230,
            maxWidth: style.width === "100%" ? "100%" : 360,
            width: style.width === "100%" ? "100%" : "auto",
            maxHeight,
            overflowY: "auto",
            background: "var(--dp-surface-gradient, var(--bg2, #EDF3FA))",
            backdropFilter: "blur(24px) saturate(190%)",
            WebkitBackdropFilter: "blur(24px) saturate(190%)",
            border: "1px solid var(--dp-line, rgba(163, 178, 204, 0.7))",
            borderRadius: 14,
            boxShadow: "var(--dp-shadow, 0 20px 45px -6px rgba(15, 23, 42, 0.18))",
            padding: "8px 6px",
            animation: "glassPopIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
            transformOrigin: align === "right" ? "top right" : "top left",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {options.map((opt, i) => {
              const optVal = typeof opt === "object" ? opt.value : opt;
              const optLabel = typeof opt === "object" ? opt.label : opt;
              const isSelected = optVal === value;

              return (
                <button
                  key={optVal || i}
                  type="button"
                  className={`glass-item-row ${isSelected ? "glass-item-selected" : ""}`}
                  onClick={() => {
                    onChange(optVal);
                    setIsOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "9px 14px",
                    borderRadius: 10,
                    background: isSelected
                      ? "linear-gradient(135deg, rgba(79, 70, 229, 0.2) 0%, rgba(99, 102, 241, 0.1) 100%)"
                      : "transparent",
                    border: isSelected ? "1px solid rgba(79, 70, 229, 0.35)" : "1px solid transparent",
                    color: isSelected ? "var(--accent, #4F46E5)" : "var(--dp-ink, var(--text, #1E293B))",
                    fontFamily: "var(--dp-font-sans, var(--sans))",
                    fontSize: 14.5,
                    fontWeight: isSelected ? 700 : 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.14s ease",
                    boxShadow: isSelected
                      ? "0 4px 12px rgba(79, 70, 229, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.9)"
                      : "none",
                  }}
                >
                  <span style={{ letterSpacing: "-0.01em" }}>{optLabel}</span>
                  {isSelected && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--accent, #4F46E5)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ marginLeft: 8, flexShrink: 0 }}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default GlassSelect;
