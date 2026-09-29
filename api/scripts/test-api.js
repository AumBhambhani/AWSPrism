#!/usr/bin/env node
/**
 * PRISM API Integration Test Script
 * Covers every endpoint in the application.
 *
 * Prerequisites:
 *   - API server running
 *   - A SUPERADMIN account already exists in the database
 *
 * Usage:
 *   SUPERADMIN_EMAIL=sa@prism.local SUPERADMIN_PASSWORD=Admin123! node scripts/test-api.js
 *
 * Optional env vars:
 *   BASE_URL         — default http://localhost:4000
 *   TEST_AI_ROUTES   — "true" to run AI-powered routes (slow, needs AI config)
 *   SKIP_CLEANUP     — "true" to leave test company in DB after run
 */

const BASE_URL     = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const SA_EMAIL     = process.env.SUPERADMIN_EMAIL;
const SA_PASSWORD  = process.env.SUPERADMIN_PASSWORD;
const TEST_AI      = process.env.TEST_AI_ROUTES === 'true';
const SKIP_CLEANUP = process.env.SKIP_CLEANUP === 'true';

if (!SA_EMAIL || !SA_PASSWORD) {
  console.error('Error: SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD env vars are required.');
  process.exit(1);
}

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

// ── Shared State ──────────────────────────────────────────────────────────────
const S = {
  saToken:      null,
  adminToken:   null,
  companyId:    null,
  moduleId:     null,
  questId:      null,
  assessmentId: null,
  evidenceId:   null,
  actionId:     null,
  listId:       null,
  reminderId:   null,
  auditorId:    null,
  vaultId:      null,
  requestId:    null,
  inviteId:     null,
  notifId:      null,
};

const SLUG   = `prismtest${Date.now()}`;
const DOMAIN = `${SLUG}.io`;
const ADMIN_EMAIL    = `admin@${DOMAIN}`;
const ADMIN_PASSWORD = 'TestAdmin@9981!';
const MONTH  = new Date().toISOString().slice(0, 7); // YYYY-MM
const MOD_ID = `TST-M-${Date.now()}`;
const Q_ID   = `TST-Q-${Date.now()}`;

// ── Counters ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const failures = [];

