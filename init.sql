BEGIN;

-- ===== Enums =====
DO $$ BEGIN
  CREATE TYPE role AS ENUM ('ADMIN', 'LEAD', 'CONTRIBUTOR', 'REVIEWER', 'AUDITOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- VIEWER renamed to REVIEWER — idempotent for already-migrated/fresh DBs.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'role' AND e.enumlabel = 'VIEWER'
  ) THEN
    ALTER TYPE role RENAME VALUE 'VIEWER' TO 'REVIEWER';
  END IF;
END $$;

-- ===== Core Tables =====

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  admin_email TEXT NOT NULL,
  industry TEXT,
  company_size TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  plan TEXT NOT NULL DEFAULT 'starter',
  billing_status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  template_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(status);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  department TEXT,
  job_title TEXT,
  role role NOT NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reset_otp TEXT,
  reset_otp_expires TIMESTAMPTZ,
  reset_otp_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_company_id_idx ON users(company_id);

CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  module_id TEXT NOT NULL,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  primary_owner TEXT,
  frequency TEXT,
  total_quests INT,
  purpose TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS modules_company_id_idx ON modules(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS modules_company_module_id_idx ON modules(company_id, module_id);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  quest_id TEXT NOT NULL,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  module_name TEXT,
  control_area TEXT,
  iso_reference TEXT,
  baseline_question TEXT,
  level3_yes_criteria TEXT,
  required_evidence TEXT,
  default_owner TEXT,
  frequency TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  tags TEXT,
  due_date DATE,
  recurrence_interval TEXT DEFAULT 'monthly',
  next_due_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS questions_module_id_idx ON questions(module_id);
CREATE INDEX IF NOT EXISTS questions_company_id_idx ON questions(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS questions_company_quest_id_idx ON questions(company_id, quest_id);

CREATE TABLE IF NOT EXISTS assessments (
  id SERIAL PRIMARY KEY,
  assessment_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  control_area TEXT,
  answer TEXT,
  current_level INT,
  level3_plus BOOLEAN,
  evidence_link TEXT,
  owner TEXT,
  submitted_by TEXT,
  reviewer TEXT,
  review_status TEXT,
  score_eligible BOOLEAN,
  comments TEXT,
  reviewed_by TEXT,
  audited_by TEXT,
  reviewed_at TIMESTAMPTZ,
  audited_at TIMESTAMPTZ,
  reviewer_notes TEXT,
  auditor_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assessments_company_id_idx ON assessments(company_id);
CREATE INDEX IF NOT EXISTS assessments_module_id_idx ON assessments(module_id);
CREATE INDEX IF NOT EXISTS assessments_quest_id_idx ON assessments(quest_id);

CREATE TABLE IF NOT EXISTS actions (
  id SERIAL PRIMARY KEY,
  action_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  defeated_quest TEXT,
  current_level INT,
  target_level INT,
  immediate_action_required BOOLEAN,
  owner TEXT,
  due_date TIMESTAMPTZ,
  status TEXT,
  closure_evidence_link TEXT,
  reviewer TEXT,
  closure_date TIMESTAMPTZ,
  notes TEXT,
  reminder_sent_offsets INT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS actions_company_id_idx ON actions(company_id);
CREATE INDEX IF NOT EXISTS actions_module_id_idx ON actions(module_id);
CREATE INDEX IF NOT EXISTS actions_quest_id_idx ON actions(quest_id);

CREATE TABLE IF NOT EXISTS evidence (
  id SERIAL PRIMARY KEY,
  evidence_id TEXT,
  month TEXT,
  module_id TEXT,
  quest_id TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  evidence_type TEXT,
  evidence_name TEXT,
  evidence_link TEXT,
  file_path TEXT,
  uploaded_by TEXT,
  upload_date TIMESTAMPTZ,
  reviewer TEXT,
  approval_status TEXT,
  notes TEXT,
  ai_contributor_comments TEXT,
  ai_reviewer_comments TEXT,
  ai_gaps JSONB,
  ai_suggestions JSONB,
  ai_analyzed_at TIMESTAMPTZ,
  ai_date_warning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evidence_company_id_idx ON evidence(company_id);
CREATE INDEX IF NOT EXISTS evidence_module_id_idx ON evidence(module_id);
CREATE INDEX IF NOT EXISTS evidence_quest_id_idx ON evidence(quest_id);

CREATE TABLE IF NOT EXISTS list_items (
  id SERIAL PRIMARY KEY,
  list_name TEXT NOT NULL,
  value TEXT NOT NULL,
  color TEXT,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, list_name, value)
);
CREATE INDEX IF NOT EXISTS list_items_company_id_idx ON list_items(company_id);
CREATE INDEX IF NOT EXISTS list_items_company_list_name_idx ON list_items(company_id, list_name);

CREATE TABLE IF NOT EXISTS import_logs (
  id SERIAL PRIMARY KEY,
  source_file TEXT,
  status TEXT,
  notes TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auditor_profiles (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '14 days'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auditor_profiles_company_id_idx ON auditor_profiles(company_id);
CREATE INDEX IF NOT EXISTS auditor_profiles_expiry_idx ON auditor_profiles(expiry_date) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  detail JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_company_id_idx ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role role NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  department TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS department TEXT;

-- ===== Self-Assessment Submissions =====
CREATE TABLE IF NOT EXISTS self_assessment_submissions (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  department TEXT NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS self_assess_submissions_unique
  ON self_assessment_submissions (company_id, user_email, department);
ALTER TABLE self_assessment_submissions ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}';

-- Caches the AI-generated regulatory-exposure mapping (aiProvider.mapRegulatoryExposure)
-- for a company's current set of self-assessment submissions, so GET /api/self-assessment
-- only re-runs the AI call when submissions_fingerprint changes (every submission edit
-- changes it) rather than on every page view/email. `mappings` holds the already-validated
-- result (see aiProvider.js validExposureMapping) — never raw model output.
CREATE TABLE IF NOT EXISTS self_assessment_reports (
  company_id INT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  submissions_fingerprint TEXT NOT NULL,
  mappings JSONB NOT NULL DEFAULT '[]',
  ai_provider TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- The AI-authored narrative layer of the Big-4 DPDPA readiness report
-- (business context, role-map notes, SDF-designation factors, sector
-- benchmarking, exec bullets — see utils/readinessNarrativePrompt.js). Cached
-- like `mappings` but keyed by narrative_fingerprint = submissions fingerprint
-- + a hash of the company profile, since the narrative also depends on
-- industry / size. NULL narrative → the report renders its templated fallback.
ALTER TABLE self_assessment_reports ADD COLUMN IF NOT EXISTS narrative JSONB;
ALTER TABLE self_assessment_reports ADD COLUMN IF NOT EXISTS narrative_fingerprint TEXT;

-- ===== Environment-first capability assessment =====
-- One row per company: the answers to the ~25 environment questions
-- (api/src/data/environmentQuestions.js), keyed by question `key`
-- ({ platforms: ["m365"], mobile: "YES", ... }). PRISM derives which security
-- capabilities are Mandatory / Recommended / N-A from these.
CREATE TABLE IF NOT EXISTS company_environment (
  company_id INT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The company's own statement, per applicable capability, of whether it has it
-- (api/src/data/capabilityLibrary.js ids, e.g. 'cap-waf') and which tool it uses.
-- source is 'self' for now; a later connector-verified value would use another source.
CREATE TABLE IF NOT EXISTS company_capability_status (
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL,
  available TEXT NOT NULL CHECK (available IN ('YES', 'PARTIAL', 'NO', 'UNKNOWN')),
  tool TEXT,
  source TEXT NOT NULL DEFAULT 'self',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, capability_id)
);

CREATE INDEX IF NOT EXISTS invitations_company_id_idx ON invitations(company_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations(token);

-- ===== Sign-up email verification (magic link) =====
-- One row per pending workspace sign-up: name + email are captured first, a
-- one-time link is emailed, and the row is consumed when POST /api/auth/register
-- creates the company. No FK — the user/company do not exist yet.
CREATE TABLE IF NOT EXISTS signup_verifications (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS signup_verifications_email_idx ON signup_verifications (email);

-- Self-assessment completion tracking (see POST /api/self-assessment/complete):
--   self_assessment_completed_at    — when the admin finished their part and the
--                                     TEAM_NOTIFY_EMAIL notification fired.
--   self_assessment_departments     — the full set of departments the admin selected
--                                     (JSON array of names); the "expected" set a
--                                     superadmin report needs a submission for.
--   self_assessment_all_departments_at — when a submission finally existed for every
--                                     department in that expected set. NULL while any
--                                     delegated department is still outstanding; the
--                                     superadmin gap report is gated on this.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS self_assessment_completed_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS self_assessment_departments JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS self_assessment_all_departments_at TIMESTAMPTZ;
-- Set the first time the self-assessment -> tracker pre-fill ran for this company
-- (utils/seedAssessmentsFromSelfAssessment.js, triggered on approval and on
-- department onboarding). Informational only — the real idempotency guard is a
-- per-(company, quest, month) existence check, so partial runs self-heal.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS self_assessment_seeded_at TIMESTAMPTZ;

-- ===== Super Admin =====

CREATE TABLE IF NOT EXISTS super_admins (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- F-21: bumped on every password change; session JWTs carry it as `tv`.
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS company_settings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  logo_url TEXT,
  primary_color TEXT,
  ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,  -- AI is opt-in per company (superadmin enables via /ai-toggle)
  default_reminder_offsets INT[] NOT NULL DEFAULT '{7,14,30}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS company_settings_company_id_idx ON company_settings(company_id);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  action_id INT REFERENCES actions(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT,
  module_id TEXT,
  reminder_type TEXT NOT NULL DEFAULT 'action_due',
  remind_at TIMESTAMPTZ NOT NULL,
  recipient_email TEXT,
  message TEXT,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reminders_company_id_idx ON reminders(company_id);
CREATE INDEX IF NOT EXISTS reminders_remind_at_idx ON reminders(remind_at) WHERE sent = FALSE;
CREATE INDEX IF NOT EXISTS reminders_action_id_idx ON reminders(action_id);

CREATE TABLE IF NOT EXISTS module_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  module_data JSONB NOT NULL,
  question_data JSONB NOT NULL,
  created_by INT REFERENCES super_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_module_templates_created_by ON module_templates(created_by);

-- ===== Consent Logs =====

CREATE TABLE IF NOT EXISTS consent_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(45) NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  consent_version VARCHAR(20) NOT NULL,
  choices JSONB NOT NULL DEFAULT '{}',
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consent_logs_ip_anon
  ON consent_logs (ip_address, created_at DESC)
  WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_logs_user
  ON consent_logs (user_id, created_at DESC);

-- ===== Evidence Vault =====

CREATE TABLE IF NOT EXISTS evidence_vault (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assessment_id INT REFERENCES assessments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  storage_path TEXT,
  evidence_link TEXT,
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  legacy_evidence_id INT,
  locked BOOLEAN NOT NULL DEFAULT false,
  -- AI evidence analysis lives on the reusable vault item so it is shared by every
  -- question (and therefore every framework) the item is linked to.
  ai_contributor_comments TEXT,
  ai_reviewer_comments TEXT,
  ai_gaps JSONB,
  ai_suggestions JSONB,
  ai_analyzed_at TIMESTAMPTZ,
  ai_date_warning TEXT,
  ai_analyzed_version INT,
  ai_provider TEXT,
  -- Auto-analysis lifecycle: 'queued' | 'running' | 'failed' | NULL (done or never run).
  ai_analysis_status TEXT,
  -- Cached policy gap-analysis (POST /vault/:id/analyze-policy). Deterministic in
  -- the file bytes + policy label + resolved model, so the fingerprint keys on
  -- storage_path (changes on every new version) + label + model id.
  ai_policy_analysis JSONB,
  ai_policy_analyzed_at TIMESTAMPTZ,
  ai_policy_provider TEXT,
  ai_policy_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS evidence_vault_company_idx ON evidence_vault(company_id);
CREATE INDEX IF NOT EXISTS evidence_vault_title_idx ON evidence_vault(company_id, title);
CREATE INDEX IF NOT EXISTS idx_evidence_vault_locked ON evidence_vault(locked) WHERE locked = true;

CREATE TABLE IF NOT EXISTS question_evidence (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  vault_id INT NOT NULL REFERENCES evidence_vault(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by TEXT,
  CONSTRAINT question_evidence_unique UNIQUE (company_id, quest_id, vault_id)
);
CREATE INDEX IF NOT EXISTS question_evidence_quest_idx ON question_evidence(company_id, quest_id);
CREATE INDEX IF NOT EXISTS question_evidence_vault_idx ON question_evidence(vault_id);

CREATE TABLE IF NOT EXISTS evidence_versions (
  id             SERIAL PRIMARY KEY,
  evidence_id    INTEGER NOT NULL REFERENCES evidence_vault(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_name      TEXT,
  file_type      TEXT,
  file_size      BIGINT,
  storage_path   TEXT,
  uploaded_by    TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version_notes  TEXT,
  UNIQUE (evidence_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_evidence_id ON evidence_versions(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_versions_uploaded_at ON evidence_versions(uploaded_at DESC);

-- ===== Evidence Requests =====

CREATE TABLE IF NOT EXISTS evidence_requests (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assessment_id INT REFERENCES assessments(id) ON DELETE SET NULL,
  question_id TEXT,
  artifact_group_id INT,
  requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Submitted', 'Completed', 'Cancelled')),
  fulfilled_evidence_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_requests_company_idx ON evidence_requests(company_id);
CREATE INDEX IF NOT EXISTS evidence_requests_assignee_idx ON evidence_requests(company_id, assignee_id);
CREATE INDEX IF NOT EXISTS evidence_requests_requester_idx ON evidence_requests(company_id, requester_id);
CREATE INDEX IF NOT EXISTS evidence_requests_status_idx ON evidence_requests(company_id, status);

CREATE TABLE IF NOT EXISTS evidence_request_comments (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES evidence_requests(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erc_request_idx ON evidence_request_comments(request_id);

-- ===== Question Dependencies =====

CREATE TABLE IF NOT EXISTS question_dependencies (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  depends_on_quest_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT question_dependencies_unique UNIQUE (company_id, quest_id, depends_on_quest_id)
);
CREATE INDEX IF NOT EXISTS question_dependencies_quest_idx ON question_dependencies(company_id, quest_id);
CREATE INDEX IF NOT EXISTS question_dependencies_depends_on_idx ON question_dependencies(company_id, depends_on_quest_id);

-- ===== Module Dependencies =====

CREATE TABLE IF NOT EXISTS module_dependencies (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  depends_on_module_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT module_dependencies_unique UNIQUE (company_id, module_id, depends_on_module_id)
);
CREATE INDEX IF NOT EXISTS module_dependencies_module_idx ON module_dependencies(company_id, module_id);
CREATE INDEX IF NOT EXISTS module_dependencies_depends_on_idx ON module_dependencies(company_id, depends_on_module_id);

-- ===== Notifications =====

CREATE TABLE IF NOT EXISTS notifications (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT,
  entity_type  TEXT,
  entity_id    INTEGER,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id, created_at DESC);

-- ===== Marketplace Subscriptions =====

CREATE TABLE IF NOT EXISTS marketplace_subscriptions (
  id                    SERIAL PRIMARY KEY,
  subscription_id       TEXT NOT NULL UNIQUE,
  company_id            INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  plan_id               TEXT,
  quantity              INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'PendingFulfillmentStart',
  purchaser_email       TEXT,
  purchaser_tenant_id   TEXT,
  beneficiary_email     TEXT,
  beneficiary_tenant_id TEXT,
  offer_id              TEXT,
  publisher_id          TEXT,
  term_start_date       TIMESTAMPTZ,
  term_end_date         TIMESTAMPTZ,
  auto_renew            BOOLEAN NOT NULL DEFAULT true,
  is_free_trial         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_company ON marketplace_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_subs_status  ON marketplace_subscriptions(status);

-- ===== Automated Evidence Collection =====

CREATE TABLE IF NOT EXISTS integrations (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('iam_role', 'access_key', 'oauth2', 'api_key')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'beta', 'coming_soon')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','revoked')),
  external_account_id TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_connections_company_idx ON integration_connections(company_id);
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS collection_frequency_hours INT NOT NULL DEFAULT 24;
ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS auto_collect_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS integration_credentials (
  id SERIAL PRIMARY KEY,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  auth_type TEXT NOT NULL,
  ciphertext TEXT,
  iv TEXT,
  auth_tag TEXT,
  key_id TEXT NOT NULL DEFAULT 'local-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integration_credentials_connection_idx ON integration_credentials(connection_id);

CREATE TABLE IF NOT EXISTS automated_tests (
  id SERIAL PRIMARY KEY,
  integration_key TEXT NOT NULL REFERENCES integrations(key),
  test_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  severity_default TEXT NOT NULL CHECK (severity_default IN ('critical','high','medium','low')),
  remediation_guidance TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Maps an automated test to a control in a framework. `iso_reference` is a
-- historical column name — it holds whatever reference the `framework` uses:
-- an ISO 27001:2013 Annex A clause, a DPDPA control_area string, a GDPR article,
-- a SOC 2 criterion, a CIS/PCI DSS control number, etc. The ISO27001 and DPDPA
-- rows are seeded below and by syncTestDefinitions(); every other framework's
-- rows are derived at startup by syncTestDefinitions() from the connector check's
-- ISO references via api/src/data/crosswalk/iso27001-annexa-crosswalk.json.
CREATE TABLE IF NOT EXISTS test_control_mappings (
  id SERIAL PRIMARY KEY,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  framework TEXT NOT NULL DEFAULT 'ISO27001',
  iso_reference TEXT NOT NULL,
  UNIQUE(test_key, framework, iso_reference)
);
-- Supports the crosswalk-propagation join in collectionRunner.js /
-- dashboard.js: (framework, iso_reference) -> question_framework_controls
-- (framework_key, control_reference).
CREATE INDEX IF NOT EXISTS test_control_mappings_framework_ref_idx
  ON test_control_mappings(framework, iso_reference);

CREATE TABLE IF NOT EXISTS evidence_collection_runs (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','scheduled','retry')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial_failure','failed')),
  tests_run INT NOT NULL DEFAULT 0,
  tests_passed INT NOT NULL DEFAULT 0,
  tests_failed INT NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by INT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_company_idx ON evidence_collection_runs(company_id);
CREATE INDEX IF NOT EXISTS evidence_collection_runs_connection_idx ON evidence_collection_runs(connection_id);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_collection_runs_running_uq ON evidence_collection_runs(connection_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS evidence_test_results (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES evidence_collection_runs(id) ON DELETE CASCADE,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warn','error','not_applicable')),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  message TEXT,
  evidence_payload JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS evidence_test_results_run_idx ON evidence_test_results(run_id);
CREATE INDEX IF NOT EXISTS evidence_test_results_company_idx ON evidence_test_results(company_id);

CREATE TABLE IF NOT EXISTS automated_evidence_items (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  evidence_vault_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  latest_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','stale','expired')),
  first_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_collection_due_at TIMESTAMPTZ,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS automated_evidence_items_company_idx ON automated_evidence_items(company_id);

CREATE TABLE IF NOT EXISTS findings (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id INT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  test_key TEXT NOT NULL REFERENCES automated_tests(test_key),
  resource_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed','false_positive')),
  title TEXT NOT NULL,
  description TEXT,
  source_result_id INT REFERENCES evidence_test_results(id) ON DELETE SET NULL,
  linked_action_id INT REFERENCES actions(id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(company_id, connection_id, test_key, resource_id)
);
CREATE INDEX IF NOT EXISTS findings_company_idx ON findings(company_id);
CREATE INDEX IF NOT EXISTS findings_status_idx ON findings(company_id, status);

ALTER TABLE actions ADD COLUMN IF NOT EXISTS finding_id INT REFERENCES findings(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS evidence_vault_id INT REFERENCES evidence_vault(id) ON DELETE SET NULL;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_analysis_status TEXT;

-- ===== Automated Evidence Collection: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('aws', 'Amazon Web Services', 'cloud', 'iam_role', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.iam.mfa_enforced', 'IAM users have MFA enabled', 'Checks every IAM user has at least one registered MFA device.', 'critical', 'Require MFA for all IAM users, ideally via an IAM policy condition or SSO enforcement.'),
  ('aws', 'aws.iam.password_policy', 'Account password policy meets minimum strength', 'Checks the account password policy enforces a 14+ character minimum with mixed case, numbers, and symbols.', 'high', 'Update the account password policy under IAM > Account settings.'),
  ('aws', 'aws.iam.access_key_age', 'IAM access keys are rotated within 90 days', 'Flags active access keys older than 90 days.', 'high', 'Rotate the access key and update any services using it, then deactivate the old key.'),
  ('aws', 'aws.logging.cloudtrail_enabled', 'CloudTrail is enabled and multi-region', 'Checks at least one multi-region CloudTrail trail is actively logging.', 'critical', 'Enable a multi-region CloudTrail trail with log file validation.'),
  ('aws', 'aws.logging.config_enabled', 'AWS Config is recording', 'Checks an AWS Config recorder exists and is actively recording.', 'medium', 'Enable AWS Config in this region and confirm the recorder is turned on.'),
  ('aws', 'aws.network.s3_public_access_blocked', 'S3 buckets block public access', 'Checks every S3 bucket has all four public access block settings enabled.', 'critical', 'Enable "Block all public access" on the bucket, or at the account level.'),
  ('aws', 'aws.network.security_groups_no_open_ingress', 'Security groups do not expose management ports publicly', 'Flags security groups allowing inbound SSH (22) or RDP (3389) from 0.0.0.0/0.', 'critical', 'Restrict the security group rule to specific IP ranges or a bastion/VPN.'),
  ('aws', 'aws.rds.publicly_accessible', 'RDS instances are not publicly accessible', 'Checks every RDS instance has PubliclyAccessible disabled.', 'critical', 'Disable public accessibility on the instance and connect via VPC peering, VPN, or a bastion host.'),
  ('aws', 'aws.rds.storage_encrypted', 'RDS instances have storage encryption enabled', 'Checks every RDS instance has storage encryption at rest enabled.', 'critical', 'Storage encryption cannot be enabled on an existing instance — create an encrypted snapshot and restore into a new encrypted instance.'),
  ('aws', 'aws.rds.automated_backups_enabled', 'RDS instances have automated backups enabled', 'Checks every RDS instance has a backup retention period greater than zero.', 'high', 'Set a backup retention period of at least 7 days under the instance''s Backup settings.'),
  ('aws', 'aws.lambda.function_url_not_public', 'Lambda function URLs require authentication', 'Checks every configured Lambda function URL requires AWS_IAM authentication rather than allowing unauthenticated access.', 'critical', 'Set the function URL''s auth type to AWS_IAM, or front it with API Gateway and appropriate authorization.'),
  ('aws', 'aws.lambda.no_wildcard_resource_policy', 'Lambda resource policies do not grant a wildcard principal', 'Checks no Lambda function''s resource-based policy grants access to Principal "*".', 'critical', 'Scope the resource policy''s Principal to specific accounts, services, or ARNs instead of "*".'),
  ('aws', 'aws.dynamodb.point_in_time_recovery_enabled', 'DynamoDB tables have point-in-time recovery enabled', 'Checks every DynamoDB table has continuous backups (PITR) enabled.', 'high', 'Enable point-in-time recovery under the table''s Backups tab.'),
  ('aws', 'aws.dynamodb.encryption_uses_cmk', 'DynamoDB tables are encrypted with a customer-managed key', 'Checks every DynamoDB table uses a customer-managed KMS key rather than the AWS-owned default key.', 'medium', 'Enable encryption at rest with a customer-managed KMS key under the table''s Encryption settings.'),
  ('aws', 'aws.kms.key_rotation_enabled', 'Customer-managed KMS keys have rotation enabled', 'Checks every customer-managed symmetric KMS key has automatic annual rotation enabled.', 'high', 'Enable automatic key rotation under the key''s Key rotation tab.'),
  ('aws', 'aws.kms.no_wildcard_key_policy', 'KMS key policies do not grant a wildcard principal', 'Checks no customer-managed KMS key''s policy grants access to Principal "*".', 'critical', 'Scope the key policy''s Principal to specific accounts, roles, or users instead of "*".')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.iam.mfa_enforced', 'ISO27001', 'A.9.4.2'),
  ('aws.iam.password_policy', 'ISO27001', 'A.9.4.3'),
  ('aws.iam.access_key_age', 'ISO27001', 'A.9.2.4'),
  ('aws.logging.cloudtrail_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.logging.config_enabled', 'ISO27001', 'A.12.1.1'),
  ('aws.network.s3_public_access_blocked', 'ISO27001', 'A.8.2.3'),
  ('aws.network.security_groups_no_open_ingress', 'ISO27001', 'A.13.1.1'),
  ('aws.rds.publicly_accessible', 'ISO27001', 'A.13.1.1'),
  ('aws.rds.storage_encrypted', 'ISO27001', 'A.8.2.3'),
  ('aws.rds.automated_backups_enabled', 'ISO27001', 'A.12.3.1'),
  ('aws.lambda.function_url_not_public', 'ISO27001', 'A.13.1.1'),
  ('aws.lambda.no_wildcard_resource_policy', 'ISO27001', 'A.9.1.2'),
  ('aws.dynamodb.point_in_time_recovery_enabled', 'ISO27001', 'A.12.3.1'),
  ('aws.dynamodb.encryption_uses_cmk', 'ISO27001', 'A.8.2.3'),
  ('aws.kms.key_rotation_enabled', 'ISO27001', 'A.10.1.2'),
  ('aws.kms.no_wildcard_key_policy', 'ISO27001', 'A.9.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.config.rules_compliant', 'AWS Config rules report compliant resources', 'Checks every AWS Config rule''s compliance evaluation is COMPLIANT, flagging any rule with NON_COMPLIANT resources.', 'medium', 'Review the non-compliant resources listed under the Config rule and remediate them, or update the rule if it no longer reflects policy.'),
  ('aws', 'aws.config.all_resource_types_recorded', 'AWS Config recorder tracks all supported resource types', 'Checks the AWS Config recorder is configured with allSupported: true rather than a scoped subset of resource types.', 'medium', 'Edit the Config recorder settings to record all resource types supported in the region.'),
  ('aws', 'aws.cloudtrail.log_file_validation_enabled', 'CloudTrail trails have log file validation enabled', 'Checks every CloudTrail trail has log file integrity validation enabled, so log tampering can be detected.', 'high', 'Enable log file validation on the trail under CloudTrail > Trails > General details.'),
  ('aws', 'aws.cloudtrail.data_events_logged', 'CloudTrail records data-plane events for S3 and Lambda', 'Checks at least one trail has event selectors (or advanced event selectors) configured to log S3 object-level and Lambda invoke data events.', 'medium', 'Add an event selector (or advanced event selector) to the trail covering S3 and Lambda data events.'),
  ('aws', 'aws.cloudwatch.alarms_configured', 'CloudWatch alarms exist for account activity', 'Checks at least one CloudWatch alarm (metric or composite) is configured in the account/region.', 'medium', 'Create CloudWatch alarms for key security metrics (e.g. root account usage, unauthorized API calls, IAM policy changes).'),
  ('aws', 'aws.cloudwatch.log_group_retention_configured', 'CloudWatch Logs groups have a retention period set', 'Checks every CloudWatch Logs log group has a finite retention period rather than "Never expire".', 'medium', 'Set a retention policy on the log group under CloudWatch > Log groups > Actions > Edit retention setting.'),
  ('aws', 'aws.waf.web_acl_associated', 'Internet-facing resources are protected by a WAF Web ACL', 'Checks Application Load Balancers, API Gateway stages, and CloudFront distributions have an associated WAFv2 Web ACL.', 'high', 'Create a WAFv2 Web ACL with the AWS managed rule groups appropriate for the workload and associate it with the resource.'),
  ('aws', 'aws.waf.logging_enabled', 'WAF Web ACLs have logging enabled', 'Checks every WAFv2 Web ACL has a logging configuration delivering to a log destination (Kinesis Firehose, S3, or CloudWatch Logs).', 'medium', 'Enable logging on the Web ACL and configure a log destination under WAF > Web ACLs > Logging and metrics.'),
  ('aws', 'aws.secretsmanager.rotation_enabled', 'Secrets Manager secrets have automatic rotation enabled', 'Checks every secret in Secrets Manager has RotationEnabled set, so credentials are rotated on a schedule rather than manually.', 'high', 'Configure automatic rotation on the secret, using a rotation Lambda function appropriate to the credential type.'),
  ('aws', 'aws.secretsmanager.encrypted_with_cmk', 'Secrets Manager secrets are encrypted with a customer-managed key', 'Checks every secret uses a customer-managed KMS key rather than the default aws/secretsmanager AWS-owned key.', 'medium', 'Re-encrypt the secret with a customer-managed KMS key under the secret''s Encryption configuration.'),
  ('aws', 'aws.secretsmanager.no_stale_secrets', 'Secrets Manager secrets are rotated within policy', 'Checks that secrets with rotation enabled have actually rotated within their configured rotation interval (flags a configured-but-stalled rotation).', 'medium', 'Investigate why the rotation Lambda is failing (check CloudWatch Logs for the rotation function) and trigger a manual rotation to re-establish the schedule.'),
  ('aws', 'aws.guardduty.enabled', 'GuardDuty is enabled', 'Checks a GuardDuty detector exists and its status is ENABLED in the account/region.', 'critical', 'Enable GuardDuty for the account/region under GuardDuty > Get started.'),
  ('aws', 'aws.guardduty.high_severity_findings_resolved', 'No unresolved high-severity GuardDuty findings', 'Checks there are no active (unarchived) GuardDuty findings with severity >= 7.0 (High/Critical).', 'high', 'Triage the finding in GuardDuty, remediate the underlying issue, and archive the finding once resolved.'),
  ('aws', 'aws.securityhub.enabled', 'Security Hub is enabled with a standard subscribed', 'Checks Security Hub is enabled in the account/region and at least one security standard (e.g. AWS Foundational Security Best Practices) is subscribed and READY.', 'high', 'Enable Security Hub and subscribe to at least the AWS Foundational Security Best Practices standard.'),
  ('aws', 'aws.securityhub.critical_findings_resolved', 'No active critical/high Security Hub findings', 'Checks there are no ACTIVE, unresolved (WorkflowStatus = NEW) Security Hub findings with severity CRITICAL or HIGH.', 'high', 'Triage the finding in Security Hub, remediate the underlying resource misconfiguration, and update its workflow status once resolved.'),
  ('aws', 'aws.ecr.image_scanning_enabled', 'ECR repositories scan images on push', 'Checks every ECR repository has scanOnPush enabled so images are scanned for known vulnerabilities automatically.', 'high', 'Enable "Scan on push" under the repository''s Image scanning settings, or enable enhanced scanning account-wide via Amazon Inspector.'),
  ('aws', 'aws.ecr.tag_immutability_enabled', 'ECR repositories enforce immutable image tags', 'Checks every ECR repository has imageTagMutability set to IMMUTABLE, preventing a tag (e.g. latest, prod) from being silently repointed to a different image.', 'medium', 'Set the repository''s tag mutability setting to Immutable under repository settings.'),
  ('aws', 'aws.ecr.no_wildcard_repository_policy', 'ECR repository policies do not grant a wildcard principal', 'Checks no ECR repository''s resource policy grants access to Principal "*".', 'critical', 'Scope the repository policy''s Principal to specific account IDs, roles, or organizations instead of "*".'),
  ('aws', 'aws.ecs.no_privileged_containers', 'ECS task definitions do not run privileged containers', 'Checks no container definition in an active ECS task definition revision sets privileged: true.', 'critical', 'Remove the privileged flag from the container definition and grant only the specific Linux capabilities the container needs via linuxParameters.capabilities.'),
  ('aws', 'aws.ecs.container_insights_enabled', 'ECS clusters have Container Insights enabled', 'Checks every ECS cluster has the containerInsights cluster setting enabled for monitoring and logging.', 'medium', 'Enable Container Insights under the cluster''s Monitoring settings, or via UpdateClusterSettings.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.config.rules_compliant', 'ISO27001', 'A.12.1.2'),
  ('aws.config.all_resource_types_recorded', 'ISO27001', 'A.12.1.1'),
  ('aws.cloudtrail.log_file_validation_enabled', 'ISO27001', 'A.12.4.2'),
  ('aws.cloudtrail.data_events_logged', 'ISO27001', 'A.12.4.1'),
  ('aws.cloudwatch.alarms_configured', 'ISO27001', 'A.12.4.1'),
  ('aws.cloudwatch.log_group_retention_configured', 'ISO27001', 'A.12.4.1'),
  ('aws.waf.web_acl_associated', 'ISO27001', 'A.13.1.1'),
  ('aws.waf.logging_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.secretsmanager.rotation_enabled', 'ISO27001', 'A.9.2.4'),
  ('aws.secretsmanager.encrypted_with_cmk', 'ISO27001', 'A.10.1.2'),
  ('aws.secretsmanager.no_stale_secrets', 'ISO27001', 'A.9.2.4'),
  ('aws.guardduty.enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.guardduty.high_severity_findings_resolved', 'ISO27001', 'A.16.1.2'),
  ('aws.securityhub.enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.securityhub.critical_findings_resolved', 'ISO27001', 'A.16.1.2'),
  ('aws.ecr.image_scanning_enabled', 'ISO27001', 'A.12.6.1'),
  ('aws.ecr.tag_immutability_enabled', 'ISO27001', 'A.12.5.1'),
  ('aws.ecr.no_wildcard_repository_policy', 'ISO27001', 'A.9.1.2'),
  ('aws.ecs.no_privileged_containers', 'ISO27001', 'A.9.4.4'),
  ('aws.ecs.container_insights_enabled', 'ISO27001', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('aws', 'aws.iam.no_root_access_keys', 'Root account has no active access keys', 'Checks the AWS root account credential report to confirm neither access_key_1 nor access_key_2 is active for the root user.', 'critical', 'Delete root account access keys under IAM > Security credentials. Use an IAM role or IAM user with least-privilege permissions for programmatic access instead.'),
  ('aws', 'aws.iam.no_inline_policies', 'IAM users and groups have no inline policies', 'Checks that no IAM user or group has inline policies attached — inline policies are harder to audit and reuse than managed policies.', 'medium', 'Convert inline policies to customer-managed IAM policies and attach them to groups or roles instead of directly to users.'),
  ('aws', 'aws.iam.no_overly_broad_managed_policies', 'No IAM users or groups have admin-level managed policies attached', 'Checks that neither AdministratorAccess nor PowerUserAccess is attached directly to any IAM user or group.', 'high', 'Remove AdministratorAccess/PowerUserAccess from individual users and groups. Grant access via least-privilege roles, or restrict admin access to a dedicated break-glass role with MFA enforcement.'),
  ('aws', 'aws.ec2.ebs_encryption_by_default', 'EBS encryption by default is enabled', 'Checks that the region-level EBS encryption-by-default setting is enabled so all new EBS volumes and snapshots are automatically encrypted.', 'high', 'Enable EBS encryption by default under EC2 > Settings > EBS encryption, or via EnableEbsEncryptionByDefault API.'),
  ('aws', 'aws.vpc.flow_logs_enabled', 'VPC flow logs are enabled for all VPCs', 'Checks every VPC in the region has at least one flow log configured to capture accepted and rejected traffic.', 'medium', 'Enable VPC flow logs for the VPC under VPC > Flow logs > Create flow log, delivering to CloudWatch Logs or S3.'),
  ('aws', 'aws.s3.bucket_encryption_enabled', 'S3 buckets have server-side encryption enabled', 'Checks every S3 bucket has a default server-side encryption configuration (SSE-S3 or SSE-KMS).', 'high', 'Enable default encryption on the bucket under S3 > Properties > Default encryption. AWS now enables SSE-S3 by default on new buckets, but older buckets may need an explicit setting.'),
  ('aws', 'aws.s3.bucket_access_logging_enabled', 'S3 buckets have access logging enabled', 'Checks every S3 bucket has server access logging enabled so API requests are recorded for audit and forensic purposes.', 'medium', 'Enable server access logging on the bucket under S3 > Properties > Server access logging, specifying a target bucket for log delivery.'),
  ('aws', 'aws.lambda.in_vpc', 'Lambda functions are deployed inside a VPC', 'Checks every Lambda function has a VPC configuration so outbound calls go through VPC network controls rather than over the public internet.', 'medium', 'Configure a VPC, subnets, and security group for the function under Lambda > Configuration > VPC.'),
  ('aws', 'aws.lambda.env_vars_not_plaintext_secrets', 'Lambda environment variables do not contain plaintext secrets', 'Checks Lambda function environment variable names for patterns suggesting plaintext credentials (password, secret, token, api_key, etc.).', 'high', 'Remove plaintext secrets from environment variables. Store them in AWS Secrets Manager or SSM Parameter Store (SecureString) and retrieve them at runtime via SDK calls.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, framework, iso_reference) VALUES
  ('aws.iam.no_root_access_keys', 'ISO27001', 'A.9.2.3'),
  ('aws.iam.no_inline_policies', 'ISO27001', 'A.9.1.2'),
  ('aws.iam.no_overly_broad_managed_policies', 'ISO27001', 'A.9.1.2'),
  ('aws.ec2.ebs_encryption_by_default', 'ISO27001', 'A.8.2.3'),
  ('aws.vpc.flow_logs_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.s3.bucket_encryption_enabled', 'ISO27001', 'A.8.2.3'),
  ('aws.s3.bucket_access_logging_enabled', 'ISO27001', 'A.12.4.1'),
  ('aws.lambda.in_vpc', 'ISO27001', 'A.13.1.1'),
  ('aws.lambda.env_vars_not_plaintext_secrets', 'ISO27001', 'A.9.2.4')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('azure', 'Microsoft Azure', 'cloud', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, severity_default) VALUES
  ('azure', 'azure.logging.activity_log_diagnostics_enabled', 'Activity Log diagnostic settings are configured', 'critical'),
  ('azure', 'azure.security.defender_enabled', 'Microsoft Defender for Cloud is enabled', 'medium'),
  ('azure', 'azure.storage.public_access_blocked', 'Storage accounts block public blob access', 'critical'),
  ('azure', 'azure.network.nsg_no_open_ingress', 'Network security groups do not expose management ports publicly', 'critical')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('azure.logging.activity_log_diagnostics_enabled', 'A.12.4.1'),
  ('azure.security.defender_enabled', 'A.12.1.1'),
  ('azure.storage.public_access_blocked', 'A.8.2.3'),
  ('azure.network.nsg_no_open_ingress', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('azure', 'azure.sql.transparent_data_encryption_enabled', 'SQL databases have transparent data encryption enabled', 'Checks every Azure SQL database has transparent data encryption enabled.', 'critical', 'Enable Transparent Data Encryption under the database''s Transparent data encryption settings blade.'),
  ('azure', 'azure.sql.public_network_access_disabled', 'SQL servers do not allow public network access', 'Checks every Azure SQL logical server disables public network access or has no fully-open firewall rule.', 'critical', 'Disable public network access under the server''s Networking blade and use a private endpoint or VNet service endpoint.'),
  ('azure', 'azure.sql.auditing_enabled', 'SQL server auditing is enabled', 'Checks every SQL server has an enabled auditing policy with a configured retention.', 'high', 'Enable auditing under the server''s Auditing blade and set a retention period.'),
  ('azure', 'azure.keyvault.purge_protection_enabled', 'Key Vaults have purge protection enabled', 'Checks every Key Vault has purge protection enabled.', 'high', 'Enable purge protection under the vault''s Properties blade.'),
  ('azure', 'azure.keyvault.rbac_authorization_enabled', 'Key Vaults use Azure RBAC instead of legacy access policies', 'Checks every Key Vault uses Azure RBAC for authorization instead of vault-local access policies.', 'medium', 'Migrate the vault''s permission model to Azure RBAC under Access configuration.'),
  ('azure', 'azure.monitor.diagnostic_settings_cover_key_resources', 'Diagnostic settings are configured for key resource types', 'Checks SQL servers, Key Vaults, and NSGs each have at least one diagnostic setting forwarding logs.', 'medium', 'Add a diagnostic setting on the flagged resource forwarding logs to a Log Analytics workspace.'),
  ('azure', 'azure.policy.assignments_compliant', 'Assigned Azure Policy definitions report a compliant state', 'Checks policy compliance summaries report no non-compliant resources above a defined threshold.', 'medium', 'Review non-compliant resources under Azure Policy > Compliance and remediate them.'),
  ('azure', 'azure.compute.disk_encryption_enabled', 'Virtual machines have encryption at host enabled', 'Checks every virtual machine has encryption at host enabled so both OS and data disk caches are encrypted.', 'high', 'Enable encryption at host under the VM''s Disks blade (Additional settings), or via the securityProfile.encryptionAtHost property. Requires the subscription feature to be registered first.'),
  ('azure', 'azure.compute.no_public_ip_association', 'Virtual machines are not directly exposed via a public IP address', 'Checks that no virtual machine''s network interface has a public IP address directly attached.', 'critical', 'Remove the public IP association from the network interface under Networking, and use a load balancer, Bastion, or VPN for access instead.'),
  ('azure', 'azure.subscription.no_classic_administrators', 'Subscription has no classic (co-)administrators', 'Checks that no legacy classic Service Administrator or Co-Administrator roles are assigned on the subscription.', 'high', 'Remove classic administrators under Subscription > Access control (IAM) > Classic administrators, and grant equivalent access via Azure RBAC role assignments instead.'),
  ('azure', 'azure.subscription.limited_owner_assignments', 'Subscription-scope Owner role assignments are limited', 'Checks that no more than a recommended maximum of principals hold the Owner role directly at subscription scope.', 'medium', 'Review Owner role assignments under Subscription > Access control (IAM), and replace unnecessary Owner grants with least-privilege roles.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('azure.sql.transparent_data_encryption_enabled', 'A.8.2.3'),
  ('azure.sql.public_network_access_disabled', 'A.13.1.1'),
  ('azure.sql.auditing_enabled', 'A.12.4.1'),
  ('azure.keyvault.purge_protection_enabled', 'A.8.2.3'),
  ('azure.keyvault.rbac_authorization_enabled', 'A.9.1.2'),
  ('azure.monitor.diagnostic_settings_cover_key_resources', 'A.12.4.1'),
  ('azure.policy.assignments_compliant', 'A.18.2.2'),
  ('azure.compute.disk_encryption_enabled', 'A.8.2.3'),
  ('azure.compute.no_public_ip_association', 'A.13.1.1'),
  ('azure.subscription.no_classic_administrators', 'A.9.2.3'),
  ('azure.subscription.limited_owner_assignments', 'A.9.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('github', 'GitHub', 'devops', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('github', 'github.org.two_factor_required', 'Organization requires two-factor authentication', 'Checks the GitHub organization enforces 2FA for all members, billing managers, and outside collaborators.', 'critical', 'Enable Require two-factor authentication under Organization settings > Authentication security.'),
  ('github', 'github.repo.branch_protection_required_reviews', 'Default branch requires pull request review before merging', 'Checks each repository default branch has a protection rule requiring at least one approving review.', 'high', 'Add a branch protection rule on the default branch requiring at least 1 approving review before merge.'),
  ('github', 'github.repo.vulnerability_alerts_enabled', 'Dependabot vulnerability alerts are enabled', 'Checks Dependabot alerts are enabled for each repository.', 'high', 'Enable Dependabot alerts under Repository settings > Code security and analysis.'),
  ('github', 'github.repo.secret_scanning_enabled', 'Secret scanning is enabled', 'Checks secret scanning is enabled for each repository where GitHub Advanced Security is available.', 'medium', 'Enable secret scanning under Repository settings > Code security and analysis.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('github.org.two_factor_required', 'A.9.4.2'),
  ('github.repo.branch_protection_required_reviews', 'A.14.2.2'),
  ('github.repo.vulnerability_alerts_enabled', 'A.12.6.1'),
  ('github.repo.secret_scanning_enabled', 'A.9.4.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('github', 'github.org.default_repository_permission_restricted', 'Default repository permission is not admin', 'Checks the organization''s default repository permission is not admin, so new members don''t inherit admin access to every repo.', 'medium', 'Set the default repository permission to read or write under Organization settings > Member privileges.'),
  ('github', 'github.org.owners_count_minimized', 'Organization owner role is limited to necessary personnel', 'Checks the number of organization owners does not exceed a defined threshold, flagging excessive standing privileged access.', 'medium', 'Review the organization owners list and demote accounts that don''t require full administrative access to a lower role.'),
  ('github', 'github.org.actions_default_workflow_permissions_readonly', 'Actions default workflow token permissions are read-only', 'Checks the default GITHUB_TOKEN permissions for Actions workflows are read-only rather than read-write.', 'high', 'Set the default workflow permissions to read-only under Organization settings > Actions > General.'),
  ('github', 'github.org.actions_third_party_restricted', 'Actions are restricted to verified or selected sources', 'Checks the organization restricts which third-party Actions and reusable workflows can run rather than allowing anything from the Marketplace.', 'medium', 'Set Actions permissions to allow only enterprise and selected non-enterprise actions under Organization settings > Actions > General.'),
  ('github', 'github.repo.code_scanning_default_setup_enabled', 'Code scanning (CodeQL) default setup is enabled', 'Checks CodeQL default setup is configured for each repository.', 'high', 'Enable CodeQL default setup under Repository settings > Code security and analysis > Code scanning.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('github.org.default_repository_permission_restricted', 'A.9.2.3'),
  ('github.org.owners_count_minimized', 'A.9.2.3'),
  ('github.org.actions_default_workflow_permissions_readonly', 'A.9.4.1'),
  ('github.org.actions_third_party_restricted', 'A.14.2.2'),
  ('github.repo.code_scanning_default_setup_enabled', 'A.12.6.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Purview connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview', 'Microsoft Purview', 'data_governance', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('purview', 'purview.datamap.sources_scanned', 'Registered data sources have a recent successful scan', 'Checks every registered Data Map source has completed a successful scan within the last 30 days.', 'high', 'Run or re-schedule a scan for the source in Microsoft Purview > Data Map > Sources.'),
  ('purview', 'purview.datamap.scan_schedule_configured', 'Registered data sources have a recurring scan schedule', 'Checks each registered source has a recurring (not one-off) scan trigger configured.', 'medium', 'Edit the source''s scan and set a recurring trigger instead of "Once".'),
  ('purview', 'purview.datamap.classification_applied', 'Scanned assets have classifications applied', 'Checks scanned assets have at least one data classification applied where the source type supports classification.', 'medium', 'Review scan rule sets to ensure classification rules are enabled for this source type, then re-run the scan.'),
  ('purview', 'purview.datamap.sensitivity_labels_applied', 'Scanned assets have sensitivity labels applied', 'Checks scanned assets carry a sensitivity label where the source type supports labeling.', 'medium', 'Apply sensitivity labels via auto-labeling policies or manually label the asset in the Purview Unified Catalog.'),
  ('purview', 'purview.audit.unified_logging_enabled', 'Unified audit logging is enabled', 'Checks unified audit logging is turned on for the tenant.', 'critical', 'Enable audit logging in Microsoft Purview > Audit > Start recording user and admin activity.'),
  ('purview', 'purview.audit.subscriptions_active', 'Required audit log content-type subscriptions are active', 'Checks Azure AD, Exchange, SharePoint, and General audit content-type subscriptions are enabled.', 'high', 'Start the missing content-type subscription via the Office 365 Management Activity API (POST /activity/feed/subscriptions/start?contentType={type}).'),
  ('purview', 'purview.audit.dlp_alerts_available', 'DLP audit content is available', 'Checks the DLP.All content-type subscription is active and retrievable, evidencing DLP policy enforcement logging.', 'high', 'Confirm at least one DLP policy is enabled in Purview and that the DLP.All subscription is active.'),
  ('purview', 'purview.audit.content_recently_available', 'Audit content is actively flowing', 'Checks at least one audit content blob was produced within the last 24 hours for each active subscription, proving logs are actually flowing rather than merely subscribed.', 'medium', 'Investigate why no recent audit content is available - this can indicate audit logging was disabled after setup or the subscription lapsed.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('purview.datamap.sources_scanned', 'A.8.1.1'),
  ('purview.datamap.scan_schedule_configured', 'A.8.1.1'),
  ('purview.datamap.classification_applied', 'A.8.2.1'),
  ('purview.datamap.sensitivity_labels_applied', 'A.8.2.3'),
  ('purview.audit.unified_logging_enabled', 'A.12.4.1'),
  ('purview.audit.subscriptions_active', 'A.12.4.1'),
  ('purview.audit.dlp_alerts_available', 'A.13.2.1'),
  ('purview.audit.content_recently_available', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Purview Compliance Manager: catalog-only placeholder (no connector) =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('purview_compliance', 'Microsoft Purview Compliance Manager', 'data_governance', 'oauth2', 'coming_soon')
ON CONFLICT (key) DO NOTHING;

-- ===== Zoho connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('zoho', 'Zoho', 'business_apps', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('zoho', 'zoho.directory.mfa_enforced', 'Multi-factor authentication is enforced org-wide', 'Checks the Directory org-wide security policy requires MFA for all users.', 'critical', 'Enable and enforce a multi-factor authentication policy under Zoho Directory > Security > Multi-factor Authentication, and remove any per-user exemptions.'),
  ('zoho', 'zoho.directory.sso_enforced', 'Single sign-on is enforced for all applications', 'Checks that SSO is configured as the required sign-in method rather than optional, so credentials aren''t scattered across individually-authenticated apps.', 'high', 'Set the org''s authentication policy to require SSO sign-in and disable direct password login where the identity provider supports it.'),
  ('zoho', 'zoho.directory.inactive_user_review', 'Inactive or terminated users are deprovisioned', 'Flags Directory user accounts with no sign-in activity for 90+ days that are still marked active.', 'medium', 'Suspend or delete the account in Zoho Directory, and confirm it is also removed from any per-product group/role assignments.'),

  ('zoho', 'zoho.crm.mfa_enforced', 'CRM users have multi-factor authentication enabled', 'Checks every active CRM user has MFA enabled (directly or via the org-wide security policy).', 'critical', 'Enforce MFA for the CRM application under Setup > Security Control > Two-Factor Authentication.'),
  ('zoho', 'zoho.crm.data_sharing_rules_restricted', 'Data sharing rules do not grant org-wide read/write', 'Checks CRM''s data-sharing settings for any module are not set to "Public Read/Write" or broader than required.', 'high', 'Tighten the module''s sharing rule under Setup > Data Sharing Settings to the narrowest role/territory grouping that meets the business need.'),
  ('zoho', 'zoho.crm.audit_log_enabled', 'Audit log tracking is enabled', 'Checks CRM''s audit log feature is turned on and retaining events.', 'medium', 'Enable Audit Log under Setup > Security Control > Audit Log.'),

  ('zoho', 'zoho.books.user_role_review', 'User roles follow least privilege', 'Checks no non-admin Books user is assigned the built-in Admin role without a documented business justification.', 'medium', 'Reassign the user to a custom role scoped to only the modules/permissions their job requires.'),
  ('zoho', 'zoho.books.two_factor_auth_enforced', 'Two-factor authentication is enforced', 'Checks the organization''s Books security policy requires 2FA for all users.', 'critical', 'Enable "Enforce two-factor authentication" under Settings > Users & Roles > Security.'),
  ('zoho', 'zoho.books.audit_trail_enabled', 'Audit trail is enabled and retained', 'Checks the Books audit trail feature is active and its retention meets the org''s evidence-retention policy.', 'medium', 'Enable Audit Trail under Settings > Preferences > Audit Trail and confirm retention duration.'),

  ('zoho', 'zoho.people.data_access_review', 'Employee data access is restricted by role', 'Checks People''s form/module permissions restrict full-employee-database visibility to HR-admin roles only.', 'high', 'Adjust form permissions under Settings > Access Permissions so only HR admin roles can view records outside their own reporting hierarchy.'),
  ('zoho', 'zoho.people.sensitive_field_encryption', 'Sensitive HR fields are access-restricted', 'Checks fields holding government ID numbers, bank details, and salary data are field-level restricted to authorized roles.', 'high', 'Apply field-level permission restrictions on sensitive fields under the form''s field settings.'),
  ('zoho', 'zoho.people.admin_role_review', 'Admin role assignment is minimized', 'Checks the count of users with full People admin privileges is limited to designated HR/IT administrators.', 'medium', 'Remove admin privileges from users who do not require org-wide People administration and reassign a scoped role instead.'),

  ('zoho', 'zoho.workdrive.external_sharing_restricted', 'External sharing is restricted at the team level', 'Checks the team/org sharing policy blocks or requires approval for sharing files/folders outside the organization.', 'critical', 'Disable open external sharing under Team Settings > Security, or require admin approval for external shares.'),
  ('zoho', 'zoho.workdrive.link_sharing_password_protected', 'Public share links require a password and expiry', 'Checks public/anyone-with-link shares have a password and an expiration date set rather than standing open indefinitely.', 'high', 'Edit the share link to require a password and set an expiration date, or disable public link sharing entirely for sensitive folders.'),
  ('zoho', 'zoho.workdrive.admin_activity_log_enabled', 'Admin activity logging is enabled', 'Checks WorkDrive''s admin audit log is enabled for the team.', 'medium', 'Enable activity logging under Admin Console > Audit.'),

  ('zoho', 'zoho.desk.agent_role_audit', 'Agent roles follow least privilege', 'Checks no agent is assigned an Administrator profile without documented justification.', 'medium', 'Reassign the agent to a Light Agent or custom profile scoped to only the permissions their job requires.'),
  ('zoho', 'zoho.desk.customer_data_field_restricted', 'Customer PII fields are profile-restricted', 'Checks fields containing customer PII (e.g. government ID, payment references) are restricted from profiles that don''t need them.', 'high', 'Apply field-level permissions restricting the field to profiles that require it for ticket resolution.'),
  ('zoho', 'zoho.desk.ticket_access_control_enabled', 'Ticket access control (team/department scoping) is enabled', 'Checks tickets are scoped to departments/teams rather than visible org-wide to every agent.', 'medium', 'Enable department-based ticket access control under Setup > Developer Space > Access Control.'),

  ('zoho', 'zoho.mail.forwarding_restricted', 'Auto-forwarding to external domains is restricted', 'Checks org mail policy blocks or requires admin approval for automatic forwarding rules that send mail to external domains.', 'high', 'Disable unrestricted auto-forwarding under Mail Admin Console > Policy Controls, or require admin approval for external forwarding rules.'),
  ('zoho', 'zoho.mail.two_factor_auth_enforced', 'Two-factor authentication is enforced for mailboxes', 'Checks the organization''s mail security policy requires 2FA for all mailbox logins.', 'critical', 'Enforce TFA under Mail Admin Console > Security > Two-Factor Authentication.'),
  ('zoho', 'zoho.mail.spam_phishing_filters_enabled', 'Spam and phishing filters are enabled', 'Checks organization-level spam/phishing filtering policies are active for all mailboxes.', 'medium', 'Enable and tune spam/phishing filter policies under Mail Admin Console > Security > Email Security.'),

  ('zoho', 'zoho.vault.secret_sharing_policy', 'Secret sharing outside designated chambers is restricted', 'Checks Vault''s sharing policy prevents individual secrets from being shared directly with users outside their assigned chamber/group.', 'high', 'Restrict secret sharing under Vault Admin Console > Policies to chamber/group-based sharing only.'),
  ('zoho', 'zoho.vault.password_policy_strength', 'Vault-generated/stored passwords meet minimum strength policy', 'Checks the organization''s password policy (used by Vault''s generator and strength scoring) enforces a minimum length and complexity.', 'high', 'Configure the password policy under Vault Admin Console > Password Policy to require 14+ characters with mixed character classes.'),
  ('zoho', 'zoho.vault.access_log_review', 'Vault access logs are enabled and retained', 'Checks Vault''s audit/access log is enabled and retention meets the org''s evidence policy.', 'medium', 'Enable audit logging under Vault Admin Console > Reports > Audit Trail.'),

  ('zoho', 'zoho.projects.external_user_review', 'External/client users have scoped project access', 'Checks client/external users are only added to the specific projects they need rather than the whole portal.', 'medium', 'Remove the external user from projects outside their engagement and confirm client-user role restricts admin functions.'),
  ('zoho', 'zoho.projects.client_portal_access_restricted', 'Client portal access is restricted to intended projects', 'Checks the client portal''s visibility settings don''t expose other clients'' projects or tasks.', 'medium', 'Restrict the client portal''s project visibility under Project Settings > Client Users.'),
  ('zoho', 'zoho.projects.role_based_permissions_enforced', 'Role-based permissions are enforced per project', 'Checks project roles (Manager/Employee/Client) are used to gate task, budget, and document permissions rather than granting everyone Manager.', 'medium', 'Reassign users with unnecessary Manager-level project roles to Employee or a scoped custom role.'),

  ('zoho', 'zoho.analytics.data_sharing_review', 'Workspace/view sharing is scoped to intended users', 'Checks workspaces and views are not shared with "Everyone in the organization" or broader than the reporting requirement.', 'high', 'Edit the workspace/view''s sharing settings to specific users or groups instead of organization-wide sharing.'),
  ('zoho', 'zoho.analytics.public_view_link_restricted', 'Public/embedded view links are disabled or reviewed', 'Checks published public view/embed links (which require no authentication) are disabled, or if in use, contain no sensitive data.', 'critical', 'Disable public publishing for the view, or remove sensitive columns/rows from the underlying query before re-publishing.'),
  ('zoho', 'zoho.analytics.workspace_permission_review', 'Workspace admin/owner assignment is minimized', 'Checks the number of users with workspace Admin/Owner permission is limited to designated report administrators.', 'medium', 'Downgrade unnecessary Admin/Owner permissions to Designer or Viewer as appropriate.'),

  ('zoho', 'zoho.creator.app_permission_review', 'App-level permissions follow least privilege', 'Checks custom applications restrict Admin/Developer permission to the users who build/maintain the app.', 'medium', 'Adjust the app''s user permissions under App Settings > Users & Permissions to remove unnecessary Developer/Admin access.'),
  ('zoho', 'zoho.creator.public_form_data_exposure', 'Public forms do not expose sensitive existing records', 'Checks public-facing forms/pages don''t embed reports or lookups that leak other users'' submitted data to anonymous visitors.', 'critical', 'Remove the exposed report/lookup field from the public form, or move it behind an authenticated (employee/portal) form instead.'),
  ('zoho', 'zoho.creator.deluge_script_access_review', 'Custom (Deluge) script edit access is restricted', 'Checks only designated developers can edit an application''s workflow/Deluge scripts, since scripts can read or exfiltrate any data the app touches.', 'medium', 'Restrict script edit permission under App Settings > Users & Permissions to the app''s designated developer role.'),

  ('zoho', 'zoho.sign.audit_trail_enabled', 'Document audit trail is enabled', 'Checks every completed document retains its full signing audit trail (timestamps, IP, authentication method per signer).', 'high', 'Enable "Include Audit Trail" in the organization''s default document settings under Sign Settings > Preferences.'),
  ('zoho', 'zoho.sign.template_access_restricted', 'Template access is restricted to authorized users', 'Checks shared templates are limited to the users/groups who need to send from them, not the whole organization.', 'medium', 'Edit template sharing under Templates > Manage Access to remove unnecessary users/groups.'),
  ('zoho', 'zoho.sign.completed_document_retention', 'Completed document retention meets policy', 'Checks completed/signed documents are retained for at least the organization''s required evidence retention period before any auto-deletion.', 'medium', 'Adjust the document retention/auto-delete setting under Sign Settings to meet the required retention period.'),

  ('zoho', 'zoho.expense.approval_policy_enforced', 'Expense approval requires a separate approver', 'Checks the approval workflow requires an approver other than the report submitter (no self-approval).', 'medium', 'Configure the approval workflow under Settings > Approvals to require a manager/finance approver distinct from the submitter.'),
  ('zoho', 'zoho.expense.receipt_data_retention', 'Receipt/expense data retention meets policy', 'Checks expense records and attached receipts are retained for at least the organization''s required financial/evidence retention period.', 'medium', 'Adjust the data retention setting under Settings > Preferences to meet the required retention period.'),
  ('zoho', 'zoho.expense.card_data_masking', 'Corporate card numbers are masked', 'Checks corporate card feed data displays only masked/last-4 card numbers, not full PANs, in reports and exports.', 'high', 'Confirm the card feed integration is configured to store/display masked card numbers only, per the provider''s masking option.'),

  ('zoho', 'zoho.recruit.candidate_data_access_review', 'Candidate data access is restricted by role', 'Checks candidate records (including resumes and contact PII) are visible only to recruiters/hiring managers assigned to that requisition, not all users.', 'high', 'Adjust the module''s sharing rules under Setup > Data Sharing Settings so candidate visibility follows requisition assignment.'),
  ('zoho', 'zoho.recruit.data_retention_policy_configured', 'Candidate data retention/deletion policy is configured', 'Checks a candidate data retention (and right-to-erasure) policy is configured, since unsuccessful-candidate PII has a legal retention ceiling under most privacy regimes.', 'medium', 'Configure a data retention policy under Setup > Data Administration > Data Retention Policy specifying an auto-purge or review window.'),
  ('zoho', 'zoho.recruit.job_posting_visibility_review', 'Job posting visibility matches intended audience', 'Checks job postings marked internal-only are not also published to public/external career-site channels.', 'low', 'Edit the job opening''s posting visibility under the Job Opening record to remove unintended public channels.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('zoho.directory.mfa_enforced', 'A.9.4.2'),
  ('zoho.directory.sso_enforced', 'A.9.2.1'),
  ('zoho.directory.inactive_user_review', 'A.9.2.6'),
  ('zoho.crm.mfa_enforced', 'A.9.4.2'),
  ('zoho.crm.data_sharing_rules_restricted', 'A.13.1.1'),
  ('zoho.crm.audit_log_enabled', 'A.12.4.1'),
  ('zoho.books.user_role_review', 'A.9.2.2'),
  ('zoho.books.two_factor_auth_enforced', 'A.9.4.2'),
  ('zoho.books.audit_trail_enabled', 'A.12.4.1'),
  ('zoho.people.data_access_review', 'A.9.1.1'),
  ('zoho.people.sensitive_field_encryption', 'A.8.2.3'),
  ('zoho.people.admin_role_review', 'A.9.2.3'),
  ('zoho.workdrive.external_sharing_restricted', 'A.13.2.1'),
  ('zoho.workdrive.link_sharing_password_protected', 'A.9.4.1'),
  ('zoho.workdrive.admin_activity_log_enabled', 'A.12.4.1'),
  ('zoho.desk.agent_role_audit', 'A.9.2.3'),
  ('zoho.desk.customer_data_field_restricted', 'A.9.4.1'),
  ('zoho.desk.ticket_access_control_enabled', 'A.9.1.2'),
  ('zoho.mail.forwarding_restricted', 'A.13.2.3'),
  ('zoho.mail.two_factor_auth_enforced', 'A.9.4.2'),
  ('zoho.mail.spam_phishing_filters_enabled', 'A.12.2.1'),
  ('zoho.vault.secret_sharing_policy', 'A.9.4.1'),
  ('zoho.vault.password_policy_strength', 'A.9.4.3'),
  ('zoho.vault.access_log_review', 'A.12.4.1'),
  ('zoho.projects.external_user_review', 'A.9.1.1'),
  ('zoho.projects.client_portal_access_restricted', 'A.9.4.1'),
  ('zoho.projects.role_based_permissions_enforced', 'A.9.2.3'),
  ('zoho.analytics.data_sharing_review', 'A.13.2.1'),
  ('zoho.analytics.public_view_link_restricted', 'A.9.4.1'),
  ('zoho.analytics.workspace_permission_review', 'A.9.2.3'),
  ('zoho.creator.app_permission_review', 'A.9.2.3'),
  ('zoho.creator.public_form_data_exposure', 'A.13.2.1'),
  ('zoho.creator.deluge_script_access_review', 'A.14.2.5'),
  ('zoho.sign.audit_trail_enabled', 'A.12.4.1'),
  ('zoho.sign.template_access_restricted', 'A.9.4.1'),
  ('zoho.sign.completed_document_retention', 'A.18.1.3'),
  ('zoho.expense.approval_policy_enforced', 'A.6.1.2'),
  ('zoho.expense.receipt_data_retention', 'A.18.1.3'),
  ('zoho.expense.card_data_masking', 'A.8.2.3'),
  ('zoho.recruit.candidate_data_access_review', 'A.9.1.1'),
  ('zoho.recruit.data_retention_policy_configured', 'A.18.1.3'),
  ('zoho.recruit.job_posting_visibility_review', 'A.13.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== OneTrust connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('onetrust', 'OneTrust', 'data_governance', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('onetrust', 'onetrust.assessments.no_stale_in_progress', 'In-progress assessments are progressing, not stalled', 'Flags PIA/DPIA assessments left NOT_STARTED / IN_PROGRESS / UNDER_REVIEW with no edit for 90+ days. GDPR Art. 35 (DPIA); DPDPA s.8(4) reasonable security safeguards.', 'medium', 'Reassign or close out the stalled assessment in OneTrust (Assessments module), or set a due date and owner so it re-enters the review workflow.'),
  ('onetrust', 'onetrust.assessments.high_risks_mitigated', 'High risks on completed assessments are mitigated', 'For COMPLETED assessments, reads the risk export and flags any High / Very High risk not in a mitigated, accepted, or closed state. GDPR Art. 35(7)(d) & Art. 36; DPDPA s.8(4).', 'high', 'Open the assessment''s risk in OneTrust and record a mitigation, formal risk acceptance, or transfer; re-run collection once the risk state is updated.'),
  ('onetrust', 'onetrust.assessments.dpia_process_operating', 'A PIA/DPIA process is operating', 'Confirms at least one PIA/DPIA-template assessment was completed in the trailing 12 months. GDPR Art. 35; DPDPA s.8(4).', 'medium', 'Run and complete a PIA/DPIA in OneTrust for a current high-risk processing activity so there is recent evidence the assessment process is live.'),
  ('onetrust', 'onetrust.inventory.ropa_populated', 'Records of Processing Activities (RoPA) is populated', 'Checks the processing-activities inventory is not empty. GDPR Art. 30 (records of processing); DPDPA s.5 notice & s.8(4) accountability.', 'high', 'Build out the processing-activities inventory in OneTrust (Data Mapping / Inventory), importing from a data-discovery scan or a manual workshop.'),
  ('onetrust', 'onetrust.inventory.records_have_owners', 'Data-inventory records have an assigned owner', 'Flags asset and processing-activity records with no owning organization. GDPR Art. 30; DPDPA s.8(3) accountability of the Data Fiduciary.', 'medium', 'Assign an owning organization / business unit to each record under the record''s details in OneTrust.'),
  ('onetrust', 'onetrust.inventory.records_reviewed_annually', 'Data-inventory records are reviewed at least annually', 'Flags inventory records whose last update is older than 12 months. GDPR Art. 5(1)(d) accuracy & Art. 30; DPDPA s.8(3).', 'low', 'Run a periodic attestation/review workflow in OneTrust so record owners re-confirm each inventory record at least yearly.'),
  ('onetrust', 'onetrust.dsar.within_statutory_deadline', 'Data-subject requests are handled within the statutory deadline', 'Flags open privacy-rights requests where slaExceeded is Yes or the remaining days to the maximum deadline is negative. GDPR Art. 12(3); DPDPA s.13 & the DPDP Rules response timeline.', 'high', 'Prioritise the overdue request in the OneTrust Privacy Rights Automation queue, complete fulfilment, and review why the SLA was missed.'),
  ('onetrust', 'onetrust.dsar.progressing', 'New data-subject requests are progressing, not sitting untouched', 'Flags requests stuck in New / Verifying identity for more than 7 active days (net of paused time). GDPR Art. 12; DPDPA s.13.', 'medium', 'Advance the request past identity verification in OneTrust, or automate the verification step so early-stage requests do not stall.'),
  ('onetrust', 'onetrust.dsar.no_excessive_pause', 'Data-subject requests are not paused indefinitely', 'Flags open requests paused for more than 30 days. GDPR Art. 12(3) (extensions must be justified); DPDPA s.13.', 'low', 'Review the long-paused request in OneTrust, document the justification for any extension, and resume or close it.'),
  ('onetrust', 'onetrust.incidents.no_stale_open', 'Open incidents are being worked, not left stale', 'Flags OPEN incidents with no update for more than 30 days. GDPR Art. 33 (breach handling); DPDPA s.8(6).', 'medium', 'Progress or formally close the incident in the OneTrust Incident module; add a status update and next action.'),
  ('onetrust', 'onetrust.incidents.breach_decision_recorded', 'Breach-notification decisions are recorded promptly', 'Flags OPEN incidents older than 72 hours whose detail record carries no breach-notification decision. GDPR Art. 33 & Art. 34; DPDPA s.8(6) intimation of a personal data breach.', 'high', 'Complete the breach-assessment step in OneTrust for the incident and record the regulator / data-principal notification decision and rationale.'),
  ('onetrust', 'onetrust.incidents.register_operating', 'The incident register is in active use', 'Liveness / evidence check: the incident register is reachable and at least one incident was logged in the trailing 12 months. GDPR Art. 33(5) documentation; DPDPA s.8(6).', 'low', 'Ensure security and privacy incidents (including near-misses) are logged in OneTrust so the register is demonstrably operating.'),
  ('onetrust', 'onetrust.risk.high_risks_have_treatment', 'Open high risks have a treatment plan', 'Flags open High / Very High risks in the risk register with neither a mitigating control nor a treatment deadline. GDPR Art. 32; DPDPA s.8(4).', 'high', 'Add a mitigating control reference or a dated treatment plan to the risk in the OneTrust Risk module.'),
  ('onetrust', 'onetrust.risk.treatment_not_overdue', 'Risk treatment deadlines are met', 'Flags open risks whose treatment deadline is in the past. GDPR Art. 32; DPDPA s.8(4).', 'medium', 'Complete the risk treatment in OneTrust or re-baseline the deadline with documented approval.'),
  ('onetrust', 'onetrust.risk.register_maintained', 'A risk register is maintained', 'Checks the OneTrust risk register is not empty. GDPR Art. 24 & Art. 32 (risk-based measures); DPDPA s.8(4).', 'low', 'Populate the OneTrust Risk module with the privacy and security risks identified through assessments and incidents.'),
  ('onetrust', 'onetrust.vendors.risk_assessed', 'Vendors have a completed risk assessment', 'Flags vendor inventory records with no linked COMPLETED vendor / third-party (TPDD) assessment. GDPR Art. 28 (processor due diligence); DPDPA s.8(2) engagement of Data Processors.', 'high', 'Send and complete a vendor risk / TPDD assessment in OneTrust Third-Party Management for the vendor.'),
  ('onetrust', 'onetrust.vendors.high_risk_reviewed', 'High-risk vendors are reviewed at least annually', 'Flags vendors flagged high-risk whose record has not been updated in 12 months. GDPR Art. 28; DPDPA s.8(2).', 'medium', 'Re-assess the high-risk vendor in OneTrust on at least an annual cadence and record the updated risk rating.'),
  ('onetrust', 'onetrust.vendors.inventory_populated', 'A vendor inventory is maintained', 'Checks the OneTrust vendor inventory is not empty. GDPR Art. 28 & Art. 30(1)(d); DPDPA s.8(2).', 'low', 'Build out the vendor / third-party inventory in OneTrust, importing from procurement or an existing vendor list.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('onetrust.assessments.no_stale_in_progress', 'A.18.2.2'),
  ('onetrust.assessments.high_risks_mitigated', 'A.18.1.4'),
  ('onetrust.assessments.dpia_process_operating', 'A.18.1.4'),
  ('onetrust.inventory.ropa_populated', 'A.18.1.1'),
  ('onetrust.inventory.records_have_owners', 'A.8.1.2'),
  ('onetrust.inventory.records_reviewed_annually', 'A.8.1.1'),
  ('onetrust.dsar.within_statutory_deadline', 'A.18.1.4'),
  ('onetrust.dsar.progressing', 'A.18.1.4'),
  ('onetrust.dsar.no_excessive_pause', 'A.18.1.4'),
  ('onetrust.incidents.no_stale_open', 'A.16.1.5'),
  ('onetrust.incidents.breach_decision_recorded', 'A.16.1.4'),
  ('onetrust.incidents.register_operating', 'A.16.1.2'),
  ('onetrust.risk.high_risks_have_treatment', 'A.18.1.4'),
  ('onetrust.risk.treatment_not_overdue', 'A.18.1.4'),
  ('onetrust.risk.register_maintained', 'A.18.1.4'),
  ('onetrust.vendors.risk_assessed', 'A.15.1.1'),
  ('onetrust.vendors.high_risk_reviewed', 'A.15.2.1'),
  ('onetrust.vendors.inventory_populated', 'A.15.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== ServiceNow connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('servicenow', 'ServiceNow', 'business_apps', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('servicenow', 'servicenow.user.no_inactive_privileged', 'No inactive users retain a privileged role', 'Flags sys_user records with active=false that still have a sys_user_has_role row for an admin-tier role (admin, security_admin, user_admin).', 'high', 'Remove the role assignment in sys_user_has_role when a user is deactivated, or run a scheduled cleanup job for stale privileged assignments.'),
  ('servicenow', 'servicenow.user.mfa_enforced', 'Multi-factor authentication is enforced instance-wide', 'Reads the instance MFA enforcement properties (glide.authenticate.multifactor.enabled and related) and confirms MFA is enabled, not opt-in. If MFA is enforced only via SSO/IdP or user-criteria rules this is reported for manual attestation.', 'critical', 'Enable Multi-Factor Authentication under Multi-Factor Authentication > Properties and enforce it for all users, not just admins.'),
  ('servicenow', 'servicenow.role.admin_count_within_policy', 'Number of users with the admin role is within policy', 'Counts active users holding the full admin role via sys_user_has_role and checks it against the configured threshold.', 'medium', 'Review admin role assignments and move users who don''t need full admin rights to a scoped custom role.'),
  ('servicenow', 'servicenow.acl.default_deny_sensitive_tables', 'Sensitive tables have explicit (non-public) ACLs defined', 'Checks sys_security_acl has explicit role/script-restricted rules for sys_user, sys_user_has_role and sys_security_acl rather than an active rule that grants an operation with no role, script or condition.', 'high', 'Add or tighten an ACL rule on the table under System Security > Access Control (ACL), restricting the operation to an explicit role list.'),
  ('servicenow', 'servicenow.group.privileged_groups_reviewed', 'Privileged groups have a bounded, reviewed membership', 'Identifies groups that look privileged (admin/security token in the name or description, or a mapped admin role) and flags those whose sys_user_grmember count exceeds the threshold or that have not been updated in 12 months.', 'medium', 'Review the flagged group''s membership and remove members without a documented business need for privileged group access.'),
  ('servicenow', 'servicenow.integrationuser.web_service_only', 'Integration/service accounts are restricted to web service access', 'Flags active users matching a service-account naming convention (svc.*, api.*, *.integration) or the internal integration-user flag that do not have web_service_access_only=true.', 'high', 'Edit the service account user record and check "Web service access only" so the credential cannot be used for interactive login.'),
  ('servicenow', 'servicenow.password_policy.strength_enforced', 'Password policy meets minimum strength requirements', 'Reads the Password Policy plugin records (sys_user_password_policy) and the glide.security.password.* properties and checks the enforced minimum length meets the baseline.', 'high', 'Update the applicable Password Policy record under User Administration > Password Policies to enforce a sufficient minimum length and complexity.'),
  ('servicenow', 'servicenow.audit.field_audit_enabled', 'Field-level audit history is enabled for sensitive tables', 'Checks sys_audit holds change history for sys_user and sys_security_acl, confirming the Audit flag is set on those tables.', 'medium', 'Enable the Audit flag on the table (System Definition > Tables) or on the specific dictionary fields via the Field Audit related list.'),
  ('servicenow', 'servicenow.audit.login_activity_logged', 'User login activity is logged and retrievable', 'Checks active sys_user records carry recent last_login_time values, evidencing login auditing has not been disabled or purged prematurely.', 'medium', 'Confirm the relevant login-logging property is enabled and that no scheduled cleanup job is purging login records prematurely.'),
  ('servicenow', 'servicenow.oauth.basic_auth_restricted', 'Basic Authentication is restricted for REST API access', 'Checks an active REST API Access Policy is configured to restrict authentication (forcing OAuth over Basic Auth) for REST access.', 'high', 'Create a REST API Access Policy under System Web Services > REST > API Access Policies restricting the target tables to OAuth authentication.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('servicenow.user.no_inactive_privileged', 'A.9.2.1'),
  ('servicenow.user.mfa_enforced', 'A.9.4.2'),
  ('servicenow.role.admin_count_within_policy', 'A.9.2.3'),
  ('servicenow.acl.default_deny_sensitive_tables', 'A.9.4.1'),
  ('servicenow.group.privileged_groups_reviewed', 'A.9.2.5'),
  ('servicenow.integrationuser.web_service_only', 'A.9.2.3'),
  ('servicenow.password_policy.strength_enforced', 'A.9.4.3'),
  ('servicenow.audit.field_audit_enabled', 'A.12.4.1'),
  ('servicenow.audit.login_activity_logged', 'A.12.4.1'),
  ('servicenow.oauth.basic_auth_restricted', 'A.9.4.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Privy by IDfy connector: catalog seed data =====
-- Privy (https://www.privybyidfy.com) is IDfy's DPDP-Act compliance platform.
-- This connector runs read-only posture checks against the customer's Privy
-- tenant, mirroring the OneTrust connector. Endpoint paths are built from the
-- documented module behaviour (Privy publishes no public API reference) and are
-- flagged in api/src/connectors/privy/index.js — confirm against a live tenant
-- before this connector leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('privy', 'Privy by IDfy', 'data_governance', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('privy', 'privy.consent.collection_points_registered', 'A consent-capture programme is operating', 'Checks at least one active consent collection point is registered in Privy. DPDPA s.6 (consent) & s.7 (legitimate uses); GDPR Art. 7.', 'high', 'Create and publish the consent collection points for each customer journey that processes personal data in Privy Consent Governance.'),
  ('privy', 'privy.consent.artifacts_being_captured', 'Consent artefacts are actively being captured', 'Confirms at least one immutable consent artefact was written in the trailing 30 days, evidencing the collection points are live, not just configured. DPDPA s.6(1) & s.6(4); GDPR Art. 7(1).', 'high', 'Wire the live consent collection points into the product journeys so consent artefacts are recorded for every data principal.'),
  ('privy', 'privy.consent.notice_versioned', 'Consent notices are versioned and reviewed', 'Flags active collection points whose notice / purpose text carries no version or has not been reviewed in 12 months. DPDPA s.5 (notice) & s.6(3); GDPR Art. 13.', 'medium', 'Attach a versioned notice to each collection point in Privy and run an annual review so the notice text stays current.'),
  ('privy', 'privy.consent.withdrawal_supported', 'Consent withdrawal is supported at every collection point', 'Flags active collection points where consent withdrawal is disabled. DPDPA s.6(4)-(6) (withdrawal must be as easy as giving consent); GDPR Art. 7(3).', 'medium', 'Enable the withdrawal path / configure a withdrawal endpoint for every active collection point in Privy.'),
  ('privy', 'privy.rights.within_statutory_deadline', 'Data-principal rights requests are handled within the statutory deadline', 'Flags open DPRM requests that are SLA-breached or past their due date. DPDPA s.11-14 & the DPDP Rules response timeline; GDPR Art. 12(3).', 'high', 'Prioritise the overdue request in the Privy DPRM queue, complete fulfilment, and review why the SLA was missed.'),
  ('privy', 'privy.rights.progressing', 'New rights requests are progressing, not sitting untouched', 'Flags requests stuck in an intake / identity-verification stage for more than 7 active days (net of paused time). DPDPA s.13; GDPR Art. 12.', 'medium', 'Advance the request past identity verification in Privy, or automate the verification step so early-stage requests do not stall.'),
  ('privy', 'privy.rights.register_operating', 'The data-principal rights register is in active use', 'Liveness / evidence check: the DPRM register is reachable and at least one request was handled in the trailing 12 months. DPDPA s.11-14; GDPR Art. 12.', 'low', 'Route all data-principal access / correction / erasure / grievance requests through Privy DPRM so the register is demonstrably operating.'),
  ('privy', 'privy.assessments.no_stale_in_progress', 'In-progress assessments are progressing, not stalled', 'Flags PIA/DPIA assessments left in a draft / in-progress / in-review state with no edit for 90+ days. DPDPA s.8(4) reasonable security safeguards; GDPR Art. 35.', 'medium', 'Reassign or close out the stalled assessment in Privy, or set a due date and owner so it re-enters the review workflow.'),
  ('privy', 'privy.assessments.high_risks_mitigated', 'High risks on completed assessments are mitigated', 'For completed assessments, reads the risk detail and flags any High / Very High risk not in a mitigated, accepted, or closed state. DPDPA s.8(4); GDPR Art. 35(7)(d) & Art. 36.', 'high', 'Record a mitigation, formal risk acceptance, or transfer against the assessment risk in Privy; re-run collection once the risk state is updated.'),
  ('privy', 'privy.assessments.dpia_process_operating', 'A PIA/DPIA process is operating', 'Confirms at least one PIA/DPIA assessment was completed in the trailing 12 months. DPDPA s.8(4) (and s.10 for a Significant Data Fiduciary); GDPR Art. 35.', 'medium', 'Run and complete a PIA/DPIA in Privy for a current high-risk processing activity so there is recent evidence the assessment process is live.'),
  ('privy', 'privy.incidents.no_stale_open', 'Open incidents are being worked, not left stale', 'Flags open incidents with no update for more than 30 days. DPDPA s.8(6); GDPR Art. 33.', 'medium', 'Progress or formally close the incident in the Privy Incident Management module; add a status update and next action.'),
  ('privy', 'privy.incidents.breach_decision_recorded', 'Breach-notification decisions are recorded promptly', 'Flags open incidents older than 72 hours whose detail carries no breach-notification decision. DPDPA s.8(6) intimation of a personal data breach to the Board and each affected Data Principal; GDPR Art. 33 & Art. 34.', 'high', 'Complete the breach-assessment step in Privy and record the Data Protection Board / data-principal notification decision and rationale.'),
  ('privy', 'privy.incidents.register_operating', 'The incident register is in active use', 'Liveness / evidence check: the incident register is reachable and at least one incident was logged in the trailing 12 months. DPDPA s.8(6); GDPR Art. 33(5).', 'low', 'Ensure security and privacy incidents (including near-misses) are logged in Privy so the register is demonstrably operating.'),
  ('privy', 'privy.tprm.processors_risk_assessed', 'Processors and third parties have a completed risk assessment', 'Flags processor / third-party records with no completed risk assessment. DPDPA s.8(2) engagement of Data Processors under a valid contract; GDPR Art. 28.', 'high', 'Send and complete a processor risk assessment in Privy TPRM, and put a compliant data-processing contract in place.'),
  ('privy', 'privy.tprm.high_risk_reviewed', 'High-risk processors are reviewed at least annually', 'Flags processors flagged high-risk whose assessment has not been refreshed in 12 months. DPDPA s.8(2); GDPR Art. 28.', 'medium', 'Re-assess the high-risk processor in Privy on at least an annual cadence and record the updated risk rating.'),
  ('privy', 'privy.inventory.ropa_populated', 'Records of Processing Activities (RoPA) is populated', 'Checks the Privy Data Compass processing-activities inventory is not empty. DPDPA s.5 notice & s.8(3) accountability of the Data Fiduciary; GDPR Art. 30.', 'high', 'Build out the processing-activities inventory in Privy Data Compass, importing from a data-discovery scan or a manual workshop.'),
  ('privy', 'privy.inventory.records_have_owners', 'Data-inventory records have an assigned owner', 'Flags processing-activity and asset records with no assigned data owner. DPDPA s.8(3); GDPR Art. 30.', 'medium', 'Assign a data owner / business unit to each record in Privy Data Compass.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('privy.consent.collection_points_registered', 'A.18.1.1'),
  ('privy.consent.artifacts_being_captured', 'A.18.1.4'),
  ('privy.consent.notice_versioned', 'A.18.1.1'),
  ('privy.consent.withdrawal_supported', 'A.18.1.4'),
  ('privy.rights.within_statutory_deadline', 'A.18.1.4'),
  ('privy.rights.progressing', 'A.18.1.4'),
  ('privy.rights.register_operating', 'A.18.1.4'),
  ('privy.assessments.no_stale_in_progress', 'A.18.2.2'),
  ('privy.assessments.high_risks_mitigated', 'A.18.1.4'),
  ('privy.assessments.dpia_process_operating', 'A.18.1.4'),
  ('privy.incidents.no_stale_open', 'A.16.1.5'),
  ('privy.incidents.breach_decision_recorded', 'A.16.1.4'),
  ('privy.incidents.register_operating', 'A.16.1.2'),
  ('privy.tprm.processors_risk_assessed', 'A.15.1.1'),
  ('privy.tprm.high_risk_reviewed', 'A.15.2.1'),
  ('privy.inventory.ropa_populated', 'A.18.1.1'),
  ('privy.inventory.records_have_owners', 'A.8.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== CrowdStrike connector: catalog seed data =====
-- CrowdStrike Falcon (https://www.crowdstrike.com) is an endpoint detection and
-- response (EDR) platform. This connector runs read-only posture checks against
-- a customer's Falcon tenant — host inventory, sensor policy, detections/alerts,
-- and Spotlight vulnerability exposure — mirroring the Microsoft Defender
-- connector. Falcon's regions are fully separate API hosts with no cross-region
-- routing, so the connection captures the cloud region explicitly. Endpoint
-- paths in api/src/connectors/crowdstrike/ follow the documented Falcon REST
-- query/entity pattern — confirm against a live tenant before this connector
-- leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('crowdstrike', 'CrowdStrike Falcon', 'endpoint_security', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('crowdstrike', 'crowdstrike.host.stale_endpoints_reviewed', 'No endpoints have gone stale without review', 'Checks hosts whose last-seen timestamp exceeds a defined staleness threshold (default 30 days) are flagged rather than left silently unmanaged. ISO 27001 A.12.2.1 (malware protection); DPDPA s.8(4) reasonable security safeguards.', 'high', 'Investigate stale hosts to confirm they are decommissioned rather than simply offline; remove decommissioned assets from the fleet and reconcile against the asset inventory.'),
  ('crowdstrike', 'crowdstrike.host.unmanaged_reduced_functionality', 'No hosts are running in reduced functionality / sensor-degraded mode', 'Checks hosts do not report reduced functionality mode or an equivalent degraded-sensor state, which indicates the sensor is installed but not providing full protection. ISO 27001 A.12.2.1; DPDPA s.8(4).', 'high', 'Investigate hosts in reduced functionality mode - commonly caused by license/policy misassignment or sensor tampering - and restore full protection.'),
  ('crowdstrike', 'crowdstrike.sensor.policy_compliance', 'All managed hosts are assigned an active sensor update policy', 'Checks every host maps to an active, non-default sensor update policy rather than falling back to the platform default. ISO 27001 A.12.2.1; DPDPA s.8(4).', 'high', 'Assign each host group an explicit sensor update policy under Host setup and management > Sensor update policies, rather than leaving hosts on the platform default.'),
  ('crowdstrike', 'crowdstrike.sensor.build_currency', 'Sensor update policies pin to a current (not deprecated) sensor build', 'Checks each sensor update policy''s configured build is not flagged deprecated or more than N releases behind the latest production build for its platform. ISO 27001 A.12.6.1 (technical vulnerability management); DPDPA s.8(4).', 'medium', 'Update the sensor policy''s build/channel assignment under Sensor update policies to a current, supported build.'),
  ('crowdstrike', 'crowdstrike.detection.high_severity_backlog', 'High/critical severity detections are triaged within SLA', 'Checks critical/high severity alerts and detections do not remain in an open or new status beyond the defined triage SLA (default 48 hours). ISO 27001 A.16.1.5 (response to information security incidents); DPDPA s.8(6).', 'critical', 'Triage the open high-severity detections listed in Falcon''s Activity dashboard and update their status once investigated; if the backlog is systemic, review analyst staffing/alerting thresholds.'),
  ('crowdstrike', 'crowdstrike.detection.no_unresolved_incidents', 'No detections remain in an unresolved state past the review window', 'Checks detections and alerts do not sit in a new or in-progress status past a defined maximum age (default 7 days) regardless of severity. ISO 27001 A.16.1.5; DPDPA s.8(6).', 'high', 'Close out or explicitly defer aged detections with documented justification; investigate why detections are aging past the review window.'),
  ('crowdstrike', 'crowdstrike.vulnerability.critical_exposure_review', 'Critical/high CVE exposure on managed hosts is within policy', 'Checks Spotlight vulnerability records with a critical/high severity and a non-remediated status do not exceed the defined age threshold (default 30 days for critical, 90 for high). ISO 27001 A.12.6.1; DPDPA s.8(4).', 'critical', 'Patch or mitigate the flagged CVEs per the vulnerability management policy''s SLA, or document a compensating control/risk acceptance for exceptions.'),
  ('crowdstrike', 'crowdstrike.user.admin_role_review', 'Falcon console admin roles are limited to a reviewed set of accounts', 'Checks Falcon console administrator role assignments against a bounded review threshold and surfaces the full admin roster. ISO 27001 A.9.2.3 (management of privileged access rights); DPDPA s.8(4).', 'medium', 'Review Falcon console user roles under User Management and remove administrator access from accounts that no longer require it.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('crowdstrike.host.stale_endpoints_reviewed', 'A.12.2.1'),
  ('crowdstrike.host.unmanaged_reduced_functionality', 'A.12.2.1'),
  ('crowdstrike.sensor.policy_compliance', 'A.12.2.1'),
  ('crowdstrike.sensor.build_currency', 'A.12.6.1'),
  ('crowdstrike.detection.high_severity_backlog', 'A.16.1.5'),
  ('crowdstrike.detection.no_unresolved_incidents', 'A.16.1.5'),
  ('crowdstrike.vulnerability.critical_exposure_review', 'A.12.6.1'),
  ('crowdstrike.user.admin_role_review', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Acronis Cyber Protect Cloud connector: catalog seed data =====
-- Acronis Cyber Protect Cloud (https://www.acronis.com) is a backup /
-- anti-malware / vulnerability-management platform. This connector runs
-- read-only posture checks against a customer's Acronis tenant — protected-
-- workload status, backup recency, anti-malware scan recency, and the alert
-- stream — to evidence backup (ISO 27001 A.12.3), malware protection (A.12.2),
-- technical vulnerability management (A.12.6) and security monitoring (A.16.1)
-- controls. Auth is an OAuth2 client-credentials API client. The endpoint paths
-- in api/src/connectors/acronis/ follow developer.acronis.com's published docs —
-- confirm against a live tenant before this connector leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('acronis', 'Acronis Cyber Protect Cloud', 'backup', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('acronis', 'acronis.backup.protection_enabled', 'Every workload has an assigned protection plan', 'Checks every managed workload reports a Protected status rather than an unprotected, degraded, or error state. ISO 27001 A.12.3.1 (information backup); DPDPA s.8(4) reasonable security safeguards.', 'high', 'Assign an active protection plan to every workload under Protection > Devices, and investigate any machine reporting a non-Protected status.'),
  ('acronis', 'acronis.backup.recent_successful_backup', 'Backups have completed within the expected window', 'Checks each workload has a successful backup no older than the defined window (default 7 days). ISO 27001 A.12.3.1; DPDPA s.8(4).', 'high', 'Investigate workloads with a stale or missing last successful backup — check the protection plan schedule, agent connectivity, and storage quota — and re-run the backup.'),
  ('acronis', 'acronis.malware.scan_up_to_date', 'Anti-malware scans have completed within the expected window', 'Checks each workload has a successful anti-malware scan no older than the defined window (default 7 days). ISO 27001 A.12.2.1 (controls against malware); DPDPA s.8(4).', 'medium', 'Enable anti-malware scanning in the protection plan for every workload and investigate agents that have not reported a recent successful scan.'),
  ('acronis', 'acronis.malware.no_open_detections', 'No unresolved malware or ransomware alerts', 'Checks the Acronis alert stream carries no open malware / ransomware detections. ISO 27001 A.12.2.1; DPDPA s.8(6).', 'critical', 'Investigate and remediate each open malware/ransomware alert in the Acronis console — quarantine or clean the affected workload, then mark the alert resolved.'),
  ('acronis', 'acronis.vulnerability.no_open_findings', 'No open vulnerability-assessment findings past SLA', 'Checks the alert stream carries no open vulnerability-assessment findings older than the defined age threshold (default 30 days). ISO 27001 A.12.6.1 (technical vulnerability management); DPDPA s.8(4).', 'high', 'Remediate the flagged vulnerabilities per the vulnerability-management SLA, or document a compensating control / risk acceptance for exceptions.'),
  ('acronis', 'acronis.vulnerability.patches_applied', 'Outstanding patches are applied within the expected window', 'Checks the alert stream carries no missing-patch alerts open past the defined window (default 30 days). ISO 27001 A.12.6.1; DPDPA s.8(4).', 'medium', 'Apply the outstanding OS / third-party patches via the patch-management module, or schedule them in the protection plan.'),
  ('acronis', 'acronis.monitoring.no_open_critical_alerts', 'No unresolved critical or error alerts', 'Checks the Acronis alert stream carries no open critical / error alerts beyond those covered by the malware and vulnerability checks. ISO 27001 A.16.1.5 (response to information security incidents); DPDPA s.8(6).', 'high', 'Triage the open critical/error alerts in the Acronis console Alerts view and resolve or explicitly acknowledge each with documented justification.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('acronis.backup.protection_enabled', 'A.12.3.1'),
  ('acronis.backup.recent_successful_backup', 'A.12.3.1'),
  ('acronis.malware.scan_up_to_date', 'A.12.2.1'),
  ('acronis.malware.no_open_detections', 'A.12.2.1'),
  ('acronis.vulnerability.no_open_findings', 'A.12.6.1'),
  ('acronis.vulnerability.patches_applied', 'A.12.6.1'),
  ('acronis.monitoring.no_open_critical_alerts', 'A.16.1.5')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Commvault connector: catalog seed data =====
-- Commvault (https://www.commvault.com) is an enterprise backup / data-protection
-- platform. This connector runs read-only posture checks against a customer's
-- CommCell through its WebConsole REST API — backup SLA health, storage-policy
-- copy WORM / compliance lock and encryption, and backup-failure alerting — to
-- evidence information backup (ISO 27001 A.12.3), protection of records (A.18.1),
-- cryptographic controls (A.10.1) and event logging (A.12.4). Auth is a
-- customer-generated Custom-scope access token (Authtoken header, no /Login).
-- Commvault has no Node SDK; several REST paths / field names in
-- api/src/connectors/commvault/ are researched from cvpysdk but unconfirmed
-- against a live CommCell (marked TODO CONFIRM, and they degrade to a visible
-- "error" result rather than a guessed pass/fail) — confirm before this
-- connector leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('commvault', 'Commvault', 'backup', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('commvault', 'commvault.backup.sla_compliance', 'Monitored entities meet their backup SLA', 'Checks the CommCell-wide Backup Health SLA summary reports zero entities missing their SLA or never backed up. ISO 27001 A.12.3.1 (information backup); DPDPA s.8(4) reasonable security safeguards.', 'critical', 'Investigate entities missing their backup SLA in Command Center > Reports > Backup Health and remediate failing backup jobs or schedules.'),
  ('commvault', 'commvault.storage.worm_lock_enabled', 'Storage policy copies have WORM / compliance lock enabled', 'Checks every storage policy copy has WORM (Write-Once-Read-Many) / compliance lock enabled, protecting backups from tampering or premature deletion for their retention period. ISO 27001 A.18.1.3 (protection of records); DPDPA s.8(4).', 'high', 'Enable compliance lock on each storage policy copy under Storage > Storage Policies > (policy) > Copy Properties.'),
  ('commvault', 'commvault.storage.encryption_enabled', 'Storage policy copies have encryption enabled', 'Checks every storage policy copy has encryption enabled at rest. ISO 27001 A.10.1.2 (key management / use of cryptographic controls); DPDPA s.8(4).', 'high', 'Enable encryption on each storage policy copy under Storage > Storage Policies > (policy) > Copy Properties > Advanced.'),
  ('commvault', 'commvault.monitoring.alerts_configured', 'An alert is configured for backup job failures', 'Checks at least one alert is configured to notify on backup job failure. ISO 27001 A.12.4.1 (event logging); DPDPA s.8(6).', 'medium', 'Configure a Job Management alert for backup job failures under Alerts > Add Alert in Command Center.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('commvault.backup.sla_compliance', 'A.12.3.1'),
  ('commvault.storage.worm_lock_enabled', 'A.18.1.3'),
  ('commvault.storage.encryption_enabled', 'A.10.1.2'),
  ('commvault.monitoring.alerts_configured', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Salesforce connector: catalog seed data =====
-- Salesforce (https://www.salesforce.com) is a cloud CRM SaaS. This connector
-- runs read-only posture checks against a customer's Salesforce org — users,
-- profiles, permission sets, MFA/session policy, connected apps, and the Setup
-- Audit Trail — to evidence identity & access management (ISO 27001 A.9) and
-- logging (A.12.4) controls. Auth is the OAuth 2.0 JWT Bearer flow (signed
-- assertion, no stored password). The SOQL / Tooling API queries in
-- api/src/connectors/salesforce/ follow the documented object model but are
-- unconfirmed against a live production org — confirm before this connector
-- leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('salesforce', 'Salesforce', 'business_apps', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('salesforce', 'salesforce.user.mfa_enforced', 'Multi-factor authentication is enforced for all users', 'Checks the org''s session/security settings require MFA at login for all direct UI logins, not just high-assurance sessions. ISO 27001 A.9.4.2; DPDPA s.8(4) reasonable security safeguards.', 'critical', 'Enable "Require multi-factor authentication (MFA) for all direct UI logins" under Setup > Session Settings, or assign the "Multi-Factor Authentication for User Interface Logins" permission org-wide.'),
  ('salesforce', 'salesforce.user.no_inactive_high_privilege', 'No inactive users retain a high-privilege profile or permission set', 'Checks deactivated users do not still carry an admin-tier profile (e.g. System Administrator) or an admin-tier permission set assignment. ISO 27001 A.9.2.1; DPDPA s.8(4).', 'high', 'Deactivate or reassign the profile/permission set on the inactive user record; move deactivated users to a minimal-access profile before deactivation completes.'),
  ('salesforce', 'salesforce.profile.password_policy_strength', 'Org password policy meets minimum strength requirements', 'Checks each profile''s password policy enforces a minimum length, complexity, and expiration consistent with the company''s policy baseline. ISO 27001 A.9.4.3; DPDPA s.8(4).', 'high', 'Update the password policy under Setup > Profiles > (profile) > Password Policies (minimum 8+ characters, complexity required, expiration <= 90 days).'),
  ('salesforce', 'salesforce.profile.least_privilege_admin_count', 'Number of users with the System Administrator profile is within policy', 'Checks the count of active users assigned the System Administrator profile does not exceed the configured review threshold. ISO 27001 A.9.2.3; DPDPA s.8(4).', 'medium', 'Review System Administrator assignments and move users who don''t require full admin rights to a scoped permission set instead.'),
  ('salesforce', 'salesforce.connected_app.oauth_scopes_minimal', 'Connected/External Client Apps do not request excessive OAuth scopes', 'Checks each connected app grant does not include broad scopes (full, web) unless explicitly justified. ISO 27001 A.9.1.2; DPDPA s.8(4).', 'high', 'Edit the connected app''s OAuth policy to remove unused scopes; prefer narrowly scoped access (api, refresh_token) over full.'),
  ('salesforce', 'salesforce.connected_app.admin_approval_required', 'Connected Apps require admin pre-authorization', 'Checks each connected app''s OAuth policy has Permitted Users set to "Admin approved users are pre-authorized" rather than "All users may self-authorize". ISO 27001 A.9.2.2; DPDPA s.8(4).', 'high', 'Set the connected app''s OAuth Policies > Permitted Users to admin-approved and explicitly assign the profiles/permission sets that need it.'),
  ('salesforce', 'salesforce.audit.setup_audit_trail_retention', 'Setup Audit Trail history is available for the required retention window', 'Checks Setup Audit Trail records exist covering at least the last 180 days (Salesforce''s standard retention window), confirming audit history isn''t being lost. ISO 27001 A.12.4.1; DPDPA s.8(6).', 'medium', 'If gaps exist, export Setup Audit Trail on a recurring schedule to external storage before the 180-day platform retention window rolls off.'),
  ('salesforce', 'salesforce.audit.login_history_available', 'Login History is retained and queryable', 'Checks Login History returns records for the trailing period, evidencing login/audit logging is active (not disabled or purged). ISO 27001 A.12.4.1; DPDPA s.8(6).', 'medium', 'Confirm no automation is purging Login History; escalate to Salesforce support if login events stop appearing.'),
  ('salesforce', 'salesforce.network.trusted_ip_ranges_configured', 'Login IP restrictions or trusted ranges are configured', 'Checks the org has configured login IP ranges (org-wide trusted ranges or per-profile Login IP Ranges) rather than allowing sign-in from any network. ISO 27001 A.13.1.1; DPDPA s.8(4).', 'medium', 'Configure Setup > Network Access trusted IP ranges, or set profile-level Login IP Ranges for sensitive profiles.'),
  ('salesforce', 'salesforce.permissionset.sensitive_permissions_reviewed', 'Sensitive system permissions are limited to a reviewed set of assignees', 'Checks permission sets/profiles granting sensitive system permissions (Modify All Data, View All Data, Manage Users, Author Apex) are assigned only to a bounded, reviewed set of active users. ISO 27001 A.9.2.3; DPDPA s.8(4).', 'high', 'Audit permission set assignments for the flagged permissions and remove assignments not tied to a documented business justification.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('salesforce.user.mfa_enforced', 'A.9.4.2'),
  ('salesforce.user.no_inactive_high_privilege', 'A.9.2.1'),
  ('salesforce.profile.password_policy_strength', 'A.9.4.3'),
  ('salesforce.profile.least_privilege_admin_count', 'A.9.2.3'),
  ('salesforce.connected_app.oauth_scopes_minimal', 'A.9.1.2'),
  ('salesforce.connected_app.admin_approval_required', 'A.9.2.2'),
  ('salesforce.audit.setup_audit_trail_retention', 'A.12.4.1'),
  ('salesforce.audit.login_history_available', 'A.12.4.1'),
  ('salesforce.network.trusted_ip_ranges_configured', 'A.13.1.1'),
  ('salesforce.permissionset.sensitive_permissions_reviewed', 'A.9.2.3')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Carbonite (Core Endpoint Backup) connector: catalog seed data =====
-- OpenText Carbonite Core Endpoint Backup (formerly "Carbonite Endpoint") is a
-- cloud endpoint-backup platform, distinct from the self-hosted Carbonite Server
-- Backup below. This connector runs read-only posture checks via the legacy SOAP
-- "Dashboard Service" — recent successful backup per device and device
-- protection coverage — to evidence information backup (ISO 27001 A.12.3.1;
-- GDPR Art. 32(1)(c); DPDPA s.8(5); SOC 2 A1.2; HIPAA 164.308(a)(7)(ii)(A); CIS
-- 11.2) and, for the coverage check, monitoring for silent lapses (A.12.4.1;
-- PCI DSS 10.2.1; CERT-In Direction 5). Auth is a customer-generated API key
-- passed as the SOAP CallingContext token. Carbonite has no Node SDK and does
-- not publish the raw SOAP wire format; every operation namespace, SOAPAction,
-- envelope shape and device-state enum value in api/src/connectors/carbonite/ is
-- a documentation guess (marked TODO CONFIRM; they degrade to a visible "error"
-- result rather than a guessed pass/fail) — confirm against a live tenant's WSDL
-- before this connector leaves beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('carbonite', 'Carbonite Core Endpoint Backup', 'backup', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('carbonite', 'carbonite.backup.recent_successful_backup', 'Devices have a recent successful backup', 'Checks each protected device''s last completed backup (LastCompleteBackupUtc) is within the recency window. ISO 27001 A.12.3.1 (information backup); GDPR Art. 32(1)(c); DPDPA s.8(5) reasonable security safeguards; SOC 2 A1.2; HIPAA 164.308(a)(7)(ii)(A).', 'critical', 'Investigate devices with stale or missing backups in the Core Endpoint Backup dashboard and remediate failing backup schedules.'),
  ('carbonite', 'carbonite.backup.device_coverage', 'Devices remain actively protected', 'Checks no enrolled device has silently lapsed into a suspended / cancelled state. ISO 27001 A.12.3.1 & A.12.4.1; GDPR Art. 32(1)(b)-(c); DPDPA s.8(5); SOC 2 A1.2 & CC7.2; PCI DSS 10.2.1; CERT-In Direction 5.', 'high', 'Reactivate or re-enroll any device unexpectedly suspended or cancelled in the Core Endpoint Backup dashboard.')
ON CONFLICT (test_key) DO NOTHING;

-- Only bare ISO27001 rows here (framework defaults to 'ISO27001'). DPDPA +
-- GDPR/SOC2/HIPAA/CIS(/PCIDSS/CERTIN) rows are derived at boot by
-- syncTestDefinitions() from the connector check objects.
INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('carbonite.backup.recent_successful_backup', 'A.12.3.1'),
  ('carbonite.backup.device_coverage', 'A.12.3.1'),
  ('carbonite.backup.device_coverage', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Carbonite Server Backup connector: catalog seed data =====
-- OpenText Carbonite Server Backup is the self-hosted product line (distinct from
-- Carbonite Core Endpoint Backup). This connector runs read-only posture checks
-- against a customer's install via its OData "API - Monitoring" component
-- (Keycloak OIDC auth) — recent successful safeset runs and backup-agent
-- liveness — to evidence information backup (ISO 27001 A.12.3.1; GDPR Art.
-- 32(1)(c); DPDPA s.8(5); SOC 2 A1.2; HIPAA 164.308(a)(7)(ii)(A); CIS 11.2) and
-- monitoring (A.12.4.1; PCI DSS 10.2.1; CERT-In Direction 5). Auth is a Keycloak
-- client (least-privilege Reseller access level) minted per collection run.
-- Carbonite Server Backup has no Node SDK and no public API docs; every OData
-- path, entity field name and Keycloak realm/endpoint in
-- api/src/connectors/carbonite-server/ is a guess pending live install
-- verification (marked TODO CONFIRM, and they degrade to a visible "error"
-- result rather than a guessed pass/fail) — confirm before this connector leaves
-- beta.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('carbonite-server', 'Carbonite Server Backup', 'backup', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('carbonite-server', 'carbonite-server.backup.recent_successful_safeset', 'Safesets have a recent successful backup run', 'Checks each monitored safeset''s most recent run completed successfully and is within the recency window. ISO 27001 A.12.3.1 (information backup); GDPR Art. 32(1)(c); DPDPA s.8(5) reasonable security safeguards; SOC 2 A1.2; HIPAA 164.308(a)(7)(ii)(A).', 'critical', 'Investigate safesets with stale or failed runs in Carbonite Server Backup Director/Portal and remediate the underlying backup job or schedule.'),
  ('carbonite-server', 'carbonite-server.monitoring.agent_online', 'Backup agents are online and checking in', 'Checks every monitored backup agent has reported in recently, so silent agent failures don''t go unnoticed. ISO 27001 A.12.3.1 & A.12.4.1; GDPR Art. 32(1)(b)-(c); DPDPA s.8(5); SOC 2 A1.2 & CC7.2; PCI DSS 10.2.1; CERT-In Direction 5.', 'high', 'Investigate any agent shown as offline / not checking in under Carbonite Server Backup Director/Portal and restore connectivity or re-register the agent.')
ON CONFLICT (test_key) DO NOTHING;

-- Only bare ISO27001 rows here (framework defaults to 'ISO27001'). DPDPA +
-- GDPR/SOC2/HIPAA/CIS(/PCIDSS/CERTIN) rows are derived at boot by
-- syncTestDefinitions() from the connector check objects' isoReferences +
-- dpdpaControlAreas — see api/src/connectors/carbonite-server/tests/*.js.
INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('carbonite-server.backup.recent_successful_safeset', 'A.12.3.1'),
  ('carbonite-server.monitoring.agent_online', 'A.12.3.1'),
  ('carbonite-server.monitoring.agent_online', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Sophos Central connector: catalog seed data =====
-- Read-only, tenant-scoped evidence collection across Sophos Central Endpoint,
-- Common, Detections, Audit, XDR, SIEM, Firewall, Web Control and DNS Protection.
-- DNS uses the current v2 API. Product areas absent from a tenant licence report
-- not_applicable independently so one missing entitlement does not abort a run.
INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('sophos', 'Sophos Central', 'endpoint_security', 'oauth2', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('sophos', 'sophos.endpoint.protection_health', 'All managed endpoints report good overall health', 'Checks endpoint health.overall is good. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'high', 'Investigate bad, suspicious or unknown endpoint health in Sophos Central > Devices.'),
  ('sophos', 'sophos.endpoint.tamper_protection_enabled', 'Tamper Protection is enabled on every device', 'Checks tamperProtectionEnabled is true. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'high', 'Enable Tamper Protection globally and remediate device-level exceptions.'),
  ('sophos', 'sophos.endpoint.services_running', 'All required Sophos protection services are running', 'Checks endpoint health.services.status is good. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'high', 'Repair or reinstall Sophos protection services on affected endpoints.'),
  ('sophos', 'sophos.endpoint.threat_policy_baseline', 'Threat Protection policies keep real-time scanning, live protection and deep learning on', 'Checks the Threat Protection policy baseline. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'high', 'Enable real-time scanning, live protection and deep learning in Threat Protection policies.'),
  ('sophos', 'sophos.endpoint.exploit_mitigation_clear', 'No unresolved exploit-mitigation detections', 'Checks the detected-exploits collection is clear. ISO 27001 A.12.6.1; DPDPA Malware Protection.', 'high', 'Investigate and resolve exploit-mitigation detections in Sophos Central.'),
  ('sophos', 'sophos.endpoint.no_stale_devices', 'No devices have gone unseen past the staleness threshold without review', 'Checks lastSeenAt against the 30-day threshold. ISO 27001 A.8.1.1; DPDPA Asset Management.', 'medium', 'Reconcile stale devices with the asset inventory and remove decommissioned records.'),
  ('sophos', 'sophos.endpoint.isolation_reviewed', 'No devices left self-isolated without an open case', 'Checks endpoint isolation status. ISO 27001 A.16.1.5; DPDPA Incident Management.', 'medium', 'Review isolated devices and link each active isolation to an incident case.'),
  ('sophos', 'sophos.endpoint.encryption_enabled', 'Device Encryption is active where the product is assigned', 'Checks overallEncryptionStatus for devices assigned Device Encryption. ISO 27001 A.10.1.1; DPDPA Encryption.', 'medium', 'Enable and complete Sophos Device Encryption on affected endpoints.'),
  ('sophos', 'sophos.common.no_unresolved_critical_alerts', 'No unresolved critical Sophos Central alerts', 'Checks the Common alert stream for critical alerts. ISO 27001 A.16.1.5; DPDPA Incident Management.', 'critical', 'Triage and resolve critical alerts in Sophos Central.'),
  ('sophos', 'sophos.common.high_alerts_triaged', 'No high-severity alerts older than the triage SLA', 'Checks high alerts against the 48-hour SLA. ISO 27001 A.16.1.4; DPDPA Incident Management.', 'high', 'Assign and triage high-severity alerts within the incident-response SLA.'),
  ('sophos', 'sophos.common.admin_count_reasonable', 'Sophos Central admin count is within the expected bound', 'Checks the tenant admin count against a review threshold. ISO 27001 A.9.2.3; DPDPA Access Control.', 'medium', 'Review Sophos Central admins and remove access that is no longer required.'),
  ('sophos', 'sophos.common.super_admin_least_privilege', 'Super Admin role membership is minimal', 'Checks Super Admin role membership. ISO 27001 A.9.2.3; DPDPA Access Control.', 'high', 'Reduce standing Super Admin membership and use narrower roles.'),
  ('sophos', 'sophos.common.mfa_enforced', 'MFA is enforced for Sophos Central admin sign-in', 'Checks the tenant MFA setting when exposed by the API. ISO 27001 A.9.4.2; DPDPA Access Control.', 'high', 'Require MFA for every Sophos Central administrator.'),
  ('sophos', 'sophos.detections.critical_resolved', 'No open critical XDR detections', 'Checks Detections query results for open critical records. ISO 27001 A.16.1.5; DPDPA Incident Management.', 'critical', 'Investigate and resolve every critical XDR detection.'),
  ('sophos', 'sophos.detections.high_reviewed', 'No high-severity detections unreviewed past the threshold', 'Checks high detections against the seven-day review threshold. ISO 27001 A.16.1.4; DPDPA Incident Management.', 'high', 'Review and disposition aged high-severity detections.'),
  ('sophos', 'sophos.detections.feed_active', 'Detections feed has produced data within the lookback window', 'Checks Detections data is retrievable in the lookback. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'low', 'Confirm XDR detection telemetry and retention are active.'),
  ('sophos', 'sophos.audit.log_retrievable', 'Audit events are retrievable for the full lookback window', 'Checks audit events are retrievable for 30 days. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'medium', 'Enable and retain Sophos Central administrative audit logging.'),
  ('sophos', 'sophos.audit.admin_activity_logged', 'Administrative changes appear in the audit log (completeness sanity check)', 'Checks administrative changes appear in audit events. ISO 27001 A.12.4.3; DPDPA Logging & Monitoring.', 'medium', 'Investigate missing administrative audit activity and logging gaps.'),
  ('sophos', 'sophos.audit.api_credential_changes_reviewed', 'API-credential create/delete events are surfaced for review', 'Checks API credential lifecycle events. ISO 27001 A.9.2.5; DPDPA Access Control.', 'medium', 'Review every API credential creation and deletion against an approved request.'),
  ('sophos', 'sophos.xdr.data_lake_queryable', 'The Sophos Data Lake responds to a baseline query', 'Checks a read-only baseline XDR query completes. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'low', 'Restore XDR Data Lake entitlement and query access.'),
  ('sophos', 'sophos.xdr.telemetry_coverage', 'Data Lake telemetry is present for the expected device population', 'Compares XDR telemetry with endpoint inventory. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'medium', 'Repair XDR sensor collection for endpoints absent from Data Lake telemetry.'),
  ('sophos', 'sophos.xdr.no_stale_telemetry', 'No devices are missing from Data Lake telemetry past the threshold', 'Checks XDR telemetry timestamps against seven days. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'medium', 'Restore current Data Lake telemetry from stale endpoints.'),
  ('sophos', 'sophos.siem.events_flowing', 'The SIEM events endpoint is returning recent events', 'Checks SIEM events are current. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'medium', 'Restore SIEM event export and investigate telemetry gaps.'),
  ('sophos', 'sophos.siem.alerts_current', 'The SIEM alerts endpoint is reachable and current', 'Checks SIEM alerts are current. ISO 27001 A.16.1.2; DPDPA Incident Management.', 'medium', 'Restore SIEM alert export and incident notification flow.'),
  ('sophos', 'sophos.siem.integration_credential_active', 'An active API credential exists for SIEM/log export', 'Checks the OAuth2 credential remains active. ISO 27001 A.12.4.1; DPDPA Logging & Monitoring.', 'low', 'Rotate or recreate the Sophos API credential used for SIEM export.'),
  ('sophos', 'sophos.firewall.all_connected', 'All Central-managed firewalls are online and connected', 'Checks firewall status.connected. ISO 27001 A.13.1.1; DPDPA Network Security.', 'high', 'Restore Sophos Central connectivity for offline firewalls.'),
  ('sophos', 'sophos.firewall.firmware_current', 'No managed firewall is running EOL/outdated firmware', 'Checks firewall firmware lifecycle data when exposed. ISO 27001 A.12.6.1; DPDPA Network Security.', 'high', 'Upgrade affected firewalls to a supported firmware release.'),
  ('sophos', 'sophos.firewall.central_management_active', 'No firewall has Central management suspended', 'Checks firewall status.suspended. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Re-enable Sophos Central management for suspended firewalls.'),
  ('sophos', 'sophos.firewall.ha_configured', 'Firewalls expected to be resilient are in an HA pair', 'Checks HA-required firewalls have cluster data. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Configure an HA pair for firewalls marked as resilience-critical.'),
  ('sophos', 'sophos.firewall.config_sync_healthy', 'Firewall-group configuration sync reports no errors', 'Checks firewall group configuration synchronization when exposed. ISO 27001 A.12.1.2; DPDPA Network Security.', 'medium', 'Resolve firewall-group configuration synchronization errors.'),
  ('sophos', 'sophos.web.policy_assigned', 'A Web Control policy is assigned to every endpoint group', 'Checks Web Control policy assignments. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Assign a Web Control policy to every endpoint group.'),
  ('sophos', 'sophos.web.risky_categories_blocked', 'High-risk web categories are blocked in policy', 'Checks Web Control category actions. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Block malware, phishing and command-and-control web categories.'),
  ('sophos', 'sophos.web.download_scanning_enabled', 'Web download scanning / TLS inspection is enabled', 'Checks download scanning or TLS inspection settings. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Enable web download scanning or TLS inspection in Web Control policies.'),
  ('sophos', 'sophos.web.no_blanket_allow', 'No blanket allow-all website exceptions are configured', 'Checks Web Control allow exceptions. ISO 27001 A.9.4.1; DPDPA Access Control.', 'medium', 'Remove blanket allow-all exceptions and scope any exception narrowly.'),
  ('sophos', 'sophos.dns.protection_active', 'At least one DNS Protection location is active', 'Checks DNS Protection v2 locations. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Configure and activate at least one DNS Protection location.'),
  ('sophos', 'sophos.dns.malware_categories_blocked', 'DNS policies block malware / phishing / C2 categories', 'Checks DNS policy category actions. ISO 27001 A.12.2.1; DPDPA Malware Protection.', 'high', 'Block malware, phishing and command-and-control categories in DNS policy.'),
  ('sophos', 'sophos.dns.all_locations_have_policy', 'Every DNS location is bound to a policy (not default-only)', 'Checks every DNS location has an explicit policy. ISO 27001 A.13.1.1; DPDPA Network Security.', 'medium', 'Assign every DNS Protection location to an explicit policy.'),
  ('sophos', 'sophos.dns.safe_search_enforced', 'Safe search is enforced in DNS policy', 'Checks DNS policy safe-search settings. ISO 27001 A.13.1.1; DPDPA Network Security.', 'low', 'Enable safe search in each DNS Protection policy.'),
  ('sophos', 'sophos.dns.custom_blocklist_present', 'A maintained custom domain block list exists', 'Checks a populated blocked custom domain list is assigned. ISO 27001 A.13.1.1; DPDPA Network Security.', 'low', 'Create, maintain and assign a custom domain block list.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('sophos.endpoint.protection_health', 'A.12.2.1'),
  ('sophos.endpoint.tamper_protection_enabled', 'A.12.2.1'),
  ('sophos.endpoint.services_running', 'A.12.2.1'),
  ('sophos.endpoint.threat_policy_baseline', 'A.12.2.1'),
  ('sophos.endpoint.exploit_mitigation_clear', 'A.12.6.1'),
  ('sophos.endpoint.no_stale_devices', 'A.8.1.1'),
  ('sophos.endpoint.isolation_reviewed', 'A.16.1.5'),
  ('sophos.endpoint.encryption_enabled', 'A.10.1.1'),
  ('sophos.common.no_unresolved_critical_alerts', 'A.16.1.5'),
  ('sophos.common.high_alerts_triaged', 'A.16.1.4'),
  ('sophos.common.admin_count_reasonable', 'A.9.2.3'),
  ('sophos.common.super_admin_least_privilege', 'A.9.2.3'),
  ('sophos.common.mfa_enforced', 'A.9.4.2'),
  ('sophos.detections.critical_resolved', 'A.16.1.5'),
  ('sophos.detections.high_reviewed', 'A.16.1.4'),
  ('sophos.detections.feed_active', 'A.12.4.1'),
  ('sophos.audit.log_retrievable', 'A.12.4.1'),
  ('sophos.audit.admin_activity_logged', 'A.12.4.3'),
  ('sophos.audit.api_credential_changes_reviewed', 'A.9.2.5'),
  ('sophos.xdr.data_lake_queryable', 'A.12.4.1'),
  ('sophos.xdr.telemetry_coverage', 'A.12.2.1'),
  ('sophos.xdr.no_stale_telemetry', 'A.12.4.1'),
  ('sophos.siem.events_flowing', 'A.12.4.1'),
  ('sophos.siem.alerts_current', 'A.16.1.2'),
  ('sophos.siem.integration_credential_active', 'A.12.4.1'),
  ('sophos.firewall.all_connected', 'A.13.1.1'),
  ('sophos.firewall.firmware_current', 'A.12.6.1'),
  ('sophos.firewall.central_management_active', 'A.13.1.1'),
  ('sophos.firewall.ha_configured', 'A.13.1.1'),
  ('sophos.firewall.config_sync_healthy', 'A.12.1.2'),
  ('sophos.web.policy_assigned', 'A.13.1.1'),
  ('sophos.web.risky_categories_blocked', 'A.13.1.1'),
  ('sophos.web.download_scanning_enabled', 'A.13.1.1'),
  ('sophos.web.no_blanket_allow', 'A.9.4.1'),
  ('sophos.dns.protection_active', 'A.13.1.1'),
  ('sophos.dns.malware_categories_blocked', 'A.12.2.1'),
  ('sophos.dns.all_locations_have_policy', 'A.13.1.1'),
  ('sophos.dns.safe_search_enforced', 'A.13.1.1'),
  ('sophos.dns.custom_blocklist_present', 'A.13.1.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Check Point connectors: catalog seed data =====
-- Check Point spans three separate auth domains that cannot share a credential,
-- so it ships as three connectors:
--   check_point_mgmt        -- Security Management API session (policy + Threat Prevention)
--   check_point             -- Infinity Portal API key (Infinity Events, XDR/XPR, Harmony Endpoint)
--   check_point_cloudguard  -- CloudGuard (Dome9) key:secret (CSPM posture)
-- All ship beta: several cloud endpoint shapes are built from public docs and
-- Check Point SDKs but not confirmed against a live tenant. syncTestDefinitions()
-- re-derives automated_tests / test_control_mappings (incl. every non-ISO
-- framework) from the connector JS on every boot; these rows are the seed.

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('check_point_mgmt', 'Check Point Security Management', 'network_security', 'api_key', 'beta'),
  ('check_point', 'Check Point Infinity', 'endpoint_security', 'api_key', 'beta'),
  ('check_point_cloudguard', 'Check Point CloudGuard', 'cloud', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('check_point_mgmt', 'check_point_mgmt.policy.cleanup_rule_present', 'Every access policy package ends with an explicit cleanup (drop) rule', 'Checks the last rule of the first policy package drops Any/Any/Any. ISO 27001 A.13.1.1.', 'high', 'Add an explicit Any/Any/Any cleanup Drop rule as the final rule of every access policy layer.'),
  ('check_point_mgmt', 'check_point_mgmt.policy.no_permissive_any_rule', 'No enabled access rule allows Any source, Any destination and Any service with Accept', 'Checks no enabled access rule accepts Any/Any/Any. ISO 27001 A.9.4.1.', 'high', 'Scope over-permissive Accept rules to specific sources, destinations and services.'),
  ('check_point_mgmt', 'check_point_mgmt.policy.rule_logging_enabled', 'Enforcing access rules have tracking set to Log', 'Checks enforcing access rules do not have tracking set to None. ISO 27001 A.12.4.1.', 'medium', 'Set tracking to Log on every enforcing access rule.'),
  ('check_point_mgmt', 'check_point_mgmt.policy.stealth_rule_present', 'A stealth rule protecting the gateways sits above the first permissive rule', 'Checks a Drop rule to the gateways precedes the first Accept rule. ISO 27001 A.13.1.1.', 'medium', 'Add a stealth rule dropping traffic destined to the gateway objects near the top of the rulebase.'),
  ('check_point_mgmt', 'check_point_mgmt.policy.disabled_rules_reviewed', 'Disabled rules are not left in the rulebase without a review comment', 'Checks disabled access rules carry a comment. ISO 27001 A.9.4.1.', 'low', 'Delete disabled rules or annotate why each is retained.'),
  ('check_point_mgmt', 'check_point_mgmt.gateway.policy_installed_current', 'Every managed gateway has an access policy installed', 'Checks show-gateways-and-servers reports access-policy-installed for each gateway. ISO 27001 A.12.1.2.', 'high', 'Install policy on gateways that report no installed access policy and investigate publish/install failures.'),
  ('check_point_mgmt', 'check_point_mgmt.gateway.software_supported', 'No managed gateway runs an end-of-support software version', 'Checks gateway software is R81 or later. ISO 27001 A.12.6.1.', 'high', 'Upgrade gateways running end-of-support versions to a supported release.'),
  ('check_point_mgmt', 'check_point_mgmt.threat.profile_assigned', 'A Threat Prevention profile is bound to enforcing traffic', 'Checks a Threat Prevention profile exists and an enforcing threat rule is active. ISO 27001 A.12.2.1.', 'high', 'Define a Threat Prevention profile and bind it to an enforcing threat rule.'),
  ('check_point_mgmt', 'check_point_mgmt.threat.mode_is_prevent', 'High-confidence Threat Prevention activations are set to Prevent, not Detect', 'Checks each Threat Prevention profile sets high-confidence activations to Prevent. ISO 27001 A.12.2.1.', 'high', 'Set high-confidence IPS/Anti-Bot/Anti-Virus activations to Prevent in each profile.'),
  ('check_point_mgmt', 'check_point_mgmt.threat.ips_signatures_current', 'The IPS signature database is current', 'Checks show-ips-status reports no update available and a recent last-updated time. ISO 27001 A.12.6.1.', 'high', 'Enable automatic IPS updates and confirm the management server can reach the Check Point update service.'),
  ('check_point_mgmt', 'check_point_mgmt.threat.no_blanket_exceptions', 'Threat Prevention exception rules are not blanket Any/Any', 'Checks Threat Prevention exceptions are scoped, not Any source to Any destination. ISO 27001 A.12.2.1.', 'medium', 'Scope Threat Prevention exceptions to specific hosts, protections and time windows.'),
  ('check_point', 'check_point.events.query_retrievable', 'A baseline Infinity Events query completes (log availability / retention sanity)', 'Checks the Infinity Events query API returns a result set. ISO 27001 A.12.4.1.', 'medium', 'Confirm the Infinity Events / Logs service is provisioned and the API key is scoped to it.'),
  ('check_point', 'check_point.events.feed_active', 'Infinity Events has recorded security events within the lookback window', 'Checks Infinity Events returned at least one event in the last 24 hours. ISO 27001 A.12.4.1.', 'medium', 'Confirm log forwarding from gateways and Harmony products into Infinity Events is active.'),
  ('check_point', 'check_point.events.critical_events_reviewed', 'Critical-severity events are not left unacknowledged past the triage SLA', 'Checks high/critical Infinity Events are handled within the triage SLA where a handling state is exposed. ISO 27001 A.16.1.5.', 'high', 'Triage high and critical events within the incident-response SLA.'),
  ('check_point', 'check_point.xdr.feed_active', 'Infinity XDR/XPR has produced detections or incidents within the lookback window', 'Checks the Infinity XDR/XPR incidents endpoint returns data. ISO 27001 A.12.4.1.', 'low', 'Confirm Infinity XDR/XPR data sources are connected and generating incidents.'),
  ('check_point', 'check_point.xdr.high_incidents_triaged', 'High and critical XDR/XPR incidents are not open past the triage SLA', 'Checks high/critical XDR incidents are not left open past the triage SLA. ISO 27001 A.16.1.5.', 'critical', 'Triage open high and critical XDR/XPR incidents within the incident-response SLA.'),
  ('check_point', 'check_point.xdr.no_stale_investigations', 'XDR/XPR incidents are not left un-progressed past the review window', 'Checks open XDR incidents have been updated within the review window. ISO 27001 A.16.1.4.', 'medium', 'Progress or close XDR/XPR incidents that have not been updated within the review window.'),
  ('check_point', 'check_point.endpoint.devices_checked_in', 'Harmony Endpoint devices have checked in within the staleness threshold', 'Checks Harmony Endpoint device last-connection times against the staleness threshold. ISO 27001 A.8.1.1.', 'high', 'Investigate stale Harmony Endpoint devices and reconcile decommissioned assets with the inventory.'),
  ('check_point', 'check_point.endpoint.protection_blades_active', 'The assigned Endpoint policy keeps Anti-Malware, Anti-Ransomware and Threat Emulation enabled', 'Checks Harmony Endpoint policies keep the core protection blades enabled. ISO 27001 A.12.2.1.', 'high', 'Enable Anti-Malware, Anti-Ransomware and Threat Emulation in every Harmony Endpoint policy.'),
  ('check_point', 'check_point.endpoint.signatures_current', 'Endpoint anti-malware signature age is within the threshold', 'Checks Harmony Endpoint anti-malware signature timestamps against the age threshold. ISO 27001 A.12.6.1.', 'medium', 'Investigate endpoints whose anti-malware signatures are not updating.'),
  ('check_point', 'check_point.endpoint.high_incidents_resolved', 'No unresolved high-severity endpoint incidents past the review window', 'Checks high-severity Harmony Endpoint incidents are resolved within the review window. ISO 27001 A.16.1.5.', 'medium', 'Resolve or formally defer aged high-severity Harmony Endpoint incidents.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.accounts_fetching', 'Every onboarded cloud account is fetching configuration successfully', 'Checks CloudGuard cloud accounts are not missing credentials or suspended. ISO 27001 A.12.1.1.', 'medium', 'Repair credentials for cloud accounts CloudGuard cannot fetch, and resume suspended fetching.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.assessment_recent', 'A compliance assessment has run for each account within the freshness window', 'Checks each cloud account has a CloudGuard assessment within the freshness window. ISO 27001 A.18.2.2.', 'medium', 'Schedule continuous compliance assessments for every onboarded cloud account.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.ruleset_assigned', 'Each account has a compliance ruleset bound and scheduled', 'Checks each cloud account is covered by a continuous-compliance policy. ISO 27001 A.18.2.2.', 'medium', 'Bind a compliance ruleset (CIS, ISO 27001 or best-practice) to every cloud account.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.critical_findings_addressed', 'No critical posture findings remain open past the remediation SLA', 'Checks open critical CloudGuard posture findings against the remediation SLA. ISO 27001 A.12.6.1.', 'critical', 'Remediate or risk-accept open critical posture findings within the SLA.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.high_findings_within_policy', 'High-severity posture findings are within the policy count and age threshold', 'Checks the count of open high-severity CloudGuard findings against the policy threshold. ISO 27001 A.18.2.2.', 'high', 'Drive down open high-severity posture findings and tune noisy rules.'),
  ('check_point_cloudguard', 'check_point_cloudguard.posture.exclusions_reviewed', 'Posture exclusions are time-bounded and not stale', 'Checks CloudGuard compliance exclusions carry a bounded expiry. ISO 27001 A.9.4.1.', 'low', 'Add an expiry date to every compliance exclusion and review them on a schedule.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('check_point_mgmt.policy.cleanup_rule_present', 'A.13.1.1'),
  ('check_point_mgmt.policy.no_permissive_any_rule', 'A.9.4.1'),
  ('check_point_mgmt.policy.rule_logging_enabled', 'A.12.4.1'),
  ('check_point_mgmt.policy.stealth_rule_present', 'A.13.1.1'),
  ('check_point_mgmt.policy.disabled_rules_reviewed', 'A.9.4.1'),
  ('check_point_mgmt.gateway.policy_installed_current', 'A.12.1.2'),
  ('check_point_mgmt.gateway.software_supported', 'A.12.6.1'),
  ('check_point_mgmt.threat.profile_assigned', 'A.12.2.1'),
  ('check_point_mgmt.threat.mode_is_prevent', 'A.12.2.1'),
  ('check_point_mgmt.threat.ips_signatures_current', 'A.12.6.1'),
  ('check_point_mgmt.threat.no_blanket_exceptions', 'A.12.2.1'),
  ('check_point.events.query_retrievable', 'A.12.4.1'),
  ('check_point.events.feed_active', 'A.12.4.1'),
  ('check_point.events.critical_events_reviewed', 'A.16.1.5'),
  ('check_point.xdr.feed_active', 'A.12.4.1'),
  ('check_point.xdr.high_incidents_triaged', 'A.16.1.5'),
  ('check_point.xdr.no_stale_investigations', 'A.16.1.4'),
  ('check_point.endpoint.devices_checked_in', 'A.8.1.1'),
  ('check_point.endpoint.protection_blades_active', 'A.12.2.1'),
  ('check_point.endpoint.signatures_current', 'A.12.6.1'),
  ('check_point.endpoint.high_incidents_resolved', 'A.16.1.5'),
  ('check_point_cloudguard.posture.accounts_fetching', 'A.12.1.1'),
  ('check_point_cloudguard.posture.assessment_recent', 'A.18.2.2'),
  ('check_point_cloudguard.posture.ruleset_assigned', 'A.18.2.2'),
  ('check_point_cloudguard.posture.critical_findings_addressed', 'A.12.6.1'),
  ('check_point_cloudguard.posture.high_findings_within_policy', 'A.18.2.2'),
  ('check_point_cloudguard.posture.exclusions_reviewed', 'A.9.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Microsoft Entra ID connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('entra_id', 'Microsoft Entra ID', 'identity', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('entra_id', 'entra_id.mfa.conditional_access_enforced', 'Multi-factor authentication is enforced tenant-wide', 'Checks at least one enabled Conditional Access policy requires MFA for all users, or that Security Defaults is enabled as a fallback.', 'critical', 'Create a Conditional Access policy requiring MFA for all users and all cloud apps, or enable Security Defaults if Conditional Access isn''t licensed.'),
  ('entra_id', 'entra_id.conditionalaccess.legacy_auth_blocked', 'Conditional Access blocks legacy authentication', 'Checks an enabled Conditional Access policy blocks legacy (basic) authentication clients.', 'critical', 'Create a Conditional Access policy scoping legacy authentication clients and set the grant control to Block access.'),
  ('entra_id', 'entra_id.authmethods.weak_methods_disabled', 'Weak authentication methods are disabled', 'Checks the tenant authentication methods policy has SMS and voice call methods disabled in favor of phishing-resistant methods.', 'medium', 'Disable SMS and Voice call authentication methods, and enable Authenticator/FIDO2/Passkey policies instead.'),
  ('entra_id', 'entra_id.roles.privileged_role_assignments_limited', 'Global Administrator assignments are limited and not permanent', 'Checks the number of active Global Administrator role assignments does not exceed a defined threshold and flags non-PIM-eligible assignments.', 'high', 'Reduce standing Global Administrator assignments and move remaining assignments to PIM-eligible, time-bound assignments.'),
  ('entra_id', 'entra_id.users.stale_guest_accounts_reviewed', 'Inactive guest accounts are disabled or removed', 'Checks guest users with no interactive sign-in within 90 days are disabled or removed.', 'high', 'Disable or remove guest accounts with no sign-in activity in the last 90 days.'),
  ('entra_id', 'entra_id.enterpriseapps.high_privilege_grants_reviewed', 'Enterprise apps with high-privilege Graph permissions are reviewed', 'Checks service principals holding high-privilege application permissions are documented as reviewed.', 'high', 'Review each flagged application''s business justification and remove the grant if no longer needed.'),
  ('entra_id', 'entra_id.appregistrations.credentials_not_expiring_soon', 'App registration secrets and certificates are rotated before expiry', 'Checks app registration credentials are not expired, not expiring within 30 days, and not issued with over 12 months'' validity.', 'medium', 'Rotate the flagged credential now and issue new credentials with a validity period of 12 months or less.'),
  ('entra_id', 'entra_id.audit.signin_and_directory_logs_available', 'Sign-in and directory audit logs are actively retained', 'Checks sign-in and directory audit logs both show entries within the last 24 hours.', 'critical', 'Investigate why no recent log entries exist — check licensing and retention configuration.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('entra_id.mfa.conditional_access_enforced', 'A.9.4.2'),
  ('entra_id.conditionalaccess.legacy_auth_blocked', 'A.9.4.2'),
  ('entra_id.authmethods.weak_methods_disabled', 'A.9.4.2'),
  ('entra_id.roles.privileged_role_assignments_limited', 'A.9.2.3'),
  ('entra_id.users.stale_guest_accounts_reviewed', 'A.9.2.6'),
  ('entra_id.enterpriseapps.high_privilege_grants_reviewed', 'A.9.4.1'),
  ('entra_id.appregistrations.credentials_not_expiring_soon', 'A.9.2.4'),
  ('entra_id.audit.signin_and_directory_logs_available', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Microsoft 365 connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_365', 'Microsoft 365', 'collaboration', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_365', 'microsoft_365.exchange.mailbox_audit_logging_enabled', 'Mailbox audit logging is enabled', 'Checks the organization config does not have mailbox audit logging disabled tenant-wide.', 'critical', 'Clear the AuditDisabled organization setting via Set-OrganizationConfig or the Purview compliance portal.'),
  ('microsoft_365', 'microsoft_365.exchange.no_external_auto_forwarding', 'Automatic forwarding to external domains is blocked', 'Checks the default remote domain configuration has automatic forwarding to external domains disabled.', 'high', 'Set the default remote domain AutoForwardEnabled to false and review existing forwarding rules.'),
  ('microsoft_365', 'microsoft_365.sharepoint.external_sharing_restricted', 'SharePoint and OneDrive external sharing is restricted', 'Checks tenant SharePoint/OneDrive sharing settings are not fully open to any external user.', 'critical', 'Set the external sharing level to Existing guests or more restrictive under the SharePoint admin center.'),
  ('microsoft_365', 'microsoft_365.sharepoint.dlp_policy_configured', 'Data Loss Prevention policies are configured for the tenant', 'Checks that at least one Data Loss Prevention policy is configured for the tenant when SharePoint sites are present.', 'critical', 'Create and enable a Data Loss Prevention policy covering SharePoint/OneDrive under the Microsoft Purview compliance portal.'),
  ('microsoft_365', 'microsoft_365.sharepoint.sensitivity_label_policy_enforced', 'Sensitivity label policies are configured', 'Checks that at least one sensitivity label is configured for the tenant.', 'high', 'Create and publish a sensitivity label policy under the Microsoft Purview compliance portal.'),
  ('microsoft_365', 'microsoft_365.intune.compliance_policy_assigned_all_platforms', 'Device compliance policies are assigned for every managed platform', 'Checks every device platform present in the tenant has at least one assigned compliance policy.', 'high', 'Create and assign a compliance policy for any platform found without one.'),
  ('microsoft_365', 'microsoft_365.intune.noncompliant_devices_remediated', 'Managed devices are compliant or being remediated', 'Checks the proportion of noncompliant managed devices does not exceed a defined threshold.', 'medium', 'Investigate noncompliant devices and remediate the underlying setting or confirm a grace-period action is in flight.'),
  ('microsoft_365', 'microsoft_365.defenderoffice.safe_links_enabled', 'Safe Links protection is enabled for email and Office apps', 'Checks at least one enabled Safe Links policy applies time-of-click URL rewriting tenant-wide.', 'high', 'Enable and assign a Safe Links policy covering email, Teams, and Office apps.'),
  ('microsoft_365', 'microsoft_365.defenderoffice.safe_attachments_enabled', 'Safe Attachments protection is enabled', 'Checks at least one enabled Safe Attachments policy applies detonation scanning to inbound mail.', 'high', 'Enable and assign a Safe Attachments policy under the Defender portal.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_365.exchange.mailbox_audit_logging_enabled', 'A.12.4.1'),
  ('microsoft_365.exchange.no_external_auto_forwarding', 'A.13.2.1'),
  ('microsoft_365.sharepoint.external_sharing_restricted', 'A.13.2.1'),
  ('microsoft_365.sharepoint.dlp_policy_configured', 'A.13.2.1'),
  ('microsoft_365.sharepoint.sensitivity_label_policy_enforced', 'A.8.2.3'),
  ('microsoft_365.intune.compliance_policy_assigned_all_platforms', 'A.6.2.1'),
  ('microsoft_365.intune.noncompliant_devices_remediated', 'A.6.2.1'),
  ('microsoft_365.defenderoffice.safe_links_enabled', 'A.12.2.1'),
  ('microsoft_365.defenderoffice.safe_attachments_enabled', 'A.12.2.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Microsoft Teams connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_teams', 'Microsoft Teams', 'collaboration', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_teams', 'microsoft_teams.externalaccess.federation_domains_restricted', 'External domain federation is restricted, not fully open', 'Checks the tenant federation configuration either blocks external federation or restricts it to an explicit allowed-domains list.', 'critical', 'Restrict external access to a defined list of allowed domains, or disable it entirely, under Teams admin center > Users > External access.'),
  ('microsoft_teams', 'microsoft_teams.externalaccess.consumer_teams_blocked', 'Communication with unmanaged consumer Teams/Skype accounts is blocked', 'Checks federation with unmanaged personal Microsoft accounts is disabled tenant-wide.', 'high', 'Disable Teams accounts not managed by an organization under Teams admin center > Users > External access.'),
  ('microsoft_teams', 'microsoft_teams.client.guest_access_reviewed', 'The Teams client tenant-wide guest access toggle is a reviewed, deliberate setting', 'Checks the Teams client guest access setting is either disabled or explicitly documented as an approved exception.', 'high', 'Disable Teams client guest access if not required, or document the business justification for audit evidence.'),
  ('microsoft_teams', 'microsoft_teams.client.unsanctioned_storage_providers_disabled', 'Unsanctioned third-party cloud storage providers are disabled in the Teams client', 'Checks no unapproved third-party storage provider integration is enabled in the Teams client.', 'medium', 'Disable unapproved third-party storage providers under Teams admin center > Teams apps > Cloud storage options.'),
  ('microsoft_teams', 'microsoft_teams.guests.meeting_capabilities_restricted', 'Guest meeting capabilities are limited to what is required', 'Checks guest meeting configuration restricts ad-hoc meeting creation and full-screen sharing for guests.', 'medium', 'Restrict guest meeting capabilities under Teams admin center > Meetings > Guest meeting policy.'),
  ('microsoft_teams', 'microsoft_teams.policies.meeting_anonymous_join_restricted', 'The global meeting policy does not auto-admit anonymous or unknown external participants', 'Checks the global Teams meeting policy restricts automatic admission and disables anonymous join unless deliberately required.', 'critical', 'Restrict AutoAdmittedUsers and disable anonymous meeting join under Teams admin center > Meetings > Meeting policies.'),
  ('microsoft_teams', 'microsoft_teams.policies.meeting_recording_retention_bounded', 'Meeting recording retention is bounded, not set to never expire', 'Checks meeting recording expiration is set to a finite value where cloud recording is enabled.', 'medium', 'Set a finite recording expiration period under Teams admin center > Meetings > Meeting policies.'),
  ('microsoft_teams', 'microsoft_teams.policies.thirdparty_app_installation_restricted', 'Third-party Teams app installation is governed by an explicit allow-list', 'Checks the global Teams app permission policy restricts third-party app installation to an approved allow-list.', 'medium', 'Configure the global app permission policy to allow only reviewed, approved third-party apps.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_teams.externalaccess.federation_domains_restricted', 'A.13.2.1'),
  ('microsoft_teams.externalaccess.consumer_teams_blocked', 'A.13.2.1'),
  ('microsoft_teams.client.guest_access_reviewed', 'A.9.2.6'),
  ('microsoft_teams.client.unsanctioned_storage_providers_disabled', 'A.13.2.1'),
  ('microsoft_teams.guests.meeting_capabilities_restricted', 'A.9.4.1'),
  ('microsoft_teams.policies.meeting_anonymous_join_restricted', 'A.9.4.1'),
  ('microsoft_teams.policies.meeting_recording_retention_bounded', 'A.18.1.3'),
  ('microsoft_teams.policies.thirdparty_app_installation_restricted', 'A.12.5.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Microsoft Defender connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('microsoft_defender', 'Microsoft Defender', 'endpoint_security', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('microsoft_defender', 'microsoft_defender.devices.onboarding_coverage_complete', 'Managed devices are onboarded to Defender for Endpoint', 'Checks no discoverable device is left un-onboarded (CanBeOnboarded or InsufficientInfo status).', 'high', 'Onboard the flagged devices via Intune, Group Policy, or the onboarding script under Defender portal > Settings > Endpoints > Onboarding.'),
  ('microsoft_defender', 'microsoft_defender.devices.sensor_health_active', 'Onboarded devices report active sensor health', 'Checks onboarded devices do not report Inactive or ImpairedCommunication health status beyond a grace period.', 'medium', 'Investigate devices with impaired or inactive sensor health under Defender portal > Device inventory.'),
  ('microsoft_defender', 'microsoft_defender.devices.high_exposure_devices_remediated', 'High-exposure devices have an active remediation plan', 'Checks devices with High exposure level are not left without remediation activity.', 'high', 'Prioritize remediation of security recommendations affecting high-exposure devices.'),
  ('microsoft_defender', 'microsoft_defender.vulnerabilities.critical_cves_remediated', 'Critical vulnerabilities with a public exploit are remediated within SLA', 'Checks Critical severity vulnerabilities with a known public exploit are not older than the defined remediation SLA.', 'critical', 'Patch or remediate the affected software per the linked security recommendation, prioritizing public-exploit vulnerabilities.'),
  ('microsoft_defender', 'microsoft_defender.recommendations.high_impact_open_reviewed', 'High-impact security recommendations are actioned or have a documented exception', 'Checks high-impact recommendations without an active exception are not left open beyond the review cadence.', 'high', 'Remediate the recommendation or file a documented exception under Defender Vulnerability Management > Recommendations.'),
  ('microsoft_defender', 'microsoft_defender.alerts.high_severity_triaged_promptly', 'High and critical severity alerts are triaged within SLA', 'Checks High/Critical severity alerts do not remain in New status beyond the triage SLA.', 'critical', 'Assign and triage the flagged alerts under Defender portal > Incidents & alerts.'),
  ('microsoft_defender', 'microsoft_defender.alerts.no_unassigned_critical_alerts', 'Critical alerts are assigned to an owner', 'Checks Critical severity alerts have a non-empty assignedTo field.', 'medium', 'Assign an owner to each unassigned critical alert, or configure automated investigation and response.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('microsoft_defender.devices.onboarding_coverage_complete', 'A.8.1.1'),
  ('microsoft_defender.devices.sensor_health_active', 'A.12.2.1'),
  ('microsoft_defender.devices.high_exposure_devices_remediated', 'A.12.6.1'),
  ('microsoft_defender.vulnerabilities.critical_cves_remediated', 'A.12.6.1'),
  ('microsoft_defender.recommendations.high_impact_open_reviewed', 'A.12.6.1'),
  ('microsoft_defender.alerts.high_severity_triaged_promptly', 'A.16.1.5'),
  ('microsoft_defender.alerts.no_unassigned_critical_alerts', 'A.16.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Google Workspace connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('google_workspace', 'Google Workspace', 'identity', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('google_workspace', 'google_workspace.security.two_step_verification_enforced', '2-Step Verification is enforced for all users', 'Checks each active user has 2-Step Verification enforced (isEnforcedIn2Sv), rather than left as an opt-in choice.', 'critical', 'Enable 2-Step Verification enforcement under Admin Console > Security > Authentication > 2-Step Verification, and set an enforcement date for all organizational units.'),
  ('google_workspace', 'google_workspace.admin.super_admin_role_reviewed', 'Super admin role is assigned to a minimal, reviewed set of users', 'Checks the count of users holding admin or delegated admin privileges, flagging accounts beyond an expected small set.', 'high', 'Remove Super Admin from accounts that don''t require it day-to-day; use delegated admin roles scoped to the minimum privileges needed instead, under Admin Console > Account > Admin roles.'),
  ('google_workspace', 'google_workspace.oauth.third_party_app_risk_reviewed', 'Third-party OAuth app authorizations are reviewed and restricted', 'Checks each active user''s authorized third-party OAuth applications for high-risk scopes (full Drive/Gmail access, Admin SDK write access) that indicate over-broad app authorization.', 'high', 'Review and revoke risky app authorizations under Admin Console > Security > API Controls > App access control, and restrict future installs to allowlisted/internally-reviewed apps.'),
  ('google_workspace', 'google_workspace.groups.privileged_group_membership_reviewed', 'Privileged groups have at least one owner', 'Checks groups matching a privileged-naming heuristic (admin, security, sudo, root, etc.) have at least one OWNER-role member, flagging orphaned groups with no accountable owner.', 'medium', 'Assign an OWNER-role member to any privileged group that lacks one, under Admin Console > Groups > select group > Members.'),
  ('google_workspace', 'google_workspace.drive.external_sharing_restricted', 'Drive/Docs external sharing defaults are restricted', 'Checks the domain''s Drive external sharing mode is not fully open, and the default new-file access level is not search-discoverable.', 'critical', 'Under Admin Console > Apps > Google Workspace > Drive and Docs > Sharing settings, restrict external sharing to specific trusted domains or disable link-sharing outside the organization by default.'),
  ('google_workspace', 'google_workspace.gmail.auto_forwarding_restricted', 'Automatic email forwarding to external addresses is restricted', 'Checks the Gmail auto-forwarding policy disallows forwarding to arbitrary external addresses.', 'high', 'Under Admin Console > Apps > Google Workspace > Gmail > End User Access, disable "Automatic forwarding" or restrict it to internal/allowlisted domains.'),
  ('google_workspace', 'google_workspace.calendar.external_sharing_restricted', 'Calendar external sharing default is restricted', 'Checks the domain default Calendar external sharing policy does not expose event details (beyond free/busy) to external users by default.', 'medium', 'Under Admin Console > Apps > Google Workspace > Calendar > Sharing settings, set the external sharing default to "Only free/busy information".'),
  ('google_workspace', 'google_workspace.devices.chrome_policy_compliant', 'Managed ChromeOS devices enforce baseline security policy', 'Checks a session length/idle-logout Chrome policy is explicitly configured for the organization rather than left on the platform default.', 'medium', 'Configure the session length policy under Admin Console > Devices > Chrome > Settings > Users & browsers for the affected organizational units.'),
  ('google_workspace', 'google_workspace.users.inactive_accounts_reviewed', 'Suspended or long-inactive user accounts are reviewed', 'Checks for suspended-but-not-deleted accounts, or active accounts with no sign-in activity within 90 days, flagging stale accounts that retain access.', 'medium', 'Offboard or fully remove accounts no longer needed, and investigate active accounts with no recent sign-in for compromise or abandonment.'),
  ('google_workspace', 'google_workspace.audit.log_retention_configured', 'Admin and login audit logs are retained and actively flowing', 'Checks Reports API admin and login application activity events are available and recent, evidencing audit logging hasn''t silently stopped.', 'high', 'Investigate via Admin Console > Reporting > Audit and investigation if no recent activity is returned.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('google_workspace.security.two_step_verification_enforced', 'A.9.4.2'),
  ('google_workspace.admin.super_admin_role_reviewed', 'A.9.2.3'),
  ('google_workspace.oauth.third_party_app_risk_reviewed', 'A.9.4.1'),
  ('google_workspace.groups.privileged_group_membership_reviewed', 'A.9.2.2'),
  ('google_workspace.drive.external_sharing_restricted', 'A.8.2.3'),
  ('google_workspace.gmail.auto_forwarding_restricted', 'A.13.2.1'),
  ('google_workspace.calendar.external_sharing_restricted', 'A.13.2.1'),
  ('google_workspace.devices.chrome_policy_compliant', 'A.6.2.1'),
  ('google_workspace.users.inactive_accounts_reviewed', 'A.9.2.6'),
  ('google_workspace.audit.log_retention_configured', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== GCP connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('gcp', 'Google Cloud Platform', 'cloud', 'oauth2', 'active')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('gcp', 'gcp.iam.owner_role_assignments_limited', 'Project-level Owner role assignments are limited', 'Checks the count of principals bound to roles/owner at project scope, flagging accounts beyond the recommended maximum of 2.', 'medium', 'Remove Owner from principals that don''t require it; use narrower predefined or custom IAM roles instead, under IAM & Admin > IAM.'),
  ('gcp', 'gcp.iam.service_account_keys_rotated', 'User-managed service account keys are rotated regularly', 'Checks user-managed (downloaded JSON) service account keys are not older than 90 days.', 'high', 'Rotate or delete stale user-managed keys under IAM & Admin > Service Accounts > select account > Keys; prefer Workload Identity Federation over long-lived keys where possible.'),
  ('gcp', 'gcp.storage.buckets_not_publicly_accessible', 'Cloud Storage buckets enforce public access prevention', 'Checks each Cloud Storage bucket has publicAccessPrevention set to "enforced" rather than left at the inherited default.', 'critical', 'Under Cloud Storage > select bucket > Permissions, set Public access prevention to Enforced.'),
  ('gcp', 'gcp.compute.instances_no_public_ip', 'Compute Engine instances are not directly exposed via a public IP address', 'Checks no VM instance network interface has an access config (external IP) assigned.', 'critical', 'Remove the external IP under Compute Engine > VM instances > select instance > Edit > Network interfaces, and route external access through a load balancer or IAP instead.'),
  ('gcp', 'gcp.compute.shielded_vm_enabled', 'Compute Engine instances have Shielded VM protections enabled', 'Checks each VM instance has both vTPM and integrity monitoring enabled.', 'high', 'Enable Shielded VM options under Compute Engine > VM instances > select instance > Edit > Shielded VM (may require stopping the instance).'),
  ('gcp', 'gcp.sql.ssl_enforced', 'Cloud SQL instances require SSL/TLS for connections', 'Checks each Cloud SQL instance requires SSL/TLS (requireSsl or an equivalent sslMode) for client connections.', 'critical', 'Under Cloud SQL > select instance > Connections > Security, require SSL/TLS encryption for all connections.'),
  ('gcp', 'gcp.sql.public_access_disabled', 'Cloud SQL instances do not authorize connections from any address', 'Checks no Cloud SQL instance authorizes the 0.0.0.0/0 network range.', 'critical', 'Under Cloud SQL > select instance > Connections > Networking, remove any 0.0.0.0/0 authorized network and use Cloud SQL Auth Proxy or private IP instead.'),
  ('gcp', 'gcp.kms.key_rotation_enabled', 'Cloud KMS symmetric keys have automatic rotation enabled', 'Checks each symmetric (ENCRYPT_DECRYPT) Cloud KMS key has an automatic rotation period configured.', 'medium', 'Under Security > Key Management > select key, set a rotation period (90 days recommended) if not already configured.'),
  ('gcp', 'gcp.network.firewall_no_open_management_ports', 'Firewall rules do not expose management ports publicly', 'Checks no enabled ingress firewall rule allows 0.0.0.0/0 access to SSH (22) or RDP (3389).', 'critical', 'Restrict the firewall rule''s source range to specific trusted IPs, or require access via Identity-Aware Proxy / a bastion host, under VPC network > Firewall.'),
  ('gcp', 'gcp.logging.data_access_audit_logs_enabled', 'Data Access audit logs are enabled for all services', 'Checks the project IAM policy''s audit config enables DATA_READ and DATA_WRITE Data Access audit logs for all services.', 'high', 'Under IAM & Admin > Audit Logs, enable Admin Read, Data Read, and Data Write for All services (or at minimum the services holding regulated data).')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('gcp.iam.owner_role_assignments_limited', 'A.9.1.2'),
  ('gcp.iam.service_account_keys_rotated', 'A.9.2.4'),
  ('gcp.storage.buckets_not_publicly_accessible', 'A.8.2.3'),
  ('gcp.compute.instances_no_public_ip', 'A.13.1.1'),
  ('gcp.compute.shielded_vm_enabled', 'A.8.2.3'),
  ('gcp.sql.ssl_enforced', 'A.8.2.3'),
  ('gcp.sql.public_access_disabled', 'A.13.1.1'),
  ('gcp.kms.key_rotation_enabled', 'A.10.1.2'),
  ('gcp.network.firewall_no_open_management_ports', 'A.13.1.1'),
  ('gcp.logging.data_access_audit_logs_enabled', 'A.12.4.1')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Akamai connector: catalog seed data =====

INSERT INTO integrations (key, name, category, auth_type, status) VALUES
  ('akamai', 'Akamai', 'network_security', 'api_key', 'beta')
ON CONFLICT (key) DO NOTHING;

INSERT INTO automated_tests (integration_key, test_key, title, description, severity_default, remediation_guidance) VALUES
  ('akamai', 'akamai.appsec.waf_policies_in_block_mode', 'WAF security policies enforce in block/deny mode', 'For every security policy on every production-active configuration, the WAF rule and attack-group actions resolve to deny/block rather than alert-only.', 'high', 'In Control Center set the attack-group and rule actions to Deny for the production network, then re-activate the security configuration.'),
  ('akamai', 'akamai.appsec.attack_groups_enabled', 'All OWASP attack groups have an enforcing action', 'Every attack group (injection, XSS, command injection, LFI/RFI, protocol, platform, policy) on each security policy has an action other than none.', 'high', 'Enable each attack group (Deny, or at minimum Alert) under the security policy Attack Groups tab. A group left at none is not inspected.'),
  ('akamai', 'akamai.appsec.rate_limiting_configured', 'A rate-limiting policy with an enforcing action exists', 'Each security policy has at least one rate policy whose action is not none, protecting against volumetric abuse, credential stuffing and scraping.', 'medium', 'Define a rate policy under Security > Rate Policies and assign it an enforcing action on the security policy.'),
  ('akamai', 'akamai.appsec.config_activated_on_production', 'Security configs are activated on production at their latest version', 'Each security configuration has an ACTIVATED production activation and the production-active version equals the latest version, so no undeployed security changes remain in draft.', 'high', 'Activate the latest version of the security configuration on the production network.'),
  ('akamai', 'akamai.siem.integration_enabled', 'Security-event SIEM export is enabled', 'For each production-active security configuration, SIEM integration is enabled so WAF, bot and rate events are shipped to the customer SIEM.', 'medium', 'Enable SIEM integration for the security configuration and connect it to your log pipeline via the Akamai SIEM API or a data-stream connector.'),
  ('akamai', 'akamai.siem.all_policies_covered', 'SIEM export covers every security policy', 'If SIEM settings do not apply to all policies, every current security policy ID appears in the SIEM policy allowlist so no policy is omitted from logging.', 'medium', 'Set SIEM integration to all security policies, or add the missing policy IDs to the SIEM policy allowlist.'),
  ('akamai', 'akamai.api.discovery_enabled', 'API discovery is active for protected hostnames', 'The API Definitions inventory is non-empty and/or API discovery is returning data, so API traffic is being catalogued rather than ungoverned.', 'medium', 'Turn on API Discovery in App & API Protector and register the APIs it surfaces.'),
  ('akamai', 'akamai.api.no_unregistered_endpoints', 'No discovered-but-unregistered API endpoints', 'Endpoints surfaced by API discovery that are absent from the registered API definitions are reported, because shadow APIs bypass per-endpoint constraints and positive-security rules.', 'high', 'Review discovered APIs in App & API Protector and register each legitimate one; investigate any that should not exist.'),
  ('akamai', 'akamai.api.endpoint_constraints_enforced', 'Registered API endpoints enforce request constraints', 'Each registered endpoint active version has request-body-size, element-count, string-length or JSON-depth constraints enabled rather than left at the permissive default.', 'medium', 'Enable request constraints for the endpoint under API Definitions > Settings, then activate the endpoint version.'),
  ('akamai', 'akamai.property.force_https', 'Production properties force HTTPS', 'Each production-active property either serves no HTTP or its rule tree contains a redirect forcing plaintext requests to TLS.', 'high', 'Add a Redirect to HTTPS behavior (or remove the HTTP edge hostname) and activate the property on production.'),
  ('akamai', 'akamai.property.min_tls_1_2', 'Edge TLS floor is TLS 1.2 or higher', 'The property or edge-hostname minimum TLS version is TLS 1.2 or higher, cross-checked against the CPS enrollment disallowed-TLS-versions list.', 'high', 'Set the minimum TLS version to 1.2 or 1.3 on the edge hostname / CPS enrollment and redeploy.'),
  ('akamai', 'akamai.property.hsts_enabled', 'HTTPS properties send HSTS', 'Properties serving HTTPS include an HSTS behavior with a max-age of at least the threshold (default 180 days).', 'medium', 'Add the HSTS behavior with a max-age of at least 180 days and activate the property.'),
  ('akamai', 'akamai.property.latest_version_active', 'Property production version is current', 'No property production-active version lags its latest editable version by more than the threshold (default 2 versions), bounding untracked configuration drift.', 'low', 'Review and activate the latest property version, or prune stale draft versions.'),
  ('akamai', 'akamai.property.origin_protected', 'Origin is shielded from direct access', 'Each production property uses Site Shield or an origin IP ACL that prevents the origin being reached directly, bypassing the edge.', 'low', 'Enable Site Shield or restrict the origin firewall to Akamai edge IP ranges.'),
  ('akamai', 'akamai.cps.no_certs_near_expiry', 'No production certificate expires soon', 'For each enrollment the production deployment primary certificate expiry is more than the threshold (default 30 days) in the future.', 'critical', 'Renew or let auto-renewal complete for the flagged enrollment; for third-party certificates upload the replacement before expiry.'),
  ('akamai', 'akamai.cps.auto_renewal_enabled', 'Certificates renew automatically or have an owner', 'Domain-validated enrollments have auto-renewal active; third-party enrollments have populated admin and technical contacts so a human owner is accountable for manual renewal.', 'high', 'For DV enrollments confirm auto-renewal is enabled; for third-party enrollments record admin and technical contacts on the enrollment.'),
  ('akamai', 'akamai.cps.strong_key_algorithm', 'Certificate keys meet the strength floor', 'Every enrollment key algorithm is RSA 2048-bit or larger, or ECDSA P-256/P-384 — no RSA-1024 and no SHA-1 signatures.', 'high', 'Reissue the enrollment specifying RSA 2048 or ECDSA P-256 as the key algorithm.'),
  ('akamai', 'akamai.cps.no_stuck_changes', 'No certificate change is stuck in progress', 'No enrollment has a pending change older than the threshold (default 14 days), which would mean a certificate update is not deploying.', 'medium', 'Complete the outstanding domain-validation or approval step for the enrollment change, or cancel and restart it.')
ON CONFLICT (test_key) DO NOTHING;

INSERT INTO test_control_mappings (test_key, iso_reference) VALUES
  ('akamai.appsec.waf_policies_in_block_mode', 'A.14.1.2'),
  ('akamai.appsec.attack_groups_enabled', 'A.14.2.5'),
  ('akamai.appsec.rate_limiting_configured', 'A.13.1.1'),
  ('akamai.appsec.config_activated_on_production', 'A.12.1.2'),
  ('akamai.siem.integration_enabled', 'A.12.4.1'),
  ('akamai.siem.all_policies_covered', 'A.12.4.1'),
  ('akamai.api.discovery_enabled', 'A.13.1.1'),
  ('akamai.api.no_unregistered_endpoints', 'A.13.1.1'),
  ('akamai.api.endpoint_constraints_enforced', 'A.14.1.3'),
  ('akamai.property.force_https', 'A.14.1.2'),
  ('akamai.property.min_tls_1_2', 'A.10.1.1'),
  ('akamai.property.hsts_enabled', 'A.14.1.2'),
  ('akamai.property.latest_version_active', 'A.12.1.2'),
  ('akamai.property.origin_protected', 'A.13.1.3'),
  ('akamai.cps.no_certs_near_expiry', 'A.10.1.1'),
  ('akamai.cps.auto_renewal_enabled', 'A.10.1.2'),
  ('akamai.cps.strong_key_algorithm', 'A.10.1.1'),
  ('akamai.cps.no_stuck_changes', 'A.12.1.2')
ON CONFLICT (test_key, framework, iso_reference) DO NOTHING;

-- ===== Idempotent upgrade guards (existing databases) =====
-- These are no-ops on a fresh install; safe to run repeatedly on upgrades.

ALTER TABLE modules     ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp TEXT;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp_expires TIMESTAMPTZ;
ALTER TABLE users       ADD COLUMN IF NOT EXISTS reset_otp_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS priority TEXT;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS tags TEXT;
ALTER TABLE questions   ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS audited_at TIMESTAMPTZ;
-- Audited period frozen at sign-off (auditCoverage.js). Legacy AUDITED rows without a
-- sign-off time get their last update as it, once, so later edits can't move it.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS audit_period_end DATE;
UPDATE assessments SET audited_at = updated_at WHERE review_status = 'AUDITED' AND audited_at IS NULL;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS auditor_notes TEXT;
-- Set when a reopened connector finding invalidates a previously FINISHED/AUDITED
-- assessment's evidence (see collectionRunner.js revertAssessmentsForEvidenceFailure).
-- Cleared the next time a reviewer/auditor takes a review action on the row.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS auto_reverted_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS auto_reverted_reason TEXT;
ALTER TABLE evidence    ADD COLUMN IF NOT EXISTS ai_date_warning TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_contributor_comments TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_reviewer_comments TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_gaps JSONB;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_suggestions JSONB;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_date_warning TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_analyzed_version INT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_provider TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_policy_analysis JSONB;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_policy_analyzed_at TIMESTAMPTZ;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_policy_provider TEXT;
ALTER TABLE evidence_vault ADD COLUMN IF NOT EXISTS ai_policy_fingerprint TEXT;
ALTER TABLE users          ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS technology_stack JSONB;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS vault_pin_hash TEXT;
-- Per-company AI provider override. NULL = use the platform default (PRISM_AI_PROVIDER env).
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS ai_provider TEXT
  CHECK (ai_provider IS NULL OR ai_provider IN ('bedrock', 'azure'));

-- AI is opt-in per company (2026-09-03). A company gets AI features only with an
-- explicit ai_enabled = TRUE row; a missing row or FALSE means AI is off. This
-- guard flips the default for databases created before the change.
ALTER TABLE company_settings ALTER COLUMN ai_enabled SET DEFAULT FALSE;
-- One-time historical backfill: every company that existed before AI became
-- opt-in keeps it on. The fixed cutoff makes this safe to re-run on every
-- init.sql apply — companies created after the cutoff are never backfilled and
-- so inherit the new opt-in default.
INSERT INTO company_settings (company_id, ai_enabled)
SELECT id, TRUE FROM companies WHERE created_at < TIMESTAMPTZ '2026-09-03 14:00:00+00'
ON CONFLICT (company_id) DO NOTHING;

-- Per-company evidence storage backend (BYO S3 / Azure Blob). 'local' = PRISM-managed
-- disk under UPLOAD_DIR (the historical default). Non-secret connection details
-- (bucket, region, prefix, container) live in evidence_storage_config; the actual
-- credentials are AES-GCM encrypted in company_storage_credentials.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS evidence_storage_backend TEXT NOT NULL DEFAULT 'local'
  CHECK (evidence_storage_backend IN ('local', 's3', 'azure_blob'));
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS evidence_storage_config JSONB;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS evidence_storage_migration_status TEXT
  CHECK (evidence_storage_migration_status IS NULL OR evidence_storage_migration_status IN ('in_progress', 'failed'));
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS evidence_storage_migration_error TEXT;
-- F-23: raw errors stored before sanitisation are replaced with the generic message.
UPDATE company_settings
   SET evidence_storage_migration_error = 'Could not copy the evidence files. Check the storage settings and credentials, then retry.'
 WHERE evidence_storage_migration_error IS NOT NULL
   AND evidence_storage_migration_error NOT LIKE 'Could not copy the evidence files%';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS evidence_storage_migration_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS company_storage_credentials (
  company_id  INT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  auth_type   TEXT NOT NULL,                        -- 'access_key' | 'iam_role' | 'connection_string'
  ciphertext  TEXT,
  iv          TEXT,
  auth_tag    TEXT,
  key_id      TEXT NOT NULL DEFAULT 'local-v1',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending / failed evidence-storage migration jobs. One row per company while a
-- backend switch is being migrated; holds the *source* backend descriptor and its
-- encrypted credential so a migration can be resumed after an API restart without
-- the admin re-entering the previous credentials. Row exists iff
-- company_settings.evidence_storage_migration_status IS NOT NULL.
CREATE TABLE IF NOT EXISTS storage_migrations (
  company_id     INT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  from_backend   TEXT NOT NULL,                     -- 'local' | 's3' | 'azure_blob'
  from_config    JSONB,                             -- previous evidence_storage_config (non-secret)
  from_auth_type TEXT,                              -- NULL when from_backend = 'local'
  ciphertext     TEXT,
  iv             TEXT,
  auth_tag       TEXT,
  key_id         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE companies      ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
-- One-time backfill for companies that predate the is_verified column (run once, 2026-08-12).
-- Deliberately not re-added: with init.sql now re-applied on every `docker compose up`
-- (db-init service), an unconditional WHERE status IN (...) clause would keep matching
-- every newly self-registered company too (status defaults to 'active', is_verified to
-- FALSE, by design) and silently skip them past pending verification on every restart.

-- Normalise priority values and enforce constraint
UPDATE questions SET priority = 'Medium'
  WHERE priority IS NULL OR priority NOT IN ('Critical', 'High', 'Medium', 'Low');
ALTER TABLE questions ALTER COLUMN priority SET DEFAULT 'Medium';
ALTER TABLE questions ALTER COLUMN priority SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_priority_check') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_priority_check
      CHECK (priority IN ('Critical', 'High', 'Medium', 'Low'));
  END IF;
END $$;

-- ===== Compliance Frameworks =====

CREATE TABLE IF NOT EXISTS frameworks (
  key         TEXT PRIMARY KEY,   -- 'DPDPA', 'ISO27001', 'SOC2', 'HIPAA', 'GDPR'
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS company_frameworks (
  company_id    INT  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  framework_key TEXT NOT NULL REFERENCES frameworks(key),
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, framework_key)
);
CREATE INDEX IF NOT EXISTS company_frameworks_company_idx ON company_frameworks(company_id);

-- Maps a question to one or more framework controls (many-to-many).
-- A question answered once satisfies every framework it is mapped to.
-- company_id IS NULL rows are the GLOBAL crosswalk (curated once, shared by every
-- company); provisioning copies them into per-company rows. For new modules this
-- replaces the single iso_reference column on questions; iso_reference is kept
-- as a fallback. original_* preserve each framework's pre-merge wording.
CREATE TABLE IF NOT EXISTS question_framework_controls (
  id                SERIAL PRIMARY KEY,
  company_id        INT  REFERENCES companies(id) ON DELETE CASCADE,
  quest_id          TEXT NOT NULL,
  framework_key     TEXT NOT NULL REFERENCES frameworks(key),
  control_reference TEXT NOT NULL,   -- e.g. 'A.9.4.2', 'DPDPA-7', 'CC6.1'
  original_quest_id     TEXT,
  original_question     TEXT,
  original_control_area TEXT,
  original_level3       TEXT,
  original_facets       JSONB,       -- {IMPLEMENTED:"…", EVIDENCE:"…", REVIEWED:"…"} pre-collapse
  CONSTRAINT qfc_uniq_nnd UNIQUE NULLS NOT DISTINCT (company_id, quest_id, framework_key, control_reference)
);
CREATE INDEX IF NOT EXISTS qfc_company_framework_idx ON question_framework_controls(company_id, framework_key);
CREATE INDEX IF NOT EXISTS qfc_quest_idx             ON question_framework_controls(company_id, quest_id);

-- The base (company_id, quest_id) unique index treats NULLs as distinct, so it
-- would not stop two global canonical questions sharing a quest_id. This partial
-- index enforces uniqueness across the global canonical set.
CREATE UNIQUE INDEX IF NOT EXISTS questions_global_quest_id_idx ON questions(quest_id) WHERE company_id IS NULL;

-- Seed framework catalog
INSERT INTO frameworks (key, name, description) VALUES
  ('ISO27001', 'ISO/IEC 27001',    'International standard for information security management systems'),
  ('DPDPA',    'DPDPA 2023',       'Digital Personal Data Protection Act (India)'),
  ('SOC2',     'SOC 2',            'Service Organisation Control 2 — Trust Services Criteria'),
  ('HIPAA',    'HIPAA',            'Health Insurance Portability and Accountability Act'),
  ('GDPR',     'GDPR',             'General Data Protection Regulation (EU)')
ON CONFLICT (key) DO NOTHING;

-- Additional frameworks (audit-ready sheet imports). Keys stay version-free and
-- uppercase to match the style above; the import filename matcher normalises.
INSERT INTO frameworks (key, name, description) VALUES
  ('AWSWAF',   'AWS Well-Architected Framework',   'Amazon Web Services Well-Architected Framework review'),
  ('AZUREWAF', 'Azure Well-Architected Framework', 'Microsoft Azure Well-Architected Framework review'),
  ('CERTIN',   'CERT-In Directions 2022',          'Indian Computer Emergency Response Team cyber security directions (Sec. 70B IT Act)'),
  ('CIS',      'CIS Critical Security Controls v8.1', 'Center for Internet Security Critical Security Controls, version 8.1'),
  ('PCIDSS',   'PCI DSS v4.0.1',                   'Payment Card Industry Data Security Standard, version 4.0.1')
ON CONFLICT (key) DO NOTHING;

-- Framework key on modules and templates (upgrade guard — no-op on fresh install)
ALTER TABLE modules          ADD COLUMN IF NOT EXISTS framework_key TEXT REFERENCES frameworks(key);
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS framework_key TEXT;

-- question_framework_controls upgrade guards (existing databases): allow a global
-- (company_id IS NULL) crosswalk, add original_* wording, switch the unique
-- constraint to NULLS NOT DISTINCT so global rows dedupe.
ALTER TABLE question_framework_controls ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE question_framework_controls ADD COLUMN IF NOT EXISTS original_quest_id     TEXT;
ALTER TABLE question_framework_controls ADD COLUMN IF NOT EXISTS original_question     TEXT;
ALTER TABLE question_framework_controls ADD COLUMN IF NOT EXISTS original_control_area TEXT;
ALTER TABLE question_framework_controls ADD COLUMN IF NOT EXISTS original_level3       TEXT;
ALTER TABLE question_framework_controls ADD COLUMN IF NOT EXISTS original_facets       JSONB;
DO $$
DECLARE c TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qfc_uniq_nnd') THEN
    FOR c IN SELECT conname FROM pg_constraint
             WHERE conrelid = 'question_framework_controls'::regclass AND contype = 'u'
    LOOP EXECUTE format('ALTER TABLE question_framework_controls DROP CONSTRAINT %I', c);
    END LOOP;
    ALTER TABLE question_framework_controls
      ADD CONSTRAINT qfc_uniq_nnd UNIQUE NULLS NOT DISTINCT
      (company_id, quest_id, framework_key, control_reference);
  END IF;
END $$;

-- ===== Framework import: AI clustering + human-review batches =====
-- A batch stages one framework's parsed sheet (kind=IMPORT) or every framework's
-- template at once (kind=RECONCILE), clusters the incoming controls against the
-- global canonical set, and holds the superadmin's merge/split decisions until
-- commit writes canonical questions + question_framework_controls.
CREATE TABLE IF NOT EXISTS import_batches (
  id                    SERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL DEFAULT 'IMPORT' CHECK (kind IN ('IMPORT','RECONCILE')),
  primary_framework_key TEXT REFERENCES frameworks(key),
  source_file_name      TEXT,
  status                TEXT NOT NULL DEFAULT 'STAGED'
                        CHECK (status IN ('STAGED','CLUSTERING','REVIEW','COMMITTED','ABANDONED','FAILED')),
  raw_stats             JSONB,
  ai_provider           TEXT,
  templates_snapshot    JSONB,       -- pre-commit backup of affected module_templates (RECONCILE)
  error                 TEXT,
  created_by            INT REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_staging_rows (
  id                    SERIAL PRIMARY KEY,
  batch_id              INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  framework_key         TEXT NOT NULL REFERENCES frameworks(key),
  source_quest_id       TEXT,
  module_id             TEXT,
  module_name           TEXT,
  control_area          TEXT,
  control_reference     TEXT,         -- one normalised ref (multi-ref cells fan out)
  control_reference_raw TEXT,
  facet                 TEXT,         -- IMPLEMENTED | EVIDENCE | REVIEWED | MATURITY | OTHER
  baseline_question     TEXT,
  level3_yes_criteria   TEXT,
  required_evidence     TEXT,
  default_owner         TEXT,
  frequency             TEXT,
  priority              TEXT,
  tags                  TEXT,
  collapse_group_key    TEXT,         -- groups the ~3 rows describing one control
  raw                   JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_staging_batch_idx ON import_staging_rows(batch_id);

CREATE TABLE IF NOT EXISTS import_clusters (
  id                         SERIAL PRIMARY KEY,
  batch_id                   INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  proposed_action            TEXT NOT NULL
                             CHECK (proposed_action IN ('MERGE_INTO_EXISTING','NEW_CANONICAL','KEEP_SEPARATE')),
  existing_quest_id          TEXT,    -- canonical questions row (company_id IS NULL)
  proposed_canonical_question TEXT,
  proposed_level3            TEXT,
  proposed_control_area      TEXT,
  proposed_module_id         TEXT,
  ai_confidence              NUMERIC,
  ai_rationale               TEXT,
  match_method               TEXT CHECK (match_method IN ('llm','fingerprint','manual')),
  decision                   TEXT CHECK (decision IN ('ACCEPT','REJECT','MODIFIED')),
  decided_action             TEXT,
  decided_canonical_question TEXT,
  decided_level3             TEXT,
  decided_quest_id           TEXT,    -- filled at commit
  decided_by                 INT REFERENCES super_admins(id) ON DELETE SET NULL,
  decided_at                 TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_clusters_batch_idx ON import_clusters(batch_id);

CREATE TABLE IF NOT EXISTS import_cluster_members (
  cluster_id                 INT NOT NULL REFERENCES import_clusters(id) ON DELETE CASCADE,
  staging_row_id             INT NOT NULL REFERENCES import_staging_rows(id) ON DELETE CASCADE,
  assigned_framework_key     TEXT,
  assigned_control_reference TEXT,
  PRIMARY KEY (cluster_id, staging_row_id)
);

COMMIT;

-- ===== Plans: collapsed to two types (starter | custom) =====
ALTER TABLE companies ALTER COLUMN plan SET DEFAULT 'starter';
UPDATE companies SET plan = 'starter' WHERE plan = 'lite';
UPDATE companies SET plan = 'custom'  WHERE plan IN ('pro', 'enterprise');

-- ===== Framework template versioning + safe update propagation =====
-- A module_templates row is INSERT-only per version (question_data already snapshots
-- the full question set). Editing-then-publishing creates a new row in the same
-- lineage, chained via root_template_id, rather than mutating a prior version.
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS root_template_id INT REFERENCES module_templates(id);
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE module_templates ADD COLUMN IF NOT EXISTS published_by INT REFERENCES super_admins(id) ON DELETE SET NULL;
UPDATE module_templates SET root_template_id = id WHERE root_template_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_module_templates_root ON module_templates(root_template_id);

-- Which version of its template a company is currently provisioned against.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS template_version INT NOT NULL DEFAULT 1;

-- Provenance + rename/archive tracking on a company's own question copies.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS source_quest_id TEXT;
-- F-25: a question removed from the template while an audit still covers it stays
-- until this date (end of the audited period), then the scheduler archives it.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS archive_after DATE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS provisioned_from_version INT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- One notice per (company, template lineage, target version) a company admin can act on.
CREATE TABLE IF NOT EXISTS template_update_notices (
  id           SERIAL PRIMARY KEY,
  company_id   INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id  INT NOT NULL REFERENCES module_templates(id) ON DELETE CASCADE,
  from_version INT NOT NULL,
  to_version   INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'applied')),
  diff_summary JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at   TIMESTAMPTZ,
  UNIQUE (company_id, template_id, to_version)
);
CREATE INDEX IF NOT EXISTS idx_template_update_notices_company ON template_update_notices(company_id) WHERE status = 'pending';

-- F-12: uploads received while ClamAV is configured but unavailable. The bytes sit in
-- the company's storage under the "quarantine" scope and are referenced only here, so
-- nothing can view, link, approve or analyse them until a rescan clears them.
CREATE TABLE IF NOT EXISTS upload_quarantine (
  id            SERIAL PRIMARY KEY,
  company_id    INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('vault', 'vault_version', 'evidence')),
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_ref   TEXT NOT NULL,
  file_name     TEXT,
  file_type     TEXT,
  file_size     BIGINT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'finalizing', 'released', 'infected', 'expired', 'rejected')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ
);
-- 'finalizing' was added after the first release of this table; keep the CHECK current.
ALTER TABLE upload_quarantine DROP CONSTRAINT IF EXISTS upload_quarantine_status_check;
ALTER TABLE upload_quarantine ADD CONSTRAINT upload_quarantine_status_check
  CHECK (status IN ('pending', 'processing', 'finalizing', 'released', 'infected', 'expired', 'rejected'));
-- Each claim gets a fresh token; every later transition is conditional on it, so a
-- worker whose claim was recovered by another run can never release the file too.
ALTER TABLE upload_quarantine ADD COLUMN IF NOT EXISTS claim_token TEXT;
CREATE INDEX IF NOT EXISTS idx_upload_quarantine_pending ON upload_quarantine(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_upload_quarantine_company ON upload_quarantine(company_id, status);

-- F-13: bumped on password reset. Session JWTs carry it as `tv`; a mismatch means the
-- session predates the reset and is rejected. Reset tokens carry it too, so each reset
-- token is single-use and dies when any reset completes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- ===== Department scoping (2026-09-24) =====
-- Per-company departments; users and controls (by quest_id) link to them many-to-many.
-- users.all_departments = TRUE means implicit membership of every department (the
-- small-company default). A company with no departments behaves exactly as before.
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_company_name_idx
  ON departments (company_id, LOWER(name));

CREATE TABLE IF NOT EXISTS user_departments (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

-- Keyed by (company_id, quest_id), not questions.id, so it also covers global
-- template questions (company_id IS NULL) as seen by this company.
CREATE TABLE IF NOT EXISTS question_departments (
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, quest_id, department_id)
);
CREATE INDEX IF NOT EXISTS question_departments_dept_idx ON question_departments (department_id);

ALTER TABLE users       ADD COLUMN IF NOT EXISTS all_departments BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS all_departments BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS department_ids INT[];
