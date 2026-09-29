import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { FiCheck } from "react-icons/fi";
import SiteHeader from "../components/homepage/SiteHeader";
import SiteFooter from "../components/homepage/SiteFooter";
import ContactModal from "../components/homepage/ContactModal";
import "./Homepage.css";
import "./Pricing.css";

/* ---------- Packages comparison table ---------- */
const PACKAGE_ROWS = [
  { label: "Annual Subscription", starter: "₹2.4L / year", custom: "Indicative pricing via calculator", lead: true },
  { label: "Compliance Frameworks", starter: "1", custom: "Multiple" },
  { label: "Collaboration Users", starter: "Up to 5", custom: "Based on requirement" },
  { label: "Framework-Aligned Controls", starter: true, custom: true },
  { label: "Cross-Framework Mapping", starter: true, custom: true },
  { label: "Policies, Risk & Evidence", starter: true, custom: true },
  { label: "Remediation & Management Review", starter: true, custom: true },
  { label: "AI-Assisted GRC", starter: true, custom: true },
  { label: "Standard Integrations", starter: true, custom: true },
  { label: "Continuous Monitoring*", starter: true, custom: true },
  { label: "Customer AWS/Azure Deployment", starter: "Available", custom: "Available" },
  { label: "Prism Managed Infrastructure", starter: "Optional", custom: "Optional" },
  { label: "Customer AI API", starter: "Available", custom: "Available" },
  { label: "Prism Managed AI", starter: "Optional", custom: "Optional" },
  { label: "Custom Integrations", starter: "Add-on", custom: "Add-on" },
  { label: "Professional Services", starter: "Optional", custom: "Optional" },
  { label: "Private Offer", starter: "Available", custom: true },
];

function Cell({ value }) {
  if (value === true) {
    return (
      <span className="pr-cell-check" aria-label="Included">
        <FiCheck />
      </span>
    );
  }
  return <span className="pr-cell-text">{value}</span>;
}

/* ---------- Calculator option sets ---------- */
/* Each option carries an indicative weight in ₹ lakhs added to the ₹2.4L base.
   Options flagged `variable: true` are open-ended (5+ frameworks, 10+ users,
   managed compliance, custom integrations) and widen the estimate range
   further, since actual scope varies more for these choices. */
const BASE_LAKHS = 2.4;

const FRAMEWORKS_OPTIONS = [
  { value: "2", label: "2", weight: 0.9 },
  { value: "3", label: "3", weight: 1.6 },
  { value: "5", label: "5", weight: 2.8 },
  { value: "5+", label: "5+", weight: 4.2, variable: true },
];
const USERS_OPTIONS = [
  { value: "5", label: "5", weight: 0 },
  { value: "8", label: "8", weight: 1.1 },
  { value: "10+", label: "10+", weight: 2.4, variable: true },
];
const ENTITIES_OPTIONS = [
  { value: "single", label: "Single", weight: 0 },
  { value: "multiple", label: "Multiple", weight: 1.6 },
];
const INFRA_OPTIONS = [
  { value: "own", label: "My AWS / Azure", weight: 0 },
  { value: "managed", label: "Prism Managed", weight: 1.3 },
];
const AI_OPTIONS = [
  { value: "own", label: "My API", weight: 0 },
  { value: "managed", label: "Prism Managed", weight: 0.9 },
];
const SERVICES_OPTIONS = [
  { value: "none", label: "None", weight: 0 },
  { value: "implementation", label: "Implementation", weight: 1.0 },
  { value: "advisory", label: "Advisory", weight: 1.6 },
  { value: "managed", label: "Managed Compliance", weight: 3.2, variable: true },
];
const INTEGRATION_OPTIONS = [
  { value: "no", label: "No", weight: 0 },
  { value: "yes", label: "Yes", weight: 1.2, variable: true },
];

const CALC_FIELDS = [
  { key: "frameworks", label: "Frameworks", options: FRAMEWORKS_OPTIONS },
  { key: "users", label: "Users", options: USERS_OPTIONS },
  { key: "entities", label: "Entities", options: ENTITIES_OPTIONS },
  { key: "infra", label: "Infrastructure", options: INFRA_OPTIONS },
  { key: "ai", label: "AI", options: AI_OPTIONS },
  { key: "services", label: "Services", options: SERVICES_OPTIONS },
  { key: "integration", label: "Custom Integration", options: INTEGRATION_OPTIONS },
];

const DEFAULT_SELECTIONS = {
  frameworks: "2",
  users: "5",
  entities: "single",
  infra: "own",
  ai: "own",
  services: "none",
  integration: "no",
};

function roundToHalf(value, dir) {
  const step = 0.5;
  return dir === "down" ? Math.floor(value / step) * step : Math.ceil(value / step) * step;
}

