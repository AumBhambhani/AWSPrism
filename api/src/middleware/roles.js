export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
};

/**
 * Allows AUDITOR read-only access alongside the supplied roles.
 * Use on GET routes that auditors are permitted to read.
 */
export const requireReadOnly = (allowedRoles) => {
  return (req, res, next) => {
    const permitted = [...allowedRoles, "AUDITOR"];
    if (!req.user || !permitted.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
};

/**
 * Restricts access to SUPERADMIN role only.
 * Use on platform-level management routes.
 */
export const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};
