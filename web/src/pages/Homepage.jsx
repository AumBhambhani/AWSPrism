import { Link } from "react-router-dom";
import { useState, useRef } from "react";
import {
  FiSearch,
  FiCheckCircle,
  FiShield,
  FiFileText,
  FiLink,
  FiMonitor,
  FiEye,
  FiZap,
  FiTrendingUp,
  FiTarget,
  FiArrowRight,
  FiCpu,
  FiAlertTriangle,
  FiTool,
  FiCheckSquare,
  FiUsers,
  FiCloud,
  FiBarChart2,
  FiLayers,
} from "react-icons/fi";
import {
  FaAws,
  FaMicrosoft,
  FaGithub,
  FaUserShield,
  FaTicketAlt,
  FaShieldAlt,
  FaCrow,
  FaHdd,
  FaNetworkWired,
} from "react-icons/fa";
import { SiZoho, SiOpentext } from "react-icons/si";
import PrismBg from "../components/PrismBg";
import HomeMark from "../components/homepage/HomeIcons";
import ComplianceCommandCenter from "../components/homepage/ComplianceCommandCenter";
import SiteScannerSection from "../components/homepage/SiteScannerSection";
import SiteHeader from "../components/homepage/SiteHeader";
import SiteFooter from "../components/homepage/SiteFooter";
import ContactModal from "../components/homepage/ContactModal";
import "./Homepage.css";

/* Homepage pricing teaser — full detail + calculator live on /pricing */
const PRICING_SUMMARY = [
  {
    tag: "Best for a focused start",
    name: "Starter",
    price: "₹2.4L",
    period: "/year",
    features: [
      "1 compliance framework",
      "Up to 5 collaboration users",
      "Full core GRC workflow + AI assistance",
      "Standard integrations",
      "Your AWS/Azure or Prism Managed infra",
    ],
    cta: "Start free trial",
    featured: false,
  },
  {
    tag: "Best for scaling programmes",
    name: "Custom",
    price: "Build your Prism",
    period: "",
    features: [
      "Multiple frameworks & entities",
      "Users based on your requirement",
      "Choice of infrastructure & AI deployment",
      "Implementation, advisory or managed services",
      "Custom integrations, on request",
    ],
    cta: "Build your custom plan →",
    featured: true,
    isCustom: true,
  },
];

/* 4 Value propositions strip */
const VALUE_PROPS = [
  {
    icon: <FiCpu />,
    title: "Automate Evidence",
    sub: "Collect and validate from your existing tools.",
    color: "#0284c7",
  },
  {
    icon: <FiShield />,
    title: "Reduce Risk",
    sub: "Identify and address gaps early.",
    color: "#10b981",
  },
  {
    icon: <FiFileText />,
    title: "Be Audit Ready",
    sub: "Always prepared, always confident.",
    color: "#3b82f6",
  },
  {
    icon: <FiLink />,
    title: "Use What You Have",
    sub: "Integrate with your existing technology.",
    color: "#00b4d8",
  },
];

/* Compliance changes every day 4 pillars */
const RESILIENCE_CARDS = [
  {
    icon: <FiMonitor />,
    title: "Continuous Monitoring",
    sub: "Track changes across your environment.",
  },
  {
    icon: <FiEye />,
    title: "Real-time Visibility",
    sub: "See your compliance posture at all times.",
  },
  {
    icon: <FiZap />,
    title: "Faster Audits",
    sub: "Spend less time preparing.",
  },
  {
    icon: <FiTrendingUp />,
    title: "Lower Compliance Overhead",
    sub: "Automate. Integrate. Do more with less.",
  },
];

/* PRISM Operating Model - 5 Pillars */
const OPERATING_PILLARS = [
  {
    letter: "P",
    letterColor: "#0284c7",
    icon: <FiFileText />,
    title: "Policies & Governance",
    sub: "Policies, obligations, ownership and accountability.",
  },
  {
    letter: "R",
    letterColor: "#10b981",
    icon: <FiShield />,
    title: "Risk & Resiliency",
    sub: "Risk, continuity, recovery and resilience.",
  },
  {
    letter: "I",
    letterColor: "#8b5cf6",
    icon: <FiUsers />,
    title: "Identity & People",
    sub: "Identity, access, privileged accounts and lifecycle.",
  },
  {
    letter: "S",
    letterColor: "#f97316",
    icon: <FiCloud />,
    title: "Security Architecture",
    sub: "Endpoints, networks, cloud, applications and data.",
  },
  {
    letter: "M",
    letterColor: "#00b4d8",
    icon: <FiBarChart2 />,
    title: "Management Review & Audit",
    sub: "Evidence, remediation and audit readiness.",
  },
];

