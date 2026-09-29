import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getClient, mapRow, query } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { DEFAULT_LIST_ITEMS } from "../utils/defaultLists.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sendEmail } from "../utils/email.js";
import { buildEmailHtml } from "../utils/emailTemplate.js";
import { authenticate } from "../middleware/auth.js";
import { DEPT_QUESTIONS, DEPT_MODULE_META, getGenericDeptQuestions } from "../utils/departmentQuestions.js";
import { seedAssessmentsFromSelfAssessment } from "../utils/seedAssessmentsFromSelfAssessment.js";
import { writeUserDepartments } from "../utils/departmentScope.js";

const router = Router();

// Generic / personal email providers are not accepted for workspace sign-up —
// shared by the sign-up start step and the final register step.
const BLOCKED_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "yandex.com",
  "gmx.com", "gmx.net", "tutanota.com",
  "fastmail.com", "hushmail.com"
];

function isBlockedEmailDomain(email) {
  const domain = String(email || "").split("@")[1];
  return !domain || BLOCKED_EMAIL_DOMAINS.includes(domain);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

// Reset tokens use a separate key from login sessions (F-13).
const RESET_TOKEN_SECRET = () => `${process.env.JWT_SECRET}:password-reset`;

// Password-reset endpoints are limited twice: per client IP (broad volumetric cap)
// and per target email (stops an attacker from re-requesting OTPs to reset the
// per-code attempt counter, and from mail-bombing a victim's inbox).
const resetEmailKey = (req) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email ? `email:${email}` : `ip:${req.ip}`;
};

function resetLimiter({ windowMs, max, message, byEmail }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    ...(byEmail ? { keyGenerator: resetEmailKey } : {}),
  });
}

const resetIpLimiter = resetLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many password reset attempts. Please try again later." });
const forgotEmailLimiter = resetLimiter({ windowMs: 60 * 60 * 1000, max: 3, byEmail: true, message: "Too many password reset requests for this account. Please try again in an hour." });
const verifyOtpEmailLimiter = resetLimiter({ windowMs: 15 * 60 * 1000, max: 10, byEmail: true, message: "Too many verification attempts. Please try again in 15 minutes." });

// ═══════════════════════════════════════════════════════════════════
// SIGN-UP — magic-link email verification (step 1 of workspace creation)
// ═══════════════════════════════════════════════════════════════════

// Step 1: capture name + email, email a one-time link to the workspace form.
router.post("/signup/start", asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;
  const trimmedName = typeof fullName === "string" ? fullName.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!trimmedName || !normalizedEmail) {
    return res.status(400).json({ error: "Full name and work email are required" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  if (isBlockedEmailDomain(normalizedEmail)) {
    return res.status(400).json({ error: "Please use a corporate email address. Generic email providers (Gmail, Yahoo, iCloud, etc.) are not accepted." });
  }

  // Never reveal whether an account already exists — respond the same either way.
  const existingUser = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existingUser.rows.length === 0) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Supersede any earlier unconsumed link for this email.
    await query("DELETE FROM signup_verifications WHERE email = $1 AND consumed_at IS NULL", [normalizedEmail]);
    await query(
      "INSERT INTO signup_verifications (email, full_name, token, expires_at) VALUES ($1, $2, $3, $4)",
      [normalizedEmail, trimmedName, token, expiresAt]
    );

    const webUrl = (process.env.WEB_URL || "http://localhost:5173").replace(/\/$/, "");
    const link = `${webUrl}/register?token=${token}`;

    sendEmail({
      to: normalizedEmail,
      subject: "PRISM — Confirm your email to create your workspace",
      text: `Hi ${trimmedName},\n\nConfirm your email to finish creating your PRISM workspace:\n${link}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.\n\n— PRISM`,
      html: buildEmailHtml({
        heading: "Confirm your email",
        preheader: "One click to finish creating your PRISM workspace",
        body: [
          `Hi ${trimmedName},`,
          "Confirm your email address to continue setting up your PRISM workspace. You'll pick your company details and a password on the next screen.",
        ],
        cta: { text: "Create your workspace", url: link },
        note: "This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email.",
      }),
    }).catch(err => console.error("Failed to send signup verification email:", err.message));
  }

  res.json({ ok: true });
}));

