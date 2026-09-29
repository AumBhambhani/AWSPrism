// Never echo internal error text for server-side failures: fs/db/library errors
// carry absolute paths, SQL and stack details. Client errors (4xx) are
// deliberately authored messages and pass through.
// Postgres rejecting a client value (not a number, out of int range, not a real date)
// is the client's error, not ours: 400 with a generic message instead of a 500
// (closure review 7B — many routes pass ids/dates straight through to SQL).
const PG_INVALID_INPUT = new Set([
  "22P02", // invalid_text_representation (e.g. "abc" as an int)
  "22003", // numeric_value_out_of_range (e.g. 99999999999 as int4)
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow (e.g. 2026-02-30, year 0)
  "22023", // invalid_parameter_value
]);

export const errorHandler = (err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (typeof err?.code === "string" && PG_INVALID_INPUT.has(err.code) && err.severity) {
    return res.status(400).json({ error: "Invalid input" });
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = status >= 500 ? "Internal server error" : (err.message || "Request failed");
  res.status(status).json({ error: message });
};