/* 13 Frameworks */
const FRAMEWORKS_13 = [
  { key: "dpdpa", name: "DPDPA", sub: "Digital Personal Data Protection Act" },
  { key: "gdpr", name: "GDPR", sub: "General Data Protection Regulation" },
  { key: "hipaa", name: "HIPAA", sub: "Health Insurance Portability and Accountability" },
  { key: "pci", name: "PCI DSS", sub: "Payment Card Industry Data Security" },
  { key: "rbi", name: "RBI / NBFC", sub: "Reserve Bank of India & NBFC Guidelines" },
  { key: "iso27001", name: "ISO 27001", sub: "Information Security Management" },
  { key: "soc2", name: "SOC 2 Type II", sub: "Service Organization Control 2" },
  { key: "cis", name: "CIS Controls", sub: "Center for Internet Security" },
  { key: "certin", name: "CERT-In", sub: "Indian Computer Emergency Response Team" },
  { key: "itgc", name: "ITGC", sub: "Information Technology General Controls" },
  { key: "iso19770", name: "ISO 19770-1", sub: "IT Asset Management" },
  { key: "aws", name: "AWS Well-Architected", sub: "Cloud Best Practices" },
  { key: "azure", name: "Azure Well-Architected", sub: "Cloud Best Practices" },
];

/* Real brand icons + colors, matching the ones used in the actual Integrations settings page */
const INTEGRATION_ICON = {
  azure: { Icon: FaMicrosoft, color: "#0078D4" },
  aws: { Icon: FaAws, color: "#FF9900" },
  akamai: { Icon: FaNetworkWired, color: "#0099CC" },
  defender: { Icon: FaMicrosoft, color: "#0D6EFD" },
  crowdstrike: { Icon: FaCrow, color: "#FC0000" },
  checkpoint: { Icon: FaShieldAlt, color: "#E5261F" },
  sophos: { Icon: FaShieldAlt, color: "#0A2E57" },
  purview: { Icon: FaMicrosoft, color: "#8661C5" },
  onetrust: { Icon: FaUserShield, color: "#24B47E" },
  privy: { Icon: FaShieldAlt, color: "#2D6DF6" },
  opentext: { Icon: SiOpentext, color: "#0073E7" },
  entra: { Icon: FaMicrosoft, color: "#0078D4" },
  commvault: { Icon: FaHdd, color: "#CC0000" },
  acronis: { Icon: FaHdd, color: "#0068B7" },
  servicenow: { Icon: FaTicketAlt, color: "#293E40" },
  github: { Icon: FaGithub, color: "#181717" },
  zoho: { Icon: SiZoho, color: "#E61E25" },
};

/* Connected Ecosystem / Integrations by category */
const INTEGRATION_CATEGORIES = [
  {
    category: "Cloud & Infrastructure",
    items: [
      { name: "Azure", mark: "azure" },
      { name: "AWS", mark: "aws" },
    ],
  },
  {
    category: "Web Application & API Security",
    items: [
      { name: "Akamai", mark: "akamai" },
    ],
  },
  {
    category: "Endpoint & Threat Protection",
    items: [
      { name: "Microsoft Defender", mark: "defender" },
      { name: "CrowdStrike", mark: "crowdstrike" },
      { name: "Check Point", mark: "checkpoint" },
      { name: "Sophos", mark: "sophos" },
    ],
  },
  {
    category: "Privacy, Data Governance & Consent",
    items: [
      { name: "Microsoft Purview", mark: "purview" },
      { name: "OneTrust", mark: "onetrust" },
      { name: "Privy", mark: "privy" },
      { name: "OpenText", mark: "opentext" },
    ],
  },
  {
    category: "Identity & Access",
    items: [{ name: "Microsoft Entra", mark: "entra" }],
  },
  {
    category: "Backup, Recovery & Resilience",
    items: [
      { name: "Commvault", mark: "commvault" },
      { name: "Acronis", mark: "acronis" },
    ],
  },
  {
    category: "IT Service Management",
    items: [{ name: "ServiceNow", mark: "servicenow" }],
  },
  {
    category: "Development & DevSecOps",
    items: [{ name: "GitHub", mark: "github" }],
  },
  {
    category: "Business Applications",
    items: [{ name: "Zoho", mark: "zoho" }],
  },
];

