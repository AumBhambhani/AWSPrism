import { Link } from "react-router-dom";
import { FaLinkedin } from "react-icons/fa";
import Logo from "../Logo";

const CURRENT_YEAR = new Date().getFullYear();

export default function SiteFooter({ onContact }) {
  return (
    <footer className="hp-footer">
      <div className="hp-container">
        <div className="hp-footer-top">
          <div className="hp-footer-brand-col">
            <div className="hp-brand">
              <Logo alt="PrismGRC" />
            </div>
          </div>

          <div className="hp-footer-nav-col">
            <a href="/#frameworks">Frameworks</a>
            <a href="/#integrations">Integrations</a>
            <a href="/#site-scanner">Site Scanner</a>
            <Link to="/pricing">Pricing</Link>
            <a href="/#about">About</a>
          </div>

          <div className="hp-footer-right-col">
            <Link to="/privacy-policy">Privacy</Link>
            <Link to="/terms-of-service">Terms</Link>
            <button className="hp-footer-link-btn" onClick={() => onContact?.("Support & Inquiries")}>
              Contact
            </button>
            <a
              href="https://linkedin.com"
              target="_blank"
              rel="noreferrer"
              className="hp-social-icon"
              aria-label="LinkedIn"
            >
              <FaLinkedin />
            </a>
          </div>
        </div>

        <div className="hp-footer-bottom-line">
          <p>© {CURRENT_YEAR} PrismGRC. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
