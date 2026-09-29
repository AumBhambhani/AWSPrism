import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../../db/index.js";

export async function truncateAll() {
  await query(`
    TRUNCATE
      findings, automated_evidence_items, evidence_test_results, evidence_collection_runs,
      integration_credentials, integration_connections,
      company_storage_credentials, storage_migrations,
      upload_quarantine, evidence_request_comments, evidence_requests,
      question_evidence, evidence_versions, evidence_vault,
      question_dependencies, module_dependencies,
      import_cluster_members, import_clusters, import_staging_rows, import_batches,
      question_framework_controls, company_frameworks, module_templates,
      notifications, actions, assessments, evidence,
      questions, modules, invitations,
      audit_logs, auditor_profiles, reminders,
      list_items, consent_logs, company_settings,
      self_assessment_reports, self_assessment_submissions, signup_verifications,
      question_departments, user_departments, departments,
      users, companies, super_admins
    RESTART IDENTITY CASCADE
  `);
}

export async function createCompany(overrides = {}) {
  const result = await query(
    `INSERT INTO companies (name, domain, admin_email, status, billing_status, is_verified)
     VALUES ($1, $2, $3, 'active', 'active', TRUE) RETURNING *`,
    [
      overrides.name || "Test Corp",
      overrides.domain || `testcorp-${Date.now()}`,
      overrides.adminEmail || "admin@testcorp.com",
    ]
  );
  return result.rows[0];
}

// Insert a consumed-able sign-up verification row directly and return its token,
// so register tests can skip the email round-trip.
export async function createSignupToken(overrides = {}) {
  const token = overrides.token || `signup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await query(
    `INSERT INTO signup_verifications (email, full_name, token, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour') RETURNING *`,
    [
      (overrides.email || "admin@acmecorp.io").toLowerCase(),
      overrides.fullName || "John Admin",
      token,
    ]
  );
  return result.rows[0];
}

export async function createSuperAdmin(overrides = {}) {
  const email = overrides.email || `superadmin-${Date.now()}@prism.test`;
  const hash = await bcrypt.hash(overrides.password || "Test@1234", 4);

  const result = await query(
    `INSERT INTO super_admins (email, password_hash) VALUES ($1, $2) RETURNING *`,
    [email, hash]
  );
  const admin = result.rows[0];

  const token = jwt.sign(
    { userId: admin.id, email: admin.email, role: "SUPERADMIN", companyId: null },
    process.env.JWT_SECRET || "integration-test-secret",
    { expiresIn: "1d" }
  );

  return { ...admin, token };
}

export async function createUser(companyId, role, overrides = {}) {
  const email = overrides.email || `${role.toLowerCase()}-${Date.now()}@testcorp.com`;
  const hash = await bcrypt.hash(overrides.password || "Test@1234", 4);

  const result = await query(
    `INSERT INTO users (email, password_hash, full_name, role, company_id)
     VALUES ($1, $2, $3, $4::role, $5) RETURNING *`,
    [email, hash, overrides.fullName || `Test ${role}`, role, companyId]
  );
  const user = result.rows[0];

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, companyId },
    process.env.JWT_SECRET || "integration-test-secret",
    { expiresIn: "1d" }
  );

  return { ...user, token };
}

export async function createDepartment(companyId, name) {
  const result = await query(
    "INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING *",
    [companyId, name]
  );
  return result.rows[0];
}

// Puts a user into specific departments (and switches off all_departments).
export async function setUserDepartments(userId, departmentIds) {
  await query("UPDATE users SET all_departments = FALSE WHERE id = $1", [userId]);
  for (const deptId of departmentIds) {
    await query(
      "INSERT INTO user_departments (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, deptId]
    );
  }
}

export async function setQuestDepartments(companyId, questId, departmentIds) {
  for (const deptId of departmentIds) {
    await query(
      "INSERT INTO question_departments (company_id, quest_id, department_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [companyId, questId, deptId]
    );
  }
}
