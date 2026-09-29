import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client.js";

export default function Support() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/contact/support", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="support-page">
      {/* Hero Section */}
      <div className="support-hero">
        <div className="support-hero-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
          </svg>
        </div>
        <h1 className="support-hero-title">Get Support</h1>
        <p className="support-hero-subtitle">
          Need help? We're here for you. Send us a message and we'll get
          <br />
          back to you within 24 hours.
        </p>
      </div>

      {/* Form Card */}
      <div className="support-card">
        {submitted ? (
          <div className="support-success">
            <div className="support-success-icon">✓</div>
            <h2>Request Submitted</h2>
            <p>We've received your message and will get back to you within 24 hours.</p>
            <Link to="/" className="support-back-btn">Back to Home</Link>
          </div>
        ) : (
          <>
            <h2 className="support-card-title">Contact Support</h2>
            <p className="support-card-subtitle">Fill out the form below and we'll respond as quickly as possible.</p>

            <form onSubmit={handleSubmit}>
              <div className="support-form-row">
                <div className="form-group">
                  <label htmlFor="support-name">Name</label>
                  <input
                    id="support-name"
                    type="text"
                    placeholder="Your full name"
                    value={form.name}
                    onChange={update("name")}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="support-email">Email</label>
                  <input
                    id="support-email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={update("email")}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="support-message">Message</label>
                <textarea
                  id="support-message"
                  placeholder="Describe your issue or question in detail..."
                  value={form.message}
                  onChange={update("message")}
                  required
                  rows={5}
                />
              </div>

              {error && <p className="error-text">{error}</p>}

              <button type="submit" disabled={loading} className="support-submit-btn">
                {loading ? "Sending..." : "Submit Request"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