// Step 2: the link target verifies the token and pre-fills the workspace form.
// Does NOT consume the token — that happens at /register, so a refresh or a
// double render doesn't burn the link.
router.get("/signup/verify", asyncHandler(async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) return res.status(400).json({ error: "Missing verification token" });

  const result = await query(
    "SELECT email, full_name, expires_at, consumed_at FROM signup_verifications WHERE token = $1",
    [token]
  );
  const row = mapRow(result);

  if (!row || row.consumedAt) {
    return res.status(400).json({ error: "This link is invalid or has already been used. Please start over." });
  }
  if (new Date() > new Date(row.expiresAt)) {
    return res.status(400).json({ error: "This link has expired. Please start over." });
  }

  res.json({ email: row.email, fullName: row.fullName });
}));

router.post("/register", asyncHandler(async (req, res) => {
  const { companyName, domain, industry, companySize, department, jobTitle, password, signupToken } = req.body;
  const trimmedName = typeof companyName === "string" ? companyName.trim() : "";
  const normalizedDomain = typeof domain === "string" ? domain.trim().toLowerCase().replace(/\s+/g, "-") : "";
  const domainPattern = /^[a-z0-9-]+$/;

  // Sign-up now goes through the magic-link flow: email + name come from the
  // verified signup_verifications row, not the request body.
  if (!signupToken || typeof signupToken !== "string") {
    return res.status(400).json({ error: "Missing sign-up verification. Please start over from the sign-up page." });
  }
  const verifyResult = await query(
    "SELECT id, email, full_name, expires_at, consumed_at FROM signup_verifications WHERE token = $1",
    [signupToken]
  );
  const verification = mapRow(verifyResult);
  if (!verification || verification.consumedAt || new Date() > new Date(verification.expiresAt)) {
    return res.status(400).json({ error: "Your sign-up link is invalid or has expired. Please start over from the sign-up page." });
  }
  const normalizedEmail = verification.email;
  const fullName = verification.fullName;

  if (!trimmedName || !normalizedDomain || !password) {
    return res.status(400).json({ error: "Company name, domain, and password are required" });
  }

  if (!domainPattern.test(normalizedDomain)) {
    return res.status(400).json({ error: "Domain must use lowercase letters, numbers, and hyphens only" });
  }

  // Corporate email validation — block generic providers
  if (isBlockedEmailDomain(normalizedEmail)) {
    return res.status(400).json({ error: "Please use a corporate email address. Generic email providers (Gmail, Yahoo, iCloud, etc.) are not accepted." });
  }

  // Password strength validation
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (!/[A-Z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one lowercase letter" });
  }
  if (!/[0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one number" });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one special character" });
  }
  
  const existingCompany = await query("SELECT id FROM companies WHERE domain = $1", [normalizedDomain]);
  if (existingCompany.rows.length > 0) {
    return res.status(400).json({ error: "Company domain already exists" });
  }

  const existingUser = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existingUser.rows.length > 0) {
    return res.status(400).json({ error: "Email already registered" });
  }

  // The `domain` field above is a slug the signer typed from the company name
  // ("Powerica Ltd" vs "Powerica Limited"), so it doesn't catch a colleague at
  // the same organization re-registering under different company-name phrasing.
  // The corporate email domain is the reliable identifier for "same org" here —
  // check it against every existing user, not just each company's admin_email,
  // since a company's original admin may have since left or been renamed.
  const emailDomain = normalizedEmail.split("@")[1];
  const existingOrg = await query(
    `SELECT c.name FROM users u JOIN companies c ON c.id = u.company_id
     WHERE LOWER(split_part(u.email, '@', 2)) = $1 LIMIT 1`,
    [emailDomain]
  );
  if (existingOrg.rows.length > 0) {
    return res.status(400).json({
      error: `A PRISM workspace for ${existingOrg.rows[0].name} already exists for your organization. Ask your workspace admin to invite you instead of creating a new workspace.`
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const client = await getClient();
  let company;
  let user;

  try {
    await client.query("BEGIN");

    const companyResult = await client.query(
      "INSERT INTO companies (name, domain, admin_email, industry, company_size, status, is_verified) VALUES ($1, $2, $3, $4, $5, 'active', FALSE) RETURNING id, name, domain, status",
      [trimmedName, normalizedDomain, normalizedEmail, industry || null, companySize || null]
    );
    company = mapRow(companyResult);

    const userResult = await client.query(
      "INSERT INTO users (email, password_hash, full_name, department, job_title, role, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role, company_id",
      [normalizedEmail, passwordHash, fullName.trim(), department || null, jobTitle || null, "ADMIN", company.id]
    );
    user = mapRow(userResult);

    for (const item of DEFAULT_LIST_ITEMS) {
      await client.query(
        "INSERT INTO list_items (company_id, list_name, value, color) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [company.id, item.listName, item.value, item.color || null]
      );
    }

    // Burn the magic link — guard against a concurrent double-submit.
    const consumed = await client.query(
      "UPDATE signup_verifications SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id",
      [verification.id]
    );
    if (consumed.rows.length === 0) {
      throw Object.assign(new Error("Your sign-up link has already been used. Please start over from the sign-up page."), { status: 400 });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId: user.companyId, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, onboardingCompleted: false },
    company: { id: company.id, name: company.name, domain: company.domain, isVerified: false }
  });
}));

router.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // Check super_admins table first
  const superResult = await query(
    "SELECT id, email, password_hash, token_version FROM super_admins WHERE email = $1",
    [normalizedEmail]
  );
  const superAdmin = mapRow(superResult);

  if (superAdmin) {
    const valid = await bcrypt.compare(password, superAdmin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: superAdmin.id, email: superAdmin.email, role: "SUPERADMIN", companyId: null, tv: superAdmin.tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: { id: superAdmin.id, email: superAdmin.email, role: "SUPERADMIN", companyId: null },
      company: null
    });
  }

  // Regular user login
  const result = await query(
    `SELECT u.id, u.email, u.role, u.password_hash, u.company_id, u.onboarding_completed, u.token_version,
            c.name AS company_name, c.domain AS company_domain, c.status AS company_status,
            c.plan AS company_plan, c.billing_status, c.trial_ends_at,
            c.is_verified AS company_is_verified
     FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1`,
    [normalizedEmail]
  );
  const user = mapRow(result);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Check company approval status
  if (user.companyStatus === "pending") {
    return res.status(403).json({ error: "Your company registration is pending approval. Please wait for a platform administrator to approve your account." });
  }
  if (user.companyStatus === "rejected") {
    return res.status(403).json({ error: "Your company registration has been rejected. Please contact the platform administrator." });
  }

  // Auditor-specific access checks
  if (user.role === "AUDITOR") {
    const profileResult = await query(
      "SELECT active, start_date, expiry_date FROM auditor_profiles WHERE user_id = $1",
      [user.id]
    );
    const profile = mapRow(profileResult);
    if (!profile || !profile.active) {
      return res.status(403).json({ error: "Auditor account is inactive" });
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const expiry = new Date(profile.expiryDate); expiry.setHours(0,0,0,0);
    if (expiry < today) {
      await query("UPDATE auditor_profiles SET active = FALSE, updated_at = NOW() WHERE user_id = $1", [user.id]);
      return res.status(403).json({ error: "Auditor access has expired" });
    }
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId: user.companyId, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, onboardingCompleted: user.onboardingCompleted },
    company: {
      id:            user.companyId,
      name:          user.companyName,
      domain:        user.companyDomain,
      plan:          user.companyPlan,
      billingStatus: user.billingStatus,
      trialEndsAt:   user.trialEndsAt,
      isVerified:    user.companyIsVerified ?? true,
    }
  });
}));

