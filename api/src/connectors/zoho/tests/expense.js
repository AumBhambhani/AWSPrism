import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://expense.zoho.{dc}/api/v1/approvals — check self-approval is blocked
async function checkApprovalPolicyEnforced(clients) {
  const data = await clients.expense.get("/api/v1/approvals");
  const policy = data?.approval_policy || data?.policy || data;
  const selfApprovalBlocked =
    policy?.allowSelfApproval === false ||
    policy?.self_approval === "disabled" ||
    policy?.block_self_approval === true;
  return [
    {
      resourceId: clients.orgId,
      status: selfApprovalBlocked ? "pass" : "fail",
      message: selfApprovalBlocked
        ? "Expense approval policy requires a separate approver (no self-approval)"
        : "Expense approval policy may allow self-approval — verify approval workflow configuration",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_expense_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { selfApprovalBlocked, approvalPolicy: policy?.type || policy?.mode || null },
      }),
    },
  ];
}

// GET https://expense.zoho.{dc}/api/v1/settings — check data retention
async function checkReceiptDataRetention(clients) {
  const data = await clients.expense.get("/api/v1/settings");
  const settings = data?.settings || data;
  const autoDeleteEnabled = settings?.auto_delete_data === true || settings?.autoDeleteReceipts === true;
  const retentionDays = settings?.data_retention_days || settings?.retentionDays || settings?.receipt_retention_days || 0;
  const compliant = !autoDeleteEnabled || retentionDays >= 2555;
  return [
    {
      resourceId: clients.orgId,
      status: compliant ? "pass" : "fail",
      message: compliant
        ? "Expense receipt data retention policy meets financial/evidence retention requirements"
        : `Expense records or receipts may be auto-deleted after ${retentionDays} days — verify this meets the required retention period`,
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_expense_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { autoDeleteEnabled, retentionDays },
      }),
    },
  ];
}

// GET https://expense.zoho.{dc}/api/v1/settings — check card data masking
async function checkCardDataMasking(clients) {
  const data = await clients.expense.get("/api/v1/settings");
  const settings = data?.settings || data;
  const masked =
    settings?.maskCardNumbers === true ||
    settings?.card_number_masking === true ||
    settings?.show_full_card_number === false;
  return [
    {
      resourceId: clients.orgId,
      status: masked ? "pass" : "fail",
      message: masked
        ? "Corporate card numbers are masked — only last-4 digits displayed in reports and exports"
        : "Corporate card numbers may not be fully masked — verify card feed integration masking settings",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_expense_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { cardNumbersMasked: masked },
      }),
    },
  ];
}

export const expenseTests = [
  {
    key: "zoho.expense.approval_policy_enforced",
    title: "Expense approval requires a separate approver",
    failTitle: "Expense approval policy may allow self-approval",
    severityDefault: "medium",
    isoReferences: ["A.6.1.2"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkApprovalPolicyEnforced(clients),
  },
  {
    key: "zoho.expense.receipt_data_retention",
    title: "Receipt/expense data retention meets policy",
    failTitle: "Expense records or receipts may be auto-deleted before the required retention period",
    severityDefault: "medium",
    isoReferences: ["A.18.1.3"],
    dpdpaControlAreas: ["Retention Schedule"],
    run: (clients) => checkReceiptDataRetention(clients),
  },
  {
    key: "zoho.expense.card_data_masking",
    title: "Corporate card numbers are masked",
    failTitle: "Corporate card numbers may not be fully masked",
    severityDefault: "high",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkCardDataMasking(clients),
  },
];