function formatLakhs(v) {
  if (v >= 100) {
    const cr = v / 100;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(1)}Cr`;
  }
  return `₹${Number.isInteger(v) ? v : v.toFixed(1)}L`;
}

function computeEstimate(selections) {
  const chosen = CALC_FIELDS.map((f) => f.options.find((o) => o.value === selections[f.key]) || f.options[0]);
  const point = BASE_LAKHS + chosen.reduce((sum, o) => sum + o.weight, 0);
  const hasVariable = chosen.some((o) => o.variable);

  const lowMult = hasVariable ? 0.8 : 0.87;
  const highMult = hasVariable ? 1.3 : 1.16;

  const low = Math.max(BASE_LAKHS, roundToHalf(point * lowMult, "down"));
  let high = roundToHalf(point * highMult, "up");
  if (high <= low) high = low + 0.5;

  return { low, high };
}

export default function Pricing() {
  const location = useLocation();
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubject, setContactSubject] = useState("Request a demo");
  const [contactNotes, setContactNotes] = useState("");
  const [selections, setSelections] = useState(DEFAULT_SELECTIONS);

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) {
        requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimate = useMemo(() => computeEstimate(selections), [selections]);

  const openContact = (subject = "Request a demo", notes = "") => {
    setContactSubject(subject);
    setContactNotes(notes);
    setContactOpen(true);
  };

  const setField = (key, value) => setSelections((prev) => ({ ...prev, [key]: value }));

  const requestPrivateOffer = () => {
    const summary = CALC_FIELDS.map((f) => {
      const opt = f.options.find((o) => o.value === selections[f.key]);
      return `${f.label}: ${opt?.label}`;
    }).join("\n");
    const notes = `Custom plan scope:\n${summary}\n\nIndicative range: ${formatLakhs(estimate.low)}–${formatLakhs(
      estimate.high
    )}/year`;
    openContact("Request a Private Offer", notes);
  };

  return (
    <div className="hp-root pr-root">
      <SiteHeader onRequestDemo={openContact} />

      {/* HERO */}
      <section className="hp-section pr-hero">
        <div className="hp-container">
          <span className="hp-eyebrow-tag">PRICING</span>
          <h1 className="hp-section-title">PrismGRC Packages</h1>
          <p className="hp-section-sub">
            A genuinely usable deployment to start with, and a plan built around exactly the
            frameworks, users and infrastructure you need.
          </p>
        </div>
      </section>

      {/* PACKAGES TABLE */}
      <section className="hp-section pr-table-section">
        <div className="hp-container">
          <div className="pr-table-wrap">
            <table className="pr-table">
              <thead>
                <tr>
                  <th className="pr-table-row-label">&nbsp;</th>
                  <th>Starter</th>
                  <th className="pr-table-col-custom">Custom</th>
                </tr>
              </thead>
              <tbody>
                {PACKAGE_ROWS.map((row) => (
                  <tr key={row.label} className={row.lead ? "pr-row-lead" : ""}>
                    <td className="pr-table-row-label">{row.label}</td>
                    <td>
                      <Cell value={row.starter} />
                    </td>
                    <td className="pr-table-col-custom">
                      <Cell value={row.custom} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pr-table-footnote">
            *Continuous monitoring applies to eligible controls where the required technology is
            deployed and supported vendor APIs/integrations are available.
          </p>
        </div>
      </section>

      {/* STARTER / CUSTOM BLURBS */}
      <section className="hp-section pr-blurbs-section">
        <div className="hp-container pr-blurbs-grid">
          <div className="pr-blurb-card">
            <h3>Starter — ₹2.4L/year</h3>
            <p>
              This should be a genuinely usable Prism deployment, not a crippled version designed
              purely to upsell.
            </p>
            <p>
              1 framework + up to 5 collaborators + full core GRC + AI assistance + supported
              integrations.
            </p>
            <p>
              Infrastructure is separate. Deploy the required database and storage in your own
              AWS/Azure account to Prism specifications, or choose Prism Managed Infrastructure.
            </p>
            <p>AI works similarly: bring your own supported AI API, or use Prism Managed AI.</p>
            <button className="hp-btn hp-btn-secondary hp-btn-block" onClick={() => openContact("Start free trial — Starter")}>
              Start free trial
            </button>
          </div>
          <div className="pr-blurb-card pr-blurb-featured">
            <h3>Custom — Build Your Prism</h3>
            <p>This is where the calculator becomes valuable.</p>
            <p>Choose your frameworks, users, entities, infrastructure, AI and services below —
              the estimate updates as you go.
            </p>
            <a href="#calculator" className="hp-btn hp-btn-primary hp-btn-block">
              Open the calculator ↓
            </a>
          </div>
        </div>
      </section>

      {/* CALCULATOR */}
      <section className="hp-section pr-calc-section" id="calculator">
        <div className="hp-container">
          <span className="hp-eyebrow-tag">CUSTOM CALCULATOR</span>
          <h2 className="hp-section-title">Build your Prism</h2>
          <p className="hp-section-sub">
            Select the scope that matches your organisation. This gives you an indicative range —
            your final plan is confirmed with our team.
          </p>

          <div className="pr-calc-layout">
            <div className="pr-calc-grid">
              {CALC_FIELDS.map((field) => (
                <div className="pr-calc-group" key={field.key}>
                  <span className="pr-calc-label">{field.label}</span>
                  <div className="pr-calc-options">
                    {field.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`pr-calc-chip${selections[field.key] === opt.value ? " active" : ""}`}
                        onClick={() => setField(field.key, opt.value)}
                        aria-pressed={selections[field.key] === opt.value}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="pr-calc-result">
              <span className="pr-calc-result-label">Your Indicative PrismGRC Investment</span>
              <div className="pr-calc-result-value">
                {formatLakhs(estimate.low)}–{formatLakhs(estimate.high)}
                <span className="pr-calc-result-period">/year</span>
              </div>
              <p className="pr-calc-result-note">
                Based on the compliance and deployment scope selected.
              </p>
              <button className="hp-btn hp-btn-primary hp-btn-lg hp-btn-block" onClick={requestPrivateOffer}>
                Request a Private Offer
              </button>
            </div>
          </div>
        </div>
      </section>

      <ContactModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        subject={contactSubject}
        initialNotes={contactNotes}
      />

      <SiteFooter onContact={openContact} />
    </div>
  );
}
