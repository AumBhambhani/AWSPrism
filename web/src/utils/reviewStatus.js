// Review-status helpers.
//
// A control is "approved" — it counts as complete for the compliance score,
// carry-forward, evidence locking and every "done" badge — once a reviewer
// (ADMIN/LEAD) marks it FINISHED.
//
// AUDITED = FINISHED plus an auditor's independent sign-off. It is a strict
// progression from FINISHED (an auditor can only audit something already
// FINISHED) and behaves identically to FINISHED everywhere "done" is what
// matters. The only place the two differ is display: an AUDITED control shows
// an extra "Audited" state so the team can see auditor sign-off at a glance.
export const APPROVED_REVIEW_STATUSES = ["FINISHED", "AUDITED"];

export function isApprovedStatus(status) {
  return status === "FINISHED" || status === "AUDITED";
}

export function assessmentApproved(a) {
  if (!a) return false;
  return isApprovedStatus(a.reviewStatus || a.review_status);
}

export function isAuditedStatus(status) {
  return status === "AUDITED";
}
