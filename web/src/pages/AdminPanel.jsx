import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import DependencySelect from "../components/DependencySelect.jsx";
import EvidenceStorageForm from "../components/EvidenceStorageForm.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";
import { TECH_CATEGORIES } from "../utils/techCategories.js";
import DepartmentsSection from "../components/admin/DepartmentsSection.jsx";
import DepartmentPicker from "../components/DepartmentPicker.jsx";

const ROLE_OPTIONS = ["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER"];
const RECURRENCE_OPTIONS = ["weekly", "fortnightly", "monthly", "quarterly", "semi-annual", "annual", "none"];
const PRIORITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

const PLAN_FEATURES = {
  starter: [
    "1 compliance framework",
    "Up to 5 collaboration users",
    "Framework-aligned controls & cross-framework mapping",
    "Policies, risk & evidence",
    "Remediation & management review",
    "AI-assisted GRC",
    "Standard integrations",
  ],
  custom: [
    "Multiple compliance frameworks",
    "Users based on your requirement",
    "Everything in Starter",
    "Multiple entities",
    "Prism Managed Infrastructure & AI (optional)",
    "Custom integrations (add-on)",
    "Professional services (optional)",
  ],
};
const PLAN_LABEL = { starter: "Starter", custom: "Custom" };
const PLAN_PRICE = { starter: "₹2.4L / year", custom: "Tailored to your scope" };

// Companies created before the two-plan model may still carry lite/pro/enterprise.
const normalizePlan = (p) => (p === "custom" || p === "pro" || p === "enterprise" ? "custom" : "starter");

