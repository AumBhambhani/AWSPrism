import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://desk.zoho.{dc}/api/v1/profiles — check agent profiles
async function checkAgentRoleAudit(clients) {
  const data = await clients.desk.get("/api/v1/profiles");
  const profiles = data?.data || data?.profiles || [];
  const adminProfiles = profiles.filter(
    (p) => p.name?.toLowerCase() === "administrator" || p.isDefault === false && p.permissions?.includes("ADMIN")
  );
  // Check agents assigned administrator profile
  const agentResults = [];
  for (const profile of adminProfiles) {
    const agentsData = await clients.desk.get(`/api/v1/agents?profileId=${profile.id}`);
    const agents = agentsData?.data || agentsData?.agents || [];
    for (const agent of agents) {
      agentResults.push({
        resourceId: String(agent.id),
        status: "fail",
        message: `Desk agent ${agent.emailId || agent.id} is assigned the Administrator profile without documented justification`,
        evidencePayload: buildEvidencePayload({
          resourceType: "zoho_desk_agent",
          resourceId: String(agent.id),
          resourceName: agent.emailId || String(agent.id),
          region: null,
          details: { email: agent.emailId, profileName: profile.name },
        }),
      });
    }
  }
  if (agentResults.length === 0) {
    agentResults.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No agents found with unrestricted Administrator profile assignment",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_desk_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { profilesChecked: profiles.length },
      }),
    });
  }
  return agentResults;
}

// GET https://desk.zoho.{dc}/api/v1/fields — check field-level permissions
async function checkCustomerDataFieldRestricted(clients) {
  const data = await clients.desk.get("/api/v1/tickets/fields");
  const fields = data?.data || data?.fields || [];
  // Flag sensitive fields without profile restrictions
  const sensitiveFieldNames = ["government_id", "payment", "credit_card", "ssn", "tax_id", "account_number"];
  const sensitiveFields = fields.filter((f) => {
    const name = (f.apiName || f.label || "").toLowerCase();
    return sensitiveFieldNames.some((s) => name.includes(s));
  });
  if (sensitiveFields.length === 0) {
    return [
      {
        resourceId: clients.orgId,
        status: "not_applicable",
        message: "No obviously sensitive PII fields found in Desk ticket fields",
        evidencePayload: buildEvidencePayload({
          resourceType: "zoho_desk_org",
          resourceId: clients.orgId,
          resourceName: `Org ${clients.orgId}`,
          region: null,
          details: { fieldsChecked: fields.length },
        }),
      },
    ];
  }
  const unrestrictedFields = sensitiveFields.filter((f) => !f.profileRestricted && !f.isProfileRestricted);
  const results = unrestrictedFields.map((f) => ({
    resourceId: String(f.id || f.apiName),
    status: "fail",
    message: `Desk field "${f.label || f.apiName}" containing customer PII is not profile-restricted`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_desk_field",
      resourceId: String(f.id || f.apiName),
      resourceName: f.label || f.apiName || String(f.id),
      region: null,
      details: { fieldName: f.apiName, label: f.label, isProfileRestricted: f.profileRestricted ?? false },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All sensitive Desk customer PII fields are profile-restricted",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_desk_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { sensitiveFieldsChecked: sensitiveFields.length },
      }),
    });
  }
  return results;
}

// GET https://desk.zoho.{dc}/api/v1/departments — check ticket access control
async function checkTicketAccessControlEnabled(clients) {
  const data = await clients.desk.get("/api/v1/departments?isEnabled=true");
  const departments = data?.data || data?.departments || [];
  // If departments exist and tickets are scoped to them, access control is active
  const enabled = departments.length > 0;
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `Desk ticket access control is active with ${departments.length} department(s) scoping ticket visibility`
        : "Desk has no active departments — tickets may be visible org-wide to every agent",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_desk_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { activeDepartmentCount: departments.length },
      }),
    },
  ];
}

export const deskTests = [
  {
    key: "zoho.desk.agent_role_audit",
    title: "Agent roles follow least privilege",
    failTitle: "Desk agent is assigned the Administrator profile without documented justification",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkAgentRoleAudit(clients),
  },
  {
    key: "zoho.desk.customer_data_field_restricted",
    title: "Customer PII fields are profile-restricted",
    failTitle: "Desk field containing customer PII is not profile-restricted",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkCustomerDataFieldRestricted(clients),
  },
  {
    key: "zoho.desk.ticket_access_control_enabled",
    title: "Ticket access control (team/department scoping) is enabled",
    failTitle: "Desk has no active departments — tickets may be visible org-wide to every agent",
    severityDefault: "medium",
    isoReferences: ["A.9.1.2"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkTicketAccessControlEnabled(clients),
  },
];
