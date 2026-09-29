import { Router } from "express";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { query, mapRow, mapRows } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { storeCredential, revokeCredentials, getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { runCollection } from "../utils/collectionRunner.js";
import { signGithubAppState, verifyGithubAppState } from "../utils/githubAppState.js";

const router = Router();

// The exact read-only permissions the AWS connector's checks call —
// kept in lockstep with connectors/aws/tests/*.js so the policy handed to
// customers never grants more (or less) than the code uses.
const AWS_READ_ONLY_POLICY = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PrismReadOnlyEvidenceCollection",
      Effect: "Allow",
      Action: [
        // IAM
        "iam:ListUsers",
        "iam:ListMFADevices",
        "iam:ListAccessKeys",
        "iam:GetAccountPasswordPolicy",
        "iam:GenerateCredentialReport",
        "iam:GetCredentialReport",
        "iam:ListGroups",
        "iam:ListGroupPolicies",
        "iam:ListUserPolicies",
        "iam:ListAttachedUserPolicies",
        "iam:ListAttachedGroupPolicies",
        // CloudTrail
        "cloudtrail:DescribeTrails",
        "cloudtrail:GetTrailStatus",
        "cloudtrail:GetEventSelectors",
        // AWS Config
        "config:DescribeConfigurationRecorders",
        "config:DescribeConfigurationRecorderStatus",
        "config:DescribeConfigRules",
        "config:DescribeComplianceByConfigRule",
        "config:GetComplianceDetailsByConfigRule",
        // S3
        "s3:ListAllMyBuckets",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketLogging",
        // EC2 / VPC
        "ec2:DescribeSecurityGroups",
        "ec2:GetEbsEncryptionByDefault",
        "ec2:DescribeVpcs",
        "ec2:DescribeFlowLogs",
        // RDS
        "rds:DescribeDBInstances",
        // Lambda
        "lambda:ListFunctions",
        "lambda:GetFunctionUrlConfig",
        "lambda:GetPolicy",
        "lambda:GetFunction",
        // DynamoDB
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        // KMS
        "kms:ListKeys",
        "kms:DescribeKey",
        "kms:GetKeyRotationStatus",
        "kms:GetKeyPolicy",
        // CloudWatch / CloudWatch Logs
        "cloudwatch:DescribeAlarms",
        "logs:DescribeLogGroups",
        // WAFv2
        "wafv2:ListWebACLs",
        "wafv2:GetWebACL",
        "wafv2:ListResourcesForWebACL",
        "wafv2:GetLoggingConfiguration",
        // Secrets Manager
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret",
        // GuardDuty
        "guardduty:ListDetectors",
        "guardduty:GetDetector",
        "guardduty:ListFindings",
        "guardduty:GetFindings",
        // Security Hub
        "securityhub:DescribeHub",
        "securityhub:GetEnabledStandards",
        "securityhub:GetFindings",
        // ECR
        "ecr:DescribeRepositories",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeImageScanFindings",
        // ECS
        "ecs:ListClusters",
        "ecs:DescribeClusters",
        "ecs:ListTaskDefinitions",
        "ecs:DescribeTaskDefinition",
      ],
      Resource: "*",
    },
  ],
};

// Shaped for the Azure Portal's "Create a custom role" > Start from JSON flow
// (and the ARM REST API directly) — NOT the Azure CLI/PowerShell shape, which
// uses top-level PascalCase Name/Actions/AssignableScopes instead of a nested
// "properties" object. Pasting the CLI shape into the Portal's JSON editor
// fails with "Properties not found", since the Portal is how most customers
// actually create the role.
const AZURE_READ_ONLY_ROLE_DEFINITION = {
  properties: {
    roleName: "Prism Read-Only Evidence Collection",
    description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
    assignableScopes: ["/subscriptions/<subscription-id>"],
    permissions: [
      {
        actions: [
          "Microsoft.Storage/storageAccounts/read",
          "Microsoft.Network/networkSecurityGroups/read",
          "Microsoft.Insights/diagnosticSettings/read",
          "Microsoft.Security/pricings/read",
          "Microsoft.Resources/subscriptions/resourceGroups/read",
        ],
        notActions: [],
        dataActions: [],
        notDataActions: [],
      },
    ],
  },
};

// Kept in lockstep with exactly what connectors/purview's checks actually call
// (tests/datamap.js needs Data Reader for entity/classification/search reads
// and Data Source Administrator for /datasources scan-history reads; tests/audit.js
// needs the three Office 365 Management API application permissions below).
// Both Purview roles are assigned in the Purview governance portal's collection
// Role assignments tab — this is a DIFFERENT system from Azure IAM/RBAC, the most
// common point of confusion for customers who already set up the Azure connector.
const PURVIEW_REQUIRED_PERMISSIONS = {
  purviewRbacRoles: [
    {
      roleName: "Data Reader",
      scope: "Root collection (recommended) or a narrower collection — API calls are scoped to whatever collection the role is assigned on",
      note: "Grants read access to catalog entities, classifications, and search — used by the Data Map classification/sensitivity-label checks.",
    },
    {
      roleName: "Data Source Administrator",
      scope: "Root collection (recommended) or a narrower collection",
      note: "Grants read access to registered data sources and scan run history — used by the scan-recency and scan-schedule checks.",
    },
  ],
  office365ManagementApiPermissions: {
    type: "Application permissions (not Delegated) — require tenant admin consent",
    permissions: ["ActivityFeed.Read", "ActivityFeed.ReadDlp", "ServiceHealth.Read"],
    note: "Granted under the app registration's API permissions > Office 365 Management APIs, then 'Grant admin consent'. Requires a Global Administrator or Privileged Role Administrator to consent.",
  },
  prerequisites: [
    "Unified audit logging must be turned on in Microsoft Purview > Audit before the audit subscriptions will return data (Purview portal > Audit > 'Start recording user and admin activity'; can take up to 60 minutes to take effect).",
  ],
};