/* From Signal to Action - 6 Steps */
const WORKFLOW_STEPS = [
  {
    icon: <FiFileText />,
    title: "Technology Signal",
    sub: "Configuration, activity or event from your tools.",
  },
  {
    icon: <FiCheckSquare />,
    title: "Applicable Control",
    sub: "Map to relevant framework controls.",
  },
  {
    icon: <FiCheckCircle />,
    title: "Evidence Validation",
    sub: "Collect and validate evidence automatically.",
  },
  {
    icon: <FiAlertTriangle />,
    title: "Risk or Gap",
    sub: "Identify issues and assess risk.",
  },
  {
    icon: <FiTool />,
    title: "Remediation",
    sub: "Create and track action items.",
  },
  {
    icon: <FiBarChart2 />,
    title: "Continuous Compliance",
    sub: "Improved posture. Ongoing assurance.",
  },
];

/* India-First Highlight Cards */
const INDIA_FIRST_CARDS = [
  {
    mark: "dpdpa",
    title: "DPDPA",
    name: "Digital Personal Data Protection Act, 2023",
    sub: "Privacy for a digital India.",
  },
  {
    mark: "rbi",
    title: "RBI / NBFC",
    name: "Reserve Bank of India & NBFC Guidelines",
    sub: "Stronger financial sector resilience.",
  },
  {
    mark: "certin",
    title: "CERT-In",
    name: "Indian Computer Emergency Response Team",
    sub: "A more secure digital ecosystem.",
  },
];

/* AI-Assisted GRC 5 Capabilities */
const AI_CAPABILITIES = [
  {
    icon: <FiFileText />,
    title: "Policy Review",
    sub: "Compare policies against control requirements.",
  },
  {
    icon: <FiSearch />,
    title: "Gap Identification",
    sub: "Identify missing controls and evidence.",
  },
  {
    icon: <FiBarChart2 />,
    title: "Evidence Analysis",
    sub: "Understand which documents and signals support controls.",
  },
  {
    icon: <FiZap />,
    title: "Recommendations",
    sub: "Suggest policy, process and control improvements.",
  },
  {
    icon: <FiCheckSquare />,
    title: "Audit Preparation",
    sub: "Surface incomplete or outdated evidence.",
  },
];

