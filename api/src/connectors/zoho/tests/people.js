import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://people.zoho.{dc}/people/api/forms — check form/module permissions
async function checkDataAccessReview(clients) {
  const data = await clients.people.get("/people/api/forms");
  const forms = data?.response?.result || data?.forms || [];
  // Flag any form where viewPermission allows "all" rather than role-based
  const openForms = forms.filter(
    (f) => f.viewPermission === "all" || f.accessPermission === "all" || f.permission === "all_employees"
  );
  const results = openForms.map((f) => ({
    resourceId: String(f.formLinkName || f.id),
    status: "fail",
    message: `People form "${f.displayName || f.formLinkName}" allows access to all employees rather than HR-admin roles only`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_people_form",
      resourceId: String(f.formLinkName || f.id),
      resourceName: f.displayName || f.formLinkName || String(f.id),
      region: null,
      details: { formName: f.displayName, viewPermission: f.viewPermission || f.accessPermission },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All People forms restrict access to designated HR-admin roles",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_people_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { formsChecked: forms.length },
      }),
    });
  }
  return results;
}

// GET https://people.zoho.{dc}/people/api/forms — check field-level permissions on sensitive forms
async function checkSensitiveFieldEncryption(clients) {
  const data = await clients.people.get("/people/api/forms");
  const forms = data?.response?.result || data?.forms || [];
  // Check for forms that likely contain sensitive data (employment, bank, documents)
  const sensitiveFormNames = ["employment", "bank", "salary", "documents", "payslip"];
  const sensitiveForms = forms.filter((f) => {
    const name = (f.formLinkName || f.displayName || "").toLowerCase();
    return sensitiveFormNames.some((s) => name.includes(s));
  });
  if (sensitiveForms.length === 0) {
    return [
      {
        resourceId: clients.orgId,
        status: "not_applicable",
        message: "No sensitive HR forms (employment, bank, salary, documents) found to check",
        evidencePayload: buildEvidencePayload({
          resourceType: "zoho_people_org",
          resourceId: clients.orgId,
          resourceName: `Org ${clients.orgId}`,
          region: null,
          details: { formsChecked: forms.length },
        }),
      },
    ];
  }
  // Flag forms where sensitive fields lack field-level permissions
  const unrestrictedForms = sensitiveForms.filter(
    (f) => f.fieldPermission !== "role_based" && f.hasFieldPermissions !== true
  );
  const results = unrestrictedForms.map((f) => ({
    resourceId: String(f.formLinkName || f.id),
    status: "fail",
    message: `Sensitive People form "${f.displayName || f.formLinkName}" does not have field-level role-based permissions`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_people_form",
      resourceId: String(f.formLinkName || f.id),
      resourceName: f.displayName || f.formLinkName || String(f.id),
      region: null,
      details: { formName: f.displayName, hasFieldPermissions: f.hasFieldPermissions ?? false },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "Sensitive HR form fields have field-level role-based permissions configured",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_people_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { sensitiveFormsChecked: sensitiveForms.length },
      }),
    });
  }
  return results;
}

// GET https://people.zoho.{dc}/people/api/roles
async function checkAdminRoleReview(clients) {
  const data = await clients.people.get("/people/api/roles");
  const roles = data?.response?.result || data?.roles || [];
  const adminRole = roles.find((r) => r.roleName === "Admin" || r.name === "Admin" || r.is_admin === true);
  if (!adminRole) {
    return [
      {
        resourceId: clients.orgId,
        status: "pass",
        message: "No Admin role found or role data not available for review",
        evidencePayload: buildEvidencePayload({
          resourceType: "zoho_people_org",
          resourceId: clients.orgId,
          resourceName: `Org ${clients.orgId}`,
          region: null,
          details: { rolesChecked: roles.length },
        }),
      },
    ];
  }
  const adminCount = adminRole.userCount || adminRole.user_count || 0;
  return [
    {
      resourceId: clients.orgId,
      status: adminCount <= 3 ? "pass" : "fail",
      message:
        adminCount <= 3
          ? `People Admin role is assigned to ${adminCount} user(s) — within acceptable limits`
          : `People Admin role is assigned to ${adminCount} users — consider reducing to designated HR/IT admins only`,
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_people_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { adminUserCount: adminCount },
      }),
    },
  ];
}

export const peopleTests = [
  {
    key: "zoho.people.data_access_review",
    title: "Employee data access is restricted by role",
    failTitle: "People form allows access to all employees rather than HR-admin roles only",
    severityDefault: "high",
    isoReferences: ["A.9.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkDataAccessReview(clients),
  },
  {
    key: "zoho.people.sensitive_field_encryption",
    title: "Sensitive HR fields are access-restricted",
    failTitle: "Sensitive People form does not have field-level role-based permissions",
    severityDefault: "high",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkSensitiveFieldEncryption(clients),
  },
  {
    key: "zoho.people.admin_role_review",
    title: "Admin role assignment is minimized",
    failTitle: "People Admin role is assigned to more users than acceptable",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkAdminRoleReview(clients),
  },
];
