import { query } from "../db/index.js";
import { sendEmail } from "./email.js";
import { buildEmailHtml } from "./emailTemplate.js";
import { writeAuditLog } from "./auditLog.js";
import { runCollection } from "../utils/collectionRunner.js";
import { resumeInterruptedAnalysis } from "./evidenceAnalysis.js";
import { processQuarantine } from "./uploadQuarantine.js";
import { archiveRetiredQuestions } from "./retireQuestion.js";

// ─── Recurrence helpers ───────────────────────────────────────────────────────

const INTERVAL_MAP = {
  weekly:        7,
  fortnightly:  14,
  monthly:      30,
  quarterly:    90,
  "semi-annual": 180,
  annual:       365
};

function advanceDate(date, interval) {
  const days = INTERVAL_MAP[interval];
  if (!days) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// ─── Deactivate expired auditors ──────────────────────────────────────────────

async function deactivateExpiredAuditors() {
  try {
    const result = await query(
      `UPDATE auditor_profiles
       SET active = FALSE, updated_at = NOW()
       WHERE active = TRUE AND expiry_date < CURRENT_DATE
       RETURNING user_id, company_id`
    );

    if (result.rowCount > 0) {
      for (const row of result.rows) {
        await writeAuditLog({
          userId:    row.user_id,
          companyId: row.company_id,
          action:    "AUDITOR_EXPIRED",
          resource:  "auditor_profiles",
          detail:    { userId: row.user_id }
        });
      }
      console.log(`[scheduler] deactivated ${result.rowCount} expired auditor(s)`);
    }
  } catch (e) {
    console.error("[scheduler] deactivateExpiredAuditors failed:", e.message);
  }
}

// ─── Process reminders table (datetime-based) ─────────────────────────────────

async function processReminders() {
  try {
    const result = await query(`
      SELECT r.*, c.name AS company_name, c.admin_email
      FROM reminders r
      JOIN companies c ON c.id = r.company_id
      WHERE r.sent = FALSE
        AND r.remind_at <= NOW()
      ORDER BY r.remind_at ASC
      LIMIT 100
    `);

    for (const reminder of result.rows) {
      const recipient = reminder.recipient_email || reminder.admin_email;
      if (!recipient) continue;

      const subject = reminder.message
        ? `Reminder: ${reminder.message.substring(0, 60)}`
        : `Compliance reminder for ${reminder.quest_id || "action #" + reminder.action_id}`;

      const detailRows = [
        { label: "Company", value: reminder.company_name },
        reminder.quest_id  ? { label: "Question",  value: reminder.quest_id }                                                          : null,
        reminder.action_id ? { label: "Action ID", value: String(reminder.action_id) }                                                  : null,
        { label: "Type",      value: reminder.reminder_type },
        { label: "Scheduled", value: new Date(reminder.remind_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" },
      ].filter(Boolean);

      const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");

      const text = [
        `Company: ${reminder.company_name}`,
        reminder.quest_id ? `Question: ${reminder.quest_id}` : null,
        reminder.action_id ? `Action ID: ${reminder.action_id}` : null,
        reminder.message ? `\nDetails: ${reminder.message}` : null,
        "",
        `Reminder type: ${reminder.reminder_type}`,
        `Scheduled for: ${new Date(reminder.remind_at).toISOString().slice(0, 16).replace("T", " ")}`,
        "",
        "Please review and take action in PRISM."
      ].filter(Boolean).join("\n");

      const html = buildEmailHtml({
        heading: "Compliance Reminder",
        preheader: reminder.message || `Compliance reminder for ${reminder.quest_id || "action #" + reminder.action_id}`,
        body: reminder.message || "You have a scheduled compliance reminder that requires your attention.",
        details: detailRows,
        cta: { text: "Open PRISM", url: webUrl },
      });

      try {
        await sendEmail({ to: recipient, subject, text, html });
      } catch (emailErr) {
        console.error(`[scheduler] failed to send reminder ${reminder.id}:`, emailErr.message); // nosemgrep
        continue;
      }

      await query(
        "UPDATE reminders SET sent = TRUE, sent_at = NOW(), updated_at = NOW() WHERE id = $1",
        [reminder.id]
      );
    }

    if (result.rowCount > 0) {
      console.log(`[scheduler] processed ${result.rowCount} reminder(s)`);
    }
  } catch (e) {
    console.error("[scheduler] processReminders failed:", e.message);
  }
}

// ─── Legacy action reminders (offset-based, for backward compatibility) ───────

async function ensureActionReminderColumns() {
  await query("ALTER TABLE actions ADD COLUMN IF NOT EXISTS reminder_sent_offsets INT[] NOT NULL DEFAULT '{}'");
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function sendActionReminders() {
  try {
    await ensureActionReminderColumns();

    const result = await query(`
      SELECT
        a.id,
        a.company_id,
        a.quest_id,
        a.defeated_quest,
        a.owner,
        a.due_date,
        a.status,
        a.notes,
        a.reminder_sent_offsets,
        c.name AS company_name,
        c.admin_email,
        CASE
          WHEN a.due_date::date < CURRENT_DATE THEN 0
          ELSE (a.due_date::date - CURRENT_DATE)
        END AS reminder_offset
      FROM actions a
      JOIN companies c ON c.id = a.company_id
      WHERE a.due_date IS NOT NULL
        AND COALESCE(UPPER(a.status), 'OPEN') NOT IN ('CLOSED', 'DONE', 'COMPLETED')
        AND (
          (a.due_date::date - CURRENT_DATE) IN (30, 14, 7, 1)
          OR a.due_date::date < CURRENT_DATE
        )
        AND NOT (
          CASE
            WHEN a.due_date::date < CURRENT_DATE THEN 0
            ELSE (a.due_date::date - CURRENT_DATE)
          END = ANY(a.reminder_sent_offsets)
        )
      ORDER BY a.due_date ASC
    `);

    for (const action of result.rows) {
      const offset = Number(action.reminder_offset);
      const recipient = isEmail(action.owner) ? action.owner.trim() : action.admin_email;
      if (!recipient) continue;

      const dueDate = new Date(action.due_date).toISOString().slice(0, 10);
      const timing = offset === 0 ? "overdue" : `due in ${offset} day${offset === 1 ? "" : "s"}`;
      const subject = `Action reminder: ${action.quest_id || "Compliance action"} is ${timing}`;
      const text = [
        `Company: ${action.company_name}`,
        `Action: ${action.defeated_quest || action.quest_id || `#${action.id}`}`,
        `Owner: ${action.owner || "Unassigned"}`,
        `Due date: ${dueDate}`,
        `Status: ${action.status || "OPEN"}`,
        "",
        action.notes ? `Notes: ${action.notes}` : "Please review and update this action in PRISM."
      ].join("\n");

      const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
      const isOverdue = offset === 0;
      const html = buildEmailHtml({
        heading: isOverdue ? "Action Overdue" : `Action Reminder — Due in ${offset} Day${offset === 1 ? "" : "s"}`,
        preheader: `${action.defeated_quest || action.quest_id || "Compliance action"} is ${timing}`,
        body: isOverdue
          ? "The following compliance action is overdue and requires immediate attention."
          : `The following compliance action is coming up soon. Please review and update its status before the due date.`,
        details: [
          { label: "Company",  value: action.company_name },
          { label: "Action",   value: action.defeated_quest || action.quest_id || `#${action.id}` },
          { label: "Owner",    value: action.owner || "Unassigned" },
          { label: "Due Date", value: dueDate },
          { label: "Status",   value: action.status || "OPEN", isStatus: true },
          action.notes ? { label: "Notes", value: action.notes } : null,
        ].filter(Boolean),
        cta: { text: "Review in PRISM", url: webUrl },
      });

      await sendEmail({ to: recipient, subject, text, html });
      await query(
        "UPDATE actions SET reminder_sent_offsets = array_append(reminder_sent_offsets, $1), updated_at = NOW() WHERE id = $2",
        [offset, action.id]
      );
    }

    if (result.rowCount > 0) {
      console.log(`[scheduler] processed ${result.rowCount} action reminder(s)`);
    }
  } catch (e) {
    console.error("[scheduler] sendActionReminders failed:", e.message);
  }
}

// ─── Recurrence: notify owners when a quest's next_due_date passes ────────────

async function processRecurrence() {
  try {
    // Find questions whose next_due_date has passed and recurrence is not "none"
    const result = await query(`
      SELECT q.*, c.admin_email, c.name AS company_name
      FROM questions q
      JOIN companies c ON c.id = q.company_id
      WHERE q.next_due_date IS NOT NULL
        AND q.next_due_date <= NOW()
        AND q.recurrence_interval IS NOT NULL
        AND q.recurrence_interval != 'none'
        AND q.company_id IS NOT NULL
        AND q.archived_at IS NULL
    `);

    for (const quest of result.rows) {
      const recipient = isEmail(quest.default_owner) ? quest.default_owner.trim() : quest.admin_email;
      if (!recipient) continue;

      const subject = `Assessment due: ${quest.control_area || quest.quest_id} (${quest.recurrence_interval} recurrence)`;
      const text = [
        `Company: ${quest.company_name}`,
        `Question: ${quest.quest_id} - ${quest.control_area || ""}`,
        `Module: ${quest.module_id}`,
        `Recurrence: ${quest.recurrence_interval}`,
        `Due date: ${new Date(quest.next_due_date).toISOString().slice(0, 10)}`,
        "",
        "This quest is due for reassessment. Please log in to PRISM and complete the assessment."
      ].join("\n");

      const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
      const html = buildEmailHtml({
        heading: "Assessment Due for Reassessment",
        preheader: `${quest.quest_id} — ${quest.control_area || quest.module_id} is due for its ${quest.recurrence_interval} review`,
        body: "This compliance assessment is due for reassessment. Please log in to PRISM and complete the assessment to maintain your compliance posture.",
        details: [
          { label: "Company",    value: quest.company_name },
          { label: "Question",   value: `${quest.quest_id}${quest.control_area ? ` — ${quest.control_area}` : ""}` },
          { label: "Module",     value: quest.module_id },
          { label: "Recurrence", value: quest.recurrence_interval },
          { label: "Due Date",   value: new Date(quest.next_due_date).toISOString().slice(0, 10) },
        ],
        cta: { text: "Complete Assessment", url: webUrl },
      });

      try {
        await sendEmail({ to: recipient, subject, text, html });
      } catch (emailErr) {
        console.error(`[scheduler] failed to send recurrence email for ${quest.quest_id}:`, emailErr.message); // nosemgrep
      }

      // Advance next_due_date to the next occurrence
      const nextDate = advanceDate(quest.next_due_date, quest.recurrence_interval);
      if (nextDate) {
        await query(
          "UPDATE questions SET next_due_date = $1, updated_at = NOW() WHERE id = $2",
          [nextDate.toISOString(), quest.id]
        );
      }
    }

    if (result.rowCount > 0) {
      console.log(`[scheduler] processed ${result.rowCount} recurrence notification(s)`);
    }
  } catch (e) {
    console.error("[scheduler] processRecurrence failed:", e.message);
  }
}

// ─── Mark overdue actions ─────────────────────────────────────────────────────

async function markOverdueActions() {
  try {
    const result = await query(`
      UPDATE actions SET status = 'OVERDUE', updated_at = NOW()
      WHERE due_date IS NOT NULL AND due_date < NOW()
      AND (status IS NULL OR UPPER(status) NOT IN ('CLOSED', 'DONE', 'COMPLETED', 'OVERDUE'))
    `);

    if (result.rowCount > 0) {
      console.log(`[scheduler] marked ${result.rowCount} action(s) as OVERDUE`);
    }
  } catch (e) {
    console.error("[scheduler] markOverdueActions failed:", e.message);
  }
}

// ─── Scheduled evidence collection ─────────────────────────────────────────────

export async function runScheduledCollections() {
  try {
    const result = await query(`
      SELECT id, company_id FROM integration_connections
      WHERE auto_collect_enabled = TRUE AND status = 'connected'
        AND (last_run_at IS NULL OR last_run_at < NOW() - (collection_frequency_hours || ' hours')::INTERVAL)
    `);

    for (const row of result.rows) {
      try {
        console.log(`[scheduler] starting scheduled collection for connection=${row.id} company=${row.company_id}`);
        const run = await runCollection({ connectionId: row.id, companyId: row.company_id, triggeredBy: null, triggerType: "scheduled" });
        console.log(`[scheduler] completed connection=${row.id} status=${run.status} passed=${run.testsPassed} failed=${run.testsFailed}`);
      } catch (e) {
        if (e.status === 409) {
          console.log(`[scheduler] skipped connection=${row.id} (run already in progress)`);
        } else {
          console.error(`[scheduler] error connection=${row.id}: ${e.message}`);
        }
      }
    }

    if (result.rowCount > 0) {
      console.log(`[scheduler] processed ${result.rowCount} scheduled collection(s)`);
    }
  } catch (e) {
    console.error("[scheduler] runScheduledCollections failed:", e.message);
  }
}

// ─── Automated evidence staleness ──────────────────────────────────────────────
//
// automated_evidence_items.next_collection_due_at is populated by collectionRunner on
// every successful pass. This sweep marks items 'stale' the first time they miss their
// due collection (tolerates a single transient collection failure — the item is still
// shown, just flagged), and 'expired' once three collection cycles have been missed
// (an abandoned/broken connector, or auto-collection turned off) so it stops silently
// counting as valid coverage on the dashboard/vault (both already filter/render on
// automated_evidence_items.status).

export async function markStaleAutomatedEvidence() {
  try {
    const staleResult = await query(`
      UPDATE automated_evidence_items
      SET status = 'stale'
      WHERE status = 'fresh' AND next_collection_due_at < NOW()
    `);

    const expiredResult = await query(`
      UPDATE automated_evidence_items aei
      SET status = 'expired'
      FROM integration_connections ic
      WHERE aei.connection_id = ic.id
        AND aei.status IN ('fresh', 'stale')
        AND aei.next_collection_due_at < NOW() - (3 * ic.collection_frequency_hours || ' hours')::INTERVAL
    `);

    if (staleResult.rowCount > 0 || expiredResult.rowCount > 0) {
      console.log(`[scheduler] marked ${staleResult.rowCount} automated evidence item(s) stale, ${expiredResult.rowCount} expired`);
    }
  } catch (e) {
    console.error("[scheduler] markStaleAutomatedEvidence failed:", e.message);
  }
}

// ─── Scheduler entry point ────────────────────────────────────────────────────

// ─── Rescan quarantined uploads (F-12) ────────────────────────────────────────

async function rescanQuarantinedUploads() {
  try {
    const outcome = await processQuarantine();
    const handled = Object.entries(outcome).filter(([k]) => k !== "pending" && k !== "skipped");
    if (handled.length) console.log("[scheduler] quarantine rescan:", Object.fromEntries(handled));
  } catch (e) {
    console.error("[scheduler] rescanQuarantinedUploads failed:", e.message); // nosemgrep
  }
}

const MS_PER_HOUR = 60 * 60 * 1000;
const QUARANTINE_RESCAN_MS = 5 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function startScheduler() {
  // Run immediately on startup
  deactivateExpiredAuditors();
  sendActionReminders();
  processReminders();
  processRecurrence();
  markOverdueActions();
  runScheduledCollections();
  markStaleAutomatedEvidence();
  archiveRetiredQuestions().catch((e) => console.error("[scheduler] archiveRetiredQuestions failed:", e.message)); // nosemgrep
  resumeInterruptedAnalysis()
    .then((n) => { if (n) console.log(`[scheduler] re-queued ${n} interrupted evidence analysis run(s)`); })
    .catch((e) => console.error("[scheduler] resumeInterruptedAnalysis failed:", e.message)); // nosemgrep

  // Give ClamAV a moment after boot, then keep retrying held uploads.
  setTimeout(rescanQuarantinedUploads, 30 * 1000);
  setInterval(rescanQuarantinedUploads, QUARANTINE_RESCAN_MS);

  // Daily tasks
  setInterval(deactivateExpiredAuditors, MS_PER_DAY);
  setInterval(sendActionReminders, MS_PER_DAY);
  setInterval(processRecurrence, MS_PER_DAY);
  setInterval(markOverdueActions, MS_PER_DAY);
  setInterval(() => archiveRetiredQuestions().catch((e) => console.error("[scheduler] archiveRetiredQuestions failed:", e.message)), MS_PER_DAY); // nosemgrep

  // Reminders checked every hour for more precise datetime targeting
  setInterval(processReminders, MS_PER_HOUR);
  setInterval(runScheduledCollections, MS_PER_HOUR);
  setInterval(markStaleAutomatedEvidence, MS_PER_HOUR);
}
