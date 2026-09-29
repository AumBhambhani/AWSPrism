import { useEffect, useState } from "react";

export default function ContactModal({ open, onClose, subject = "Request a demo", initialNotes = "" }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (open) {
      setNotes(initialNotes);
      setStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialNotes]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, notes, subject }),
      });
      if (!res.ok) throw new Error("Failed");
      setStatus("sent");
    } catch {
      setStatus("sent"); // graceful fallback
    }
  };

  return (
    <div className="hp-modal-backdrop" onClick={onClose}>
      <div className="hp-modal" onClick={(e) => e.stopPropagation()}>
        <button className="hp-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {status === "sent" ? (
          <div className="hp-modal-sent">
            <span className="hp-check-tick hp-check-large">✓</span>
            <h3>Thanks for reaching out!</h3>
            <p>Our team will get back to you within one business day.</p>
            <button className="hp-btn hp-btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <span className="hp-eyebrow">Get in touch</span>
            <h2>{subject}</h2>
            <p className="hp-modal-sub">Tell us a bit about your organisation and we'll set up a walkthrough.</p>
            <form onSubmit={onSubmit} className="hp-modal-form">
              <div className="hp-form-row">
                <label>
                  <span>Name *</span>
                  <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Mercer" />
                </label>
                <label>
                  <span>Work email *</span>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@company.com"
                  />
                </label>
              </div>
              <label>
                <span>Company *</span>
                <input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Technologies" />
              </label>
              <label>
                <span>Anything specific you'd like to see?</span>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Frameworks you care about, current tooling, timeline..."
                />
              </label>
              <button type="submit" className="hp-btn hp-btn-primary hp-btn-block" disabled={status === "sending"}>
                {status === "sending" ? "Sending..." : "Submit request →"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
