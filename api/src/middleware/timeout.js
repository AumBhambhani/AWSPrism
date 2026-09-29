/**
 * Request timeout middleware — fail fast if a request takes too long.
 * 
 * Returns 408 Request Timeout if the handler doesn't respond
 * within the configured duration.
 */
export function requestTimeout(ms = 30000) {
  return (req, res, next) => {
    // Set the server-side timeout
    req.setTimeout(ms);
    res.setTimeout(ms);

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: "Request timed out. The server took too long to process your request.",
          code: "REQUEST_TIMEOUT",
        });
      }
    }, ms);

    // Clear the timer when the response finishes
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    next();
  };
}

/**
 * Route-specific timeout for long-running operations (uploads, AI analysis, etc.)
 */
export function longRequestTimeout(ms = 120000) {
  return requestTimeout(ms);
}
