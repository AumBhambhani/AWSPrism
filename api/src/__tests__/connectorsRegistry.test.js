import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getConnector, listConnectorTests, listConnectorKeys } from "../connectors/registry.js";

const REGISTRY_PATH = "../connectors/registry.js";
const realReadFileSync = fs.readFileSync;

// Builds an `fs` mock factory whose `readFileSync` rewrites just the named
// connector's connector.json (via `transformManifest`) and delegates every
// other read straight to the real filesystem.
function mockManifestFor(connectorKey, transformManifest) {
  const manifestSuffix = path.join(connectorKey, "connector.json");
  vi.doMock("fs", async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      default: {
        ...actual.default,
        readFileSync: (filePath, ...args) => {
          if (typeof filePath === "string" && filePath.endsWith(manifestSuffix)) {
            const manifest = JSON.parse(realReadFileSync(filePath, "utf8"));
            transformManifest(manifest);
            return JSON.stringify(manifest);
          }
          return realReadFileSync(filePath, ...args);
        },
      },
    };
  });
}

describe("connector registry", () => {
  test("resolves the aws connector", () => {
    const connector = getConnector("aws");
    expect(connector.key).toBe("aws");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("aws connector exposes the expected tests (spot-check key namespaces)", () => {
    const tests = listConnectorTests("aws");
    expect(tests.length).toBeGreaterThan(16);
    const keys = tests.map((t) => t.key);
    // Core namespaces always present
    expect(keys).toContain("aws.iam.mfa_enforced");
    expect(keys).toContain("aws.iam.password_policy");
    expect(keys).toContain("aws.iam.access_key_age");
    expect(keys).toContain("aws.logging.cloudtrail_enabled");
    expect(keys).toContain("aws.logging.config_enabled");
    expect(keys).toContain("aws.network.s3_public_access_blocked");
    expect(keys).toContain("aws.network.security_groups_no_open_ingress");
    expect(keys).toContain("aws.kms.key_rotation_enabled");
    expect(keys).toContain("aws.rds.storage_encrypted");
    expect(keys).toContain("aws.lambda.function_url_not_public");
    expect(keys).toContain("aws.dynamodb.encryption_uses_cmk");
  });

  test("resolves the azure connector", () => {
    const connector = getConnector("azure");
    expect(connector.key).toBe("azure");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("azure connector exposes exactly the expected tests (Phase-1 plus SQL/Key Vault/Monitor/Policy/Compute/Subscription)", () => {
    const tests = listConnectorTests("azure");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "azure.compute.disk_encryption_enabled",
      "azure.compute.no_public_ip_association",
      "azure.keyvault.purge_protection_enabled",
      "azure.keyvault.rbac_authorization_enabled",
      "azure.logging.activity_log_diagnostics_enabled",
      "azure.monitor.diagnostic_settings_cover_key_resources",
      "azure.network.nsg_no_open_ingress",
      "azure.policy.assignments_compliant",
      "azure.security.defender_enabled",
      "azure.sql.auditing_enabled",
      "azure.sql.public_network_access_disabled",
      "azure.sql.transparent_data_encryption_enabled",
      "azure.storage.public_access_blocked",
      "azure.subscription.limited_owner_assignments",
      "azure.subscription.no_classic_administrators",
    ]);
  });

  test("resolves the github connector", () => {
    const connector = getConnector("github");
    expect(connector.key).toBe("github");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("github connector exposes exactly the 9 tests", () => {
    const tests = listConnectorTests("github");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "github.org.actions_default_workflow_permissions_readonly",
      "github.org.actions_third_party_restricted",
      "github.org.default_repository_permission_restricted",
      "github.org.owners_count_minimized",
      "github.org.two_factor_required",
      "github.repo.branch_protection_required_reviews",
      "github.repo.code_scanning_default_setup_enabled",
      "github.repo.secret_scanning_enabled",
      "github.repo.vulnerability_alerts_enabled",
    ]);
  });

  test("resolves the purview connector", () => {
    const connector = getConnector("purview");
    expect(connector.key).toBe("purview");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("purview connector exposes exactly the 8 datamap + audit tests", () => {
    const tests = listConnectorTests("purview");
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "purview.audit.content_recently_available",
      "purview.audit.dlp_alerts_available",
      "purview.audit.subscriptions_active",
      "purview.audit.unified_logging_enabled",
      "purview.datamap.classification_applied",
      "purview.datamap.scan_schedule_configured",
      "purview.datamap.sensitivity_labels_applied",
      "purview.datamap.sources_scanned",
    ]);
  });

  test("resolves the zoho connector", () => {
    const connector = getConnector("zoho");
    expect(connector.key).toBe("zoho");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("zoho connector exposes exactly the 42 tier-1 tests", () => {
    const tests = listConnectorTests("zoho");
    expect(tests).toHaveLength(42);
    const keys = tests.map((t) => t.key).sort();
    // Spot-check one key per product
    expect(keys).toContain("zoho.directory.mfa_enforced");
    expect(keys).toContain("zoho.crm.audit_log_enabled");
    expect(keys).toContain("zoho.workdrive.external_sharing_restricted");
    expect(keys).toContain("zoho.analytics.public_view_link_restricted");
    expect(keys).toContain("zoho.recruit.job_posting_visibility_review");
  });

  test("resolves the entra_id connector", () => {
    const connector = getConnector("entra_id");
    expect(connector.key).toBe("entra_id");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("entra_id connector exposes exactly the 15 tests", () => {
    const tests = listConnectorTests("entra_id");
    expect(tests).toHaveLength(15);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("entra_id.mfa.conditional_access_enforced");
    expect(keys).toContain("entra_id.audit.signin_and_directory_logs_available");
    expect(keys).toContain("entra_id.appregistrations.credentials_not_expiring_soon");
    expect(keys).toContain("entra_id.groups.privileged_groups_have_owners");
    expect(keys).toContain("entra_id.users.mfa_registration_reviewed");
    expect(keys).toContain("entra_id.roles.privileged_users_mfa_registered");
    expect(keys).toContain("entra_id.roles.other_privileged_roles_reviewed");
    expect(keys).toContain("entra_id.signins.legacy_auth_signins_absent");
    expect(keys).toContain("entra_id.signins.risky_signins_resolved");
    expect(keys).toContain("entra_id.audit.privileged_role_changes_actor_captured");
  });

  test("resolves the microsoft_365 connector", () => {
    const connector = getConnector("microsoft_365");
    expect(connector.key).toBe("microsoft_365");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("microsoft_365 connector exposes exactly the 9 tests", () => {
    const tests = listConnectorTests("microsoft_365");
    expect(tests).toHaveLength(9);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_365.exchange.mailbox_audit_logging_enabled");
    expect(keys).toContain("microsoft_365.sharepoint.external_sharing_restricted");
    expect(keys).toContain("microsoft_365.sharepoint.dlp_policy_configured");
    expect(keys).toContain("microsoft_365.sharepoint.sensitivity_label_policy_enforced");
    expect(keys).toContain("microsoft_365.intune.compliance_policy_assigned_all_platforms");
    expect(keys).toContain("microsoft_365.defenderoffice.safe_links_enabled");
  });

  test("resolves the microsoft_teams connector", () => {
    const connector = getConnector("microsoft_teams");
    expect(connector.key).toBe("microsoft_teams");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("microsoft_teams connector exposes exactly the 8 tests", () => {
    const tests = listConnectorTests("microsoft_teams");
    expect(tests).toHaveLength(8);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_teams.externalaccess.federation_domains_restricted");
    expect(keys).toContain("microsoft_teams.client.unsanctioned_storage_providers_disabled");
    expect(keys).toContain("microsoft_teams.policies.meeting_anonymous_join_restricted");
  });

  test("resolves the google_workspace connector", () => {
    const connector = getConnector("google_workspace");
    expect(connector.key).toBe("google_workspace");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("google_workspace connector exposes exactly the 10 tests", () => {
    const tests = listConnectorTests("google_workspace");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "google_workspace.admin.super_admin_role_reviewed",
      "google_workspace.audit.log_retention_configured",
      "google_workspace.calendar.external_sharing_restricted",
      "google_workspace.devices.chrome_policy_compliant",
      "google_workspace.drive.external_sharing_restricted",
      "google_workspace.gmail.auto_forwarding_restricted",
      "google_workspace.groups.privileged_group_membership_reviewed",
      "google_workspace.oauth.third_party_app_risk_reviewed",
      "google_workspace.security.two_step_verification_enforced",
      "google_workspace.users.inactive_accounts_reviewed",
    ]);
  });

  test("resolves the gcp connector", () => {
    const connector = getConnector("gcp");
    expect(connector.key).toBe("gcp");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("gcp connector exposes exactly the 10 tests", () => {
    const tests = listConnectorTests("gcp");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "gcp.compute.instances_no_public_ip",
      "gcp.compute.shielded_vm_enabled",
      "gcp.iam.owner_role_assignments_limited",
      "gcp.iam.service_account_keys_rotated",
      "gcp.kms.key_rotation_enabled",
      "gcp.logging.data_access_audit_logs_enabled",
      "gcp.network.firewall_no_open_management_ports",
      "gcp.sql.public_access_disabled",
      "gcp.sql.ssl_enforced",
      "gcp.storage.buckets_not_publicly_accessible",
    ]);
  });

  test("resolves the onetrust connector", () => {
    const connector = getConnector("onetrust");
    expect(connector.key).toBe("onetrust");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("onetrust connector exposes exactly the 18 tests across 6 modules", () => {
    const tests = listConnectorTests("onetrust");
    expect(tests).toHaveLength(18);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "onetrust.assessments.dpia_process_operating",
      "onetrust.assessments.high_risks_mitigated",
      "onetrust.assessments.no_stale_in_progress",
      "onetrust.dsar.no_excessive_pause",
      "onetrust.dsar.progressing",
      "onetrust.dsar.within_statutory_deadline",
      "onetrust.incidents.breach_decision_recorded",
      "onetrust.incidents.no_stale_open",
      "onetrust.incidents.register_operating",
      "onetrust.inventory.records_have_owners",
      "onetrust.inventory.records_reviewed_annually",
      "onetrust.inventory.ropa_populated",
      "onetrust.risk.high_risks_have_treatment",
      "onetrust.risk.register_maintained",
      "onetrust.risk.treatment_not_overdue",
      "onetrust.vendors.high_risk_reviewed",
      "onetrust.vendors.inventory_populated",
      "onetrust.vendors.risk_assessed",
    ]);
  });

  test("resolves the servicenow connector", () => {
    const connector = getConnector("servicenow");
    expect(connector.key).toBe("servicenow");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("servicenow connector exposes exactly the 10 tests across its areas", () => {
    const tests = listConnectorTests("servicenow");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "servicenow.acl.default_deny_sensitive_tables",
      "servicenow.audit.field_audit_enabled",
      "servicenow.audit.login_activity_logged",
      "servicenow.group.privileged_groups_reviewed",
      "servicenow.integrationuser.web_service_only",
      "servicenow.oauth.basic_auth_restricted",
      "servicenow.password_policy.strength_enforced",
      "servicenow.role.admin_count_within_policy",
      "servicenow.user.mfa_enforced",
      "servicenow.user.no_inactive_privileged",
    ]);
  });

  test("resolves the privy connector", () => {
    const connector = getConnector("privy");
    expect(connector.key).toBe("privy");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("privy connector exposes exactly the 17 tests across 6 modules", () => {
    const tests = listConnectorTests("privy");
    expect(tests).toHaveLength(17);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "privy.assessments.dpia_process_operating",
      "privy.assessments.high_risks_mitigated",
      "privy.assessments.no_stale_in_progress",
      "privy.consent.artifacts_being_captured",
      "privy.consent.collection_points_registered",
      "privy.consent.notice_versioned",
      "privy.consent.withdrawal_supported",
      "privy.incidents.breach_decision_recorded",
      "privy.incidents.no_stale_open",
      "privy.incidents.register_operating",
      "privy.inventory.records_have_owners",
      "privy.inventory.ropa_populated",
      "privy.rights.progressing",
      "privy.rights.register_operating",
      "privy.rights.within_statutory_deadline",
      "privy.tprm.high_risk_reviewed",
      "privy.tprm.processors_risk_assessed",
    ]);
  });

  test("resolves the crowdstrike connector", () => {
    const connector = getConnector("crowdstrike");
    expect(connector.key).toBe("crowdstrike");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("crowdstrike connector exposes exactly the 8 tests across its areas", () => {
    const tests = listConnectorTests("crowdstrike");
    expect(tests).toHaveLength(8);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "crowdstrike.detection.high_severity_backlog",
      "crowdstrike.detection.no_unresolved_incidents",
      "crowdstrike.host.stale_endpoints_reviewed",
      "crowdstrike.host.unmanaged_reduced_functionality",
      "crowdstrike.sensor.build_currency",
      "crowdstrike.sensor.policy_compliance",
      "crowdstrike.user.admin_role_review",
      "crowdstrike.vulnerability.critical_exposure_review",
    ]);
  });

  test("resolves the salesforce connector", () => {
    const connector = getConnector("salesforce");
    expect(connector.key).toBe("salesforce");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("salesforce connector exposes exactly the 10 tests across its areas", () => {
    const tests = listConnectorTests("salesforce");
    expect(tests).toHaveLength(10);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "salesforce.audit.login_history_available",
      "salesforce.audit.setup_audit_trail_retention",
      "salesforce.connected_app.admin_approval_required",
      "salesforce.connected_app.oauth_scopes_minimal",
      "salesforce.network.trusted_ip_ranges_configured",
      "salesforce.permissionset.sensitive_permissions_reviewed",
      "salesforce.profile.least_privilege_admin_count",
      "salesforce.profile.password_policy_strength",
      "salesforce.user.mfa_enforced",
      "salesforce.user.no_inactive_high_privilege",
    ]);
  });

  test("resolves the acronis connector", () => {
    const connector = getConnector("acronis");
    expect(connector.key).toBe("acronis");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("acronis connector exposes exactly the 7 tests across its areas", () => {
    const tests = listConnectorTests("acronis");
    expect(tests).toHaveLength(7);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "acronis.backup.protection_enabled",
      "acronis.backup.recent_successful_backup",
      "acronis.malware.no_open_detections",
      "acronis.malware.scan_up_to_date",
      "acronis.monitoring.no_open_critical_alerts",
      "acronis.vulnerability.no_open_findings",
      "acronis.vulnerability.patches_applied",
    ]);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["backup", "malware", "monitoring", "vulnerability"]);
  });

  test("resolves the commvault connector", () => {
    const connector = getConnector("commvault");
    expect(connector.key).toBe("commvault");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("commvault connector exposes exactly the 4 Tier-1 tests across its areas", () => {
    const tests = listConnectorTests("commvault");
    expect(tests).toHaveLength(4);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "commvault.backup.sla_compliance",
      "commvault.monitoring.alerts_configured",
      "commvault.storage.encryption_enabled",
      "commvault.storage.worm_lock_enabled",
    ]);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["backup", "monitoring", "storage"]);
  });

  test("resolves the akamai connector", () => {
    const connector = getConnector("akamai");
    expect(connector.key).toBe("akamai");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("akamai connector is registered and its manifest matches its 18 JS tests", () => {
    const keys = listConnectorKeys();
    expect(keys).toContain("akamai");
    const tests = listConnectorTests("akamai");
    expect(tests).toHaveLength(18);
    const jsKeys = new Set(tests.map((t) => t.key));
    expect(jsKeys.size).toBe(18);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["api", "appsec", "cps", "property", "siem"]);
  });

  test("resolves the carbonite connector", () => {
    const connector = getConnector("carbonite");
    expect(connector.key).toBe("carbonite");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("carbonite connector exposes exactly its 2 beta backup checks", () => {
    const tests = listConnectorTests("carbonite");
    expect(tests).toHaveLength(2);
    expect(tests.map((t) => t.key).sort()).toEqual([
      "carbonite.backup.device_coverage",
      "carbonite.backup.recent_successful_backup",
    ]);
  });

  test("resolves the carbonite-server connector", () => {
    const connector = getConnector("carbonite-server");
    expect(connector.key).toBe("carbonite-server");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("carbonite-server connector exposes exactly its 2 beta tests across backup / monitoring", () => {
    const tests = listConnectorTests("carbonite-server");
    expect(tests).toHaveLength(2);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toEqual([
      "carbonite-server.backup.recent_successful_safeset",
      "carbonite-server.monitoring.agent_online",
    ]);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["backup", "monitoring"]);
  });

  test("resolves the check_point_mgmt connector with its 11 policy / gateway / threat checks", () => {
    const connector = getConnector("check_point_mgmt");
    expect(connector.key).toBe("check_point_mgmt");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
    const tests = listConnectorTests("check_point_mgmt");
    expect(tests.map((t) => t.key).sort()).toEqual([
      "check_point_mgmt.gateway.policy_installed_current",
      "check_point_mgmt.gateway.software_supported",
      "check_point_mgmt.policy.cleanup_rule_present",
      "check_point_mgmt.policy.disabled_rules_reviewed",
      "check_point_mgmt.policy.no_permissive_any_rule",
      "check_point_mgmt.policy.rule_logging_enabled",
      "check_point_mgmt.policy.stealth_rule_present",
      "check_point_mgmt.threat.ips_signatures_current",
      "check_point_mgmt.threat.mode_is_prevent",
      "check_point_mgmt.threat.no_blanket_exceptions",
      "check_point_mgmt.threat.profile_assigned",
    ]);
    expect([...new Set(tests.map((t) => t.key.split(".")[1]))].sort()).toEqual(["gateway", "policy", "threat"]);
  });

  test("resolves the check_point connector with its 10 events / xdr / endpoint checks", () => {
    const connector = getConnector("check_point");
    expect(connector.key).toBe("check_point");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
    const tests = listConnectorTests("check_point");
    expect(tests.map((t) => t.key).sort()).toEqual([
      "check_point.endpoint.devices_checked_in",
      "check_point.endpoint.high_incidents_resolved",
      "check_point.endpoint.protection_blades_active",
      "check_point.endpoint.signatures_current",
      "check_point.events.critical_events_reviewed",
      "check_point.events.feed_active",
      "check_point.events.query_retrievable",
      "check_point.xdr.feed_active",
      "check_point.xdr.high_incidents_triaged",
      "check_point.xdr.no_stale_investigations",
    ]);
    expect([...new Set(tests.map((t) => t.key.split(".")[1]))].sort()).toEqual(["endpoint", "events", "xdr"]);
  });

  test("resolves the check_point_cloudguard connector with its 6 posture checks", () => {
    const connector = getConnector("check_point_cloudguard");
    expect(connector.key).toBe("check_point_cloudguard");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
    const tests = listConnectorTests("check_point_cloudguard");
    expect(tests.map((t) => t.key).sort()).toEqual([
      "check_point_cloudguard.posture.accounts_fetching",
      "check_point_cloudguard.posture.assessment_recent",
      "check_point_cloudguard.posture.critical_findings_addressed",
      "check_point_cloudguard.posture.exclusions_reviewed",
      "check_point_cloudguard.posture.high_findings_within_policy",
      "check_point_cloudguard.posture.ruleset_assigned",
    ]);
  });

  test("resolves the microsoft_defender connector", () => {
    const connector = getConnector("microsoft_defender");
    expect(connector.key).toBe("microsoft_defender");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
  });

  test("resolves the sophos connector with all 39 planned checks", () => {
    const connector = getConnector("sophos");
    expect(connector.key).toBe("sophos");
    expect(typeof connector.testConnection).toBe("function");
    expect(typeof connector.runTests).toBe("function");
    const sophosTests = listConnectorTests("sophos");
    expect(sophosTests).toHaveLength(39);
    expect([...new Set(sophosTests.map((definition) => definition.key.split(".")[1]))].sort()).toEqual([
      "audit", "common", "detections", "dns", "endpoint", "firewall", "siem", "web", "xdr",
    ]);
  });

  test("microsoft_defender connector exposes exactly the 7 tests", () => {
    const tests = listConnectorTests("microsoft_defender");
    expect(tests).toHaveLength(7);
    const keys = tests.map((t) => t.key).sort();
    expect(keys).toContain("microsoft_defender.devices.onboarding_coverage_complete");
    expect(keys).toContain("microsoft_defender.vulnerabilities.critical_cves_remediated");
    expect(keys).toContain("microsoft_defender.alerts.high_severity_triaged_promptly");
  });

  // Findings are only ever created from a failing test result (see
  // collectionRunner.js's upsertFinding), so a check's positive `title` (e.g.
  // "MFA is enabled") reads backwards once it becomes a finding. Every check,
  // across every connector, must carry a distinct `failTitle` describing the
  // actual violation so the Findings list reads correctly.
  test("every connector's checks define a failTitle distinct from their (positive) title", () => {
    for (const connectorKey of listConnectorKeys()) {
      for (const definition of listConnectorTests(connectorKey)) {
        expect(definition.failTitle, `${connectorKey}/${definition.key} is missing a failTitle`).toBeTruthy();
        expect(definition.failTitle, `${connectorKey}/${definition.key}'s failTitle matches its title`).not.toBe(definition.title);
      }
    }
  });

  test("throws for an unknown integration", () => {
    expect(() => getConnector("digitalocean")).toThrow("Unknown integration: digitalocean");
  });

  // Guardrail: purview_compliance is a catalog-only placeholder (no connector
  // module exists for it) — assert it stays unresolvable so nobody
  // accidentally wires it up as if it were a real, testable connector.
  test("throws for purview_compliance (catalog-only placeholder, no connector module)", () => {
    expect(() => getConnector("purview_compliance")).toThrow("Unknown integration: purview_compliance");
  });
});

describe("connector manifest validation (connector.json vs. JS tests)", () => {
  afterEach(() => {
    vi.doUnmock("fs");
    vi.resetModules();
  });

  test("loads cleanly when every connector's manifest matches its JS tests", async () => {
    vi.resetModules();
    await expect(import(REGISTRY_PATH)).resolves.toBeDefined();
  });

  test("throws when a manifest is missing a test key present in the JS tests array", async () => {
    vi.resetModules();
    mockManifestFor("azure", (manifest) => {
      manifest.tests = manifest.tests.filter((t) => t.testKey !== "azure.security.defender_enabled");
    });

    await expect(import(REGISTRY_PATH)).rejects.toThrow(/azure.*azure\.security\.defender_enabled/s);
  });

  test("throws when a manifest has an extra test key not present in the JS tests array", async () => {
    vi.resetModules();
    mockManifestFor("github", (manifest) => {
      manifest.tests.push({
        testKey: "github.repo.nonexistent_check",
        title: "Bogus test not defined in JS",
        severityDefault: "low",
        isoReferences: [],
      });
    });

    await expect(import(REGISTRY_PATH)).rejects.toThrow(/github.*github\.repo\.nonexistent_check/s);
  });
});
