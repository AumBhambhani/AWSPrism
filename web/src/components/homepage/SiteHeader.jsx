import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { FiArrowRight, FiMenu, FiX } from "react-icons/fi";
import Logo from "../Logo";

export const NAV_LINKS = [
  { label: "Frameworks", href: "/#frameworks" },
  { label: "Integrations", href: "/#integrations" },
  { label: "Site Scanner", href: "/#site-scanner" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/#about" },
];

function NavLink({ link, className, onClick, children }) {
  if (link.href.includes("#")) {
    return (
      <a href={link.href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={link.href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export default function SiteHeader({ navLinks = NAV_LINKS, onRequestDemo }) {
  const [dark, setDark] = useState(() => {
    return document.documentElement.getAttribute("data-theme") === "dark";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("prism_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 860) {
        setMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className="hp-header">
      <div className="hp-header-inner">
        <Link to="/" className="hp-brand">
          <Logo alt="PrismGRC" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hp-nav hp-desktop-nav">
          <div className="hp-nav-menu">
            {navLinks.map((l) => (
              <NavLink key={l.label} link={l} className="hp-nav-link">
                <span>{l.label}</span>
              </NavLink>
            ))}
          </div>

          <div className="hp-nav-actions">
            <button
              className="hp-toggle"
              onClick={() => setDark(!dark)}
              aria-label="Toggle theme"
              title={`Switch to ${dark ? "light" : "dark"} mode`}
            >
              <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
            </button>
            <button className="hp-btn-nav-outline" onClick={() => onRequestDemo?.("Request a demo")}>
              Request a Demo
            </button>
            <Link to="/login" className="hp-nav-login-link">
              Sign In
            </Link>
            <Link to="/register" className="hp-btn-nav-primary">
              Sign Up
            </Link>
          </div>
        </nav>

        {/* Mobile Header Controls */}
        <div className="hp-mobile-nav-controls">
          <button
            className="hp-toggle"
            onClick={() => setDark(!dark)}
            aria-label="Toggle theme"
            title={`Switch to ${dark ? "light" : "dark"} mode`}
          >
            <span className={`hp-toggle-knob ${dark ? "active" : ""}`} />
          </button>
          <button
            className="hp-mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <FiX /> : <FiMenu />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="hp-mobile-drawer">
          <div className="hp-mobile-drawer-links">
            {navLinks.map((l) => (
              <NavLink
                key={l.label}
                link={l}
                className="hp-mobile-nav-link"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>{l.label}</span>
                <FiArrowRight className="hp-mobile-link-arrow" />
              </NavLink>
            ))}
          </div>
          <div className="hp-mobile-drawer-actions">
            <button
              className="hp-btn hp-btn-secondary hp-btn-block"
              onClick={() => {
                setMobileMenuOpen(false);
                onRequestDemo?.("Request a demo");
              }}
            >
              Request a Demo
            </button>
            <Link
              to="/register"
              className="hp-btn hp-btn-primary hp-btn-block"
              onClick={() => setMobileMenuOpen(false)}
            >
              Sign Up Free →
            </Link>
            <Link
              to="/login"
              className="hp-mobile-login-link"
              onClick={() => setMobileMenuOpen(false)}
            >
              Already have an account? <b>Sign In</b>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
