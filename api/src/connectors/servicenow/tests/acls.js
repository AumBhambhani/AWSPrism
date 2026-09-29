import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function isTrue(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// Sensitive tables (sys_user, sys_user_has_role, sys_security_acl) must have
// explicit, role-restricted read/write ACL rules — not an open rule that grants
// the operation with no role and no script. ServiceNow's default is deny, but a
// misconfigured "public" ACL (active, roles empty, no condition/script) on one
// of these tables effectively opens it.
async function checkDefaultDenySensitiveTables(clients) {
  const acls = await clients.listSensitiveAcls();
  const sensitive = clients.SENSITIVE_TABLES;

  if (acls.length === 0) {
    // No explicit ACL rows for these tables. Out-of-box ServiceNow ships table
    // ACLs, so "none returned" most likely means the integration user can't
    // read sys_security_acl rather than that the tables are wide open.
    return [
      {
        resourceId: "sensitive-acls",
        status: "not_applicable",
        message: "No ACL rules for the sensitive tables were returned — the integration user likely cannot read sys_security_acl",
        evidencePayload: buildEvidencePayload({
          resourceType: "servicenow_acl",
          resourceId: "sensitive-acls",
          resourceName: "Sensitive-table ACLs",
          region: null,
          details: { tables: sensitive },
        }),
      },
    ];
  }

  const byTable = new Map(sensitive.map((t) => [t, []]));
  for (const a of acls) {
    const table = String(clients.displayOf(a.name) ?? "");
    if (byTable.has(table)) byTable.get(table).push(a);
  }

  const rows = [];
  for (const table of sensitive) {
    const tableAcls = byTable.get(table) || [];
    const active = tableAcls.filter((a) => isTrue(clients.displayOf(a.active) ?? clients.valueOf(a.active) ?? "true"));

    if (active.length === 0) {
      rows.push({
        resourceId: table,
        status: "fail",
        message: `Table "${table}" has no active ACL rule of its own — access falls back to a parent/wildcard rule`,
        evidencePayload: buildEvidencePayload({
          resourceType: "servicenow_acl",
          resourceId: table,
          resourceName: `${table} ACLs`,
          region: null,
          details: { activeRules: 0, totalRules: tableAcls.length },
        }),
      });
      continue;
    }

    // An "open" rule: active, read/write operation, no roles, no script, no
    // condition — grants the operation to everyone.
    const openRules = active.filter((a) => {
      const op = String(clients.displayOf(a.operation) ?? "").toLowerCase();
      if (!["read", "write", "create", "delete", "*"].includes(op)) return false;
      const roles = String(clients.displayOf(a.roles) ?? "").trim();
      const script = String(clients.displayOf(a.script) ?? clients.valueOf(a.script) ?? "").trim();
      const condition = String(clients.displayOf(a.condition) ?? clients.valueOf(a.condition) ?? "").trim();
      return roles === "" && script === "" && condition === "";
    });

    if (openRules.length > 0) {
      rows.push({
        resourceId: table,
        status: "fail",
        message: `Table "${table}" has ${openRules.length} active ACL rule(s) that grant an operation with no role, script or condition`,
        evidencePayload: buildEvidencePayload({
          resourceType: "servicenow_acl",
          resourceId: table,
          resourceName: `${table} ACLs`,
          region: null,
          details: {
            openRules: openRules.map((a) => ({
              operation: clients.displayOf(a.operation),
              adminOverrides: isTrue(clients.displayOf(a.admin_overrides)),
            })),
          },
        }),
      });
    }
  }

  if (rows.length === 0) {
    return [
      {
        resourceId: "sensitive-acls",
        status: "pass",
        message: `All ${sensitive.length} sensitive table(s) have explicit role/script-restricted ACL rules`,
        evidencePayload: buildEvidencePayload({
          resourceType: "servicenow_acl",
          resourceId: "sensitive-acls",
          resourceName: "Sensitive-table ACLs",
          region: null,
          details: { tables: sensitive, aclRulesReviewed: acls.length },
        }),
      },
    ];
  }
  return rows;
}

export const aclTests = [
  {
    key: "servicenow.acl.default_deny_sensitive_tables",
    title: "Sensitive tables have explicit (non-public) ACLs defined",
    failTitle: "A sensitive table has a missing or open (public) ACL rule",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkDefaultDenySensitiveTables(clients),
  },
];
