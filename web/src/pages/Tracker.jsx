import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Sidebar from "../components/Sidebar.jsx";
import TopBar from "../components/TopBar.jsx";
import QuestionCard from "../components/QuestionCard.jsx";
import Toast from "../components/Toast.jsx";
import RetryBanner from "../components/RetryBanner.jsx";
import { carriesForwardTo, assessmentCompletedAt } from "../utils/carryForward.js";
import { isApprovedStatus } from "../utils/reviewStatus.js";
import { useDepartmentScope } from "../hooks/useDepartmentScope.js";

export default function Tracker({ token, onLogout, user, company, branding, theme, onThemeToggle, isVerified, onProfileUpdate }) {
  const [modules, setModules] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [allAssessments, setAllAssessments] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState({});
  const [trackerSidebarOpen, setTrackerSidebarOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [toast, setToast] = useState({ show: false, message: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState("");
  const departmentScope = useDepartmentScope(token, "tracker");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dueDateFilter, setDueDateFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [reminders, setReminders] = useState([]);
  const [retryError, setRetryError] = useState(null);
  const [lastFailedAction, setLastFailedAction] = useState(null);

  const [searchParams] = useSearchParams();
  useEffect(() => {
    const questParam = searchParams.get("quest");
    if (questParam) setSearchTerm(questParam);
  }, []);

  useEffect(() => {
    loadData();
    loadDraft();
  }, [token]);

  useEffect(() => {
    if (token) {
      loadAssessments();
    }
  }, [month, token]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [ownerFilter, statusFilter, priorityFilter, tagFilter, dueDateFilter, searchTerm, departmentScope.mode]);

  const loadAssessments = async () => {
    try {
      const [monthAssessments, allAssessments] = await Promise.all([
        apiFetch(`/api/assessments?month=${month}`, { token }),
        apiFetch("/api/assessments", { token })
      ]);
      setAssessments(monthAssessments || []);
      setAllAssessments(allAssessments || []);
    } catch (err) {
      console.error("Error loading assessments:", err.message);
    }
  };

  const loadData = async () => {
    try {
      const [modulesData, questionsData, evidenceData, remindersData] = await Promise.all([
        apiFetch("/api/modules", { token }),
        apiFetch("/api/questions", { token }),
        apiFetch("/api/evidence", { token }),
        apiFetch("/api/reminders?upcoming=true", { token })
      ]);
      setModules(modulesData);
      setQuestions(questionsData);
      setEvidence(evidenceData || []);
      setReminders(remindersData || []);
      setRetryError(null);
      setLoading(false);
    } catch (err) {
      if (err.code === "TIMEOUT" || err.code === "COOLDOWN" || err.code === "QUEUE_FULL") {
        setRetryError(err);
        setLastFailedAction(() => loadData);
      } else {
        showToast("Error loading data: " + err.message);
      }
      setLoading(false);
    }
  };

  const loadDraft = () => {
    try {
      const draftKey = `prism_draft_${user?.id || "guest"}`;
      const saved = localStorage.getItem(draftKey);
      if (saved) setResponses(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load draft:", e);
    }
  };

  // Derive unique owners for the filter dropdown
  const owners = [...new Set(questions.map(q => q.defaultOwner).filter(Boolean))].sort();

  // Derive unique tags for the filter dropdown (from ALL questions, not filtered)
  const allTags = [...new Set(
    questions.flatMap(q => (q.tags || '').split(',').map(t => t.trim()).filter(Boolean))
  )].sort();

  // Get the effective assessment for a question: this month's, or carried forward from a prior month
  const getEffectiveAssessment = (questId) => {
    // First check if there's an assessment for the selected month
    const thisMonth = assessments.find(a =>
      (a.questId === questId || a.quest_id === questId) &&
      (a.month === month || String(a.month) === String(month))
    );
    if (thisMonth) return thisMonth;

    // Check carry-forward: find the latest completed assessment from any prior month
    const quest = questions.find(q => q.questId === questId);
    if (!quest) return null;

    const recurrence = quest.recurrenceInterval;
    if (!recurrence || recurrence === "none") return null;

    // Find the most recent approved (FINISHED/AUDITED) assessment for this quest
    // before or equal to the selected month
    const prior = allAssessments
      .filter(a =>
        (a.questId === questId || a.quest_id === questId) &&
        isApprovedStatus(a.reviewStatus || a.review_status) &&
        (a.month || "") <= month
      )
      .sort((a, b) => (b.month || "").localeCompare(a.month || ""));

    if (prior.length === 0) return null;

    const latestAssessment = prior[0];

    // Day-precise carry-forward window: keep the assessment marked until its
    // recurrence interval actually elapses from the completion date (the same
    // math behind the "Due in Nd" label on the linked evidence), rather than
    // dropping it the instant the calendar month rolls over.
    if (carriesForwardTo(assessmentCompletedAt(latestAssessment), recurrence, month, quest.nextDueDate)) {
      return { ...latestAssessment, _carriedForward: true };
    }

    return null;
  };

  // Modules whose own dep-modules are not yet fully completed
  const blockedModuleIds = new Set(
    modules.filter(m => m.blockedByDeps).map(m => m.moduleId)
  );

  // Filter questions by owner, status, priority, tags, due date, and search term
  const filteredQuestions = questions.filter(q => {
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      const inQuestId = (q.questId || "").toLowerCase().includes(s);
      const inControlArea = (q.controlArea || "").toLowerCase().includes(s);
      const inBaseline = (q.baselineQuestion || "").toLowerCase().includes(s);
      const inNotes = (q.latestComments || "").toLowerCase().includes(s);
      const inReviewerNotes = (q.latestReviewerNotes || "").toLowerCase().includes(s);
      if (!inQuestId && !inControlArea && !inBaseline && !inNotes && !inReviewerNotes) return false;
    }
    if (!departmentScope.matches(q.departments)) return false;
    if (ownerFilter && q.defaultOwner !== ownerFilter) return false;
    if (priorityFilter && q.priority !== priorityFilter) return false;
    if (tagFilter) {
      const qTags = (q.tags || '').split(',').map(t => t.trim());
      if (!qTags.includes(tagFilter)) return false;
    }
    if (statusFilter) {
      if (statusFilter === "OVERDUE") {
        const isOverdue = q.isOverdue || q.status === 'OVERDUE' || (q.nextDueDate && new Date(q.nextDueDate) < new Date());
        if (!isOverdue) return false;
      } else {
        const assessment = getEffectiveAssessment(q.questId);
        const draftAnswer = responses[q.questId]?.answer;
        const answer = assessment?.answer || draftAnswer || null;
        if (statusFilter === "UNANSWERED") {
          if (answer) return false;
        } else {
          if (answer !== statusFilter) return false;
        }
      }
    }
    if (dueDateFilter) {
      const dd = q.dueDate ? q.dueDate.slice(0, 10) : null;
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const sevenDays = new Date(Date.now() + 7*24*60*60*1000);
      const sevenDaysStr = `${sevenDays.getFullYear()}-${String(sevenDays.getMonth()+1).padStart(2,"0")}-${String(sevenDays.getDate()).padStart(2,"0")}`;
      if (dueDateFilter === "DUE_OVERDUE") {
        const notCompliant = !["IMPLEMENTED","NOT_APPLICABLE"].includes(q.latestAnswer);
        if (!dd || !(dd < today && notCompliant)) return false;
      } else if (dueDateFilter === "DUE_TODAY") {
        if (dd !== today) return false;
      } else if (dueDateFilter === "DUE_THIS_WEEK") {
        if (!dd || dd < today || dd > sevenDaysStr) return false;
      } else if (dueDateFilter === "NO_DUE_DATE") {
        if (dd) return false;
      }
    }
    return true;
  });

  const saveDraft = () => {
    localStorage.setItem(`prism_draft_${user?.id || "guest"}`, JSON.stringify(responses));
    showToast("Draft saved locally", "success");
  };

  const saveAndContinue = async () => {
    const quest = filteredQuestions[currentIndex];
    const resp = getResponse(quest.questId);

    if (!resp.answer) {
      showToast("Please select an answer first");
      return;
    }

    try {
      const evidenceIds = (resp.files || [])
        .map(file => (file && typeof file === "object" ? file.id : null))
        .filter(Boolean);

      await apiFetch("/api/assessments", {
        token,
        method: "POST",
        body: JSON.stringify({
          questId: quest.questId,
          moduleId: quest.moduleId,
          month,
          answer: resp.answer,
          currentLevel: resp.maturity || 1,
          level3Plus: false,
          owner: quest.defaultOwner,
          reviewStatus: "WIP",
          scoreEligible: false,
          comments: resp.comment,
          evidenceIds,
        })
      });

      showToast("Progress saved ✓", "success");
      setResponses(prev => { const copy = { ...prev }; delete copy[quest.questId]; return copy; });

      try {
        const newAssessments = await apiFetch(`/api/assessments?month=${month}`, { token });
        setAssessments(newAssessments || []);
      } catch (e) {
        console.error("Failed to refresh assessments", e.message);
      }

      if (currentIndex < filteredQuestions.length - 1) {
        setTimeout(() => navigate(1), 800);
      }
    } catch (err) {
      showToast("Error saving: " + err.message);
    }
  };

  const getResponse = (questId) => {
    const draft = responses[questId] || {
      answer: null,
      maturity: null,
      link: "",
      comment: "",
      files: [],
      actionOwner: "",
      actionDueDate: "",
      actionNotes: ""
    };
    
    // Pre-populate files from server-side evidence only when the user has no draft yet.
    // Skipped when responses[questId] exists so that explicitly cleared files stay cleared.
    const hasDraft = questId in responses;
    if (!hasDraft && draft.files.length === 0) {
      const existingEvidence = evidence.filter(e =>
        (e.questId === questId || e.quest_id === questId) &&
        (e.month === month || String(e.month) === String(month))
      );
      if (existingEvidence.length > 0) {
        return {
          ...draft,
          files: existingEvidence.map(e => ({
            id: e.id,
            name: e.evidenceName || e.evidence_name,
            link: e.evidenceLink || e.evidence_link
          }))
        };
      }
    }

    return draft;
  };

  const setResponse = (questId, key, value) => {
    setResponses(prev => {
      const existing = prev[questId] || { answer: null, maturity: null, link: "", comment: "", files: [], actionOwner: "", actionDueDate: "", actionNotes: "" };
      return { ...prev, [questId]: { ...existing, [key]: value } };
    });
  };

  const navigate = (direction) => {
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < filteredQuestions.length) {
      setCurrentIndex(newIndex);
    }
  };

  const jumpTo = (index) => {
    setCurrentIndex(index);
  };

  const jumpToModule = (moduleId) => {
    const index = filteredQuestions.findIndex(q => q.moduleId === moduleId);
    if (index >= 0) setCurrentIndex(index);
  };

  const submitReview = async () => {
    const quest = filteredQuestions[currentIndex];
    const resp = getResponse(quest.questId);

    if (!resp.answer) {
      showToast("Please select an answer first");
      return;
    }
    if (resp.answer === "IMPLEMENTED" && !resp.maturity) {
      showToast("Please select a maturity level");
      return;
    }
    if (resp.answer === "IMPLEMENTED" && !resp.link && !(resp.files && resp.files.length > 0) && !resp.vaultLinked) {
      showToast("Implemented requires an evidence upload, link, or vault attachment");
      return;
    }
    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED"].includes(resp.answer) && (!resp.actionDueDate || !resp.actionOwner || !resp.actionNotes)) {
      showToast(`${resp.answer.replace(/_/g, " ")} requires an action owner, due date, and notes`);
      return;
    }
    if (resp.answer === "NOT_APPLICABLE" && !resp.comment) {
      showToast("Not Applicable requires a justification in the comments");
      return;
    }

    const isImplemented = resp.answer === "IMPLEMENTED";

    try {
      const evidenceIds = isImplemented
        ? (resp.files || []).map(file => (file && typeof file === "object" ? file.id : null)).filter(Boolean)
        : [];

      const created = await apiFetch("/api/assessments", {
        token,
        method: "POST",
        body: JSON.stringify({
          questId: quest.questId,
          moduleId: quest.moduleId,
          month,
          answer: resp.answer,
          currentLevel: resp.maturity,
          level3Plus: isImplemented && resp.maturity >= 3,
          evidenceLink: isImplemented ? resp.link : undefined,
          owner: quest.defaultOwner,
          reviewStatus: isImplemented ? "Submitted" : "FINISHED",
          scoreEligible: isImplemented && resp.maturity >= 3 && (resp.link || (resp.files && resp.files.length > 0) || resp.vaultLinked),
          comments: resp.comment,
          evidenceIds,
          actionOwner: resp.actionOwner,
          actionDueDate: resp.actionDueDate,
          actionNotes: resp.actionNotes
        })
      });

      // Link uploaded evidence files to the assessment (IMPLEMENTED only)
      if (isImplemented && resp.files && resp.files.length > 0) {
        for (const f of resp.files) {
          const evidenceId = f && f.id ? f.id : null;
          if (evidenceId) {
            try {
              await apiFetch(`/api/evidence/${evidenceId}`, { token, method: 'PUT', body: JSON.stringify({ evidenceId: String(created.id) }) });
            } catch (e) {
              console.error('Failed to link evidence', evidenceId, e.message);
            }
          }
        }
      }

      showToast(isImplemented ? "Submitted for review ✓" : "Saved ✓", "success");
      // clear local draft for this question so old data isn't resubmitted
      setResponses(prev => {
        const copy = { ...prev };
        delete copy[quest.questId];
        return copy;
      });

      // refresh assessments so review gates and stats update
      try {
        const newAssessments = await apiFetch(`/api/assessments?month=${month}`, { token });
        setAssessments(newAssessments || []);
      } catch (e) {
        console.error('Failed to refresh assessments', e.message);
      }
      if (currentIndex < filteredQuestions.length - 1) {
        setTimeout(() => navigate(1), 800);
      }
    } catch (err) {
      if (err.code === "TIMEOUT" || err.code === "COOLDOWN" || err.code === "QUEUE_FULL") {
        setRetryError(err);
        setLastFailedAction(() => submitReview);
      } else {
        showToast("Error submitting: " + err.message);
      }
    }
  };

  const showToast = (message, type = "") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "" }), 2500);
  };

  const stats = {
    total: filteredQuestions.length,
    assessed: filteredQuestions.filter(q => {
      const assessment = getEffectiveAssessment(q.questId);
      return assessment && isApprovedStatus(assessment.reviewStatus || assessment.review_status);
    }).length,
    yesEligible: filteredQuestions.filter(q => {
      const assessment = getEffectiveAssessment(q.questId);
      return assessment &&
        isApprovedStatus(assessment.reviewStatus || assessment.review_status) &&
        (assessment.answer === "IMPLEMENTED" || assessment.answer === "YES") &&
        (assessment.currentLevel || assessment.current_level) >= 3 &&
        (assessment.scoreEligible === true || assessment.score_eligible === true);
    }).length
  };

  if (loading) {
    return (
      <div className="tracker-loading">
        <div className="loading-spinner"></div>
        <p>Loading assessment tracker...</p>
      </div>
    );
  }

  const currentQuest = filteredQuestions[currentIndex];

  return (
    <div className="tracker">
      {/* Mobile overlay for tracker sidebar */}
      {trackerSidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setTrackerSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={`tracker-sidebar-wrapper ${trackerSidebarOpen ? "sidebar-open" : ""}`}>
        <Sidebar
          modules={modules}
          questions={filteredQuestions}
          currentIndex={currentIndex}
          responses={responses}
          assessments={assessments}
          allAssessments={allAssessments}
          stats={stats}
          month={month}
          onMonthChange={setMonth}
          onJumpTo={(idx) => { jumpTo(idx); setTrackerSidebarOpen(false); }}
          onJumpToModule={(idx) => { jumpToModule(idx); setTrackerSidebarOpen(false); }}
          owners={owners}
          ownerFilter={ownerFilter}
          onOwnerFilterChange={setOwnerFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={setPriorityFilter}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          allTags={allTags}
          dueDateFilter={dueDateFilter}
          onDueDateFilterChange={setDueDateFilter}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          reminders={reminders}
          departmentScope={departmentScope}
        />
      </div>
      <main className="main">
        <TopBar
          currentIndex={currentIndex}
          total={filteredQuestions.length}
          onNavigate={navigate}
          onSaveDraft={saveDraft}
          onSubmitReview={submitReview}
          onSaveAndContinue={saveAndContinue}
          onLogout={onLogout}
          user={user}
          company={company}
          branding={branding}
          theme={theme}
          onThemeToggle={onThemeToggle}
          onMenuToggle={() => setTrackerSidebarOpen((v) => !v)}
          token={token}
          isVerified={isVerified}
          currentAnswer={currentQuest ? getResponse(currentQuest.questId).answer : null}
          onProfileUpdate={onProfileUpdate}
        />
        <div className="card-area">
          {retryError && (
            <RetryBanner
              error={retryError}
              onRetry={() => {
                setRetryError(null);
                if (lastFailedAction) lastFailedAction();
              }}
              onDismiss={() => setRetryError(null)}
            />
          )}
          {currentQuest && (
            (currentQuest.blockedByDeps || blockedModuleIds.has(currentQuest.moduleId)) ? (
              (() => {
                const moduleBlocked = blockedModuleIds.has(currentQuest.moduleId);
                const blockingModule = moduleBlocked
                  ? modules.find(m => m.moduleId === currentQuest.moduleId)
                  : null;
                return (
                  <div key={currentQuest.questId} style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    minHeight: 320, padding: 40, textAlign: "center",
                    background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border2)",
                    margin: "24px 0"
                  }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
                      {moduleBlocked ? "Module locked" : "Question locked"}
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text3)", maxWidth: 400, lineHeight: 1.6, marginBottom: 20 }}>
                      {moduleBlocked
                        ? `This module is locked until its prerequisite modules are fully completed. Complete all questions in the required modules first.`
                        : `This question has dependencies that must be completed first. Return to the prerequisite questions in the sidebar and submit them before answering this one.`}
                    </div>
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 20,
                      background: "rgba(var(--amber-rgb,220,150,40),0.12)", border: "1px solid var(--amber,#dc9628)",
                      fontSize: 12, color: "var(--amber,#dc9628)", fontWeight: 600
                    }}>
                      <span>⚠</span>
                      {moduleBlocked
                        ? `Module "${currentQuest.moduleId}" is waiting on prerequisite modules`
                        : `${currentQuest.unmetDepCount || "Some"} prerequisite ${currentQuest.unmetDepCount === 1 ? "question" : "questions"} not yet completed`}
                    </div>
                  </div>
                );
              })()
            ) : (
              (() => {
                const assessment = getEffectiveAssessment(currentQuest.questId);
                return (
                  <QuestionCard
                    key={currentQuest.questId}
                    question={currentQuest}
                    assessment={assessment}
                    isVerified={isVerified}
                    response={getResponse(currentQuest.questId)}
                    onSetResponse={(key, value) => setResponse(currentQuest.questId, key, value)}
                    token={token}
                    month={month}
                    user={user}
                    reminders={reminders.filter(r => r.questId === currentQuest.questId || r.quest_id === currentQuest.questId)}
                    onEvidenceChange={async () => {
                      const evidenceData = await apiFetch("/api/evidence", { token });
                      setEvidence(evidenceData || []);
                    }}
                    onSaveActionDetails={async () => {
                      saveDraft();
                      const resp = getResponse(currentQuest.questId);
                      if (resp.actionDueDate) {
                        try {
                          await apiFetch(`/api/questions/${currentQuest.questId}/recurrence`, {
                            token,
                            method: "PUT",
                            body: JSON.stringify({ nextDueDate: resp.actionDueDate })
                          });
                          const questionsData = await apiFetch("/api/questions", { token });
                          setQuestions(questionsData);
                        } catch (err) {
                          console.error("Failed to save due date:", err.message);
                        }
                      }
                    }}
                  />
                );
              })()
            )
          )}
        </div>
      </main>
      <Toast show={toast.show} message={toast.message} type={toast.type} />
    </div>
  );
}