// GET /api/auth/invitation/:token — public, returns safe metadata about an invitation
router.get("/invitation/:token", asyncHandler(async (req, res) => {
  const { token } = req.params;
  if (!token) return res.status(400).json({ error: "Token required" });

  const invitationResult = await query(
    `SELECT i.email, i.role, i.expires_at, i.accepted_at, i.department,
            c.name AS company_name,
            u.email AS invitor_email, u.full_name AS invitor_name
     FROM invitations i
     JOIN companies c ON c.id = i.company_id
     LEFT JOIN users u ON u.company_id = i.company_id AND u.role = 'ADMIN'
     WHERE i.token = $1
     LIMIT 1`,
    [token]
  );

  if (invitationResult.rows.length === 0) {
    return res.status(404).json({ error: "Invitation not found" });
  }

  const row = invitationResult.rows[0];
  if (row.accepted_at) return res.status(400).json({ error: "Invitation already accepted" });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: "Invitation has expired" });

  res.json({
    inviteeEmail: row.email,
    role: row.role,
    companyName: row.company_name,
    invitorEmail: row.invitor_email,
    invitorName: row.invitor_name,
    department: row.department || null,
  });
}));

router.post("/accept-invitation", asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: "Token and password required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (!/[A-Z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one lowercase letter" });
  }
  if (!/[0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one number" });
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: "Password must contain at least one special character" });
  }
  
  const invitationResult = await query("SELECT * FROM invitations WHERE token = $1", [token]);
  const invitation = mapRow(invitationResult);
  if (!invitation || invitation.acceptedAt || new Date(invitation.expiresAt) < new Date()) {
    return res.status(400).json({ error: "Invalid or expired invitation" });
  }
  
  const passwordHash = await bcrypt.hash(password, 10);
  const client = await getClient();
  let user;
  let company;

  try {
    await client.query("BEGIN");

    const userResult = invitation.department
      ? await client.query(
          "INSERT INTO users (email, password_hash, role, company_id, department) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, company_id, department",
          [invitation.email, passwordHash, invitation.role, invitation.companyId, invitation.department]
        )
      : await client.query(
          "INSERT INTO users (email, password_hash, role, company_id) VALUES ($1, $2, $3, $4) RETURNING id, email, role, company_id",
          [invitation.email, passwordHash, invitation.role, invitation.companyId]
        );
    user = mapRow(userResult);

    // Department scoping. Ids were validated at invite time; the JOIN re-checks
    // company ownership in case a department was deleted since.
    if (invitation.allDepartments === false) {
      const deptIds = (await client.query(
        "SELECT id FROM departments WHERE company_id = $1 AND id = ANY($2::int[])",
        [invitation.companyId, invitation.departmentIds || []]
      )).rows.map((r) => r.id);
      await writeUserDepartments(client, user.id, { allDepartments: false, departmentIds: deptIds });
    }

    await client.query("UPDATE invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);

    const companyResult = await client.query(
      "SELECT id, name, domain, is_verified FROM companies WHERE id = $1",
      [invitation.companyId]
    );
    company = mapRow(companyResult);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  
  const authToken = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId: user.companyId, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  
  res.json({
    token: authToken,
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId },
    company: { id: company.id, name: company.name, domain: company.domain, isVerified: company.isVerified ?? false },
    department: invitation.department || null,
  });
}));

