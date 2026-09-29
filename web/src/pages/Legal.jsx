import { Link } from "react-router-dom";
import Logo from "../components/Logo";

const CURRENT_YEAR = new Date().getFullYear();

export default function PrivacyPolicy() {
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
          <h1>Privacy Policy</h1>
          <p className="pp-effective">Effective Date: July 28, 2026</p>
        </header>

        <div className="pp-body">

          {/* 1 */}
          <section className="pp-section">
            <h2>1. Introduction</h2>
            <p>
              Welcome to PRISM, an Information Security Governance, Risk, and Compliance (GRC) platform
              developed by <strong>Neozaar Digital Pvt. Ltd.</strong>
            </p>
            <p>
              We respect your privacy and are committed to protecting your personal and organizational
              information. This Privacy Policy explains how PRISM collects, uses, stores, secures, and
              processes information when you use our platform.
            </p>
            <p>
              By accessing or using PRISM, you agree to the practices described in this Privacy Policy.
            </p>
          </section>

          {/* 2 */}
          <section className="pp-section">
            <h2>2. Information We Collect</h2>

            <h3>Account Information</h3>
            <p>When your organization creates an account, we may collect:</p>
            <ul>
              <li>Name</li>
              <li>Business email address</li>
              <li>Organization name</li>
              <li>Job title</li>
              <li>Phone number (optional)</li>
              <li>Login credentials (encrypted)</li>
            </ul>

            <h3>Organization Data</h3>
            <p>PRISM stores information required to operate your compliance program, including:</p>
            <ul>
              <li>ISO 27001 assessments</li>
              <li>Compliance responses</li>
              <li>Risk registers</li>
              <li>Evidence documents</li>
              <li>Policies and procedures</li>
              <li>Audit findings</li>
              <li>Corrective actions</li>
              <li>Compliance reports</li>
              <li>Approval records</li>
              <li>User activity history</li>
            </ul>

            <h3>Technical Information</h3>
            <p>When using PRISM we automatically collect:</p>
            <ul>
              <li>IP address</li>
              <li>Browser type</li>
              <li>Login timestamps</li>
              <li>Session information</li>
              <li>Audit logs</li>
              <li>Error logs</li>
            </ul>

            <h3>Uploaded Files</h3>
            <p>Customers may upload:</p>
            <ul>
              <li>Policies</li>
              <li>Evidence documents</li>
              <li>Audit reports</li>
              <li>Screenshots</li>
              <li>Certificates</li>
              <li>Supporting documentation</li>
            </ul>
            <p>Uploaded files remain the property of the customer.</p>
          </section>

          {/* 3 */}
          <section className="pp-section">
            <h2>3. How We Use Your Information</h2>
            <p>We use collected information to:</p>
            <ul>
              <li>Provide PRISM services</li>
              <li>Authenticate users</li>
              <li>Manage user accounts</li>
              <li>Perform compliance assessments</li>
              <li>Store audit evidence</li>
              <li>Generate reports</li>
              <li>Improve platform performance</li>
              <li>Detect fraud or unauthorized access</li>
              <li>Maintain audit trails</li>
              <li>Provide technical support</li>
              <li>Meet legal obligations</li>
            </ul>
          </section>

          {/* 4 */}
          <section className="pp-section">
            <h2>4. AI Processing</h2>
            <p>Certain PRISM features may use Artificial Intelligence to assist with:</p>
            <ul>
              <li>Evidence analysis</li>
              <li>Document summarization</li>
              <li>Compliance recommendations</li>
              <li>Risk identification</li>
            </ul>
            <p>
              AI processing is designed to assist users and should not replace professional judgment.
              Customer content is processed only for providing requested services.
            </p>
          </section>

          {/* 5 */}
          <section className="pp-section">
            <h2>5. Data Storage</h2>
            <p>PRISM is hosted on Amazon Web Services (AWS). Customer data may be stored using services including:</p>
            <ul>
              <li>Amazon EC2</li>
              <li>Amazon RDS PostgreSQL</li>
              <li>Amazon S3</li>
              <li>AWS CloudTrail</li>
              <li>AWS Config</li>
              <li>AWS CloudWatch</li>
            </ul>
            <p>Data is encrypted during transmission using TLS. Sensitive information is encrypted at rest using AWS encryption capabilities.</p>
          </section>

          {/* 6 */}
          <section className="pp-section">
            <h2>6. Multi-Tenant Security</h2>
            <p>
              PRISM is a multi-tenant SaaS platform. Logical isolation mechanisms ensure one customer
              cannot access another customer's information. Each organization has isolated:
            </p>
            <ul>
              <li>Users</li>
              <li>Compliance records</li>
              <li>Evidence</li>
              <li>Reports</li>
              <li>Audit history</li>
            </ul>
          </section>

          {/* 7 */}
          <section className="pp-section">
            <h2>7. Role-Based Access</h2>
            <p>Access is restricted according to assigned roles. Typical roles include:</p>
            <ul>
              <li>Administrator</li>
              <li>Lead</li>
              <li>Contributor</li>
              <li>Reviewer</li>
              <li>Auditor</li>
            </ul>
            <p>Permissions determine which information each user may access.</p>
          </section>

          {/* 8 */}
          <section className="pp-section">
            <h2>8. Sharing of Information</h2>
            <p>We do not sell customer data. Information may only be shared:</p>
            <ul>
              <li>With authorized users within your organization</li>
              <li>With trusted cloud infrastructure providers necessary to operate PRISM</li>
              <li>When required by applicable law</li>
              <li>During business transfers such as mergers or acquisitions</li>
            </ul>
          </section>

          {/* 9 */}
          <section className="pp-section">
            <h2>9. Data Retention</h2>
            <p>Customer data is retained:</p>
            <ul>
              <li>While your subscription remains active</li>
              <li>As required by applicable law</li>
              <li>Until deletion is requested</li>
            </ul>
            <p>
              Following account termination, data will be securely deleted within a commercially
              reasonable timeframe unless legal obligations require longer retention.
            </p>
          </section>

          {/* 10 */}
          <section className="pp-section">
            <h2>10. Security</h2>
            <p>PRISM employs industry-standard security measures including:</p>
            <ul>
              <li>Encryption in transit</li>
              <li>Encryption at rest</li>
              <li>Role-based access control</li>
              <li>Secure password storage</li>
              <li>Audit logging</li>
              <li>AWS infrastructure security</li>
              <li>Continuous monitoring</li>
              <li>Backup and disaster recovery procedures</li>
            </ul>
            <p>
              No system can guarantee absolute security, but we continuously work to protect customer information.
            </p>
          </section>

          {/* 11 */}
          <section className="pp-section">
            <h2>11. Cookies</h2>
            <p>PRISM uses cookies and similar technologies to:</p>
            <ul>
              <li>Maintain user sessions</li>
              <li>Improve user experience</li>
              <li>Remember preferences</li>
              <li>Analyze platform performance</li>
            </ul>
            <p>
              Users may disable cookies through browser settings, although some features may not function properly.
            </p>
          </section>

          {/* 12 */}
          <section className="pp-section">
            <h2>12. Customer Rights</h2>
            <p>Depending on applicable law, customers may have the right to:</p>
            <ul>
              <li>Access personal information</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion</li>
              <li>Restrict processing</li>
              <li>Export their data</li>
              <li>Withdraw consent where applicable</li>
            </ul>
            <p>Requests can be submitted using the contact information below.</p>
          </section>

          {/* 13 */}
          <section className="pp-section">
            <h2>13. International Data Transfers</h2>
            <p>
              Customer data may be processed in AWS regions selected by Neozaar or the customer.
              Where required, appropriate safeguards are implemented for cross-border transfers.
            </p>
          </section>

          {/* 14 */}
          <section className="pp-section">
            <h2>14. Children's Privacy</h2>
            <p>
              PRISM is intended solely for business and enterprise use. It is not directed toward
              individuals under 18 years of age.
            </p>
          </section>

          {/* 15 */}
          <section className="pp-section">
            <h2>15. Third-Party Services</h2>
            <p>
              PRISM may integrate with third-party platforms, including cloud and identity providers.
              These services are governed by their own privacy policies.
            </p>
          </section>

          {/* 16 */}
          <section className="pp-section">
            <h2>16. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. Material changes will be communicated
              through the PRISM platform or via email. The updated policy becomes effective upon publication.
            </p>
          </section>

          {/* 17 */}
          <section className="pp-section">
            <h2>17. Contact Us</h2>
            <div className="pp-contact-card">
              <p className="pp-contact-company">Neozaar Digital Pvt. Ltd.</p>
              <p>
                <span className="pp-contact-label">Email</span>
                <a href="mailto:info@neozaar.com">info@neozaar.com</a>
              </p>
              <p>
                <span className="pp-contact-label">Website</span>
                <a href="https://www.neozaar.com" target="_blank" rel="noopener noreferrer">
                  www.neozaar.com
                </a>
              </p>
            </div>
          </section>

          {/* 18 */}
          <section className="pp-section">
            <h2>18. Applicable Laws</h2>
            <p>
              PRISM is designed to support compliance with applicable privacy and security requirements, including:
            </p>
            <ul>
              <li>India's Digital Personal Data Protection (DPDP) Act, where applicable</li>
              <li>General Data Protection Regulation (GDPR), where applicable</li>
              <li>Enterprise information security best practices</li>
            </ul>
          </section>

        </div>
      </div>

      {/* Footer */}
      <footer className="pp-footer">
        <p>
          &copy; {CURRENT_YEAR} Neozaar Digital Pvt. Ltd. All rights reserved. &mdash;{" "}
          <a href="mailto:info@neozaar.com">info@neozaar.com</a>
          {" · "}
          <Link to="/">Back to PRISM</Link>
        </p>
      </footer>

    </div>
  );
}
