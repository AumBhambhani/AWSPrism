import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";
import { inScope } from "../utils/departmentScope.js";

// Soft department scoping for a list page. Scoped users (company has departments,
// user is not "All departments") default to "mine" and can flip to "all"; the
// choice is remembered per page. Everyone else always sees everything.
export function useDepartmentScope(token, pageKey) {
  const storageKey = `prism_dept_scope_${pageKey}`;
  const [me, setMe] = useState(null);
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/departments/me", { token })
      .then((data) => { if (!cancelled) setMe(data); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, [token]);

  const scoped = !!(me && me.enabled && !me.all);
  const effectiveMode = scoped ? (mode === "all" ? "all" : "mine") : "all";

  const setMode = (next) => {
    setModeState(next);
    try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable */ }
  };

  return {
    me,
    scoped,
    mode: effectiveMode,
    setMode,
    isInScope: (departments) => inScope(departments, me),
    matches: (departments) => effectiveMode === "all" || inScope(departments, me),
  };
}
