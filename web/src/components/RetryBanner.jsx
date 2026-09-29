import { useEffect, useState } from "react";
import { getCooldownInfo } from "../api/client.js";

/**
 * RetryBanner — shows timeout/retry state and cooldown countdown.
 * 
 * Props:
 *   error      - the error object from a failed request
 *   onRetry    - callback to retry the failed request
 *   onDismiss  - callback to dismiss the banner
 */
export default function RetryBanner({ error, onRetry, onDismiss }) {
  const [cooldown, setCooldown] = useState(() => getCooldownInfo());
  const [remainingStr, setRemainingStr] = useState("");

  // Refresh cooldown state every second
  useEffect(() => {
    if (!cooldown.active && (!error || error.code !== "COOLDOWN")) return;

    const interval = setInterval(() => {
      const info = getCooldownInfo();
      setCooldown(info);
      if (info.active) {
        const mins = Math.floor(info.remainingMs / 60000);
        const secs = Math.floor((info.remainingMs % 60000) / 1000);
        setRemainingStr(`${mins}m ${secs}s`);
      } else {
        setRemainingStr("");
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown.active, error]);

  // Listen for cooldown activation events
  useEffect(() => {
    const handler = (e) => setCooldown({ active: true, remainingMs: 30 * 60 * 1000, reason: e.detail.reason });
    const clearHandler = () => setCooldown({ active: false, remainingMs: 0, reason: null });
    window.addEventListener("api:cooldown-activated", handler);
    window.addEventListener("api:cooldown-cleared", clearHandler);
    return () => {
      window.removeEventListener("api:cooldown-activated", handler);
      window.removeEventListener("api:cooldown-cleared", clearHandler);
    };
  }, []);

  if (!error && !cooldown.active) return null;

  const isTimeout = error?.code === "TIMEOUT";
  const isQueueFull = error?.code === "QUEUE_FULL";
  const isCooldown = error?.code === "COOLDOWN" || cooldown.active;
  const canRetry = error?.canRetry && !isCooldown;

  return (
    <div className="retry-banner" role="alert" aria-live="assertive">
      <div className="retry-banner-icon">
        {isCooldown ? "⏸" : isQueueFull ? "⏳" : "⚠️"}
      </div>
      <div className="retry-banner-content">
        <div className="retry-banner-title">
          {isCooldown
            ? "Cooldown Active"
            : isQueueFull
            ? "Too Many Requests"
            : isTimeout
            ? "Request Timed Out"
            : "Request Failed"}
        </div>
        <div className="retry-banner-message">
          {isCooldown ? (
            <>Too many failed attempts. Requests paused for <strong>{remainingStr || "30m"}</strong>.</>
          ) : isQueueFull ? (
            "The request queue is full. Please wait for current requests to complete."
          ) : isTimeout ? (
            <>
              The server took too long to respond.
              {error.retryCount && ` (Attempt ${error.retryCount} of ${error.maxRetries})`}
            </>
          ) : (
            error?.message || "Something went wrong."
          )}
        </div>
      </div>
      <div className="retry-banner-actions">
        {canRetry && onRetry && (
          <button className="retry-btn" onClick={onRetry}>
            ↻ Retry
          </button>
        )}
        {onDismiss && !isCooldown && (
          <button className="retry-btn retry-btn-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
