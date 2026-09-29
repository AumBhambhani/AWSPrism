import { query } from "../db/index.js";
import { sendEmail } from "./email.js";
import { buildEmailHtml } from "./emailTemplate.js";

const MANAGERS = ["ADMIN", "LEAD"];

export class FulfilError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
    this.body = { error };
  }
}

// Permission/state checks for attaching evidence to a request. Shared by the fulfil
// route and by uploads that will fulfil a request once a quarantined file clears.
export async function loadFulfillableRequest({ companyId, requestId, actor }) {
  const erResult = await query(
    "SELECT id, requester_id, assignee_id, status, question_id, fulfilled_evidence_id, title FROM evidence_requests WHERE id = $1 AND company_id = $2",
    [requestId, companyId]
  );
  if (erResult.rows.length === 0) throw new FulfilError(404, "Request not found");
  const er = erResult.rows[0];

  // Permission: only assignee, ADMIN, or LEAD can fulfill
  if (actor.role === "CONTRIBUTOR" && er.assignee_id !== actor.userId) {
    throw new FulfilError(403, "Only the assigned user can fulfil this request");
  }
  if (!["ADMIN", "LEAD", "CONTRIBUTOR"].includes(actor.role)) throw new FulfilError(403, "Forbidden");
  if (["Completed", "Cancelled"].includes(er.status)) {
    throw new FulfilError(409, `Cannot fulfil a ${er.status} request`);
  }
  if (er.fulfilled_evidence_id) {
    throw new FulfilError(409, "Evidence already attached. Remove it first or update the request.");
  }
  return er;
}

export async function fulfilEvidenceRequest({ companyId, requestId, vaultId, actor }) {
  const er = await loadFulfillableRequest({ companyId, requestId, actor });

  // Validate vault item belongs to this company
  const vaultResult = await query("SELECT id, title FROM evidence_vault WHERE id = $1 AND company_id = $2", [vaultId, companyId]);
  if (vaultResult.rows.length === 0) throw new FulfilError(404, "Vault item not found");

  // Determine new status
  const newStatus = MANAGERS.includes(actor.role) ? "Completed" : "Submitted";
  const setClauses = newStatus === "Completed"
    ? "fulfilled_evidence_id = $3, status = $4, completed_at = NOW(), updated_at = NOW()"
    : "fulfilled_evidence_id = $3, status = $4, updated_at = NOW()";

  await query(
    `UPDATE evidence_requests SET ${setClauses} WHERE id = $1 AND company_id = $2`,
    [requestId, companyId, vaultId, newStatus]
  );

  // Auto-link vault item to the question if request has a question_id
  if (er.question_id) {
    await query(
      `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
      [companyId, er.question_id, vaultId, actor.email || null]
    );
  }

  // Notify requester
  if (er.requester_id !== actor.userId) {
    const requesterResult = await query("SELECT email, COALESCE(full_name, email) AS name FROM users WHERE id = $1 AND company_id = $2", [er.requester_id, companyId]);
    if (requesterResult.rows[0]) {
      const { email, name } = requesterResult.rows[0];
      const fulfillByResult = await query("SELECT COALESCE(full_name, email) AS name FROM users WHERE id = $1", [actor.userId]);
      const fulfillerName = fulfillByResult.rows[0]?.name || "A user";
      sendEmail({
        to: email,
        subject: `Evidence Request fulfilled — ${er.title}`,
        text: `Hi ${name},\n\n${fulfillerName} has submitted evidence for your request "${er.title}" in PRISM.\n\nStatus: ${newStatus}\n\nPlease log in to PRISM to review the submitted evidence.`,
        html: buildEmailHtml({
          heading: "Evidence Request Fulfilled",
          preheader: `${fulfillerName} submitted evidence for: ${er.title}`,
          body: `Hi ${name}, ${fulfillerName} has submitted evidence for your request in PRISM. Please review the submitted evidence below.`,
          details: [
            { label: "Request", value: er.title },
            { label: "Fulfilled by", value: fulfillerName },
            { label: "Status", value: newStatus, isStatus: true },
          ],
          cta: { text: "Review Evidence in PRISM", url: process.env.WEB_URL || "https://prismgrc.co" },
        }),
      }).catch(() => {});
    }
  }
  return { status: newStatus };
}