// Kept in lockstep with exactly what connectors/github/index.js's testConnection
// and connectors/github/tests/{access,security}.js's checks actually call, same
// "policy in code = policy in docs" discipline as AWS_READ_ONLY_POLICY /
// AZURE_READ_ONLY_ROLE_DEFINITION. No webhook events are consumed in Phase 1,
// so hook_attributes.active is explicitly false rather than standing up a
// receiver Prism doesn't use yet.
function buildGithubAppManifest({ companyName }) {
  const baseUrl = process.env.API_URL || "http://localhost:4000";
  return {
    name: `Prism Evidence Collection - ${companyName}`.slice(0, 34),
    url: baseUrl,
    redirect_url: `${baseUrl}/api/integrations/github/manifest-callback`,
    setup_url: `${baseUrl}/api/integrations/github/install-callback`,
    hook_attributes: { url: baseUrl, active: false },
    public: false,
    default_permissions: {
      organization_administration: "read",
      administration: "read",
      metadata: "read",
    },
  };
}

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM integration_connections WHERE company_id = $1 AND status != 'revoked' ORDER BY created_at DESC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.get("/catalog", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM integrations WHERE status != 'coming_soon' ORDER BY name`);
  res.json(mapRows(result));
}));

// GET /api/integrations/aws/setup-info — the exact trust-policy principal Prism's
// own backend runs as (via STS), plus the least-privilege permissions policy the
// connector needs, so a customer's IAM role works on the first try.
router.get("/aws/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  let principalArn = null;
  let principalError = null;
  try {
    const sts = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    principalArn = identity.Arn;
  } catch (err) {
    console.error("aws/setup-info: failed to resolve Prism's AWS principal ARN:", err.message);
    principalError = "This Prism deployment has no AWS credentials configured, so the trust policy's principal can't be resolved automatically. Ask your Prism administrator for the AWS principal ARN Prism runs as, or connect using static access keys instead.";
  }
  res.json({ principalArn, principalError, permissionsPolicy: AWS_READ_ONLY_POLICY });
}));

router.get("/azure/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roleDefinition: AZURE_READ_ONLY_ROLE_DEFINITION });
}));

router.get("/purview/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: PURVIEW_REQUIRED_PERMISSIONS });
}));

// ── Microsoft connector setup-info ──────────────────────────────────────────
// All four Microsoft connectors share the same tenantId + clientId + clientSecret
// credential shape. Each setup-info endpoint returns the connector-specific list
// of API permissions the customer must grant, plus any connector-specific notes
// (extra consent steps, Entra role assignments, TCM enrollment, etc.).
// Kept in code next to the routes so any permission change is a visible diff.

const ENTRA_ID_PERMISSIONS = {
  graphPermissions: [
    { permission: "User.Read.All", note: "Read guest accounts and sign-in activity for staleness checks." },
    { permission: "RoleManagement.Read.Directory", note: "Read directory role assignments — narrower than Directory.Read.All." },
    { permission: "Policy.Read.All", note: "Read Conditional Access policies and authentication methods policy." },
    { permission: "Policy.Read.AuthenticationMethod", note: "Read the tenant-level authentication methods policy (SMS/voice/FIDO2 enablement)." },
    { permission: "Application.Read.All", note: "Read app registrations, service principals, and their permission grants and credential expiry." },
    { permission: "AuditLog.Read.All", note: "Read sign-in and directory audit logs, and user.signInActivity for staleness data." },
  ],
  consentNote: "All permissions are Microsoft Graph Application permissions — select Grant admin consent after adding them.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector (M365, Teams, Defender), add these permissions to that same app registration instead of creating a new one.",
};

const M365_PERMISSIONS = {
  graphPermissions: [
    { permission: "SharePointTenantSettings.Read.All", note: "Tenant-level SharePoint/OneDrive external sharing settings." },
    { permission: "DeviceManagementManagedDevices.Read.All", note: "Intune managed device compliance state." },
    { permission: "DeviceManagementConfiguration.Read.All", note: "Intune device compliance policies and their platform assignments." },
  ],
  exchangePermission: {
    resource: "Office 365 Exchange Online",
    permission: "Exchange.ManageAsApp",
    note: "Find this under API permissions → Add a permission → APIs my organization uses → search 'Office 365 Exchange Online'. This resource does not appear in the default list.",
  },
  entraRoleAssignment: {
    role: "Global Reader",
    note: "Exchange Online's own RBAC also gates what a token can read — holding Exchange.ManageAsApp alone is not sufficient. In Entra ID → Roles and administrators → Global Reader → Add assignments, add the app's service principal.",
  },
  consentNote: "Grant admin consent separately for each resource (Microsoft Graph and Office 365 Exchange Online — they appear as separate rows in the Permissions page).",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these permissions to that same app registration.",
};

const TEAMS_PERMISSIONS = {
  graphPermissions: [
    { permission: "TeamSettings.Read.All", note: "Per-team settings via GET /teams/{id}." },
    { permission: "TeamMember.Read.All", note: "Team membership including guest members." },
    { permission: "TeamsAppInstallation.Read.All", note: "Installed Teams apps per team/chat/user scope." },
    { permission: "Organization.Read.All", note: "Required for all Tenant Configuration Management (TCM) policy reads — federation config, client config, meeting/messaging/app policies. NOT Policy.Read.All." },
  ],
  tcmNote: "After granting admin consent, the tenant's TCM service principal must also be enrolled (one-time setup). See Microsoft's 'Set up authentication for Tenant Configuration Management APIs' doc. This is separate from admin consent and required before Organization.Read.All unlocks policy reads.",
  consentNote: "All permissions are Microsoft Graph Application permissions — select Grant admin consent after adding them.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these permissions to that same app registration.",
};

const DEFENDER_PERMISSIONS = {
  windowsDefenderATPPermissions: [
    { permission: "Machine.Read.All", note: "Device/machine inventory — GET /api/machines." },
    { permission: "Vulnerability.Read.All", note: "Discovered vulnerabilities per device." },
    { permission: "SecurityRecommendation.Read.All", note: "Security recommendations — GET /api/recommendations." },
    { permission: "Alert.Read.All", note: "Alerts — GET /api/alerts. If this is rejected in practice, fall back to Alert.ReadWrite.All (a documented Microsoft permission inconsistency)." },
  ],
  resourceNote: "Add these under API permissions → Add a permission → APIs my organization uses → search 'WindowsDefenderATP'. This is the internal name for the Defender for Endpoint API — it does not appear in the default Microsoft APIs tab.",
  consentNote: "Grant admin consent for WindowsDefenderATP separately from Microsoft Graph — they are different API resources and each requires its own consent grant.",
  tokenAudienceNote: "Defender for Endpoint tokens must be requested for resource https://api.securitycenter.microsoft.com even though API calls go to https://api.security.microsoft.com — these are two different strings. Prism handles this automatically; it is noted here only if you are troubleshooting 403 errors.",
  sharedAppNote: "If you already set up an app registration for another Prism Microsoft connector, add these WindowsDefenderATP permissions to that same app registration.",
};

router.get("/entra_id/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: ENTRA_ID_PERMISSIONS });
}));

router.get("/microsoft_365/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: M365_PERMISSIONS });
}));

router.get("/microsoft_teams/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: TEAMS_PERMISSIONS });
}));

router.get("/microsoft_defender/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ permissions: DEFENDER_PERMISSIONS });
}));

// Data-center domain table for the Zoho wizard UI dropdown, and per-product
// OAuth2 scope lists for the scope checklist. Kept in code (not DB) because
// they're tightly coupled to what the connector actually calls — any new product
// added to the connector should add its scopes here at the same time.
const ZOHO_DATA_CENTERS = [
  { label: "United States (zoho.com)", value: "com" },
  { label: "Europe (zoho.eu)", value: "eu" },
  { label: "India (zoho.in)", value: "in" },
  { label: "Australia (zoho.com.au)", value: "com.au" },
  { label: "China (zoho.com.cn)", value: "com.cn" },
  { label: "Japan (zoho.jp)", value: "jp" },
  { label: "Canada (zohocloud.ca)", value: "cloud.ca" },
];

const ZOHO_PRODUCTS = [
  { key: "directory", label: "Zoho Directory", scopes: ["ZohoDirectory.org.READ", "ZohoDirectory.users.READ"] },
  { key: "crm", label: "Zoho CRM", scopes: ["ZohoCRM.users.READ", "ZohoCRM.settings.READ"] },
  { key: "books", label: "Zoho Books", scopes: ["ZohoBooks.settings.READ", "ZohoBooks.contacts.READ"] },
  { key: "people", label: "Zoho People", scopes: ["ZohoPeople.forms.READ", "ZohoPeople.roles.READ"] },
  { key: "workdrive", label: "Zoho WorkDrive", scopes: ["WorkDrive.team.READ", "WorkDrive.organization.READ"] },
  { key: "desk", label: "Zoho Desk", scopes: ["Desk.agents.READ", "Desk.tickets.READ", "Desk.settings.READ"] },
  { key: "mail", label: "Zoho Mail", scopes: ["ZohoMail.organization.READ", "ZohoMail.settings.READ"] },
  { key: "vault", label: "Zoho Vault", scopes: ["ZohoVault.secrets.READ", "ZohoVault.settings.READ"] },
  { key: "projects", label: "Zoho Projects", scopes: ["ZohoProjects.portals.READ", "ZohoProjects.projects.READ", "ZohoProjects.users.READ"] },
  { key: "analytics", label: "Zoho Analytics", scopes: ["ZohoAnalytics.data.READ", "ZohoAnalytics.metadata.READ"] },
  { key: "creator", label: "Zoho Creator", scopes: ["ZohoCreator.meta.READ", "ZohoCreator.data.READ"] },
  { key: "sign", label: "Zoho Sign", scopes: ["ZohoSign.documents.READ", "ZohoSign.templates.READ"] },
  { key: "expense", label: "Zoho Expense", scopes: ["ZohoExpense.settings.READ", "ZohoExpense.reports.READ"] },
  { key: "recruit", label: "Zoho Recruit", scopes: ["ZohoRecruit.settings.READ", "ZohoRecruit.modules.READ"] },
];

router.get("/zoho/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ dataCenters: ZOHO_DATA_CENTERS, products: ZOHO_PRODUCTS });
}));

// Kept in lockstep with connectors/google_workspace/credentials.js's SCOPES
// array (not imported from it, matching this file's existing convention of
// duplicating connector permission lists in code — see AZURE_READ_ONLY_ROLE_DEFINITION
// above) — any scope added to one must be added to the other, or domain-wide
// delegation authorization in the customer's Admin Console won't match what
// the connector actually requests at token-mint time.
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.security",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.mobile.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies.readonly",
];

router.get("/google_workspace/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ scopes: GOOGLE_WORKSPACE_SCOPES });
}));

// GCP's service account authenticates directly (no domain-wide delegation/
// impersonation, unlike google_workspace) and is authorized via ordinary
// Cloud IAM role bindings on the project — Viewer covers most reads (incl.
// resourcemanager.projects.getIamPolicy), but IAM-specific reads like
// iam.serviceAccountKeys.list are deliberately excluded from Viewer, hence
// the second role. Kept in code next to the route, same convention as
// AZURE_READ_ONLY_ROLE_DEFINITION above.
const GCP_RECOMMENDED_ROLES = [
  { role: "roles/viewer", note: "Broad read access across Compute Engine, Cloud SQL, Cloud Storage, Cloud KMS, and Resource Manager." },
  { role: "roles/iam.securityReviewer", note: "Read access to service account keys and IAM policies — not included in the basic Viewer role." },
];

router.get("/gcp/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({ roles: GCP_RECOMMENDED_ROLES });
}));

// OneTrust Client Credential read scopes, one per audited module. Kept in code
// (not DB) next to the route — tightly coupled to what connectors/onetrust/*
// actually calls; a module added to the connector adds its scope here too. A
// missing scope makes that module's endpoints 403 and its checks fall back to
// not_applicable (see connectors/onetrust/index.js runTests).
const ONETRUST_SCOPES = [
  { scope: "ORGANIZATION", note: "Base scope — used by the connection test (external organizations)." },
  { scope: "ASSESSMENT_READ", note: "PIA/DPIA assessments and their risk exports." },
  { scope: "INVENTORY_READ", note: "Data inventory: assets, processing activities (RoPA), entities, vendors. (Some tenants name this DATA_CATALOG_READ.)" },
  { scope: "DSAR_READ", note: "Data-subject / privacy-rights request queues." },
  { scope: "INCIDENT_READ", note: "Incident register and breach-notification decision fields." },
  { scope: "RISK", note: "Risk register." },
  { scope: "VRM_READ", note: "Third-party / vendor risk inventory and assessments." },
];

router.get("/onetrust/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    scopes: ONETRUST_SCOPES,
    hostnameHint: "The tenant domain you sign in with, e.g. acme.my.onetrust.com, app-eu.onetrust.com, or trial.onetrust.com",
  });
}));

// Tables the ServiceNow integration user must be able to read. Kept in code next
// to the route — tightly coupled to what connectors/servicenow/* actually calls.
// A table the user's roles can't read comes back 403 and those checks fall back
// to not_applicable (see connectors/servicenow/index.js runTests).
const SERVICENOW_TABLES = [
  { table: "sys_user", note: "User records — active flag, web-service-only flag, last login." },
  { table: "sys_user_has_role", note: "User-to-role assignments (privileged-role checks)." },
  { table: "sys_user_group", note: "Groups (privileged-group review)." },
  { table: "sys_user_grmember", note: "Group membership." },
  { table: "sys_security_acl", note: "Access Control List rules for the sensitive-table check." },
  { table: "sys_audit", note: "Field-level audit history." },
  { table: "sys_properties", note: "Instance properties — MFA enforcement, password policy." },
  { table: "sys_user_password_policy", note: "Password Policy plugin records (optional — skipped if the plugin is absent)." },
  { table: "sys_ws_api_access_policy", note: "REST API Access Policies (optional — skipped if not readable)." },
];

router.get("/servicenow/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    tables: SERVICENOW_TABLES,
    roleHint: "Grant the integration user snc_platform_rest_api_access plus a read-only role covering the tables below. Enable the Client Credentials grant (system property glide.oauth.inbound.client.credential.grant_type.enabled = true) and set an OAuth Application User on the Application Registry record.",
    instanceUrlHint: "The instance base URL you sign in to, e.g. acme.service-now.com or https://acme.service-now.com",
  });
}));

// Privy by IDfy modules Prism audits, one row per module. Kept in code next to
// the route — tightly coupled to what connectors/privy/* actually calls. A module
// the tenant's API key can't reach comes back 403/404 and those checks fall back
// to not_applicable (see connectors/privy/index.js runTests).
const PRIVY_MODULES = [
  { module: "Consent Governance", note: "Consent collection points and consent artefacts." },
  { module: "Data Principal Rights (DPRM)", note: "Rights-request queue and statutory deadlines." },
  { module: "Privacy Impact Assessments", note: "PIA/DPIA assessments and their risks." },
  { module: "Incident Management", note: "Incident register and breach-notification decisions." },
  { module: "Third-Party Risk (TPRM)", note: "Processor / third-party inventory and risk assessments." },
  { module: "Data Discovery (Data Compass)", note: "Processing-activity and asset inventory (RoPA)." },
];

router.get("/privy/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    modules: PRIVY_MODULES,
    baseUrlHint: "The Privy tenant domain you sign in with, e.g. acme.privybyidfy.com or app.privybyidfy.com",
    apiKeyHint: "Issue a read-only API key from Privy → Settings → API Keys, or ask your IDfy account team. A module the key cannot reach is skipped (its checks report not applicable).",
  });
}));

// CrowdStrike Falcon read scopes, one per audited collection. Kept in code next
// to the route — tightly coupled to what connectors/crowdstrike/* actually
// calls. A scope the API client is missing makes that collection 403 and those
// checks fall back to not_applicable (see connectors/crowdstrike/index.js
// runTests). Regions are separate API hosts with no cross-region routing, so the
// region is an explicit dropdown, not free text.
const CROWDSTRIKE_SCOPES = [
  { scope: "hosts:read", note: "Device / endpoint inventory — OS, sensor version, last seen, reduced functionality mode." },
  { scope: "sensor-update-policies:read", note: "Sensor update policy definitions and host-group assignment." },
  { scope: "alerts:read", note: "The unified alert stream (severity, status, host) — the current detections API." },
  { scope: "detects:read", note: "Legacy Detects API — used as a fallback during CrowdStrike's Alerts migration." },
  { scope: "spotlight-vulnerabilities:read", note: "Per-host CVE exposure, severity, and remediation status." },
  { scope: "user-management:read", note: "Falcon console user / role inventory, for the admin-role review check." },
];

const CROWDSTRIKE_REGIONS = [
  { value: "us-1", label: "US-1 (falcon.crowdstrike.com)", baseUrl: "https://api.crowdstrike.com" },
  { value: "us-2", label: "US-2 (falcon.us-2.crowdstrike.com)", baseUrl: "https://api.us-2.crowdstrike.com" },
  { value: "eu-1", label: "EU-1 (falcon.eu-1.crowdstrike.com)", baseUrl: "https://api.eu-1.crowdstrike.com" },
  { value: "us-gov-1", label: "US-GOV-1 (falcon.laggar.gcw.crowdstrike.com)", baseUrl: "https://api.laggar.gcw.crowdstrike.com" },
  { value: "us-gov-2", label: "US-GOV-2 (falcon.us-gov-2.crowdstrike.mil)", baseUrl: "https://api.us-gov-2.crowdstrike.mil" },
];

router.get("/crowdstrike/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    scopes: CROWDSTRIKE_SCOPES,
    regions: CROWDSTRIKE_REGIONS,
    regionHint: "Pick the region your Falcon console runs in — a Client ID / Secret only authenticates against the region it was created in.",
  });
}));

const SOPHOS_SETUP_STEPS = [
  "In Sophos Central Admin, open Global Settings > API Credentials and click Add Credential.",
  "Name the service principal (for example, Prism Compliance Reader) and assign the narrowest read-only role that covers the Sophos products you want Prism to audit.",
  "Save the credential, then copy its Client ID and Client Secret. Sophos displays the secret only at creation time.",
  "Paste both values below and click Connect. Prism uses whoami to discover the tenant ID and regional API host automatically.",
];

const SOPHOS_ROLE_HINT =
  "Use a tenant-level service principal with read-only access. Partner and organization credentials are deliberately rejected; create the credential inside the customer tenant.";

router.get("/sophos/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    steps: SOPHOS_SETUP_STEPS,
    roleHint: SOPHOS_ROLE_HINT,
    regionHint: "No region selection is required. Sophos whoami returns the tenant data-region host for each connection and collection run.",
    scopeNote: "Endpoint access is required to connect. Unlicensed or inaccessible product areas are isolated and reported as not applicable without stopping other checks.",
    areas: ["Endpoint", "Common", "Detections", "Audit", "XDR Data Lake", "SIEM", "Firewall", "Web Control", "DNS Protection"],
  });
}));

// Salesforce JWT Bearer flow setup. The connector reads Setup metadata via SOQL
// / the Tooling API, so the integration user needs a small read-only permission
// set — an object it can't read makes those checks report not_applicable (see
// connectors/salesforce/index.js runTests). The customer records their My Domain
// login URL (JWT audience) explicitly rather than us inferring a pod.
const SALESFORCE_PERMISSIONS = [
  { permission: "API Enabled", note: "Baseline — required for every REST/SOQL call the connector makes." },
  { permission: "View Setup and Configuration", note: "Session Settings / MFA policy, password policies, Login IP Ranges, connected apps." },
  { permission: "View All Users", note: "Full user list with profile + active flag, for the inactive-privileged-user check." },
  { permission: "View All Data (or Manage Users)", note: "Permission-set assignments and the Setup Audit Trail. Do NOT grant Modify All Data." },
];

const SALESFORCE_OAUTH_SCOPES = [
  { scope: "api", note: "Manage user data via APIs — required for all REST/SOQL/Tooling calls." },
  { scope: "refresh_token, offline_access", note: "Perform requests at any time — required for the unattended JWT token lifecycle." },
];

router.get("/salesforce/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    permissions: SALESFORCE_PERMISSIONS,
    oauthScopes: SALESFORCE_OAUTH_SCOPES,
    steps: [
      'Generate an RSA keypair locally: openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 -keyout salesforce.key -out salesforce.crt',
      'In Salesforce Setup > App Manager, create a New Connected App (or a New External Client App on Spring ’26+ orgs). Enable OAuth, set any callback URL, and under "Use digital signatures" upload salesforce.crt.',
      'Select the OAuth scopes "api" and "refresh_token, offline_access" — nothing broader.',
      'Save and wait up to 10 minutes for propagation. Under Manage > Edit Policies, set Permitted Users to "Admin approved users are pre-authorized", then pre-authorize the integration user’s profile or a dedicated permission set.',
      'Create (or reuse) a dedicated integration user with the read-only permission set below.',
      'Copy the Consumer Key from Manage Consumer Details — that is the Client ID below. Paste the contents of salesforce.key as the private key.',
    ],
    loginUrlHint: 'Your My Domain login URL, e.g. https://acme.my.salesforce.com (use https://test.salesforce.com for a sandbox).',
  });
}));

// Acronis Cyber Protect Cloud connects with an OAuth2 client-credentials API
// client created in the management console. Acronis has no least-privilege
// policy JSON — its model is coarse built-in roles — so this is a static
// instructional walkthrough, not a computed document. A module the client's role
// can't read comes back 403/404 and those checks fall back to not_applicable
// (see connectors/acronis/index.js runTests).
const ACRONIS_MODULES = [
  { module: "Resource management", note: "Protected-workload inventory — protection status, last successful backup, last anti-malware scan." },
  { module: "Alert manager", note: "The alert stream — malware/ransomware detections, vulnerability findings, missing patches, critical alerts." },
];

router.get("/acronis/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    modules: ACRONIS_MODULES,
    steps: [
      "In the Cyber Protect Cloud management console, go to Settings > API clients and click Create API client (name it e.g. \"Prism Compliance Reader\").",
      "Assign it the most restrictive role that can read across your tenant — \"Read-only administrator\" is recommended. Acronis has no per-endpoint scopes.",
      "Save, then copy the Client ID and Client secret — the secret is shown only once.",
      "Copy your data-center URL from the browser address bar while signed into the console (e.g. https://us5-cloud.acronis.com), then paste all three below and click Connect.",
    ],
    roleHint: "Grant the API client a Read-only administrator role (or the narrowest role your tenant offers that can read resource management and the alert manager).",
    datacenterUrlHint: "The Cyber Protect Cloud data-center host you sign in to, e.g. https://us5-cloud.acronis.com or https://eu2-cloud.acronis.com — a credential pair only authenticates against the data center it was created in.",
  });
}));

// Commvault connects with a customer-generated Custom-scope access token
// (Command Center > user > Access Tokens). The `apiEndpoints` allowlist below is
// kept in lockstep with the exact REST paths connectors/commvault/tests/*.js and
// index.js's testConnection call, so the token a customer generates grants no
// more (and no less) than Prism uses. `/v2/StoragePolicy` is listed separately
// from `/StoragePolicy` because Commvault's Custom-scope allowlist matches on
// literal path prefixes. Re-verify this list once the connector's TODO CONFIRM
// endpoint paths are confirmed against a live CommCell.
const COMMVAULT_ACCESS_TOKEN_SETUP = {
  tokenType: 3,
  apiEndpoints: ["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"],
  instructions:
    "In your CommCell's Command Center, go to your username > Access Tokens > Add. " +
    "Set the scope to \"Custom\", paste the exact API endpoint list Prism shows here, " +
    "and copy the generated token into Prism's connection form along with your " +
    "WebConsole base URL (e.g. https://commvault.example.com).",
};

router.get("/commvault/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    accessTokenSetup: COMMVAULT_ACCESS_TOKEN_SETUP,
    steps: [
      "In Command Center, open your user menu (top-right) > Access Tokens, and click Add.",
      "Set Token type / scope to \"Custom\" and add exactly these API endpoints to the allowlist: /Alerts, /dashboard, /StoragePolicy, /v2/StoragePolicy.",
      "Generate the token and copy it — it is shown only once.",
      "Copy your CommCell WebConsole base URL from the browser address bar (e.g. https://commvault.example.com), then paste both below and click Connect.",
    ],
    webconsoleUrlHint: "The CommCell WebConsole base URL you sign in to, e.g. https://commvault.example.com — copy it from the browser address bar while signed into Command Center.",
  });
}));

// Carbonite Core Endpoint Backup connects with a customer-generated API key
// (dashboard > Key Management) used as the SOAP CallingContext token, plus the
// account email. Static instructions (no live call), matching Azure/Commvault.
// Carbonite does not publish per-endpoint scopes or the real dashboard host
// pattern — the wording below is provisional pending a live tenant (see
// api/src/connectors/carbonite/ TODO CONFIRM markers).
router.get("/carbonite/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    operations: [
      { operation: "GetDeviceList", note: "Enumerates protected devices and their protection state." },
      { operation: "GetDashboardDeviceInfo", note: "Per-device detail including the last completed backup time." },
    ],
    steps: [
      "In the Core Endpoint Backup dashboard, open Key Management and generate an API key with read access to dashboard / device data — do not grant provisioning or restore scopes.",
      "Copy the API key (it is shown only once) and note the account email it belongs to.",
      "Find your dashboard host from the browser address bar while signed in (e.g. https://dashboard.carbonite.com).",
      "In Prism, paste the dashboard host, the account email, and the API key, then click Connect.",
    ],
    dashboardHostHint: "The host your Core Endpoint Backup dashboard is served from, e.g. https://dashboard.carbonite.com — copy it from the browser address bar while signed in.",
    betaNote: "This connector talks to Carbonite's legacy SOAP Dashboard Service, whose wire format Carbonite does not publish. It ships as beta: checks that can't confirm a field against your tenant report \"error\" rather than guess.",
  });
}));

// Carbonite Server Backup's API - Monitoring component authenticates via a
// Keycloak client the customer registers with the vendor's shipped setup script.
// Its access levels are Admin / Partner / Reseller — Reseller, scoped to the one
// company being monitored, is the least-privilege tier that can still read
// safesets and agents, so that is what this walkthrough recommends. Static
// instructions (no live call), matching every sibling connector's setup-info.
// The exact script name, realm, and endpoint paths are unconfirmed pending a
// live install (see api/src/connectors/carbonite-server/ TODO CONFIRM markers).
const CARBONITE_SERVER_ACCESS_LEVELS = [
  { level: "Admin", note: "Unrestricted — all companies, all data including vault info. More than Prism needs." },
  { level: "Partner", note: "Portal-instance data, no vault info. Still broader than Prism needs." },
  { level: "Reseller", note: "Scoped to specific companies and their safesets — the recommended least-privilege level for Prism." },
];

router.get("/carbonite-server/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    accessLevels: CARBONITE_SERVER_ACCESS_LEVELS,
    recommendedAccessLevel: "Reseller",
    steps: [
      "On the server running the Carbonite Server Backup \"API - Monitoring\" component, run the vendor-supplied Keycloak client-registration script (shipped with the API installer).",
      "Register the client at the \"Reseller\" access level, scoped to the single company you want Prism to monitor — this is the least-privilege level that can still read safesets and agents.",
      "Copy the generated Client ID and Client secret — the secret is shown only once.",
      "Open the API's Swagger UI (https://<your-api-host>/monitoring/swaggerui/index) once to confirm the host is reachable, and note the Keycloak realm name from its authorize dialog.",
      "In Prism, paste the API host (e.g. https://backup.example.com), the Keycloak realm, and the Client ID / Client secret, then click Connect.",
    ],
    apiDomainHint: "The host the API - Monitoring component is served from, e.g. https://backup.example.com — the same host you open its Swagger UI on.",
    keycloakRealmHint: "The Keycloak realm the API - Monitoring client is registered in (shown in the Swagger UI's authorize dialog, or the realm named in the registration script output) — not 'master'.",
  });
}));

// ── Check Point connectors (three separate auth domains) ────────────────────
// check_point_mgmt: Security Management API session (administrator API key,
//   read-only). check_point: Infinity Portal API key (one key per service, or a
//   broad user key). check_point_cloudguard: CloudGuard/Dome9 key id + secret.
// All static instructional walkthroughs (no live call), matching every sibling
// connector; all ship beta pending live-tenant confirmation of cloud response
// shapes (see the api/src/connectors/check_point*/ modules).

const CHECK_POINT_MGMT_DEPLOYMENTS = [
  { value: "self_managed", label: "Self-managed Security Management / Multi-Domain server" },
  { value: "smart1_cloud", label: "Smart-1 Cloud (Check Point hosted)" },
];

router.get("/check_point_mgmt/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    deployments: CHECK_POINT_MGMT_DEPLOYMENTS,
    steps: [
      "In SmartConsole, open Manage & Settings > Permissions > Administrators and create (or reuse) an administrator with a read-only permission profile.",
      "Generate an API key for that administrator and Publish the session.",
      "Self-managed: make sure the Management API accepts requests from Prism's egress (Manage & Settings > Blades > Management API > 'All IP addresses' or a specific range), then use your Security Management server URL. Smart-1 Cloud: copy the tenant service URL shown in the Infinity Portal (Smart-1 Cloud > Settings), which ends in /web_api.",
      "In Prism, choose the deployment, paste the Management URL and the administrator API key, and click Connect. Prism logs in read-only and never writes.",
    ],
    areas: ["Access policy", "Gateways", "Threat Prevention / IPS"],
    mgmtUrlHint: "The origin only, e.g. https://mgmt.example.com (self-managed) or https://<tenant>.maas.checkpoint.com/<id> (Smart-1 Cloud). Prism appends /web_api itself.",
    roleHint: "Use a read-only permission profile. The connection also sends read-only:true on login so writes are impossible even if the profile is broader.",
  });
}));

const CHECK_POINT_REGIONS = [
  { value: "eu", label: "EU (cloudinfra-gw.portal.checkpoint.com)", gatewayUrl: "https://cloudinfra-gw.portal.checkpoint.com" },
  { value: "us", label: "US (cloudinfra-gw-us.portal.checkpoint.com)", gatewayUrl: "https://cloudinfra-gw-us.portal.checkpoint.com" },
  { value: "ap", label: "AP (cloudinfra-gw-ap.portal.checkpoint.com)", gatewayUrl: "https://cloudinfra-gw-ap.portal.checkpoint.com" },
];

const CHECK_POINT_SERVICES = [
  { service: "events", label: "Logs / Events", note: "Infinity Events — security event feed and log-retention checks." },
  { service: "xdr", label: "XDR / XPR", note: "Infinity XDR/XPR — incident triage and investigation freshness checks." },
  { service: "endpoint", label: "Endpoint", note: "Harmony Endpoint — device check-in, protection blades, signature and incident checks." },
];

router.get("/check_point/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    regions: CHECK_POINT_REGIONS,
    services: CHECK_POINT_SERVICES,
    steps: [
      "In the Infinity Portal, open Global Settings > API Keys > New.",
      "An Account API key is scoped to one service — create one key per service you want Prism to audit (Logs/Events, XDR/XPR, Endpoint), or create a broader user API key that covers several.",
      "Copy each Client ID and Secret Key, and note your Infinity Portal region.",
      "In Prism, select the region, then paste one Client ID / Secret Key pair (used for every service) or a pair per service. A service left blank is reported as not applicable.",
    ],
    regionHint: "Pick the region your Infinity Portal tenant runs in — an API key only authenticates against the gateway for its region.",
    scopeNote: "Only the services you provide a key for are collected; the rest are skipped as not applicable rather than failing the run.",
  });
}));

const CHECK_POINT_CLOUDGUARD_DATA_CENTERS = [
  { value: "us", label: "US (api.dome9.com)", baseUrl: "https://api.dome9.com/v2" },
  { value: "eu", label: "EU (api.eu1.dome9.com)", baseUrl: "https://api.eu1.dome9.com/v2" },
  { value: "ap1", label: "AP1 – Sydney (api.ap1.dome9.com)", baseUrl: "https://api.ap1.dome9.com/v2" },
  { value: "ap2", label: "AP2 – Singapore (api.ap2.dome9.com)", baseUrl: "https://api.ap2.dome9.com/v2" },
  { value: "ap3", label: "AP3 – Mumbai (api.ap3.dome9.com)", baseUrl: "https://api.ap3.dome9.com/v2" },
  { value: "ca", label: "Canada (api.cace1.dome9.com)", baseUrl: "https://api.cace1.dome9.com/v2" },
];

router.get("/check_point_cloudguard/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json({
    dataCenters: CHECK_POINT_CLOUDGUARD_DATA_CENTERS,
    steps: [
      "In the CloudGuard console, open Settings > Credentials and click Create API Key.",
      "Assign the key a read-only role that can read Cloud Accounts, Compliance and Posture Findings — grant nothing broader.",
      "Copy the API Key ID and Secret — the secret is shown only once.",
      "Find your data centre under Settings > Account Info, then in Prism select it, paste the key id and secret, and click Connect.",
    ],
    dataCenterHint: "CloudGuard's API host is fixed by your account's data centre (Settings > Account Info) — a key only authenticates against its own data centre.",
    areas: ["Cloud account fetch health", "Compliance assessment freshness", "Ruleset coverage", "Critical / high posture findings", "Exclusions"],
  });
}));

// ── Akamai connector ───────────────────────────────────────────────────────
// Kept in lockstep with the scopes connectors/akamai/* actually calls — see
// docs/connectors/akamai.md §2. A missing scope makes that area's checks
// fall back to not_applicable (connectors/akamai/index.js runTests).
const AKAMAI_SETUP = {
  scopes: [
    "Application Security — READ-ONLY (WAF, rate, attack groups, SIEM settings)",
    "Property Manager (PAPI) — READ-ONLY (properties, versions, activations, rule trees)",
    "Certificate Provisioning System — READ-ONLY (enrollments, deployments, changes)",
    "API Definitions — READ-ONLY (registered endpoints and resources)",
  ],
  controlCenterPath: "Control Center → Identity & Access → API clients → Create API client (read-only)",
  hostHint:
    'The "host" line from the API client .edgerc block, e.g. akab-xxxx.luna.akamaiapis.net — it is unique per credential, not a shared Akamai hostname.',
  steps: [
    "In Control Center open Identity & Access → API clients and click Create API client.",
    "Set the client to read-only and grant the four READ-ONLY scopes listed below (grant nothing broader).",
    "Set the client's group/account access to the groups whose properties and security configs are in scope.",
    "Create credentials and download the .edgerc block — it has host, client_token, client_secret and access_token.",
    "Paste those four values below. Add the account switch key only if this is a partner-managed account.",
  ],
};

router.get("/akamai/setup-info", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  res.json(AKAMAI_SETUP);
}));

router.get("/:id/github/setup-info", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const state = signGithubAppState({ connectionId, companyId: req.user.companyId });
  const manifest = buildGithubAppManifest({ companyName: req.user.company?.name || "Prism" });
  res.json({ manifest, state });
}));

// Hit directly by the customer's browser via GitHub's redirect after they
// create the App from the manifest — there is no Prism session at this
// point, so authorization is entirely the signed `state` token, verified
// before any database access.
router.get("/github/manifest-callback", asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  let appData;
  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status} exchanging the manifest code`);
    appData = await response.json();
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await revokeCredentials(connectionId, companyId);
  await storeCredential({
    connectionId, companyId, authType: "oauth2",
    secret: { appId: String(appData.id), privateKey: appData.pem },
  });
  // No authenticated user exists on a GitHub-initiated redirect — userId: null
  // is a legitimate value here, same as other automated, non-user-attributed
  // audit events already written by this codebase (e.g. evidence auto-collection).
  await writeAuditLog({ userId: null, companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType: "oauth2", via: "github_manifest_flow" } });

  // `slug`/`html_url` are part of GitHub's App resource shape by convention
  // (not independently confirmed via context7 in this planning pass, see the
  // plan header's Spec section) — fall back to constructing the install URL
  // from `slug` alone if `html_url` is ever absent.
  // Re-sign a fresh state token rather than reusing the one verified above —
  // its 15-minute clock started at setup-info time and has to survive reading
  // setup-info, creating the App on github.com, this manifest-conversion
  // redirect, AND the admin clicking through to install. Re-minting here gives
  // the install leg its own full window instead of inheriting whatever's left.
  const installState = signGithubAppState({ connectionId, companyId });
  const installUrl = appData.html_url ? `${appData.html_url}/installations/new` : `https://github.com/apps/${appData.slug}/installations/new`;
  res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubInstallUrl=${encodeURIComponent(`${installUrl}?state=${installState}`)}`);
}));

// Also unauthenticated, for the same reason as manifest-callback above —
// this is GitHub's own redirect after the admin installs the App, carrying
// only `installation_id`. That alone doesn't tell us the org login the
// connector's testConnection/runTests need, so this route resolves it via
// an App-level (JWT, not installation-token) lookup first.
router.get("/github/install-callback", asyncHandler(async (req, res) => {
  const installationId = parseInt(req.query.installation_id);
  const { state } = req.query;
  const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");

  let stateData;
  try {
    stateData = verifyGithubAppState(state);
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent(err.message)}`);
  }
  const { connectionId, companyId } = stateData;

  const connResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2 AND integration_key = 'github'`,
    [connectionId, companyId]
  );
  if (!mapRow(connResult)) {
    return res.redirect(`${webUrl}/settings/integrations?githubError=${encodeURIComponent("Connection not found")}`);
  }

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent("Create the GitHub App before installing it")}`);
  }

  let org;
  try {
    const appAuth = createAppAuth({ appId: credential.secret.appId, privateKey: credential.secret.privateKey });
    const { token: appJwt } = await appAuth({ type: "app" });
    const appOctokit = new Octokit({ auth: appJwt });
    const { data: installation } = await appOctokit.rest.apps.getInstallation({ installation_id: installationId });
    org = installation.account.login;
  } catch (err) {
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await query(
    `UPDATE integration_connections SET config = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
    [JSON.stringify({ installationId, org }), connectionId, companyId]
  );

  const connector = getConnector("github");
  try {
    const testResult = await connector.testConnection({ authType: "oauth2", config: { installationId, org }, secret: credential.secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, companyId]);
    await writeAuditLog({ userId: null, companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.redirect(`${webUrl}/settings/integrations/${connectionId}?githubError=${encodeURIComponent(err.message)}`);
  }

  await writeAuditLog({ userId: null, companyId, action: "CONNECTION_INSTALLED", resource: "integration_connections", detail: { connectionId, installationId, org } });
  res.redirect(`${webUrl}/settings/integrations/${connectionId}`);
}));

router.get("/:id", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ic.*, cred.auth_type
     FROM integration_connections ic
     LEFT JOIN LATERAL (
       SELECT auth_type FROM integration_credentials
       WHERE connection_id = ic.id AND company_id = ic.company_id AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1
     ) cred ON true
     WHERE ic.id = $1 AND ic.company_id = $2`,
    [parseInt(req.params.id), req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });
  res.json(connection);
}));

