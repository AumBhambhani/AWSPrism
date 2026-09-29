// Recurrence / carry-forward helpers.
//
// A FINISHED assessment stays "marked" (carries forward into later assessment
// months) until its recurrence interval elapses. The re-validation date must be
// day-precise and match the "Due in Nd" label shown on the linked evidence in
// QuestionCard — otherwise a question with a monthly recurrence assessed on, say,
// 17 Aug gets un-marked the moment the calendar flips to September, ~2-4 weeks
// before its evidence actually expires.

// Mirror of addIntervalQC() in components/QuestionCard.jsx — keep in sync.
export function addRecurrence(date, interval) {
  const s = (interval || "").toLowerCase();
  if (!s || s === "none") return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  if (s === "weekly") d.setDate(d.getDate() + 7);
  else if (s === "fortnightly") d.setDate(d.getDate() + 14);
  else if (s.includes("annual") || s.includes("year")) d.setFullYear(d.getFullYear() + 1);
  else if (s.includes("quarter")) d.setMonth(d.getMonth() + 3);
  else if (s.includes("semi") || s.includes("bi")) d.setMonth(d.getMonth() + 6);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

// Does a FINISHED assessment completed at `completedAt` still cover the
// assessment period identified by `viewedMonth` ("YYYY-MM")?
//
// - `nextDueDate` (question.next_due_date), when set, wins.
// - otherwise the window is `completedAt + recurrence interval`, compared against
//   the first day of the viewed month so the question stays marked for the whole
//   period its evidence remains valid.
export function carriesForwardTo(completedAt, interval, viewedMonth, nextDueDate) {
  const s = (interval || "").toLowerCase();
  if (!s || s === "none") return false;
  if (!viewedMonth) return false;

  const monthStart = new Date(`${viewedMonth}-01T00:00:00`);
  if (Number.isNaN(monthStart.getTime())) return false;

  if (nextDueDate) {
    const due = new Date(nextDueDate);
    return !Number.isNaN(due.getTime()) && due >= monthStart;
  }

  if (!completedAt) return false;
  const expiry = addRecurrence(completedAt, interval);
  return expiry ? expiry >= monthStart : false;
}

// The best day-precise "this assessment was finished" timestamp we have.
export function assessmentCompletedAt(a) {
  return (
    a?.reviewedAt || a?.reviewed_at ||
    a?.updatedAt || a?.updated_at ||
    a?.createdAt || a?.created_at ||
    (a?.month ? `${a.month}-01T00:00:00` : null)
  );
}
