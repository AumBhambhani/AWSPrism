import { Link } from "react-router-dom";
import Logo from "../components/Logo";

const CURRENT_YEAR = new Date().getFullYear();

export default function TermsOfService() {
  return (
    <div className="pp-page">

      {/* Top bar */}
      <div className="pp-topbar">
        <Link to="/" aria-label="Back to PRISM home">
          <Logo className="pp-logo" />
        </Link>
        <Link to="/" className="pp-back">← Back to home</Link>
      </div>

      {/* Document */}
      <div className="pp-container">

        <header className="pp-header">
          <div className="pp-header-badge">Legal</div>
          <h1>Terms of Service</h1>
          <p className="pp-effective">Effective Date: July 28, 2026</p>
        </header>

        <p className="pp-intro">
          Welcome to PRISM ("Platform", "Service", "we", "our", or "us"). These Terms of Service ("Terms")
          govern your access to and use of the PRISM platform and related services.
        </p>
        <p className="pp-intro">
          By accessing or using PRISM, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <div className="pp-body">

          {/* 1 */}
          <section className="pp-section">
            <h2>1. About PRISM</h2>
            <p>
              PRISM is a cloud-based Governance, Risk, and Compliance (GRC) platform that enables organizations
              to manage compliance assessments, evidence, remediation activities, reporting, workflows, and
              related governance processes.
            </p>
          </section>

          {/* 2 */}
          <section className="pp-section">
            <h2>2. Eligibility</h2>
            <p>You may use PRISM only if:</p>
            <ul>
              <li>You are at least 18 years old.</li>
              <li>You have authority to act on behalf of your organization.</li>
              <li>Your use complies with all applicable laws and regulations.</li>
            </ul>
          </section>

          {/* 3 */}
          <section className="pp-section">
            <h2>3. Account Registration</h2>
            <p>You are responsible for:</p>
            <ul>
              <li>Maintaining accurate account information.</li>
              <li>Protecting your login credentials.</li>
              <li>Restricting unauthorized access to your account.</li>
              <li>Promptly notifying us of any suspected unauthorized access.</li>
            </ul>
          </section>

          {/* 4 */}
          <section className="pp-section">
            <h2>4. Subscription and Licensing</h2>
            <p>
              Subject to these Terms, PRISM grants you a limited, non-exclusive, non-transferable, revocable
              license to access and use the Service during your active subscription.
            </p>
            <p>Your subscription does not transfer ownership of the software.</p>
          </section>

          {/* 5 */}
          <section className="pp-section">
            <h2>5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Attempt unauthorized access to any systems.</li>
              <li>Reverse engineer or decompile the platform.</li>
              <li>Upload malicious software or harmful code.</li>
              <li>Interfere with platform availability or security.</li>
              <li>Use PRISM for unlawful activities.</li>
              <li>Share accounts in violation of your subscription.</li>
              <li>Attempt to bypass licensing or security controls.</li>
            </ul>
          </section>

          {/* 6 */}
          <section className="pp-section">
            <h2>6. Customer Data</h2>
            <p>You retain ownership of all data you upload to PRISM.</p>
            <p>
              By using the Service, you grant us permission to process your data solely for the purpose
              of providing the Service.
            </p>
            <p>We do not claim ownership of your content.</p>
          </section>

          {/* 7 */}
          <section className="pp-section">
            <h2>7. Data Security</h2>
            <p>
              We implement commercially reasonable administrative, technical, and organizational safeguards
              designed to protect customer data.
            </p>
            <p>
              While we strive to maintain secure systems, no internet-based service can guarantee absolute security.
            </p>
          </section>

          {/* 8 */}
          <section className="pp-section">
            <h2>8. Privacy</h2>
            <p>
              Our collection and use of personal information is governed by our{" "}
              <Link to="/privacy-policy">Privacy Policy</Link>.
            </p>
          </section>

          {/* 9 */}
          <section className="pp-section">
            <h2>9. AI Features</h2>
            <p>Certain PRISM features may use artificial intelligence to assist with:</p>
            <ul>
              <li>Compliance recommendations</li>
              <li>Evidence analysis</li>
              <li>Risk identification</li>
              <li>Workflow suggestions</li>
              <li>Report generation</li>
            </ul>
            <p>
              AI-generated content is intended to assist users and should be reviewed by qualified personnel
              before being relied upon for business, legal, regulatory, or compliance decisions.
            </p>
          </section>

          {/* 10 */}
          <section className="pp-section">
            <h2>10. Availability</h2>
            <p>We aim to provide reliable service but do not guarantee uninterrupted availability.</p>
            <p>
              Scheduled maintenance, upgrades, emergencies, and third-party outages may temporarily affect availability.
            </p>
          </section>

          {/* 11 */}
          <section className="pp-section">
            <h2>11. Third-Party Services</h2>
            <p>
              PRISM may integrate with third-party services, including cloud providers, identity providers,
              productivity tools, and AI services.
            </p>
            <p>Use of third-party services is subject to their respective terms and policies.</p>
          </section>

          {/* 12 */}
          <section className="pp-section">
            <h2>12. Intellectual Property</h2>
            <p>
              PRISM, including its software, design, documentation, trademarks, logos, and related intellectual
              property, remains the exclusive property of PRISM and its licensors.
            </p>
            <p>
              Except as expressly permitted, no rights are granted beyond those stated in these Terms.
            </p>
          </section>

          {/* 13 */}
          <section className="pp-section">
            <h2>13. Confidentiality</h2>
            <p>
              Each party agrees to protect confidential information received from the other party using
              reasonable care and not to disclose it except as necessary to provide or use the Service or
              as required by law.
            </p>
          </section>

          {/* 14 */}
          <section className="pp-section">
            <h2>14. Fees and Payment</h2>
            <p>
              Subscription fees, billing terms, renewal periods, and payment obligations are governed by
              your applicable order, subscription agreement, or marketplace purchase.
            </p>
            <p>Failure to pay applicable fees may result in suspension or termination of access.</p>
          </section>

          {/* 15 */}
          <section className="pp-section">
            <h2>15. Suspension</h2>
            <p>We may suspend access if:</p>
            <ul>
              <li>Required by law.</li>
              <li>There is suspected fraud or unauthorized activity.</li>
              <li>Subscription payments remain overdue.</li>
            </ul>
            <p>Where practical, we will provide notice before suspension.</p>
          </section>

          {/* 16 */}
          <section className="pp-section">
            <h2>16. Termination</h2>
            <p>
              Either party may terminate the Service in accordance with the applicable subscription agreement.
            </p>
            <p>Upon termination:</p>
            <ul>
              <li>Access to PRISM will end.</li>
              <li>Customer data may be retained for a limited period as described in our data retention policy or as required by law.</li>
              <li>Customers are responsible for exporting their data before termination where applicable.</li>
            </ul>
          </section>

          {/* 17 */}
          <section className="pp-section">
            <h2>17. Disclaimer of Warranties</h2>
            <p>PRISM is provided on an "as is" and "as available" basis.</p>
            <p>
              To the maximum extent permitted by law, we disclaim all warranties, whether express, implied,
              statutory, or otherwise, including warranties of merchantability, fitness for a particular
              purpose, and non-infringement.
            </p>
          </section>

          {/* 18 */}
          <section className="pp-section">
            <h2>18. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, PRISM and its affiliates, officers, employees, and
              licensors shall not be liable for any indirect, incidental, consequential, special, exemplary,
              or punitive damages, including loss of profits, business interruption, goodwill, or data.
            </p>
            <p>
              Our total liability arising from or relating to the Service shall not exceed the fees paid by
              the customer for the Service during the twelve (12) months preceding the event giving rise to the claim.
            </p>
            <p>
              Some jurisdictions do not allow certain limitations of liability, so portions of this section may not apply.
            </p>
          </section>

          {/* 19 */}
          <section className="pp-section">
            <h2>19. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless PRISM, its affiliates, officers, employees, and
              licensors from claims, damages, liabilities, and expenses arising from:
            </p>
            <ul>
              <li>Your use of the Service.</li>
              <li>Your violation of these Terms.</li>
              <li>Your violation of applicable laws.</li>
              <li>Your infringement of third-party rights.</li>
            </ul>
          </section>

          {/* 20 */}
          <section className="pp-section">
            <h2>20. Export Compliance</h2>
            <p>
              You agree to comply with all applicable export control, sanctions, and trade laws governing
              the use of the Service.
            </p>
          </section>

          {/* 21 */}
          <section className="pp-section">
            <h2>21. Changes to the Service</h2>
            <p>We may update, improve, modify, or discontinue features of PRISM from time to time.</p>
            <p>Material changes affecting your use of the Service will be communicated where appropriate.</p>
          </section>

          {/* 22 */}
          <section className="pp-section">
            <h2>22. Changes to These Terms</h2>
            <p>We may update these Terms periodically.</p>
            <p>Updated Terms become effective upon publication unless otherwise stated.</p>
            <p>
              Continued use of PRISM after changes become effective constitutes acceptance of the revised Terms.
            </p>
          </section>

          {/* 23 */}
          <section className="pp-section">
            <h2>23. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of India, without
              regard to its conflict of law principles.
            </p>
            <p>
              Any disputes shall be subject to the exclusive jurisdiction of the courts located in Mumbai,
              Maharashtra, India, unless otherwise required by applicable law.
            </p>
          </section>

          {/* 24 */}
          <section className="pp-section">
            <h2>24. Contact Information</h2>
            <p>For questions regarding these Terms, please contact:</p>
            <div className="pp-contact-card">
              <p className="pp-contact-company">PRISM Support</p>
              <p>
                <span className="pp-contact-label">Email</span>
                <a href="mailto:support@askthechamp.com">support@askthechamp.com</a>
              </p>
              <p>
                <span className="pp-contact-label">Website</span>
                <a href="https://prismgrc.co" target="_blank" rel="noopener noreferrer">
                  prismgrc.co
                </a>
              </p>
            </div>
          </section>

          {/* 25 */}
          <section className="pp-section">
            <h2>25. Entire Agreement</h2>
            <p>
              These Terms, together with the <Link to="/privacy-policy">Privacy Policy</Link> and any
              applicable subscription or order agreement, constitute the entire agreement between you and
              PRISM regarding the Service and supersede all prior understandings relating to its subject matter.
            </p>
          </section>

        </div>
      </div>

      {/* Footer */}
      <footer className="pp-footer">
        <p>
          &copy; {CURRENT_YEAR} PRISM. All rights reserved. &mdash;{" "}
          <a href="mailto:support@askthechamp.com">support@askthechamp.com</a>
          {" · "}
          <Link to="/">Back to PRISM</Link>
        </p>
      </footer>

    </div>
  );
}