router.get("/:id/runs", authenticate, requireReadOnly(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const connResult = await query(
    `SELECT id FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (connResult.rows.length === 0) return res.status(404).json({ error: "Connection not found" });

  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = await query(
    `SELECT * FROM evidence_collection_runs WHERE connection_id = $1 AND company_id = $2 ORDER BY started_at DESC LIMIT $3`,
    [connectionId, req.user.companyId, limit]
  );
  res.json(mapRows(result));
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { integrationKey, name, config } = sanitiseFields(req.body, { name: "text" });
  if (!integrationKey || !name) {
    return res.status(400).json({ error: "integrationKey and name are required" });
  }
  const result = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name, config, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.companyId, integrationKey, name, JSON.stringify(config || {}), req.user.userId]
  );
  const connection = mapRow(result);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_CREATED", resource: "integration_connections", detail: { connectionId: connection.id, integrationKey } });
  res.status(201).json(connection);
}));

router.post("/:id/credentials", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const result = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  const { authType, secret } = req.body;
  if (!authType || !secret) {
    return res.status(400).json({ error: "authType and secret are required" });
  }

  await revokeCredentials(connectionId, req.user.companyId);
  await storeCredential({ connectionId, companyId: req.user.companyId, authType, secret });

  const connector = getConnector(connection.integrationKey);
  try {
    const testResult = await connector.testConnection({ authType, config: connection.config, secret });
    await query(
      `UPDATE integration_connections SET status = 'connected', external_account_id = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
      [testResult.externalAccountId || null, connectionId, req.user.companyId]
    );
  } catch (err) {
    await query(`UPDATE integration_connections SET status = 'error', updated_at = NOW() WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_TEST_FAILED", resource: "integration_connections", detail: { connectionId, error: err.message } });
    return res.status(400).json({ error: `Connection test failed: ${err.message}` });
  }

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CREDENTIAL_STORED", resource: "integration_credentials", detail: { connectionId, authType } });

  const updated = await query(`SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
  res.json(mapRow(updated));
}));