// ═══════════════════════════════════════════════════════════════════
// FORGOT PASSWORD — OTP FLOW
// ═══════════════════════════════════════════════════════════════════

// Step 1: Request OTP — sends a 6-digit code to the user's email
router.post("/forgot-password", resetIpLimiter, forgotEmailLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail) {
    return res.status(400).json({ error: "Email is required" });
  }

  // Find user (regular users only, not super admins)
  const result = await query("SELECT id, email FROM users WHERE email = $1", [normalizedEmail]);
  const user = mapRow(result);

  // Always return success to prevent email enumeration
  if (!user) {
    return res.json({ message: "If an account with that email exists, an OTP has been sent." });
  }

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store OTP (hashed for security)
  const otpHash = await bcrypt.hash(otp, 6);
  await query(
    "UPDATE users SET reset_otp = $1, reset_otp_expires = $2, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $3",
    [otpHash, expiresAt, user.id]
  );

  // Send OTP via email (fire and forget — don't block the response)
  sendEmail({
    to: user.email,
    subject: "PRISM — Password Reset Code",
    text: `Your password reset code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\n— PRISM Compliance Platform`,
    html: buildEmailHtml({
      heading: "Password Reset",
      preheader: `Your PRISM password reset code is: ${otp}`,
      body: "You requested a password reset for your PRISM account. Use the code below to continue. If you did not request this, you can safely ignore this email.",
      highlight: { label: "Your verification code", value: otp },
      note: "This code expires in 10 minutes and can only be used once.",
    }),
  }).catch(err => {
    console.error("Failed to send OTP email:", err.message);
  });

  res.json({ message: "If an account with that email exists, an OTP has been sent." });
}));

