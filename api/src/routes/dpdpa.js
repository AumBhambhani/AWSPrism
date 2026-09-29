import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { scanWebsite } from "../scanner/scanner.js";
import { scanMobileApp } from "../scanner/mobile.js";
import { evaluateCompliance } from "../scanner/scorer.js";
import { renderHtml, renderConsole } from "../scanner/report.js";
import { sendEmail } from "../utils/email.js";

const router = Router();

// Dedicated recipient for homepage scan reports — intentionally not CONTACT_EMAIL,
// which this deployment overrides to team@prismgrc.co for the general contact form.
const SCAN_REPORT_TO = process.env.SITE_SCAN_REPORT_EMAIL || "ab@neozaar.com";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// neozaar.com (Prism's own team) is exempt from the "email domain must match
// the scanned site" rule below, so they can scan any site for demos/prospecting.
const UNRESTRICTED_EMAIL_DOMAINS = new Set(["neozaar.com"]);

function extractHost(rawUrl) {
  let trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) trimmed = "https://" + trimmed;
  return new URL(trimmed).hostname.replace(/^www\./i, "").toLowerCase();
}

// Simple in-memory rate limiter for unauthenticated scan endpoints
const publicScanHits = new Map(); // ip → { count, resetAt }
const PUBLIC_SCAN_LIMIT = 5;      // requests per window
const PUBLIC_SCAN_WINDOW_MS = 60 * 1000; // 1 minute
let activeScanCount = 0;
const MAX_CONCURRENT_SCANS = 3;

function publicScanRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = publicScanHits.get(ip);

  if (!entry || now > entry.resetAt) {
    publicScanHits.set(ip, { count: 1, resetAt: now + PUBLIC_SCAN_WINDOW_MS });
  } else if (entry.count >= PUBLIC_SCAN_LIMIT) {
    return res.status(429).json({ error: "Too many scan requests. Please wait a minute and try again." });
  } else {
    entry.count += 1;
  }

  if (activeScanCount >= MAX_CONCURRENT_SCANS) {
    return res.status(503).json({ error: "Scanner is busy. Please try again shortly." });
  }

  next();
}

async function runScan(url, { type = "website", headless = false, policy = null } = {}) {
  const signals =
    type === "mobile"
      ? await scanMobileApp(url, { privacyPolicyUrl: policy })
      : await scanWebsite(url, { headless: !!headless });

  if (signals.reachable === false)
    throw Object.assign(new Error(`Could not reach target. ${(signals.errors || []).join(" ")}`), { status: 422 });

  const evaluation = evaluateCompliance(signals);
  return { target: url, signals, evaluation };
}

// Public scan (no auth) — website only, no headless
router.post("/public-scan", publicScanRateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  activeScanCount++;
  try {
    const result = await runScan(url.trim());
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : "Scan failed. Please try again." });
  } finally {
    activeScanCount--;
  }
});

// Public scan + email (homepage scanner) — no auth, report is emailed, never returned to the client
router.post("/public-scan-email", publicScanRateLimit, async (req, res) => {
  const { url, email } = req.body || {};
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });
  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim()))
    return res.status(400).json({ error: "A valid email address is required." });

  let host;
  try {
    host = extractHost(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL." });
  }

  const emailDomain = email.trim().split("@")[1]?.toLowerCase();
  if (!emailDomain || (emailDomain !== host && !UNRESTRICTED_EMAIL_DOMAINS.has(emailDomain))) {
    return res.status(400).json({
      error: `Please use an email address on the ${host} domain to request this report.`,
    });
  }

  activeScanCount++;
  try {
    const { target, signals, evaluation } = await runScan(url.trim());
    const trimmedEmail = email.trim();
    const consoleText = renderConsole(target, signals, evaluation);
    const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
    const cta = { url: `${webUrl}/register` };
    const ctaText = `\n\nTake your free self-assessment: ${webUrl}/register\n`;

    // Admin copy — includes who submitted this and what was scanned, plus the CTA.
    const adminHtml = renderHtml(target, signals, evaluation, {
      email: true,
      submission: { email: trimmedEmail },
      cta,
    });
    const adminText = consoleText + `\n\nSubmitted email: ${trimmedEmail}\n` + ctaText;

    // User copy — the same branded PRISM report, plus a closing CTA to self-assess.
    const userHtml = renderHtml(target, signals, evaluation, { email: true, cta });
    const userText = consoleText + ctaText;

    await Promise.all([
      sendEmail({
        to: SCAN_REPORT_TO,
        subject: `[PRISM] Site Scan Report — ${host} (${evaluation.overall.score}/100)`,
        text: adminText,
        html: adminHtml,
      }),
      sendEmail({
        to: trimmedEmail,
        subject: `[PRISM] Your DPDPA & GDPR Compliance Report — ${host}`,
        text: userText,
        html: userHtml,
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : "Scan failed. Please try again." });
  } finally {
    activeScanCount--;
  }
});

// Public HTML report (opens in new tab for print-to-PDF)
router.post("/public-report", publicScanRateLimit, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  activeScanCount++;
  try {
    const { target, signals, evaluation } = await runScan(url.trim());
    const html = renderHtml(target, signals, evaluation);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : "Scan failed. Please try again." });
  } finally {
    activeScanCount--;
  }
});

// Authenticated scan — full features (headless, mobile, policy URL)
router.post("/scan", authenticate, async (req, res) => {
  const { url, type = "website", headless = false, policy = null } = req.body;
  if (!url || typeof url !== "string" || !url.trim())
    return res.status(400).json({ error: "URL is required." });

  try {
    const result = await runScan(url.trim(), { type, headless, policy });
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : "Scan failed. Please try again." });
  }
});

export default router;
