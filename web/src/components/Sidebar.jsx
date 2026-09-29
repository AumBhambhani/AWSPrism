import Logo from "./Logo";
import { carriesForwardTo, assessmentCompletedAt } from "../utils/carryForward.js";
import { isApprovedStatus } from "../utils/reviewStatus.js";

export default function Sidebar({
  modules,
  questions,
  currentIndex,
  responses,
  assessments,
  allAssessments,
  stats,
  month,
  onMonthChange,
  onJumpTo,
  onJumpToModule,
  owners,
  ownerFilter,
  onOwnerFilterChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  tagFilter,
  onTagFilterChange,
  allTags,
  dueDateFilter,
  onDueDateFilterChange,
  searchTerm,
  onSearchTermChange,
  reminders,
  departmentScope
}) {
  const currentModuleId = questions[currentIndex]?.moduleId;

  // Helper: check if a prior assessment carries forward for this quest/month
  const getCarriedAssessment = (questId) => {
    const quest = questions.find(q => q.questId === questId);
    if (!quest || !quest.recurrenceInterval || quest.recurrenceInterval === "none") return null;
    if (!allAssessments || !allAssessments.length) return null;

    const prior = allAssessments
      .filter(a =>
        (a.questId === questId || a.quest_id === questId) &&
        isApprovedStatus(a.reviewStatus || a.review_status) &&
        (a.answer === "IMPLEMENTED" || a.answer === "YES") &&
        (a.month || "") <= month
      )
      .sort((a, b) => (b.month || "").localeCompare(a.month || ""));

    if (prior.length === 0) return null;
    const latest = prior[0];

    // Day-precise carry-forward window: the assessment stays valid until its
    // recurrence interval elapses from the completion date (matching the "Due in
    // Nd" label on the linked evidence), not just until the calendar month flips.
    if (carriesForwardTo(assessmentCompletedAt(latest), quest.recurrenceInterval, month, quest.nextDueDate)) {
      return latest;
    }

    return null;
  };

  const getModuleStats = (moduleId) => {
    const moduleQuests = questions.filter(q => q.moduleId === moduleId);
    const assessed = moduleQuests.filter(q => {
      let assessment = assessments.find(a => 
        (a.questId === q.questId || a.quest_id === q.questId) && 
        (a.month === month || String(a.month) === String(month))
      );
      if (!assessment) assessment = getCarriedAssessment(q.questId);
      return assessment && isApprovedStatus(assessment.reviewStatus || assessment.review_status);
    }).length;
    return { assessed, total: moduleQuests.length };
  };

  const getQuestionDot = (questId) => {
    // Check this month's assessment
    if (assessments && assessments.length) {
      const a = assessments.find(x => (x.questId === questId || x.quest_id === questId));
      if (a && isApprovedStatus(a.reviewStatus || a.review_status)) {
        const ans = a.answer;
        if (ans === "NOT_IMPLEMENTED") return 'dot-notimpl';
        if (ans === "PARTIALLY_IMPLEMENTED") return 'dot-partial';
        if (ans === "PLANNED") return 'dot-planned';
        if (ans === "NOT_APPLICABLE") return 'dot-na';
        return 'dot-implemented';
      }
      if (a && (a.reviewStatus || a.review_status) === 'Submitted') return 'dot-partial';
    }
    // Check carry-forward
    const carried = getCarriedAssessment(questId);
    if (carried) return 'dot-implemented';

    const resp = responses[questId];
    if (resp?.answer === "IMPLEMENTED") return "dot-implemented";
    if (resp?.answer === "NOT_IMPLEMENTED") return "dot-notimpl";
    if (resp?.answer === "PARTIALLY_IMPLEMENTED") return "dot-partial";
    if (resp?.answer === "PLANNED") return "dot-planned";
    if (resp?.answer === "NOT_APPLICABLE") return "dot-na";
    // Legacy support
    if (resp?.answer === "YES") return "dot-implemented";
    if (resp?.answer === "NO") return "dot-notimpl";
    if (resp?.answer === "WIP") return "dot-partial";
    return "dot-unanswered";
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div style={{ width: "100%", maxWidth: 160, height: 36, display: "flex", alignItems: "center" }}>
          <Logo style={{ height: 36, display: "block" }} />
        </div>
      </div>

      <div className="sidebar-month">
        <label>Search</label>
        <input
          type="text"
          value={searchTerm || ""}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder="Question, area, notes…"
        />
      </div>

      <div className="sidebar-month">
        <label>Assessment month</label>
        <select value={month} onChange={(e) => onMonthChange(e.target.value)}>
          {(() => {
            const options = [];
            for (let year = new Date().getFullYear() + 1; year >= 2023; year--) {
              for (let m = 12; m >= 1; m--) {
                const value = `${year}-${String(m).padStart(2, '0')}`;
                const date = new Date(value + '-01');
                const label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
                options.push(<option key={value} value={value}>{label}</option>);
              }
            }
            return options;
          })()}
        </select>
      </div>

      {departmentScope?.scoped && (
        <div className="sidebar-month">
          <label>Departments</label>
          <select value={departmentScope.mode} onChange={(e) => departmentScope.setMode(e.target.value)}>
            <option value="mine">
              My departments{departmentScope.me?.departments?.length ? ` (${departmentScope.me.departments.map((d) => d.name).join(", ")})` : ""}
            </option>
            <option value="all">All departments</option>
          </select>
        </div>
      )}

      <div className="sidebar-month">
        <label>Filter by owner</label>
        <select value={ownerFilter} onChange={(e) => onOwnerFilterChange(e.target.value)}>
          <option value="">All owners</option>
          {owners && owners.map((owner) => (
            <option key={owner} value={owner}>{owner}</option>
          ))}
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by status</label>
        <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>
          <option value="">All statuses</option>
          <option value="IMPLEMENTED">Implemented</option>
          <option value="PARTIALLY_IMPLEMENTED">Partially Implemented</option>
          <option value="PLANNED">Planned</option>
          <option value="NOT_IMPLEMENTED">Not Implemented</option>
          <option value="NOT_APPLICABLE">Not Applicable</option>
          <option value="UNANSWERED">Unanswered</option>
          <option value="OVERDUE">Overdue</option>
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by priority</label>
        <select value={priorityFilter} onChange={(e) => onPriorityFilterChange(e.target.value)}>
          <option value="">All priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by tag</label>
        <select value={tagFilter} onChange={(e) => onTagFilterChange(e.target.value)}>
          <option value="">All tags</option>
          {(allTags || []).map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      <div className="sidebar-month">
        <label>Filter by due date</label>
        <select value={dueDateFilter || ""} onChange={(e) => onDueDateFilterChange(e.target.value)}>
          <option value="">All due dates</option>
          <option value="DUE_OVERDUE">Overdue</option>
          <option value="DUE_TODAY">Due Today</option>
          <option value="DUE_THIS_WEEK">Due This Week</option>
          <option value="NO_DUE_DATE">No Due Date</option>
        </select>
      </div>

      <nav className="module-nav">
        {modules.map((module) => {
          const moduleStats = getModuleStats(module.moduleId);
          const isActive = currentModuleId === module.moduleId;
          const moduleQuests = questions.filter(q => q.moduleId === module.moduleId);
          const isModuleLocked = !!module.blockedByDeps;

          return (
            <div key={module.moduleId} className="module-group">
              <button
                className={`module-btn ${isActive ? "active" : ""}`}
                onClick={() => onJumpToModule(module.moduleId)}
                title={isModuleLocked ? "Module locked — complete prerequisite modules first" : undefined}
                style={isModuleLocked ? { opacity: 0.55 } : undefined}
              >
                <div className="module-dot"></div>
                <div className="module-btn-text">
                  <div className="module-id" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {isModuleLocked && <span style={{ fontSize: 10 }}>🔒</span>}
                    {module.moduleId}
                  </div>
                  <div className="module-name">{module.name}</div>
                </div>
                <div className="module-progress">
                  {moduleStats.assessed}/{moduleStats.total}
                </div>
              </button>
              {isActive && (
                <div className="quest-list">
                  {moduleQuests.map((quest, idx) => {
                    const questIndex = questions.indexOf(quest);
                    const hasReminder = reminders && reminders.some(r => (r.questId === quest.questId || r.quest_id === quest.questId));
                    const dotClass = getQuestionDot(quest.questId);
                    const statusClass = dotClass.replace('dot-', 'status-');
                    const isBlocked = !!quest.blockedByDeps;
                    return (
                      <button
                        key={quest.questId}
                        className={`quest-nav-item ${statusClass} ${questIndex === currentIndex ? "active" : ""}`}
                        onClick={() => onJumpTo(questIndex)}
                        title={isBlocked ? "Blocked — complete prerequisite questions first" : undefined}
                        style={isBlocked ? { opacity: 0.5 } : undefined}
                      >
                        <div className={`quest-status-dot ${dotClass}`}></div>
                        <span className="quest-nav-text">
                          {quest.questId && <span className="quest-nav-id">{quest.questId}</span>}
                          {quest.baselineQuestion
                            ? quest.baselineQuestion.length > 40
                              ? quest.baselineQuestion.slice(0, 40) + "…"
                              : quest.baselineQuestion
                            : quest.controlArea}
                        </span>
                        {isBlocked && <span style={{ fontSize: 11, flexShrink: 0, marginLeft: 2 }}>🔒</span>}
                        {hasReminder && <span className="reminder-badge" title="Upcoming reminder">⏰</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="score-summary">
          <div className="score-box">
            <div className="score-label">Total quests</div>
            <div className="score-val">{stats.total}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Implemented</div>
            <div className="score-val green">{stats.yesEligible}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Assessed</div>
            <div className="score-val">{stats.assessed}</div>
          </div>
          <div className="score-box">
            <div className="score-label">Score</div>
            <div className="score-val">
              {stats.total > 0 ? Math.round((stats.yesEligible / stats.total) * 100) : 0}%
            </div>
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("open-cookie-banner"))}
          style={{
            marginTop: 12,
            background: "none",
            border: "none",
            color: "var(--text3)",
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          Cookie Settings
        </button>
      </div>
    </aside>
  );
}
