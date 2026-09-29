import { Router } from "express";
import { sendEmail } from "../utils/email.js";
import { buildEmailHtml } from "../utils/emailTemplate.js";

const router = Router();
const CONTACT_TO = process.env.CONTACT_EMAIL || "ab@neozaar.com";

// Simple in-memory rate limit: max 3 submissions per IP per hour
const contactHits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = contactHits.get(ip);
  if (!entry || now > entry.resetAt) {
    contactHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  } else if (entry.count >= 3) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  } else {
    entry.count += 1;
  }
  next();
}

router.post("/", rateLimit, async (req, res) => {
  const { name, email, company, message, _subject } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const subject = _subject ? `[PRISM] ${_subject}` : "[PRISM] New contact form submission";
  const text = [
    `Name: ${name.trim()}`,
    `Email: ${email.trim()}`,
    company?.trim() ? `Company: ${company.trim()}` : null,
    "",
    message?.trim() || "(no message)",
  ].filter(l => l !== null).join("\n");

  try {
    await sendEmail({ to: CONTACT_TO, subject, text });
    res.json({ ok: true });
  } catch (err) {
    console.error("[contact] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send message. Please email us directly." });
  }
});

router.post("/support", rateLimit, async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();

  // Email to support team
  const subject = "[PRISM] Support Request";
  const text = [
    `Name: ${trimmedName}`,
    `Email: ${trimmedEmail}`,
    "",
    trimmedMessage,
  ].join("\n");

  const confirmationHtml = buildEmailHtml({
    heading: "We've Received Your Request",
    preheader: `Hi ${trimmedName}, we've received your support request and will respond within 24 hours.`,
    body: [
      `Hi ${trimmedName}, thank you for reaching out to PRISM Support. Our team will review your message and get back to you within 24 hours.`,
      "For urgent issues, email us directly at support@askthechamp.com",
    ],
    details: [
      { label: "Your Message", value: trimmedMessage },
    ],
    note: "1. Our team reviews your request  ·  2. We respond within 24 hours  ·  3. Issue resolved ✓",
  });

  const confirmationText = `Hi ${trimmedName},\n\nThank you for reaching out to PRISM Support. We've received your request and our team will get back to you within 24 hours.\n\nYour message:\n${trimmedMessage}\n\nFor urgent issues, email us directly at support@askthechamp.com\n\n— PRISM Support Team`;

  try {
    // Send to support team
    await sendEmail({ to: CONTACT_TO, subject, text, replyTo: trimmedEmail });

    // Send confirmation to user
    await sendEmail({
      to: trimmedEmail,
      subject: "[PRISM] We've received your support request",
      text: confirmationText,
      html: confirmationHtml,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact/support] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send message. Please email us directly at support@askthechamp.com" });
  }
});

// Rate limit for report emails: 2 per IP per hour (heavier payload)
const reportHits = new Map();
function reportRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = reportHits.get(ip);
  if (!entry || now > entry.resetAt) {
    reportHits.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
  } else if (entry.count >= 2) {
    return res.status(429).json({ error: "Too many report requests. Please try again later." });
  } else {
    entry.count += 1;
  }
  next();
}

router.post("/report", reportRateLimit, async (req, res) => {
  const { name, email, company, score, reportHtml, reportText } = req.body || {};
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
  if (!reportHtml || !reportText) {
    return res.status(400).json({ error: "Report data is required." });
  }

  const subject = `[PRISM] Your Compliance Assessment Report — Score: ${score ?? "??"}/100`;

  try {
    await sendEmail({
      to: email.trim(),
      subject,
      text: reportText,
      html: reportHtml,
    });

    // Notify admins that someone completed an assessment
    await sendEmail({
      to: CONTACT_TO,
      subject: `[PRISM] Assessment completed — ${name.trim()} (${company?.trim() || "no company"}) scored ${score ?? "??"}`,
      text: `Name: ${name.trim()}\nEmail: ${email.trim()}\nCompany: ${company?.trim() || "-"}\nScore: ${score ?? "??"}/100`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact/report] sendEmail error:", err.message);
    res.status(500).json({ error: "Failed to send report. Please try again." });
  }
});

export default router;