// Step 2: Verify OTP — confirms the code is valid
router.post("/verify-otp", resetIpLimiter, verifyOtpEmailLimiter, asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !otp) {
    return res.status(400).json({ error: "Email and OTP are required" });
  }

  const result = await query(
    "SELECT id, reset_otp, reset_otp_expires, reset_otp_attempts, token_version FROM users WHERE email = $1",
    [normalizedEmail]
  );
  const user = mapRow(result);

  if (!user || !user.resetOtp) {
    return res.status(400).json({ error: "No password reset was requested for this email" });
  }

  // Check expiry first — an expired OTP should never consume an attempt slot
  if (new Date() > new Date(user.resetOtpExpires)) {
    await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);
    return res.status(400).json({ error: "OTP has expired. Please request a new code." });
  }

  // Check max attempts (5 attempts allowed)
  if (user.resetOtpAttempts >= 5) {
    await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);
    return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  // Verify OTP
  const valid = await bcrypt.compare(otp.trim(), user.resetOtp);
  if (!valid) {
    await query("UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1, updated_at = NOW() WHERE id = $1", [user.id]);
    const remaining = 5 - (user.resetOtpAttempts + 1);
    return res.status(400).json({ error: `Invalid OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` });
  }

  // OTP is valid — generate a short-lived reset token (5 minutes)
  // Signed with its own key so it can never pass as a login session, and bound to the
  // current token_version so it is single-use (F-13).
  const resetToken = jwt.sign(
    { userId: user.id, email: normalizedEmail, purpose: "password-reset", tv: user.tokenVersion ?? 0 },
    RESET_TOKEN_SECRET(),
    { expiresIn: "5m" }
  );

  // Clear OTP from database
  await query("UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0, updated_at = NOW() WHERE id = $1", [user.id]);

  res.json({ resetToken, message: "OTP verified. You can now set a new password." });
}));