router.post("/:id/run", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  try {
    const run = await runCollection({ connectionId, companyId: req.user.companyId, triggeredBy: req.user.userId, triggerType: "manual" });
    res.json(run);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
}));

router.patch("/:id/schedule", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const { collectionFrequencyHours, autoCollectEnabled } = req.body;

  if (!Number.isInteger(collectionFrequencyHours) || collectionFrequencyHours <= 0) {
    return res.status(400).json({ error: "collectionFrequencyHours must be a positive integer" });
  }
  if (typeof autoCollectEnabled !== "boolean") {
    return res.status(400).json({ error: "autoCollectEnabled must be a boolean" });
  }

  const result = await query(
    `UPDATE integration_connections
     SET collection_frequency_hours = $1, auto_collect_enabled = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING *`,
    [collectionFrequencyHours, autoCollectEnabled, connectionId, req.user.companyId]
  );
  const connection = mapRow(result);
  if (!connection) return res.status(404).json({ error: "Connection not found" });

  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_SCHEDULE_UPDATED", resource: "integration_connections", detail: { connectionId, collectionFrequencyHours, autoCollectEnabled } });

  res.json(connection);
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const connectionId = parseInt(req.params.id);
  const existing = await query(
    `SELECT ic.status,
            EXISTS (
              SELECT 1 FROM evidence_collection_runs r
              WHERE r.connection_id = ic.id AND r.status IN ('success', 'partial_failure')
            ) AS ever_collected
       FROM integration_connections ic
       WHERE ic.id = $1 AND ic.company_id = $2`,
    [connectionId, req.user.companyId]
  );
  if (existing.rowCount === 0) return res.status(404).json({ error: "Connection not found" });

  // A connection that never successfully connected never held a working
  // credential worth crypto-shredding for audit purposes — hard-delete it
  // (cascades to credentials/runs/findings) instead of leaving a dead
  // "revoked" row behind. A connection that did connect gets the existing
  // soft-revoke treatment, preserving its audit trail. `status === 'error'`
  // alone isn't a reliable proxy for "never connected" — collectionRunner
  // flips a previously-connected connection to 'error' on any later failed
  // run too, so this also requires that no run of that connection ever
  // completed (successfully or partially) before hard-deleting.
  if (existing.rows[0].status === "error" && !existing.rows[0].ever_collected) {
    await query(`DELETE FROM integration_connections WHERE id = $1 AND company_id = $2`, [connectionId, req.user.companyId]);
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_DELETED", resource: "integration_connections", detail: { connectionId } });
    return res.status(204).send();
  }

  await query(
    `UPDATE integration_connections SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2`,
    [connectionId, req.user.companyId]
  );
  await revokeCredentials(connectionId, req.user.companyId);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CONNECTION_REVOKED", resource: "integration_connections", detail: { connectionId } });

  res.status(204).send();
}));

export default router;