function PlanCard({ planKey, highlighted }) {
  return (
    <div style={{
      flex: "1 1 200px", borderRadius: 10, padding: "16px 18px",
      border: highlighted ? "2px solid var(--accent)" : "1px solid var(--border)",
      background: highlighted ? "rgba(99,102,241,0.06)" : "var(--bg3)",
      position: "relative",
    }}>
      {highlighted && (
        <div style={{ position: "absolute", top: -10, left: 16, fontSize: 10, fontWeight: 700, background: "var(--accent)", color: "#fff", padding: "2px 10px", borderRadius: 20, letterSpacing: "0.06em" }}>
          RECOMMENDED
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{PLAN_LABEL[planKey]}</div>
      <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, marginBottom: 10 }}>{PLAN_PRICE[planKey]}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {PLAN_FEATURES[planKey].map(f => (
          <li key={f} style={{ fontSize: 12, color: "var(--text2)", padding: "2px 0", display: "flex", gap: 6 }}>
            <span style={{ color: "var(--green)", fontWeight: 700, flexShrink: 0 }}>✓</span> {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BillingSection({ company, user }) {
  const [upgradeRequested, setUpgradeRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const plan          = normalizePlan(company?.plan);
  const billingStatus = company?.billingStatus || "trial";
  const trialEndsAt   = company?.trialEndsAt;

  const daysLeft = trialEndsAt
    ? Math.ceil((new Date(trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const statusColor = {
    trial:   { bg: "rgba(245,158,11,0.1)",  color: "var(--amber)", border: "rgba(245,158,11,0.3)" },
    active:  { bg: "rgba(34,197,94,0.1)",   color: "var(--green)", border: "rgba(34,197,94,0.3)" },
    expired: { bg: "rgba(239,68,68,0.1)",   color: "var(--red)",   border: "rgba(239,68,68,0.3)" },
  }[billingStatus] || {};

  const nextPlans = plan === "starter" ? ["custom"] : [];

  const handleUpgradeRequest = async (targetPlan) => {
    setRequesting(true);
    setRequestError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:     company?.name || "Company Admin",
          email:    user?.email || ("admin@" + (company?.domain || "company.com")),
          company:  company?.name,
          message:  `Upgrade request from ${company?.name}.\nCurrent plan: ${PLAN_LABEL[plan]}\nRequested plan: ${PLAN_LABEL[targetPlan] || "upgrade"}\nContact email: ${user?.email || ""}`,
          _subject: `[Upgrade Request] ${company?.name} — ${PLAN_LABEL[plan]} → ${PLAN_LABEL[targetPlan] || "upgrade"}`,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setRequestError(d.error || "Could not send request. Email ab@neozaar.com directly.");
      } else {
        setUpgradeRequested(true);
      }
    } catch {
      setRequestError("Could not send request. Email ab@neozaar.com directly.");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <section className="admin-section">
      <h2>Billing &amp; Plan</h2>

      {/* Current plan summary */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ flex: "1 1 200px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Current plan</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{PLAN_LABEL[plan]}</div>
          <div style={{ fontSize: 12, color: "var(--text3)", margin: "-4px 0 8px" }}>{PLAN_PRICE[plan]}</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: statusColor.bg, color: statusColor.color, border: `1px solid ${statusColor.border}` }}>
            {billingStatus === "trial" ? "Free Trial" : billingStatus === "active" ? "Active" : "Expired"}
          </div>
        </div>

        <div style={{ flex: "1 1 200px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {billingStatus === "trial" ? "Trial ends" : billingStatus === "active" ? "Next renewal" : "Expired on"}
          </div>
          {trialEndsAt ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: daysLeft !== null && daysLeft <= 7 ? "var(--red)" : "var(--text)" }}>
                {new Date(trialEndsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </div>
              {billingStatus === "trial" && daysLeft !== null && (
                <div style={{ fontSize: 12, color: daysLeft <= 7 ? "var(--red)" : "var(--text3)", marginTop: 4 }}>
                  {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining` : "Trial ended"}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 16, color: "var(--text3)" }}>—</div>
          )}
        </div>

        <div style={{ flex: "1 1 200px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>What's included</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {PLAN_FEATURES[plan].map(f => (
              <li key={f} style={{ fontSize: 12, color: "var(--text2)", padding: "2px 0", display: "flex", gap: 6 }}>
                <span style={{ color: "var(--green)", fontWeight: 700, flexShrink: 0 }}>✓</span> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Upgrade section */}
      {nextPlans.length > 0 && (
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "20px" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Need more than Starter?</div>
          <p style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 16px" }}>
            Custom is built around your frameworks, users, entities, infrastructure and services. <a href="/pricing#calculator" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Estimate your plan</a>, then request it — our team will reach out within one business day.
          </p>

          {/* Next plan cards */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            {nextPlans.map((p, i) => <PlanCard key={p} planKey={p} highlighted={i === 0} />)}
          </div>

          {upgradeRequested ? (
            <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <span>✓</span> Request sent — we'll be in touch within one business day.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {nextPlans.map(p => (
                <button
                  key={p}
                  className="btn btn-primary"
                  onClick={() => handleUpgradeRequest(p)}
                  disabled={requesting}
                  style={{ fontSize: 13, padding: "8px 20px" }}
                >
                  {requesting ? "Sending…" : `Request ${PLAN_LABEL[p]}`}
                </button>
              ))}
              {requestError && <span style={{ fontSize: 12, color: "var(--red)" }}>{requestError}</span>}
            </div>
          )}
        </div>
      )}

      {plan === "custom" && (
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 8 }}>
          You're on the Custom plan. Contact <a href="mailto:ab@neozaar.com" style={{ color: "var(--accent)" }}>ab@neozaar.com</a> for any billing queries.
        </p>
      )}
    </section>
  );
}

function DangerZoneSection({ token, company, onDeleted }) {
  const [password, setPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const companyName = company?.name || "";
  const canDelete = password.length > 0 && confirmName.trim() === companyName && !deleting;

  const handleDelete = async () => {
    if (!canDelete) return;
    const reallySure = window.confirm(
      `This permanently deletes "${companyName}" — every user, assessment, evidence file, integration, and uploaded document. This cannot be undone. Continue?`
    );
    if (!reallySure) return;

    setDeleting(true);
    setError("");
    try {
      await apiFetch("/api/settings/company", {
        token,
        method: "DELETE",
        body: { password, companyName: confirmName.trim() },
      });
      onDeleted();
    } catch (err) {
      setError(err.message || "Could not delete company.");
      setDeleting(false);
    }
  };

  return (
    <section className="admin-section">
      <h2>Danger Zone</h2>
      <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>Delete company</div>
        <p style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 16px", lineHeight: 1.5, maxWidth: 480 }}>
          Permanently deletes <strong>{companyName}</strong> — every user, assessment, evidence file, integration, and uploaded document. This action cannot be undone.
        </p>

        <div className="form-group">
          <label htmlFor="dangerPassword">Your password</label>
          <input
            id="dangerPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </div>

        <div className="form-group">
          <label htmlFor="dangerConfirmName">Type <strong>{companyName}</strong> to confirm</label>
          <input
            id="dangerConfirmName"
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={companyName}
            autoComplete="off"
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          className="btn btn-danger"
          onClick={handleDelete}
          disabled={!canDelete}
          style={{ marginTop: 4 }}
        >
          {deleting ? "Deleting…" : "Delete Company"}
        </button>
      </div>
    </section>
  );
}

export default function AdminPanel({ token, company, user, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("CONTRIBUTOR");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteDepts, setInviteDepts] = useState({ allDepartments: true, departmentIds: [] });
  const [departments, setDepartments] = useState([]);
  const [editingDepts, setEditingDepts] = useState(null); // { userId, value }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Reminders & Recurrence state
  const [reminderOffsets, setReminderOffsets] = useState([7, 14, 30]);
  const [newOffset, setNewOffset] = useState("");
  const [questions, setQuestions] = useState([]);
  const [modules, setModules] = useState([]);
  const [recurrenceEdits, setRecurrenceEdits] = useState({});

  // Question dependencies management state
  const [depsManaging, setDepsManaging] = useState(null);
  const [depsCurrent, setDepsCurrent] = useState([]);
  const [depsEdited, setDepsEdited] = useState(null);
  const [depsLoading, setDepsLoading] = useState(false);
  const [depsError, setDepsError] = useState("");
  const [depsSaving, setDepsSaving] = useState(false);

  // Module dependencies management state
  const [modDepsManaging, setModDepsManaging] = useState(null);
  const [modDepsCurrent, setModDepsCurrent] = useState([]);
  const [modDepsEdited, setModDepsEdited] = useState(null);
  const [modDepsLoading, setModDepsLoading] = useState(false);
  const [modDepsError, setModDepsError] = useState("");
  const [modDepsSaving, setModDepsSaving] = useState(false);

  // Tech stack state
  const [techStack, setTechStack] = useState({});
  const [techStackSaving, setTechStackSaving] = useState(false);
  const [techStackMsg, setTechStackMsg] = useState("");

  const [section, setSection] = useState("invite");
  const baseUrl = useMemo(() => window.location.origin, []);

  useEffect(() => {
    loadData();
  }, [token]);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [usersData, invitesData, settingsData, questionsData, modulesData, techStackData] = await Promise.all([
        apiFetch("/api/users", { token }),
        apiFetch("/api/users/invitations", { token }),
        apiFetch("/api/reminders/settings", { token }),
        apiFetch("/api/questions", { token }),
        apiFetch("/api/modules", { token }),
        apiFetch("/api/settings/tech-stack", { token }),
      ]);
      // Fetched after the batch above so the admin page's burst stays under the
      // client's concurrent-request cap.
      const departmentsData = await apiFetch("/api/departments", { token });
      setUsers(usersData);
      setDepartments(departmentsData || []);
      setInvitations(invitesData);
      setReminderOffsets(settingsData.defaultReminderOffsets || [7, 14, 30]);
      setQuestions(questionsData || []);
      setModules(modulesData || []);
      setTechStack(techStackData || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveTechStack = async () => {
    setTechStackSaving(true);
    setTechStackMsg("");
    try {
      await apiFetch("/api/settings/tech-stack", { token, method: "PUT", body: techStack });
      setTechStackMsg("Saved");
      setTimeout(() => setTechStackMsg(""), 2500);
    } catch (err) {
      setTechStackMsg(err.message || "Save failed");
    } finally {
      setTechStackSaving(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setError("");
    setInviteLink("");

    try {
      const result = await apiFetch("/api/users/invite", {
        token,
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, ...inviteDepts })
      });
      setInviteEmail("");
      setInviteRole("CONTRIBUTOR");
      setInviteDepts({ allDepartments: true, departmentIds: [] });
      // Build invite link from current origin — never rely on backend URL
      const invToken = result.invitation?.token || result.token || "";
      setInviteLink(invToken ? `${baseUrl}/accept-invite/${invToken}` : (result.inviteLink || ""));
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRoleChange = async (userId, role) => {
    try {
      const updated = await apiFetch(`/api/users/${userId}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ role })
      });
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    } catch (err) {
      setError(err.message);
    }
  };

  const reloadDepartments = async () => {
    const [departmentsData, questionsData, usersData] = await Promise.all([
      apiFetch("/api/departments", { token }),
      apiFetch("/api/questions", { token }),
      apiFetch("/api/users", { token }),
    ]);
    setDepartments(departmentsData || []);
    setQuestions(questionsData || []);
    setUsers(usersData || []);
  };

  const saveUserDepartments = async () => {
    if (!editingDepts) return;
    try {
      const updated = await apiFetch(`/api/users/${editingDepts.userId}`, {
        token,
        method: "PUT",
        body: JSON.stringify(editingDepts.value),
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditingDepts(null);
      setDepartments(await apiFetch("/api/departments", { token }));
    } catch (err) {
      setError(err.message);
    }
  };

  const deptSummary = (u) => {
    if (u.role === "ADMIN" || u.allDepartments !== false) return "All departments";
    const names = departments.filter((d) => (u.departmentIds || []).includes(d.id)).map((d) => d.name);
    return names.length ? names.join(", ") : "None";
  };

  const handleDeleteUser = async (userId) => {
    const confirmDelete = window.confirm("Remove this user from the company?");
    if (!confirmDelete) return;

    try {
      await apiFetch(`/api/users/${userId}`, { token, method: "DELETE" });
      setUsers((prev) => prev.filter((user) => user.id !== userId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCancelInvite = async (invitationId) => {
    try {
      await apiFetch(`/api/users/invitations/${invitationId}`, { token, method: "DELETE" });
      setInvitations((prev) => prev.filter((invite) => invite.id !== invitationId));
    } catch (err) {
      setError(err.message);
    }
  };

  const copyInviteLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      setInviteLink(link);
    } catch (err) {
      setError("Unable to copy. Please copy the link manually.");
    }
  };

  // Reminder offset handlers
  const handleAddOffset = () => {
    const days = parseInt(newOffset, 10);
    if (!days || days < 1) return;
    if (reminderOffsets.includes(days)) return;
    const updated = [...reminderOffsets, days].sort((a, b) => a - b);
    setReminderOffsets(updated);
    setNewOffset("");
    saveReminderOffsets(updated);
  };

  const handleRemoveOffset = (days) => {
    const updated = reminderOffsets.filter(d => d !== days);
    setReminderOffsets(updated);
    saveReminderOffsets(updated);
  };

  const saveReminderOffsets = async (offsets) => {
    try {
      await apiFetch("/api/reminders/settings", {
        token,
        method: "PUT",
        body: JSON.stringify({ defaultReminderOffsets: offsets })
      });
    } catch (err) {
      setError(err.message);
    }
  };

  // Dependency handlers
  const openDepsManager = async (questId) => {
    setDepsManaging(questId);
    setDepsEdited(null);
    setDepsError("");
    setDepsLoading(true);
    try {
      const data = await apiFetch(`/api/questions/${questId}/dependencies`, { token });
      setDepsCurrent((data || []).map(d => d.questId));
    } catch (err) {
      setDepsError(err.message);
    } finally {
      setDepsLoading(false);
    }
  };

  const saveDeps = async () => {
    if (!depsManaging || depsEdited === null) return;
    setDepsSaving(true);
    setDepsError("");
    try {
      await apiFetch(`/api/questions/${depsManaging}/dependencies`, {
        token,
        method: "PUT",
        body: JSON.stringify({ dependsOn: depsEdited }),
      });
      setDepsManaging(null);
      setDepsEdited(null);
      setDepsCurrent([]);
      const questionsData = await apiFetch("/api/questions", { token });
      setQuestions(questionsData || []);
    } catch (err) {
      setDepsError(err.message);
    } finally {
      setDepsSaving(false);
    }
  };

  // Module dependency handlers
  const openModDepsManager = async (moduleId) => {
    setModDepsManaging(moduleId);
    setModDepsEdited(null);
    setModDepsError("");
    setModDepsLoading(true);
    try {
      const data = await apiFetch(`/api/modules/${encodeURIComponent(moduleId)}/dependencies`, { token });
      setModDepsCurrent((data || []).map(d => d.module_id));
    } catch (err) {
      setModDepsError(err.message);
    } finally {
      setModDepsLoading(false);
    }
  };

  const saveModDeps = async () => {
    if (!modDepsManaging || modDepsEdited === null) return;
    setModDepsSaving(true);
    setModDepsError("");
    try {
      await apiFetch(`/api/modules/${encodeURIComponent(modDepsManaging)}/dependencies`, {
        token,
        method: "PUT",
        body: { dependsOn: modDepsEdited },
      });
      setModDepsManaging(null);
      setModDepsEdited(null);
      setModDepsCurrent([]);
      const modulesData = await apiFetch("/api/modules", { token });
      setModules(modulesData || []);
    } catch (err) {
      setModDepsError(err.message);
    } finally {
      setModDepsSaving(false);
    }
  };

  // Recurrence handlers
  const handleRecurrenceChange = (questId, field, value) => {
    setRecurrenceEdits(prev => ({
      ...prev,
      [questId]: { ...(prev[questId] || {}), [field]: value }
    }));
  };

  const saveRecurrence = async (questId) => {
    const edits = recurrenceEdits[questId];
    if (!edits) return;
    try {
      if (edits.recurrenceInterval !== undefined || edits.nextDueDate !== undefined) {
        await apiFetch(`/api/questions/${questId}/recurrence`, {
          token,
          method: "PUT",
          body: JSON.stringify({
            recurrenceInterval: edits.recurrenceInterval,
            nextDueDate: edits.nextDueDate || null
          })
        });
      }
      if (edits.priority !== undefined || edits.dueDate !== undefined) {
        const body = {};
        if (edits.priority !== undefined) body.priority = edits.priority;
        if (edits.dueDate !== undefined) body.dueDate = edits.dueDate || null;
        await apiFetch(`/api/questions/${questId}`, {
          token,
          method: "PUT",
          body: JSON.stringify(body)
        });
      }
      setRecurrenceEdits(prev => {
        const copy = { ...prev };
        delete copy[questId];
        return copy;
      });
      const questionsData = await apiFetch("/api/questions", { token });
      setQuestions(questionsData || []);
    } catch (err) {
      setError(err.message);
    }
  };

  const VERIFIED_ONLY_SECTIONS = new Set(["reminders", "recurrence", "module-deps", "tech-stack", "storage"]);
  const NAV_ITEMS = [
    { key: "invite",      label: "Invite Member" },
    { key: "members",     label: "Team" },
    { key: "departments", label: "Departments" },
    { key: "reminders",   label: "Reminders" },
    { key: "recurrence",  label: "Recurrence" },
    { key: "module-deps", label: "Module Order" },
    { key: "tech-stack",  label: "Tech Stack" },
    { key: "storage",     label: "Evidence Storage" },
    { key: "billing",     label: "Billing & Plan" },
    { key: "danger",      label: "Danger Zone" },
  ].filter(item => isVerified !== false || !VERIFIED_ONLY_SECTIONS.has(item.key));

  const handleCompanyDeleted = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("company");
    localStorage.removeItem("branding");
    window.location.href = "/";
  };

  const navBtnStyle = (key) => ({
    display: "block", width: "100%", textAlign: "left",
    padding: "9px 14px", border: "none", borderRadius: 8,
    background: section === key ? "rgba(99,102,241,0.12)" : "transparent",
    color: section === key ? "var(--accent)" : "var(--text2)",
    fontWeight: section === key ? 600 : 400,
    cursor: "pointer", fontSize: 13, marginBottom: 2,
    transition: "background 0.15s, color 0.15s",
  });

  if (loading) {
    return (
      <div className="admin-container">
        <div className="admin-card">
          <p>Loading admin data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost" onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/dashboard")}>← Back</button>
            <UserMenu
              user={user}
              company={company}
              theme={theme}
              onThemeToggle={onThemeToggle}
              onLogout={onLogout}
              isVerified={isVerified}
            />
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>
          {/* Sidebar */}
          <nav style={{ width: 176, flexShrink: 0, borderRight: "1px solid var(--border2)", paddingRight: 16, marginRight: 28, paddingTop: 4 }}>
            {NAV_ITEMS.map(item => (
              <button key={item.key} style={navBtnStyle(item.key)} onClick={() => setSection(item.key)}>
                {item.label}
              </button>
            ))}
          </nav>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {section === "invite" && (
              <section className="admin-section">
                <h2>Invite a team member</h2>
                <form className="invite-form" onSubmit={handleInvite}>
                  <div className="form-group">
                    <label htmlFor="inviteEmail">Email</label>
                    <input
                      id="inviteEmail"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="inviteRole">Role</label>
                    <GlassSelect
                      value={inviteRole}
                      onChange={val => setInviteRole(val)}
                      options={ROLE_OPTIONS.map(r => ({ value: r, label: r }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary">Create invite</button>
                  {departments.length > 0 && inviteRole !== "ADMIN" && (
                    <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                      <label>Departments</label>
                      <DepartmentPicker departments={departments} value={inviteDepts} onChange={setInviteDepts} />
                    </div>
                  )}
                </form>
                {inviteLink && (
                  <div className="invite-link">
                    <span>Invite link</span>
                    <div className="invite-link-row">
                      <input type="text" readOnly value={inviteLink} />
                      <button className="btn btn-ghost" onClick={() => copyInviteLink(inviteLink)}>Copy</button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {section === "departments" && (
              <DepartmentsSection
                token={token}
                departments={departments}
                questions={questions}
                onChanged={reloadDepartments}
              />
            )}

            {section === "members" && (
              <>
                <section className="admin-section">
                  <h2>Team members</h2>
                  <div className="admin-table">
                    <div className={`admin-row admin-row-header${departments.length ? " admin-row-four" : ""}`}>
                      <span>Email</span>
                      <span>Role</span>
                      {departments.length > 0 && <span>Departments</span>}
                      <span>Actions</span>
                    </div>
                    {users.map((u) => {
                      const isSelf = user && u.id === user.id;
                      const isEditingDepts = editingDepts?.userId === u.id;
                      const leadWithNoDepts = u.role === "LEAD" && u.allDepartments === false && !(u.departmentIds || []).length;
                      return (
                        <div key={u.id} className={`admin-row${departments.length ? " admin-row-four" : ""}`}>
                          <span>{u.email}</span>
                          <span>
                            <GlassSelect
                              value={u.role}
                              onChange={val => handleRoleChange(u.id, val)}
                              options={[
                                ...ROLE_OPTIONS.map(role => ({ value: role, label: role })),
                                ...(u.role === "AUDITOR" ? [{ value: "AUDITOR", label: "AUDITOR" }] : [])
                              ]}
                              style={{ width: "100%", maxWidth: 160 }}
                            />
                          </span>
                          {departments.length > 0 && (
                            <span>
                              {isEditingDepts ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                  <DepartmentPicker
                                    compact
                                    departments={departments}
                                    value={editingDepts.value}
                                    onChange={(value) => setEditingDepts({ userId: u.id, value })}
                                  />
                                  <div style={{ display: "flex", gap: 6 }}>
                                    <button className="btn btn-primary" onClick={saveUserDepartments}>Save</button>
                                    <button className="btn btn-ghost" onClick={() => setEditingDepts(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 13 }}>{deptSummary(u)}</span>
                                    {u.role !== "ADMIN" && (
                                      <button
                                        className="btn btn-ghost"
                                        style={{ padding: "2px 8px", fontSize: 12 }}
                                        onClick={() => setEditingDepts({
                                          userId: u.id,
                                          value: { allDepartments: u.allDepartments !== false, departmentIds: u.departmentIds || [] },
                                        })}
                                      >
                                        Edit
                                      </button>
                                    )}
                                  </span>
                                  {leadWithNoDepts && (
                                    <span style={{ fontSize: 11, color: "var(--danger, #dc2626)" }}>
                                      Lead with no departments — can’t approve anything
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                          <span>
                            <button className="btn btn-ghost" onClick={() => handleDeleteUser(u.id)}>Remove</button>
                          </span>
                        </div>
                      );
                    })}
                    {users.length === 0 && (
                      <div className="admin-row admin-row-empty"><span>No users yet.</span></div>
                    )}
                  </div>
                </section>

                <section className="admin-section">
                  <h2>Pending invitations</h2>
                  <div className="admin-table">
                    <div className="admin-row admin-row-header admin-row-four">
                      <span>Email</span>
                      <span>Role</span>
                      <span>Invite link</span>
                      <span>Actions</span>
                    </div>
                    {invitations.map((invite) => {
                      const inviteUrl = `${baseUrl}/accept-invite/${invite.token}`;
                      return (
                        <div key={invite.id} className="admin-row admin-row-four">
                          <span>{invite.email}</span>
                          <span>{invite.role}</span>
                          <span className="invite-url">{inviteUrl}</span>
                          <span>
                            <button className="btn btn-ghost" onClick={() => copyInviteLink(inviteUrl)}>Copy</button>
                            <button className="btn btn-ghost" onClick={() => handleCancelInvite(invite.id)}>Cancel</button>
                          </span>
                        </div>
                      );
                    })}
                    {invitations.length === 0 && (
                      <div className="admin-row admin-row-empty"><span>No pending invitations.</span></div>
                    )}
                  </div>
                </section>
              </>
            )}

            {section === "reminders" && (
              <section className="admin-section">
                <h2>Reminder settings</h2>
                <p style={{ color: "var(--text2)", marginBottom: 12, fontSize: 13 }}>
                  Default reminder offsets (days before due date). These apply automatically when an action is created for Partially Implemented, Planned, or Not Implemented answers.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {reminderOffsets.map((days) => (
                    <span key={days} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, padding: "6px 12px", fontSize: 13 }}>
                      {days} day{days !== 1 ? "s" : ""} before
                      <button onClick={() => handleRemoveOffset(days)} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    min="1"
                    placeholder="Days"
                    value={newOffset}
                    onChange={(e) => setNewOffset(e.target.value)}
                    style={{ width: 80, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13 }}
                  />
                  <button className="btn btn-primary" onClick={handleAddOffset} style={{ padding: "8px 16px" }}>Add offset</button>
                </div>
              </section>
            )}

            {section === "recurrence" && (
              <section className="admin-section">
                <h2>Quest recurrence</h2>
                <p style={{ color: "var(--text2)", marginBottom: 12, fontSize: 13 }}>
                  Set how often each question should be reassessed and optionally a hard audit deadline.
                </p>
                <div className="admin-table">
                  <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr" }}>
                    <span>Question</span>
                    <span>Priority</span>
                    <span>Recurrence</span>
                    <span>Audit deadline</span>
                    <span>Actions</span>
                    <span>Deps</span>
                  </div>
                  {questions.map((q) => {
                    const edits = recurrenceEdits[q.questId] || {};
                    const priority = edits.priority !== undefined ? edits.priority : (q.priority || "Medium");
                    const interval = edits.recurrenceInterval !== undefined ? edits.recurrenceInterval : (q.recurrenceInterval || "monthly");
                    const hasChanges = edits.priority !== undefined || edits.recurrenceInterval !== undefined || edits.dueDate !== undefined;

                    return (
                      <div key={q.questId} className="admin-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr" }}>
                        <span style={{ fontSize: 12 }} title={q.baselineQuestion}>{q.questId} - {q.controlArea}</span>
                        <span>
                          <select
                            value={priority}
                            onChange={(e) => handleRecurrenceChange(q.questId, "priority", e.target.value)}
                            style={{ fontSize: 12, padding: "4px 6px", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 4 }}
                          >
                            {PRIORITY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </span>
                        <span>
                          <select
                            value={interval}
                            onChange={(e) => handleRecurrenceChange(q.questId, "recurrenceInterval", e.target.value)}
                            style={{ fontSize: 12, padding: "4px 6px", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 4 }}
                          >
                            {RECURRENCE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </span>
                        <span>
                          <input
                            type="date"
                            title="Hard deadline for compliance / audit purposes"
                            value={edits.dueDate !== undefined ? (edits.dueDate || "") : (q.dueDate ? q.dueDate.slice(0, 10) : "")}
                            onChange={(e) => handleRecurrenceChange(q.questId, "dueDate", e.target.value)}
                            style={{ fontSize: 12, padding: "4px 6px", background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 4 }}
                          />
                        </span>
                        <span>
                          {hasChanges && (
                            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => saveRecurrence(q.questId)}>Save</button>
                          )}
                        </span>
                        <span>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => openDepsManager(q.questId)}
                          >
                            {q.dependencyCount > 0 ? `${q.dependencyCount} dep${q.dependencyCount !== 1 ? "s" : ""}` : "Set deps"}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  {questions.length === 0 && (
                    <div className="admin-row admin-row-empty"><span>No questions loaded.</span></div>
                  )}
                </div>

                {/* Dependencies modal */}
                {depsManaging && (
                  <div
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={() => { setDepsManaging(null); setDepsEdited(null); setDepsError(""); }}
                  >
                    <div
                      style={{ background: "var(--bg2)", borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          Dependencies — <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{depsManaging}</span>
                        </div>
                        <button
                          style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}
                          onClick={() => { setDepsManaging(null); setDepsEdited(null); setDepsError(""); }}
                        >×</button>
                      </div>
                      <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12, marginTop: 0 }}>
                        This question will be blocked until all selected questions are answered.
                      </p>
                      {depsLoading ? (
                        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>Loading...</p>
                      ) : (
                        <>
                          <DependencySelect
                            allQuestions={questions}
                            value={depsEdited !== null ? depsEdited : depsCurrent}
                            onChange={val => setDepsEdited(val)}
                            selfQuestId={depsManaging}
                          />
                          {depsError && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 8, marginBottom: 0 }}>{depsError}</p>}
                          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 12 }}
                              onClick={() => { setDepsManaging(null); setDepsEdited(null); setDepsError(""); }}
                            >Cancel</button>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 12 }}
                              disabled={depsSaving || depsEdited === null}
                              onClick={saveDeps}
                            >
                              {depsSaving ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {section === "module-deps" && (
              <section>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Module Order &amp; Dependencies</h2>
                <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20 }}>
                  Lock a module behind one or more other modules. Users cannot answer questions in a locked module until all questions in its prerequisite modules are completed.
                </p>

                {modules.length === 0 && (
                  <p style={{ color: "var(--text3)" }}>No modules found for your company.</p>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {modules.map(m => {
                    const isManaging = modDepsManaging === m.moduleId;
                    const currentDeps = isManaging
                      ? (modDepsEdited !== null ? modDepsEdited : modDepsCurrent)
                      : (m.depModuleIds || []);
                    const otherModules = modules.filter(x => x.moduleId !== m.moduleId);

                    return (
                      <div key={m.moduleId} style={{
                        border: "1px solid var(--border)", borderRadius: 8,
                        background: "var(--bg3)", overflow: "hidden",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                          {m.blockedByDeps && <span title="Locked">🔒</span>}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent2)", fontWeight: 600 }}>{m.moduleId}</div>
                            <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 1 }}>{m.name}</div>
                          </div>
                          {currentDeps.length > 0 && !isManaging && (
                            <div style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>
                              requires: {currentDeps.join(", ")}
                            </div>
                          )}
                          <button
                            style={{ padding: "5px 12px", fontSize: 12, background: isManaging ? "var(--bg4)" : "var(--accent)", color: isManaging ? "var(--text2)" : "#fff", border: isManaging ? "1px solid var(--border)" : "none", borderRadius: 6, cursor: "pointer", flexShrink: 0 }}
                            onClick={() => {
                              if (isManaging) { setModDepsManaging(null); setModDepsEdited(null); setModDepsError(""); }
                              else openModDepsManager(m.moduleId);
                            }}
                          >{isManaging ? "Cancel" : "Set deps"}</button>
                        </div>

                        {isManaging && (
                          <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", background: "var(--bg4)" }}>
                            {modDepsLoading ? (
                              <p style={{ fontSize: 13, color: "var(--text3)" }}>Loading…</p>
                            ) : (
                              <>
                                <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 10px" }}>
                                  Select modules that must be 100% completed before <strong style={{ color: "var(--text)" }}>{m.moduleId}</strong> unlocks:
                                </p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                  {otherModules.map(dep => {
                                    const selected = currentDeps.includes(dep.moduleId);
                                    return (
                                      <button
                                        key={dep.moduleId}
                                        type="button"
                                        onClick={() => {
                                          const base = modDepsEdited !== null ? modDepsEdited : modDepsCurrent;
                                          setModDepsEdited(
                                            selected ? base.filter(id => id !== dep.moduleId) : [...base, dep.moduleId]
                                          );
                                        }}
                                        style={{
                                          padding: "4px 10px", fontSize: 11, borderRadius: 20, cursor: "pointer",
                                          background: selected ? "var(--accent)" : "var(--bg3)",
                                          color: selected ? "#fff" : "var(--text2)",
                                          border: selected ? "1px solid var(--accent)" : "1px solid var(--border2)",
                                          fontFamily: "var(--mono)",
                                        }}
                                      >{dep.moduleId}</button>
                                    );
                                  })}
                                  {otherModules.length === 0 && (
                                    <span style={{ fontSize: 12, color: "var(--text3)" }}>No other modules available.</span>
                                  )}
                                </div>
                                {modDepsError && <p style={{ fontSize: 12, color: "var(--red)", margin: "0 0 8px" }}>{modDepsError}</p>}
                                <button
                                  style={{ padding: "6px 16px", fontSize: 12, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", opacity: modDepsSaving ? 0.6 : 1 }}
                                  disabled={modDepsSaving || modDepsEdited === null}
                                  onClick={saveModDeps}
                                >{modDepsSaving ? "Saving…" : "Save"}</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {section === "tech-stack" && (
              <section className="admin-section">
                <h2>Technology Stack</h2>
                <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 18 }}>
                  Map the security and IT tools your organisation uses. AskTheChamp uses this to answer questions about your technology.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8, marginBottom: 20 }}>
                  {TECH_CATEGORIES.map(cat => {
                    const value = techStack[cat.id] || "";
                    const filled = Boolean(value.trim());
                    return (
                      <div key={cat.id} style={{
                        padding: "11px 14px", borderRadius: 10,
                        background: filled ? "rgba(76,168,160,0.08)" : "var(--bg3)",
                        boxShadow: filled ? "0 0 0 1px rgba(76,168,160,0.3)" : "var(--neu-inset-sm)",
                        transition: "all 0.2s",
                      }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: filled ? "#4CAF7D" : "var(--text3)", transition: "all 0.2s" }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{cat.label}</span>
                        </label>
                        <input
                          type="text"
                          value={value}
                          onChange={e => setTechStack(prev => ({ ...prev, [cat.id]: e.target.value }))}
                          placeholder={cat.placeholder}
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "none", background: "var(--bg4)", color: "var(--text)", fontSize: 12, fontFamily: "var(--sans)", outline: "none", boxSizing: "border-box" }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button className="btn btn-primary" onClick={saveTechStack} disabled={techStackSaving}>
                    {techStackSaving ? "Saving…" : "Save Tech Stack"}
                  </button>
                  {techStackMsg && (
                    <span style={{ fontSize: 13, color: techStackMsg === "Saved" ? "var(--green)" : "var(--red)" }}>
                      {techStackMsg}
                    </span>
                  )}
                </div>
              </section>
            )}

            {section === "storage" && (
              <section className="admin-section">
                <h2>Evidence Storage</h2>
                <p style={{ color: "var(--text2)", marginBottom: 16, fontSize: 13 }}>
                  Choose where PRISM stores uploaded and automatically-collected evidence files. Switching to
                  your own Amazon S3 bucket or Azure Blob container migrates existing files in the background.
                </p>
                <EvidenceStorageForm token={token} />
              </section>
            )}

            {section === "billing" && (
              <BillingSection company={company} user={user} />
            )}

            {section === "danger" && (
              <DangerZoneSection token={token} company={company} onDeleted={handleCompanyDeleted} />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