// Step 3: Reset password — uses the reset token from step 2
router.post("/reset-password", resetIpLimiter, asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required" });
  }

  // Password strength validation
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long" });
  }
  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one lowercase letter" });
  }
  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one number" });
  }
  if (!/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: "Password must contain at least one special character" });
  }

  // Verify reset token
  let payload;
  try {
    payload = jwt.verify(resetToken, RESET_TOKEN_SECRET());
  } catch (err) {
    return res.status(400).json({ error: "Reset token is invalid or has expired. Please start over." });
  }

  if (payload.purpose !== "password-reset") {
    return res.status(400).json({ error: "Invalid token" });
  }

  // Hash new password and update. Bumping token_version in the same statement makes the
  // reset token single-use (a replay no longer matches) and ends every existing session.
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const updated = await query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = NOW(),
            reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0
     WHERE id = $2 AND token_version = $3
     RETURNING id`,
    [passwordHash, payload.userId, payload.tv ?? 0]
  );
  if (updated.rowCount === 0) {
    return res.status(400).json({ error: "Reset token is invalid or has already been used. Please start over." });
  }

  res.json({ message: "Password has been reset successfully. You can now log in." });
}));

// POST /api/auth/complete-onboarding — creates department modules/quests and marks onboarding done
router.post("/complete-onboarding", authenticate, asyncHandler(async (req, res) => {
  const { departments = [] } = req.body;
  const companyId = req.user.companyId;

  if (departments.length > 0) {
    const client = await getClient();
    try {
      await client.query("BEGIN");

      for (let di = 0; di < departments.length; di++) {
        const dept = departments[di];
        const slug = dept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const moduleId = `dept-${slug}`;
        const meta = DEPT_MODULE_META[dept];
        const moduleName = meta ? meta.name : dept;
        const modulePurpose = meta ? meta.purpose : `${dept} compliance and data privacy controls`;
        const questions = DEPT_QUESTIONS[dept] || getGenericDeptQuestions(dept);

        await client.query(
          `INSERT INTO modules (module_id, company_id, name, purpose, total_quests, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (company_id, module_id) DO NOTHING`,
          [moduleId, companyId, moduleName, modulePurpose, questions.length, di + 1]
        );

        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          const questId = `dept-${slug}-q${String(qi + 1).padStart(2, "0")}`;
          await client.query(
            `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
                                   baseline_question, priority, tags, recurrence_interval)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'annual')
             ON CONFLICT (company_id, quest_id) DO NOTHING`,
            [questId, companyId, moduleId, moduleName, q.cat, q.text, q.priority, q.tags]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Pre-fill the newly-created department questions from the company's
    // self-assessment answers (draft/WIP rows — does not move the score). Runs
    // in its own transaction after onboarding commits; best-effort so a failure
    // never blocks onboarding completion.
    const seedClient = await getClient();
    try {
      await seedClient.query("BEGIN");
      await seedAssessmentsFromSelfAssessment(seedClient, companyId, { scope: "dept" });
      await seedClient.query("COMMIT");
    } catch (seedErr) {
      await seedClient.query("ROLLBACK");
      console.error("[auth] complete-onboarding self-assessment seeding failed:", seedErr.message); // nosemgrep
    } finally {
      seedClient.release();
    }
  }

  await query(
    "UPDATE users SET onboarding_completed = TRUE, updated_at = NOW() WHERE id = $1",
    [req.user.userId]
  );
  res.json({ onboardingCompleted: true });
}));

// GET /api/auth/me — return fresh user + company state for the current session
router.get("/me", authenticate, asyncHandler(async (req, res) => {
  if (req.user.role === "SUPERADMIN") {
    return res.json({ user: { id: req.user.userId, email: req.user.email, role: "SUPERADMIN", companyId: null }, company: null });
  }
  const result = await query(
    `SELECT u.id, u.email, u.role, u.company_id, u.onboarding_completed,
            c.name AS company_name, c.domain AS company_domain,
            c.plan AS company_plan, c.billing_status, c.trial_ends_at,
            c.is_verified AS company_is_verified
     FROM users u JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
    [req.user.userId]
  );
  const user = mapRow(result);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({
    user: { id: user.id, email: user.email, role: user.role, companyId: user.companyId, onboardingCompleted: user.onboardingCompleted },
    company: { id: user.companyId, name: user.companyName, domain: user.companyDomain, plan: user.companyPlan, billingStatus: user.billingStatus, trialEndsAt: user.trialEndsAt, isVerified: user.companyIsVerified ?? true }
  });
}));

export default router;