export default function Homepage() {
  const [contactOpen, setContactOpen] = useState(false);
  const [contactSubject, setContactSubject] = useState("Request a demo");

  const openContact = (subject = "Request a demo") => {
    setContactSubject(subject);
    setContactOpen(true);
  };

  return (
    <div className="hp-root">
      <SiteHeader onRequestDemo={openContact} />

      {/* 1. HERO SECTION */}
      <section className="hp-hero" id="hero">
        <PrismBg
          animationType="hover"
          height={3.4}
          baseWidth={5.0}
          glow={0.5}
          bloom={0.5}
          noise={0.15}
          scale={3.4}
          hueShift={0}
          colorFrequency={1.1}
          hoverStrength={1.0}
          inertia={0.05}
          timeScale={0.28}
          offset={{ x: 0, y: -120 }}
          transparent
          suspendWhenOffscreen
        />
        <div className="hp-hero-inner">
          <div className="hp-hero-copy">
            <span className="hp-eyebrow-tag">FROM RISK TO RESILIENCE</span>
            <h1 className="hp-hero-title">
              Continuous Compliance.<br />
              <span className="hp-hero-accent">Connected to Your Technology.</span>
            </h1>
            <h2 className="hp-hero-subhead">
              13 Frameworks. Hundreds of Controls. One Compliance Control Plane.
            </h2>
            <p className="hp-hero-sub">
              PRISM connects policies, risks, controls, technology signals, evidence and remediation — helping enterprises continuously understand and improve their compliance posture.
            </p>
            <div className="hp-hero-ctas">
              <Link to="/register" className="hp-btn hp-btn-primary">
                Assess Your Readiness →
              </Link>
              <button className="hp-btn hp-btn-secondary" onClick={() => openContact("Request a demo")}>
                Request a Demo
              </button>
            </div>
          </div>
          <div className="hp-hero-mock">
            <ComplianceCommandCenter />
          </div>
        </div>
      </section>

      {/* 2. VALUE PROPOSITIONS STRIP */}
      <section className="hp-valprops-strip">
        <div className="hp-container">
          <div className="hp-valprops-grid">
            {VALUE_PROPS.map((vp) => (
              <div key={vp.title} className="hp-valprop-card">
                <div className="hp-valprop-icon" style={{ color: vp.color, borderColor: vp.color }}>
                  {vp.icon}
                </div>
                <div className="hp-valprop-content">
                  <h4 className="hp-valprop-title">{vp.title}</h4>
                  <p className="hp-valprop-sub">{vp.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2.5 LIVE WEBSITE COMPLIANCE SCANNER */}
      <SiteScannerSection />

      {/* 3. COMPLIANCE CHANGES EVERY DAY */}
      <section className="hp-section hp-resilience-section">
        <div className="hp-container">
          <div className="hp-split-layout">
            <div className="hp-split-left">
              <span className="hp-eyebrow-tag">A MORE RESILIENT TOMORROW</span>
              <h2 className="hp-section-title hp-align-left">Compliance Changes Every Day.</h2>
              <h3 className="hp-section-lead-sub">
                Your audit may happen periodically. Your risk changes every day.
              </h3>
              <p className="hp-section-desc">
                Users join and leave. Access changes. Data moves. Applications are deployed. Vendors are onboarded. Security configurations change. PrismGRC helps you stay ahead — continuously.
              </p>
            </div>
            <div className="hp-split-right">
              <div className="hp-resilience-grid">
                {RESILIENCE_CARDS.map((rc) => (
                  <div key={rc.title} className="hp-feature-card">
                    <div className="hp-feature-icon">{rc.icon}</div>
                    <h4 className="hp-feature-title">{rc.title}</h4>
                    <p className="hp-feature-sub">{rc.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. THE PRISM OPERATING MODEL */}
      <section className="hp-section hp-pillars-section" id="approach">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">OUR APPROACH</span>
              <h2 className="hp-section-title hp-align-left">The PRISM Operating Model</h2>
              <p className="hp-section-sub hp-align-left">One operating model for enterprise compliance.</p>
            </div>
            <span className="hp-header-note">A connected approach. Stronger outcomes.</span>
          </div>

          <div className="hp-prism-pillars-grid">
            {OPERATING_PILLARS.map((op) => (
              <div key={op.title} className="hp-pillar-badge-card">
                <div className="hp-pillar-top-row">
                  <div className="hp-pillar-letter" style={{ color: op.letterColor, borderColor: op.letterColor }}>
                    {op.letter}
                  </div>
                  <div className="hp-pillar-small-icon">{op.icon}</div>
                </div>
                <h3 className="hp-pillar-card-title">{op.title}</h3>
                <p className="hp-pillar-card-desc">{op.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. 13 FRAMEWORKS. ONE CONTROL LIBRARY */}
      <section className="hp-section hp-frameworks-section" id="frameworks">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">COMPLIANCE COVERAGE</span>
              <h2 className="hp-section-title hp-align-left">13 Frameworks. One Control Library.</h2>
              <p className="hp-section-sub hp-align-left">
                Map common controls across privacy, regulatory, cybersecurity, audit and cloud frameworks.
              </p>
            </div>
            <div className="hp-framework-callout-badge">
              <FiTarget className="hp-callout-icon" />
              <span>One control can support multiple frameworks. Less duplication. Faster audits. Better visibility.</span>
            </div>
          </div>

          <div className="hp-frameworks-13-grid">
            {FRAMEWORKS_13.map((fw) => {
              const iconEntry = INTEGRATION_ICON[fw.key];
              return (
                <div key={fw.key} className="hp-framework-card">
                  <div className="hp-framework-mark-wrap">
                    {iconEntry ? (
                      <iconEntry.Icon className="hp-framework-real-icon" color={iconEntry.color} />
                    ) : (
                      <HomeMark name={fw.key} />
                    )}
                  </div>
                  <div className="hp-framework-details">
                    <strong className="hp-framework-name">{fw.name}</strong>
                    <span className="hp-framework-sub">{fw.sub}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. CONNECTED COMPLIANCE ECOSYSTEM */}
      <section className="hp-section hp-ecosystem-section" id="integrations">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">CONFIGURATIONS</span>
              <h2 className="hp-section-title hp-align-left">Connected Compliance Ecosystem</h2>
              <p className="hp-section-sub hp-align-left">Use the technology you already own.</p>
            </div>
            <span className="hp-header-note">More integrations. A stronger compliance story.</span>
          </div>

          <div className="hp-categories-grid">
            {INTEGRATION_CATEGORIES.map((cat) => (
              <div key={cat.category} className="hp-category-card">
                <h4 className="hp-category-title">{cat.category}</h4>
                <div className="hp-category-logos">
                  {cat.items.map((item) => {
                    const iconEntry = INTEGRATION_ICON[item.mark];
                    return (
                      <div key={item.name} className="hp-integration-logo-item" title={item.name}>
                        {iconEntry && <iconEntry.Icon className="hp-integration-icon" color={iconEntry.color} />}
                        <span className="hp-integration-name">{item.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. FROM SIGNAL TO ACTION */}
      <section className="hp-section hp-workflow-section" id="workflow">
        <div className="hp-container">
          <span className="hp-eyebrow-tag">HOW IT WORKS</span>
          <h2 className="hp-section-title hp-align-left">From Signal to Action</h2>
          <p className="hp-section-sub hp-align-left">Turn technology signals into continuous compliance.</p>

          <div className="hp-workflow-steps-wrap">
            {WORKFLOW_STEPS.map((ws, index) => (
              <div key={ws.title} className="hp-workflow-step-col">
                <div className="hp-step-card">
                  <div className="hp-step-icon">{ws.icon}</div>
                  <h4 className="hp-step-title">{ws.title}</h4>
                  <p className="hp-step-desc">{ws.sub}</p>
                </div>
                {index < WORKFLOW_STEPS.length - 1 && (
                  <div className="hp-step-arrow">
                    <FiArrowRight />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8. BUILT FOR INDIAN COMPLIANCE. READY FOR GLOBAL FRAMEWORKS */}
      <section className="hp-section hp-india-section" id="india-first">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">INDIA-FIRST</span>
              <h2 className="hp-section-title hp-align-left">
                Built for Indian Compliance. Ready for Global Frameworks.
              </h2>
              <p className="hp-section-sub hp-align-left">
                Designed to help enterprises address local regulatory obligations while aligning with global assurance requirements like ISO 27001, SOC 2, GDPR, HIPAA and PCI DSS.
              </p>
            </div>
            <span className="hp-header-note">Local strength. Global readiness.</span>
          </div>

          <div className="hp-india-grid">
            {INDIA_FIRST_CARDS.map((ic) => (
              <div key={ic.title} className="hp-india-card">
                <div className="hp-india-badge-wrap">
                  <HomeMark name={ic.mark} />
                </div>
                <div className="hp-india-info">
                  <h3 className="hp-india-title">{ic.title}</h3>
                  <strong className="hp-india-name">{ic.name}</strong>
                  <p className="hp-india-sub">{ic.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. AI-ASSISTED GRC */}
      <section className="hp-section hp-ai-section" id="ai-grc">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">AI-POWERED</span>
              <h2 className="hp-section-title hp-align-left">AI-Assisted GRC</h2>
              <p className="hp-section-sub hp-align-left">Reduce manual effort. Increase confidence.</p>
            </div>
            <span className="hp-header-note">AI assists. Your organization governs.</span>
          </div>

          <div className="hp-ai-grid">
            {AI_CAPABILITIES.map((ai) => (
              <div key={ai.title} className="hp-ai-card">
                <div className="hp-ai-icon">{ai.icon}</div>
                <h4 className="hp-ai-title">{ai.title}</h4>
                <p className="hp-ai-sub">{ai.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9.6 PRICING */}
      <section className="hp-section hp-pricing-section" id="pricing">
        <div className="hp-container">
          <span className="hp-eyebrow-tag">PRICING</span>
          <h2 className="hp-section-title">Simple, transparent pricing</h2>
          <p className="hp-section-sub">
            Start with a focused deployment, or build a plan around your exact compliance and
            infrastructure needs.
          </p>

          <div className="hp-pricing-row hp-pricing-row-2">
            {PRICING_SUMMARY.map((plan) => (
              <div
                key={plan.name}
                className={`hp-pricing-card${plan.featured ? " hp-pricing-featured" : ""}`}
              >
                <div className="hp-pricing-tag">{plan.tag}</div>
                <h3>{plan.name}</h3>
                <div className="hp-pricing-price">
                  {plan.price}
                  {plan.period && <span>{plan.period}</span>}
                </div>
                <ul className="hp-pricing-features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {plan.isCustom ? (
                  <Link to="/pricing#calculator" className="hp-btn hp-btn-block hp-btn-primary">
                    {plan.cta}
                  </Link>
                ) : (
                  <button
                    className="hp-btn hp-btn-block hp-btn-secondary"
                    onClick={() => openContact(`${plan.cta} — ${plan.name}`)}
                  >
                    {plan.cta}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="hp-pricing-footnote">
            <Link to="/pricing" className="hp-pricing-footnote-link">
              See the full packages comparison & pricing calculator →
            </Link>
          </div>
        </div>
      </section>

      {/* 9.5 ABOUT PRISM */}
      <section className="hp-section hp-about-section" id="about">
        <div className="hp-container">
          <div className="hp-section-header-flex">
            <div>
              <span className="hp-eyebrow-tag">ABOUT PRISM</span>
              <h2 className="hp-section-title hp-align-left">About PRISM</h2>
              <p className="hp-section-sub hp-align-left">
                We built the tool we wished existed when we were doing compliance ourselves.
              </p>
            </div>
          </div>

          <div className="hp-about-layout">
            <div className="hp-about-story">
              <span className="hp-eyebrow-tag">OUR STORY</span>
              <p>
                PRISM was born out of frustration. Every compliance programme we worked on ran
                into the same problems — questions buried in spreadsheets, evidence scattered
                across drives, and a scramble every time an auditor asked for something.
              </p>
              <p>
                We built PRISM to work the way compliance teams do — structured enough to
                satisfy auditors, practical enough for everyday use by the people who own the
                controls. We started with India's DPDP Act because we believed it deserved a
                purpose-built tool, not an afterthought bolt-on.
              </p>
              <p className="hp-about-byline">
                Developed by <strong>Neozaar</strong> — governance, risk and compliance
                tooling for Indian and global organisations.
              </p>
            </div>
            <div className="hp-about-values">
              {[
                { title: "Practitioners first", body: "Every feature is designed by people who have sat in the CISO chair, written policies and faced auditors." },
                { title: "Transparency", body: "No black-box scoring. Every maturity level and calculation is visible and explainable." },
                { title: "Indian regulatory depth", body: "DPDP Act 2023 isn't a checkbox we added — it's where we started, and we track rule-making as it evolves." },
                { title: "Built to last", body: "Compliance is a programme, not a project. PRISM is built for teams who manage it year-round." },
              ].map((v) => (
                <div key={v.title} className="hp-about-value-card">
                  <h4>{v.title}</h4>
                  <p>{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 10. YOUR COMPLIANCE CONTROL PLANE BANNER (BOTTOM CTA) */}
      <section className="hp-final-banner-section">
        <div className="hp-container">
          <div className="hp-final-banner">
            <div className="hp-final-banner-content">
              <h2 className="hp-banner-title">Your Compliance Control Plane.</h2>
              <p className="hp-banner-sub">
                13 Frameworks. Hundreds of Controls. Connected Technology. Continuous Evidence.
              </p>
              <div className="hp-banner-actions">
                <Link to="/register" className="hp-btn hp-btn-primary hp-btn-lg">
                  Assess Your Compliance Readiness →
                </Link>
                <button className="hp-btn hp-btn-outline-white hp-btn-lg" onClick={() => openContact("Request a demo")}>
                  Request a Demo
                </button>
              </div>
            </div>
            <div className="hp-banner-right-tag">
              <span>Govern Continuously.</span>
              <span>Prove Confidently.</span>
            </div>
          </div>
        </div>
      </section>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} subject={contactSubject} />

      <SiteFooter onContact={openContact} />
    </div>
  );
}