// ── Core helpers ──────────────────────────────────────────────────────────────
async function api(method, path, { body, token, form, expect: exp } = {}) {
  const defaultStatus = { POST: 201, DELETE: 204, PATCH: 200, PUT: 200, GET: 200 };
  const expected = exp ?? defaultStatus[method] ?? 200;

  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let reqBody;
  if (form) {
    reqBody = form; // FormData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: reqBody });

  if (res.status !== expected) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
    throw new Error(`HTTP ${res.status} (expected ${expected}): ${detail.slice(0, 300)}`);
  }

  if (res.status === 204 || res.status === 202) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

async function t(name, fn) {
  try {
    await fn();
    console.log(`  ${C.green('✓')} ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ${C.red('✗')} ${name}`);
    console.log(`    ${C.dim(err.message)}`);
    failed++;
    failures.push(`${name}: ${err.message.slice(0, 200)}`);
  }
}

function sk(name, reason) {
  console.log(`  ${C.yellow('○')} ${name}${reason ? C.dim(` (${reason})`) : ''}`);
  skipped++;
}

function section(title) {
  const bar = '─'.repeat(Math.max(0, 52 - title.length));
  console.log(`\n${C.bold(C.cyan(`── ${title} ${bar}`))}`);
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 0 — Health & public endpoints
// ─────────────────────────────────────────────────────────────────────────────
section('Health & Public');

await t('GET /health', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert(res.ok, `status ${res.status}`);
});

await t('GET /api/consent/version', async () => {
  const d = await api('GET', '/api/consent/version');
  assert(d !== null);
});

await t('GET /api/consent/pv (ad-blocker alias)', async () => {
  const d = await api('GET', '/api/consent/pv');
  assert(d !== null);
});

await t('POST /api/consent/ (anonymous acceptance)', async () => {
  await api('POST', '/api/consent/', {
    body: { action: 'accepted_all', language: 'en', consent_version: '1.0' },
    expect: 200,
  });
});

sk('POST /api/contact/', 'sends real email — test manually');
sk('POST /api/contact/support', 'sends real email — test manually');
sk('POST /api/contact/report', 'sends real email — test manually');
sk('POST /api/dpdpa/public-scan', 'live URL scan — test manually');
sk('POST /api/dpdpa/public-report', 'live URL scan — test manually');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Auth setup (superadmin login → register company → approve → admin login)
// ─────────────────────────────────────────────────────────────────────────────
section('Auth — Setup');

await t('POST /api/auth/login (superadmin)', async () => {
  const d = await api('POST', '/api/auth/login', {
    body: { email: SA_EMAIL, password: SA_PASSWORD }, expect: 200,
  });
  assert(d?.token, 'no token returned');
  S.saToken = d.token;
});

await t('POST /api/auth/register (create test company)', async () => {
  await api('POST', '/api/auth/register', {
    body: {
      companyName: `PRISM API Test Co (${SLUG})`,
      domain: DOMAIN,
      industry: 'Technology',
      companySize: '1-50',
      fullName: 'Test Admin',
      adminEmail: ADMIN_EMAIL,
      department: 'Engineering',
      jobTitle: 'QA Engineer',
      password: ADMIN_PASSWORD,
    },
    expect: 201,
  });
});

await t('GET /api/superadmin/companies (find new company)', async () => {
  const d = await api('GET', '/api/superadmin/companies', { token: S.saToken });
  const co = d?.find?.(c => c.domain === DOMAIN || c.adminEmail === ADMIN_EMAIL);
  assert(co, `test company not found in list`);
  S.companyId = co.id;
});

await t('PATCH /api/superadmin/companies/:id/status (approve)', async () => {
  await api('PATCH', `/api/superadmin/companies/${S.companyId}/status`, {
    body: { status: 'approved' }, token: S.saToken, expect: 200,
  });
});

await t('POST /api/auth/login (test admin)', async () => {
  const d = await api('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, expect: 200,
  });
  assert(d?.token, 'no token returned');
  S.adminToken = d.token;
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Auth edge cases
// ─────────────────────────────────────────────────────────────────────────────
section('Auth — Edge Cases');

await t('POST /api/auth/login → 401 wrong password', async () => {
  await api('POST', '/api/auth/login', {
    body: { email: ADMIN_EMAIL, password: 'wrong' }, expect: 401,
  });
});

await t('POST /api/auth/forgot-password (valid email)', async () => {
  await api('POST', '/api/auth/forgot-password', {
    body: { email: ADMIN_EMAIL }, expect: 200,
  });
});

await t('POST /api/auth/accept-invitation → 400 bad token', async () => {
  await api('POST', '/api/auth/accept-invitation', {
    body: { token: 'invalid-token', password: 'Test@12345' }, expect: 400,
  });
});

await t('POST /api/auth/complete-onboarding', async () => {
  await api('POST', '/api/auth/complete-onboarding', {
    body: {}, token: S.adminToken, expect: 200,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Superadmin routes
// ─────────────────────────────────────────────────────────────────────────────
section('Superadmin');

await t('GET /api/superadmin/companies', async () => {
  const d = await api('GET', '/api/superadmin/companies', { token: S.saToken });
  assert(Array.isArray(d));
});

await t('PATCH /api/superadmin/companies/:id/billing', async () => {
  await api('PATCH', `/api/superadmin/companies/${S.companyId}/billing`, {
    body: { plan: 'custom', billingStatus: 'trial', trialDays: 30 },
    token: S.saToken,
  });
});

await t('PATCH /api/superadmin/companies/:id/ai-toggle', async () => {
  await api('PATCH', `/api/superadmin/companies/${S.companyId}/ai-toggle`, {
    body: { aiEnabled: false }, token: S.saToken,
  });
});

await t('GET /api/superadmin/companies/:id/settings', async () => {
  await api('GET', `/api/superadmin/companies/${S.companyId}/settings`, { token: S.saToken });
});

await t('PUT /api/superadmin/companies/:id/settings', async () => {
  await api('PUT', `/api/superadmin/companies/${S.companyId}/settings`, {
    body: { primaryColor: '#1a73e8' }, token: S.saToken,
  });
});

await t('GET /api/superadmin/templates', async () => {
  const d = await api('GET', '/api/superadmin/templates', { token: S.saToken });
  assert(Array.isArray(d));
});

await t('POST /api/superadmin/companies/:id/modules (create test module)', async () => {
  const d = await api('POST', `/api/superadmin/companies/${S.companyId}/modules`, {
    body: {
      moduleId: MOD_ID,
      name: 'Test Module',
      primaryOwner: ADMIN_EMAIL,
      frequency: 'monthly',
      totalQuests: 1,
      purpose: 'API test module',
      sortOrder: 0,
    },
    token: S.saToken,
    expect: 201,
  });
  S.moduleId = d?.id ?? d?.moduleId ?? MOD_ID;
});

await t('GET /api/superadmin/companies/:id/modules', async () => {
  const d = await api('GET', `/api/superadmin/companies/${S.companyId}/modules`, { token: S.saToken });
  assert(Array.isArray(d));
});

await t('PATCH /api/superadmin/companies/:companyId/modules/:moduleId/order', async () => {
  await api('PATCH', `/api/superadmin/companies/${S.companyId}/modules/${MOD_ID}/order`, {
    body: { sortOrder: 5 }, token: S.saToken,
  });
});

await t('POST /api/superadmin/companies/:id/questions (create test question)', async () => {
  await api('POST', `/api/superadmin/companies/${S.companyId}/questions`, {
    body: {
      questId: Q_ID,
      moduleId: MOD_ID,
      moduleName: 'Test Module',
      controlArea: 'Policy',
      isoReference: '5.1',
      baselineQuestion: 'Do you have a written security policy?',
      level3YesCriteria: 'Policy reviewed in last 12 months',
      requiredEvidence: 'Policy document',
      defaultOwner: ADMIN_EMAIL,
      frequency: 'annual',
      priority: 'High',
      tags: 'policy,security',
    },
    token: S.saToken,
    expect: 201,
  });
});

await t('GET /api/superadmin/companies/:id/questions', async () => {
  const d = await api('GET', `/api/superadmin/companies/${S.companyId}/questions`, { token: S.saToken });
  assert(Array.isArray(d));
});

await t('GET /api/superadmin/companies/:id/questions/:questId/dependencies', async () => {
  await api('GET', `/api/superadmin/companies/${S.companyId}/questions/${Q_ID}/dependencies`, {
    token: S.saToken,
  });
});

await t('PUT /api/superadmin/companies/:id/questions/:questId/dependencies', async () => {
  await api('PUT', `/api/superadmin/companies/${S.companyId}/questions/${Q_ID}/dependencies`, {
    body: { dependsOn: [] }, token: S.saToken,
  });
});

sk('POST /api/superadmin/import-modules', 'requires .xlsx file upload');
sk('POST /api/superadmin/preview-import', 'requires .xlsx file upload');
sk('POST /api/superadmin/companies/:id/logo', 'requires image file upload');
sk('POST /api/superadmin/templates/:id/assign', 'no template available in test run');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Settings
// ─────────────────────────────────────────────────────────────────────────────
section('Settings');

await t('GET /api/settings/', async () => {
  const d = await api('GET', '/api/settings/', { token: S.adminToken });
  assert('aiEnabled' in d || 'primaryColor' in d || d !== null);
});

await t('PUT /api/settings/', async () => {
  await api('PUT', '/api/settings/', {
    body: { primaryColor: '#0057b7', aiEnabled: false },
    token: S.adminToken,
  });
});

await t('GET /api/settings/tech-stack', async () => {
  await api('GET', '/api/settings/tech-stack', { token: S.adminToken });
});

await t('PUT /api/settings/tech-stack', async () => {
  await api('PUT', '/api/settings/tech-stack', {
    body: { iam: 'Okta', siem: 'Splunk' },
    token: S.adminToken,
  });
});

sk('POST /api/settings/logo', 'requires image file upload');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Users
// ─────────────────────────────────────────────────────────────────────────────
section('Users');

await t('GET /api/users/', async () => {
  const d = await api('GET', '/api/users/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('PUT /api/users/me', async () => {
  await api('PUT', '/api/users/me', {
    body: { fullName: 'Test Admin Updated', department: 'QA', jobTitle: 'Senior QA' },
    token: S.adminToken,
  });
});

await t('POST /api/users/invite', async () => {
  const d = await api('POST', '/api/users/invite', {
    body: { email: `contrib@${DOMAIN}`, role: 'CONTRIBUTOR' },
    token: S.adminToken,
    expect: 201,
  });
  S.inviteId = d?.id;
});

await t('GET /api/users/invitations', async () => {
  const d = await api('GET', '/api/users/invitations', { token: S.adminToken });
  assert(Array.isArray(d));
  if (!S.inviteId && d.length > 0) S.inviteId = d[0].id;
});

if (S.inviteId) {
  await t('DELETE /api/users/invitations/:id', async () => {
    await api('DELETE', `/api/users/invitations/${S.inviteId}`, {
      token: S.adminToken, expect: 204,
    });
  });
} else {
  sk('DELETE /api/users/invitations/:id', 'no invitation to delete');
}

await t('GET /api/users/ → 401 without token', async () => {
  await api('GET', '/api/users/', { expect: 401 });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Lists
// ─────────────────────────────────────────────────────────────────────────────
section('Lists');

await t('GET /api/lists/', async () => {
  await api('GET', '/api/lists/', { token: S.adminToken });
});

await t('GET /api/lists/?listName=priority', async () => {
  await api('GET', '/api/lists/?listName=priority', { token: S.adminToken });
});

await t('POST /api/lists/', async () => {
  const d = await api('POST', '/api/lists/', {
    body: { listName: 'priority', value: 'Critical', color: '#e53e3e' },
    token: S.adminToken,
    expect: 201,
  });
  S.listId = d?.id;
});

if (S.listId) {
  await t('DELETE /api/lists/:id', async () => {
    await api('DELETE', `/api/lists/${S.listId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Modules & Questions
// ─────────────────────────────────────────────────────────────────────────────
section('Modules & Questions');

await t('GET /api/modules/', async () => {
  const d = await api('GET', '/api/modules/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/modules/:moduleId', async () => {
  await api('GET', `/api/modules/${MOD_ID}`, { token: S.adminToken });
});

await t('GET /api/modules/:moduleId/dependencies', async () => {
  await api('GET', `/api/modules/${MOD_ID}/dependencies`, { token: S.adminToken });
});

await t('PUT /api/modules/:moduleId/dependencies', async () => {
  await api('PUT', `/api/modules/${MOD_ID}/dependencies`, {
    body: { dependsOn: [] }, token: S.adminToken,
  });
});

await t('GET /api/questions/', async () => {
  const d = await api('GET', '/api/questions/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/questions/?moduleId=...', async () => {
  await api('GET', `/api/questions/?moduleId=${MOD_ID}`, { token: S.adminToken });
});

await t('GET /api/questions/:questId', async () => {
  await api('GET', `/api/questions/${Q_ID}`, { token: S.adminToken });
});

await t('PUT /api/questions/:questId (priority + dueDate)', async () => {
  const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await api('PUT', `/api/questions/${Q_ID}`, {
    body: { priority: 'High', dueDate: due },
    token: S.adminToken,
  });
});

await t('PUT /api/questions/:questId/recurrence', async () => {
  const next = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  await api('PUT', `/api/questions/${Q_ID}/recurrence`, {
    body: { recurrenceInterval: 'annual', nextDueDate: next },
    token: S.adminToken,
  });
});

await t('GET /api/questions/:questId/dependencies', async () => {
  await api('GET', `/api/questions/${Q_ID}/dependencies`, { token: S.adminToken });
});

await t('PUT /api/questions/:questId/dependencies', async () => {
  await api('PUT', `/api/questions/${Q_ID}/dependencies`, {
    body: { dependsOn: [] }, token: S.adminToken,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Assessments
// ─────────────────────────────────────────────────────────────────────────────
section('Assessments');

await t('POST /api/assessments/ (answer: PLANNED)', async () => {
  const d = await api('POST', '/api/assessments/', {
    body: {
      month: MONTH,
      moduleId: MOD_ID,
      questId: Q_ID,
      controlArea: 'Policy',
      answer: 'PLANNED',
      currentLevel: 1,
      level3Plus: false,
      owner: ADMIN_EMAIL,
      reviewer: ADMIN_EMAIL,
      reviewStatus: 'PENDING',
      scoreEligible: false,
      comments: 'API test assessment',
      actionOwner: ADMIN_EMAIL,
      actionDueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      actionNotes: 'Plan to implement security policy',
    },
    token: S.adminToken,
    expect: 201,
  });
  S.assessmentId = d?.id;
});

await t('GET /api/assessments/', async () => {
  const d = await api('GET', '/api/assessments/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/assessments/?questId=...', async () => {
  await api('GET', `/api/assessments/?questId=${Q_ID}`, { token: S.adminToken });
});

await t('GET /api/assessments/?moduleId=...', async () => {
  await api('GET', `/api/assessments/?moduleId=${MOD_ID}`, { token: S.adminToken });
});

if (S.assessmentId) {
  await t('PUT /api/assessments/:id (update comments)', async () => {
    await api('PUT', `/api/assessments/${S.assessmentId}`, {
      body: { comments: 'Updated via API test' },
      token: S.adminToken,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Evidence
// ─────────────────────────────────────────────────────────────────────────────
section('Evidence');

await t('POST /api/evidence/ (link-based, no file)', async () => {
  const d = await api('POST', '/api/evidence/', {
    body: {
      month: MONTH,
      moduleId: MOD_ID,
      questId: Q_ID,
      evidenceType: 'link',
      evidenceName: 'Test Evidence Link',
      evidenceLink: 'https://example.com/policy.pdf',
      uploadDate: new Date().toISOString().slice(0, 10),
      reviewer: ADMIN_EMAIL,
      approvalStatus: 'Pending',
      notes: 'Uploaded via API test',
    },
    token: S.adminToken,
    expect: 201,
  });
  S.evidenceId = d?.id;
});

await t('GET /api/evidence/', async () => {
  const d = await api('GET', '/api/evidence/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/evidence/?questId=...', async () => {
  await api('GET', `/api/evidence/?questId=${Q_ID}`, { token: S.adminToken });
});

if (S.evidenceId) {
  await t('PUT /api/evidence/:id', async () => {
    await api('PUT', `/api/evidence/${S.evidenceId}`, {
      body: { notes: 'Updated via API test', approvalStatus: 'Approved' },
      token: S.adminToken,
    });
  });
}

sk('GET /api/evidence/:id/view', 'requires an uploaded file');
sk('GET /api/evidence/:id/download', 'requires an uploaded file');
sk('POST /api/evidence/:id/analyze', 'requires AI enabled + uploaded file');
sk('POST /api/evidence/:id/reassign', 'requires a second admin user');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — Vault
// ─────────────────────────────────────────────────────────────────────────────
section('Vault');

await t('POST /api/vault/ (title only, no file)', async () => {
  const d = await api('POST', '/api/vault/', {
    body: { title: 'Test Vault Item', description: 'Created by API test' },
    token: S.adminToken,
    expect: 201,
  });
  S.vaultId = d?.id;
});

await t('GET /api/vault/', async () => {
  const d = await api('GET', '/api/vault/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/vault/?search=Test', async () => {
  await api('GET', '/api/vault/?search=Test', { token: S.adminToken });
});

if (S.vaultId) {
  await t('GET /api/vault/:id', async () => {
    const d = await api('GET', `/api/vault/${S.vaultId}`, { token: S.adminToken });
    assert(d?.id === S.vaultId);
  });

  await t('PUT /api/vault/:id', async () => {
    await api('PUT', `/api/vault/${S.vaultId}`, {
      body: { title: 'Test Vault Item (updated)', description: 'Updated via API test' },
      token: S.adminToken,
    });
  });

  await t('POST /api/vault/:id/link (link to question)', async () => {
    await api('POST', `/api/vault/${S.vaultId}/link`, {
      body: { questId: Q_ID }, token: S.adminToken, expect: 201,
    });
  });

  await t('GET /api/vault/?questId=... (filter linked)', async () => {
    await api('GET', `/api/vault/?questId=${Q_ID}`, { token: S.adminToken });
  });

  await t('DELETE /api/vault/:id/link/:questId', async () => {
    await api('DELETE', `/api/vault/${S.vaultId}/link/${Q_ID}`, {
      token: S.adminToken, expect: 204,
    });
  });

  await t('GET /api/vault/:id/versions', async () => {
    const d = await api('GET', `/api/vault/${S.vaultId}/versions`, { token: S.adminToken });
    assert(Array.isArray(d));
  });

  await t('DELETE /api/vault/:id', async () => {
    await api('DELETE', `/api/vault/${S.vaultId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

if (TEST_AI) {
  await t('POST /api/vault/chat', async () => {
    const d = await api('POST', '/api/vault/chat', {
      body: { message: 'What policies do you have?', history: [] },
      token: S.adminToken,
      expect: 200,
    });
    assert(d?.reply);
  });
  await t('GET /api/vault/suggestions?questId=...', async () => {
    await api('GET', `/api/vault/suggestions?questId=${Q_ID}`, { token: S.adminToken });
  });
} else {
  sk('POST /api/vault/chat', 'set TEST_AI_ROUTES=true to enable');
  sk('GET /api/vault/suggestions', 'set TEST_AI_ROUTES=true to enable');
}

sk('POST /api/vault/:id/versions', 'requires file upload');
sk('GET /api/vault/:id/view', 'requires uploaded file');
sk('GET /api/vault/:id/download', 'requires uploaded file');
sk('POST /api/vault/:id/versions/:vId/restore', 'requires uploaded file');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — Actions
// ─────────────────────────────────────────────────────────────────────────────
section('Actions');

await t('POST /api/actions/', async () => {
  const d = await api('POST', '/api/actions/', {
    body: {
      month: MONTH,
      moduleId: MOD_ID,
      questId: Q_ID,
      currentLevel: 1,
      targetLevel: 2,
      immediateActionRequired: false,
      owner: ADMIN_EMAIL,
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      status: 'Open',
      notes: 'API test action',
    },
    token: S.adminToken,
    expect: 201,
  });
  S.actionId = d?.id;
});

await t('GET /api/actions/', async () => {
  const d = await api('GET', '/api/actions/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/actions/?questId=...', async () => {
  await api('GET', `/api/actions/?questId=${Q_ID}`, { token: S.adminToken });
});

await t('GET /api/actions/?status=Open', async () => {
  await api('GET', '/api/actions/?status=Open', { token: S.adminToken });
});

if (S.actionId) {
  await t('PUT /api/actions/:id', async () => {
    await api('PUT', `/api/actions/${S.actionId}`, {
      body: { status: 'In Progress', notes: 'Updated via API test' },
      token: S.adminToken,
    });
  });

  await t('DELETE /api/actions/:id', async () => {
    await api('DELETE', `/api/actions/${S.actionId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — Dashboard
// ─────────────────────────────────────────────────────────────────────────────
section('Dashboard');

await t('GET /api/dashboard/', async () => {
  const d = await api('GET', '/api/dashboard/', { token: S.adminToken });
  assert(d !== null);
});

await t('GET /api/dashboard/?month=...', async () => {
  await api('GET', `/api/dashboard/?month=${MONTH}`, { token: S.adminToken });
});

await t('GET /api/dashboard/?priority=High', async () => {
  await api('GET', '/api/dashboard/?priority=High', { token: S.adminToken });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — Auditors
// ─────────────────────────────────────────────────────────────────────────────
section('Auditors');

await t('POST /api/auditors/', async () => {
  const d = await api('POST', '/api/auditors/', {
    body: {
      email: `auditor@${DOMAIN}`,
      password: 'Audit@9981!',
      startDate: new Date().toISOString().slice(0, 10),
      expiryDate: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    },
    token: S.adminToken,
    expect: 201,
  });
  S.auditorId = d?.id;
});

await t('GET /api/auditors/', async () => {
  const d = await api('GET', '/api/auditors/', { token: S.adminToken });
  assert(Array.isArray(d));
});

await t('GET /api/auditors/logs', async () => {
  const d = await api('GET', '/api/auditors/logs', { token: S.adminToken });
  assert(Array.isArray(d) || d !== null);
});

if (S.auditorId) {
  await t('PUT /api/auditors/:id (extend expiry)', async () => {
    await api('PUT', `/api/auditors/${S.auditorId}`, {
      body: {
        expiryDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
        active: true,
      },
      token: S.adminToken,
    });
  });

  await t('DELETE /api/auditors/:id', async () => {
    await api('DELETE', `/api/auditors/${S.auditorId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — Reminders
// ─────────────────────────────────────────────────────────────────────────────
section('Reminders');

await t('GET /api/reminders/settings', async () => {
  await api('GET', '/api/reminders/settings', { token: S.adminToken });
});

await t('PUT /api/reminders/settings', async () => {
  await api('PUT', '/api/reminders/settings', {
    body: { defaultReminderOffsets: [7, 3, 1] },
    token: S.adminToken,
  });
});

await t('POST /api/reminders/', async () => {
  const d = await api('POST', '/api/reminders/', {
    body: {
      remindAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      message: 'API test reminder',
      questId: Q_ID,
      moduleId: MOD_ID,
      recipientEmail: ADMIN_EMAIL,
      reminderType: 'question_due',
    },
    token: S.adminToken,
    expect: 201,
  });
  S.reminderId = d?.id;
});

await t('GET /api/reminders/', async () => {
  const d = await api('GET', '/api/reminders/', { token: S.adminToken });
  assert(Array.isArray(d) || d !== null);
});

await t('GET /api/reminders/?upcoming=true', async () => {
  await api('GET', '/api/reminders/?upcoming=true', { token: S.adminToken });
});

if (S.reminderId) {
  await t('DELETE /api/reminders/:id', async () => {
    await api('DELETE', `/api/reminders/${S.reminderId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — Requests
// ─────────────────────────────────────────────────────────────────────────────
section('Requests');

await t('GET /api/requests/users', async () => {
  const d = await api('GET', '/api/requests/users', { token: S.adminToken });
  assert(Array.isArray(d) || d !== null);
});

await t('POST /api/requests/', async () => {
  const d = await api('POST', '/api/requests/', {
    body: {
      title: 'API Test Request',
      questionId: Q_ID,
      description: 'Please upload the security policy document',
      priority: 'High',
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    },
    token: S.adminToken,
    expect: 201,
  });
  S.requestId = d?.id;
});

await t('GET /api/requests/', async () => {
  const d = await api('GET', '/api/requests/', { token: S.adminToken });
  assert(Array.isArray(d) || d !== null);
});

await t('GET /api/requests/?status=Open', async () => {
  await api('GET', '/api/requests/?status=Open', { token: S.adminToken });
});

if (S.requestId) {
  await t('GET /api/requests/:id', async () => {
    const d = await api('GET', `/api/requests/${S.requestId}`, { token: S.adminToken });
    assert(d?.id === S.requestId);
  });

  await t('PUT /api/requests/:id', async () => {
    await api('PUT', `/api/requests/${S.requestId}`, {
      body: { title: 'API Test Request (updated)', status: 'In Progress' },
      token: S.adminToken,
    });
  });

  await t('POST /api/requests/:id/comments', async () => {
    await api('POST', `/api/requests/${S.requestId}/comments`, {
      body: { body: 'Comment via API test' },
      token: S.adminToken,
      expect: 201,
    });
  });

  await t('DELETE /api/requests/:id (cancel)', async () => {
    await api('DELETE', `/api/requests/${S.requestId}`, {
      token: S.adminToken, expect: 204,
    });
  });
}

sk('POST /api/requests/:id/fulfill', 'requires a vault item + unlinked question');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 16 — Notifications
// ─────────────────────────────────────────────────────────────────────────────
section('Notifications');

await t('GET /api/notifications/', async () => {
  const d = await api('GET', '/api/notifications/', { token: S.adminToken });
  assert(Array.isArray(d) || d !== null);
  if (Array.isArray(d) && d.length > 0) S.notifId = d[0].id;
});

await t('GET /api/notifications/unread-count', async () => {
  const d = await api('GET', '/api/notifications/unread-count', { token: S.adminToken });
  assert('count' in d || d !== null);
});

if (S.notifId) {
  await t('POST /api/notifications/:id/read', async () => {
    await api('POST', `/api/notifications/${S.notifId}/read`, {
      token: S.adminToken, expect: 204,
    });
  });
} else {
  sk('POST /api/notifications/:id/read', 'no notifications to mark');
}

await t('POST /api/notifications/read-all', async () => {
  await api('POST', '/api/notifications/read-all', {
    token: S.adminToken, expect: 204,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 17 — DPDPA (authenticated scan)
// ─────────────────────────────────────────────────────────────────────────────
section('DPDPA');

sk('POST /api/dpdpa/scan', 'live URL scan — test manually or provide a test URL');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 18 — Marketplace
// ─────────────────────────────────────────────────────────────────────────────
section('Marketplace');

sk('POST /api/marketplace/webhook', 'requires Microsoft Azure JWT');
sk('POST /api/marketplace/resolve', 'requires a Microsoft marketplace token');
sk('POST /api/marketplace/activate', 'requires an existing subscription');
sk('GET /api/marketplace/subscription/:id', 'requires an existing subscription');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 19 — Auth error: 401 on protected routes
// ─────────────────────────────────────────────────────────────────────────────
section('Auth — 401 checks');

for (const [method, path] of [
  ['GET',  '/api/users/'],
  ['GET',  '/api/modules/'],
  ['GET',  '/api/assessments/'],
  ['GET',  '/api/dashboard/'],
  ['GET',  '/api/vault/'],
  ['GET',  '/api/notifications/'],
]) {
  await t(`${method} ${path} → 401 without token`, async () => {
    await api(method, path, { expect: 401 });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 20 — Cleanup
// ─────────────────────────────────────────────────────────────────────────────
section('Cleanup');

if (SKIP_CLEANUP) {
  sk('DELETE test company', 'SKIP_CLEANUP=true');
} else {
  // Delete the assessment (if not already deleted)
  if (S.assessmentId) {
    await t('DELETE /api/assessments/:id', async () => {
      await api('DELETE', `/api/assessments/${S.assessmentId}`, {
        token: S.adminToken, expect: 204,
      });
    });
  }

  // Delete the evidence
  if (S.evidenceId) {
    await t('DELETE /api/evidence/:id', async () => {
      await api('DELETE', `/api/evidence/${S.evidenceId}`, {
        token: S.adminToken, expect: 204,
      });
    });
  }

  // Delete the test question
  await t('DELETE /api/superadmin/companies/:id/questions/:questId', async () => {
    await api('DELETE', `/api/superadmin/companies/${S.companyId}/questions/${Q_ID}`, {
      token: S.saToken, expect: 204,
    });
  });

  // Delete the test module
  await t('DELETE /api/superadmin/companies/:id/modules/:moduleId', async () => {
    await api('DELETE', `/api/superadmin/companies/${S.companyId}/modules/${MOD_ID}`, {
      token: S.saToken, expect: 204,
    });
  });

  // Delete the test company (cascades everything)
  await t('DELETE /api/superadmin/companies/:id (cascade)', async () => {
    await api('DELETE', `/api/superadmin/companies/${S.companyId}`, {
      token: S.saToken, expect: 204,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed + skipped;
console.log(`\n${'═'.repeat(55)}`);
console.log(C.bold('Results'));
console.log(`  ${C.green(`✓ ${passed} passed`)}   ${C.red(`✗ ${failed} failed`)}   ${C.yellow(`○ ${skipped} skipped`)}   (${total} total)`);

if (failures.length) {
  console.log(`\n${C.red(C.bold('Failures:'))}`);
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
