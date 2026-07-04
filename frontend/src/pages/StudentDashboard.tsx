import React, { useState, useMemo } from "react";
import {
  GraduationCap, Network, BookOpen, Clock, HelpCircle, Target,
  ArrowRight, ChevronDown, ChevronUp, Check, Lightbulb, Inbox,
  TrendingUp, Zap, RotateCcw, Play, Star, Award, CheckCircle2,
  AlertCircle, BookMarked, BarChart3, Calendar, Activity,
} from "lucide-react";
import { LectureExample, LECTURE_EXAMPLES } from "../utils/lectureExamples";
import { SavedSimulationSummary } from "../types/network";
import { AssignedWork } from "../types/classroom";
import {
  computeStudentOverview, computeTopicProgress, computeContinueLearning,
  computeStudentTimeline, computeStudentAchievements, computeStudentInsights,
  getStudentWorkRecord, getLectureById,
} from "../utils/studentProgressService";
import { TopicStatus, StudentWorkRecord } from "../types/studentProgress";

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "overview" | "progress" | "work" | "timeline";

// ── Props ─────────────────────────────────────────────────────────────────────

interface StudentDashboardProps {
  assignedWorks: AssignedWork[];
  currentStudentId: string | null;
  currentStudentName: string | null;
  savedRuns: SavedSimulationSummary[];
  onOpenAssignment: () => void;
  onOpenChallenges: () => void;
  onBuildLab: () => void;
  onLoadLectureExample: (ex: LectureExample) => void;
  onOpenSavedRuns: () => void;
  onOpenHelp: () => void;
  onOpenAssignedWork: (work: AssignedWork) => void;
  onOpenChallenge?: (workId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return iso; }
}

function isAssignedToStudent(work: AssignedWork, studentId: string | null): boolean {
  if (!studentId) return false;
  if (work.assignedTo === "all") return true;
  return (work.assignedTo as string[]).includes(studentId);
}

// ── Internal components ───────────────────────────────────────────────────────

const MetricCard: React.FC<{
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: boolean; warn?: boolean;
}> = ({ label, value, sub, icon, accent, warn }) => (
  <div className={`spd-metric-card${accent ? " spd-metric-card--accent" : ""}${warn ? " spd-metric-card--warn" : ""}`}>
    <div className="spd-metric-icon">{icon}</div>
    <div className="spd-metric-body">
      <div className="spd-metric-value">{value}</div>
      <div className="spd-metric-label">{label}</div>
      {sub && <div className="spd-metric-sub">{sub}</div>}
    </div>
  </div>
);

const ProgressBar: React.FC<{ pct: number; status: TopicStatus }> = ({ pct, status }) => {
  const cls = status === "completed" ? "spd-bar--green" : status === "learning" ? "spd-bar--blue" : "spd-bar--gray";
  return (
    <div className="spd-bar-track">
      <div className={`spd-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const StatusDot: React.FC<{ status: TopicStatus }> = ({ status }) => {
  const cls = status === "completed" ? "spd-dot--green" : status === "learning" ? "spd-dot--blue" : "spd-dot--gray";
  const label = status === "completed" ? "Completed" : status === "learning" ? "Learning" : "Not started";
  return <span className={`spd-status-dot ${cls}`}>{label}</span>;
};

const WorkStatusBadge: React.FC<{ status: StudentWorkRecord["status"] }> = ({ status }) => {
  const cfg: Record<string, { label: string; cls: string }> = {
    not_started: { label: "Not started", cls: "spd-wbadge--gray" },
    in_progress:  { label: "In progress",  cls: "spd-wbadge--blue" },
    submitted:    { label: "Submitted",    cls: "spd-wbadge--yellow" },
    completed:    { label: "Completed",    cls: "spd-wbadge--green" },
    needs_retry:  { label: "Needs retry",  cls: "spd-wbadge--red" },
  };
  const { label, cls } = cfg[status] ?? cfg.not_started;
  return <span className={`spd-work-badge ${cls}`}>{label}</span>;
};

const TimelineIcon: React.FC<{ action: string }> = ({ action }) => {
  const icons: Record<string, React.ReactNode> = {
    submitted:   <CheckCircle2 size={12} />,
    attempted:   <Play size={12} />,
    solved:      <Star size={12} />,
    hint:        <Lightbulb size={12} />,
    replay:      <RotateCcw size={12} />,
    lecture:     <BookOpen size={12} />,
    simulation:  <Network size={12} />,
    opened:      <BookMarked size={12} />,
  };
  const clss: Record<string, string> = {
    submitted: "spd-tl-icon--green", solved: "spd-tl-icon--green",
    attempted: "spd-tl-icon--blue",  replay: "spd-tl-icon--purple",
    hint:      "spd-tl-icon--amber", lecture: "spd-tl-icon--teal",
    simulation:"spd-tl-icon--gray",  opened: "spd-tl-icon--gray",
  };
  return (
    <div className={`spd-tl-icon ${clss[action] ?? "spd-tl-icon--gray"}`}>
      {icons[action] ?? <Activity size={12} />}
    </div>
  );
};

// ── Overview tab ──────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  studentId: string | null;
  firstName: string;
  assignedWorks: AssignedWork[];
  onOpenChallenge?: (id: string) => void;
  onLoadLectureExample: (ex: LectureExample) => void;
  onBuildLab: () => void;
}> = ({ studentId, firstName, assignedWorks, onOpenChallenge, onLoadLectureExample, onBuildLab }) => {
  const overview = useMemo(() => computeStudentOverview(studentId, assignedWorks), [studentId, assignedWorks]);
  const continueItems = useMemo(() => computeContinueLearning(studentId), [studentId]);
  const insights = useMemo(() => computeStudentInsights(studentId), [studentId]);

  const handleContinueClick = (item: ReturnType<typeof computeContinueLearning>[number]) => {
    if (item.type === "challenge" && item.challengeId && onOpenChallenge) {
      onOpenChallenge(item.challengeId);
    } else if (item.type === "lecture" && item.lectureId) {
      const lecture = getLectureById(item.lectureId);
      if (lecture) onLoadLectureExample(lecture);
    } else if (item.type === "lab") {
      onBuildLab();
    }
  };

  return (
    <div className="spd-tab-content">
      {/* Greeting */}
      <div className="spd-greeting">
        <div>
          <div className="spd-greeting-title">Welcome back, {firstName}! 👋</div>
          <div className="spd-greeting-sub">
            {overview.needsRetry > 0
              ? `You have ${overview.needsRetry} challenge${overview.needsRetry > 1 ? "s" : ""} that need a retry.`
              : overview.inProgress > 0
              ? "You have work in progress — keep going!"
              : "Continue your routing practice below."}
          </div>
        </div>
        {overview.avgScore !== null && (
          <div className="spd-greeting-score">
            <div className="spd-greeting-score-ring">
              <svg viewBox="0 0 36 36" className="spd-ring-svg">
                <circle cx="18" cy="18" r="15.9" className="spd-ring-bg" />
                <circle cx="18" cy="18" r="15.9" className="spd-ring-fg"
                  strokeDasharray={`${overview.avgScore} ${100 - overview.avgScore}`}
                  strokeDashoffset="25" />
              </svg>
              <div className="spd-ring-val">{overview.avgScore}%</div>
            </div>
            <div className="spd-ring-label">Avg score</div>
          </div>
        )}
      </div>

      {/* Metric cards */}
      <div className="spd-metrics-grid">
        <MetricCard label="Assigned" value={overview.assignedTotal} icon={<BookMarked size={14} />} />
        <MetricCard label="Completed" value={overview.completed} icon={<CheckCircle2 size={14} />} accent />
        <MetricCard label="In progress" value={overview.inProgress} icon={<TrendingUp size={14} />} />
        <MetricCard label="Needs retry" value={overview.needsRetry} icon={<AlertCircle size={14} />} warn={overview.needsRetry > 0} />
        <MetricCard label="Best score" value={overview.bestScore !== null ? `${overview.bestScore}%` : "—"} icon={<Star size={14} />} />
        <MetricCard label="Challenges solved" value={overview.challengesSolved} icon={<Zap size={14} />} />
        <MetricCard label="Hints used" value={overview.hintsUsed} icon={<Lightbulb size={14} />} />
        <MetricCard label="Replays watched" value={overview.replaysWatched} icon={<RotateCcw size={14} />} />
      </div>

      {/* Continue Learning */}
      <div className="spd-section">
        <div className="spd-section-heading">Continue Learning</div>
        <div className="spd-continue-grid">
          {continueItems.map((item) => (
            <div key={item.id} className="spd-continue-card">
              <div className="spd-continue-type-row">
                <span className={`spd-type-chip spd-type-chip--${item.type}`}>
                  {item.type === "challenge" ? "Challenge"
                    : item.type === "lecture" ? "Lecture"
                    : item.type === "lab" ? "Lab"
                    : "Assignment"}
                </span>
                <span className="spd-continue-time">
                  <Clock size={10} /> {item.estimatedMinutes} min
                </span>
              </div>
              <div className="spd-continue-title">{item.title}</div>
              {item.score !== null && item.score !== undefined && (
                <div className="spd-continue-score">Last score: {item.score}%</div>
              )}
              <div className="spd-continue-bar-wrap">
                <div className="spd-bar-track">
                  <div
                    className={`spd-bar-fill ${item.progressPct >= 80 ? "spd-bar--green" : item.progressPct > 0 ? "spd-bar--blue" : "spd-bar--gray"}`}
                    style={{ width: `${item.progressPct}%` }}
                  />
                </div>
                <span className="spd-continue-pct">{item.progressPct}%</span>
              </div>
              <button
                className={`spd-cta-btn ${item.cta === "Retry" ? "spd-cta-btn--warn" : "spd-cta-btn--primary"}`}
                onClick={() => handleContinueClick(item)}
              >
                {item.cta} <ArrowRight size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="spd-section">
          <div className="spd-section-heading">Your Insights</div>
          <div className="spd-insights-list">
            {insights.map((ins) => (
              <div key={ins.id} className={`spd-insight-card spd-insight-card--${ins.type}`}>
                <div className="spd-insight-icon">
                  {ins.type === "positive" ? <Star size={12} />
                    : ins.type === "suggestion" ? <ArrowRight size={12} />
                    : <BarChart3 size={12} />}
                </div>
                <div className="spd-insight-body">
                  <div className="spd-insight-text">{ins.text}</div>
                  <div className="spd-insight-detail">{ins.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Progress tab ──────────────────────────────────────────────────────────────

const ProgressTab: React.FC<{
  studentId: string | null;
  onOpenChallenge?: (id: string) => void;
}> = ({ studentId, onOpenChallenge }) => {
  const topics = useMemo(() => computeTopicProgress(studentId), [studentId]);
  const achievements = useMemo(() => computeStudentAchievements(studentId), [studentId]);

  return (
    <div className="spd-tab-content">
      {/* Topic progress */}
      <div className="spd-section">
        <div className="spd-section-heading">Topic Progress</div>
        <div className="spd-topics-grid">
          {topics.map((t) => (
            <div key={t.topic} className={`spd-topic-card spd-topic-card--${t.status}`}>
              <div className="spd-topic-header">
                <div className="spd-topic-name">{t.displayName}</div>
                <StatusDot status={t.status} />
              </div>
              <ProgressBar pct={t.progressPct} status={t.status} />
              <div className="spd-topic-pct-row">
                <span className="spd-topic-pct">{t.progressPct}%</span>
                {t.score !== null && (
                  <span className="spd-topic-score">score: {t.score}%</span>
                )}
              </div>
              <div className="spd-topic-desc">{t.description}</div>
              {t.status !== "completed" && (
                <div className="spd-topic-next">
                  {t.nextChallengeId && onOpenChallenge ? (
                    <button
                      className="spd-topic-action-btn"
                      onClick={() => onOpenChallenge(t.nextChallengeId!)}
                    >
                      {t.nextAction} <ArrowRight size={10} />
                    </button>
                  ) : (
                    <span className="spd-topic-next-text">{t.nextAction}</span>
                  )}
                </div>
              )}
              {t.status === "completed" && (
                <div className="spd-topic-done">
                  <CheckCircle2 size={11} /> Topic complete
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Achievements */}
      <div className="spd-section">
        <div className="spd-section-heading">Achievements</div>
        <div className="spd-achievements-grid">
          {achievements.map((a) => (
            <div key={a.id} className={`spd-achievement${a.unlocked ? " spd-achievement--unlocked" : " spd-achievement--locked"}`}>
              <div className="spd-achievement-icon">
                {a.id === "first_simulation"     && <Play size={16} />}
                {a.id === "ecmp_explorer"         && <Network size={16} />}
                {a.id === "congestion_detective"  && <AlertCircle size={16} />}
                {a.id === "replay_learner"        && <RotateCcw size={16} />}
                {a.id === "no_hint_solver"        && <Lightbulb size={16} />}
                {a.id === "challenge_streak"      && <Zap size={16} />}
              </div>
              <div className="spd-achievement-body">
                <div className="spd-achievement-title">{a.title}</div>
                <div className="spd-achievement-desc">{a.description}</div>
                {a.unlocked && a.unlockedAt && (
                  <div className="spd-achievement-date">
                    Earned {fmtDate(a.unlockedAt)}
                  </div>
                )}
                {!a.unlocked && (
                  <div className="spd-achievement-locked-label">Locked</div>
                )}
              </div>
              {a.unlocked && <Check size={11} className="spd-achievement-check" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Work tab ──────────────────────────────────────────────────────────────────

type WorkFilter = "all" | "active" | "completed" | "attention";

const WorkTab: React.FC<{
  studentId: string | null;
  assignedWorks: AssignedWork[];
  onOpenAssignedWork: (work: AssignedWork) => void;
  onOpenAssignment: () => void;
  onOpenHelp: () => void;
  onLoadLectureExample: (ex: LectureExample) => void;
}> = ({ studentId, assignedWorks, onOpenAssignedWork, onOpenAssignment, onOpenHelp, onLoadLectureExample }) => {
  const [filter, setFilter] = useState<WorkFilter>("all");
  const [showLectures, setShowLectures] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);

  const myWorks = useMemo(
    () => assignedWorks.filter((w) => isAssignedToStudent(w, studentId)),
    [assignedWorks, studentId]
  );

  const enriched = useMemo(
    () => myWorks.map((w) => ({
      work: w,
      rec: getStudentWorkRecord(studentId, w.workId),
    })),
    [myWorks, studentId]
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case "active":    return enriched.filter((e) => e.rec.status === "in_progress" || e.rec.status === "not_started");
      case "completed": return enriched.filter((e) => e.rec.status === "completed" || e.rec.status === "submitted");
      case "attention": return enriched.filter((e) => e.rec.status === "needs_retry");
      default:          return enriched;
    }
  }, [enriched, filter]);

  const assignments = filtered.filter((e) => e.work.workType === "assignment");
  const challenges  = filtered.filter((e) => e.work.workType === "challenge");

  const attentionCount = enriched.filter((e) => e.rec.status === "needs_retry").length;

  const ctaLabel = (status: StudentWorkRecord["status"]): string => {
    switch (status) {
      case "needs_retry":  return "Retry";
      case "in_progress":  return "Continue";
      case "completed":
      case "submitted":    return "Review";
      default:             return "Start";
    }
  };

  const WorkRow: React.FC<{ work: AssignedWork; rec: StudentWorkRecord }> = ({ work, rec }) => (
    <div className={`spd-work-row${rec.status === "needs_retry" ? " spd-work-row--warn" : ""}`}>
      <div className="spd-work-row-main">
        <div className="spd-work-row-title">{work.workTitle}</div>
        <div className="spd-work-row-meta">
          {work.workTopic && <span className="chip chip--topic">{work.workTopic.replace("_", " ")}</span>}
          {work.dueDate && (
            <span className="spd-work-due">
              <Calendar size={9} /> Due {fmtDate(work.dueDate)}
            </span>
          )}
          {rec.attempts > 0 && (
            <span className="spd-work-attempts">{rec.attempts} attempt{rec.attempts > 1 ? "s" : ""}</span>
          )}
          {rec.lastActivityAt && (
            <span className="spd-work-last">Last: {relTime(rec.lastActivityAt)}</span>
          )}
        </div>
      </div>
      <div className="spd-work-row-right">
        {rec.score !== null && (
          <span className={`spd-work-score ${rec.score >= 80 ? "spd-work-score--green" : rec.score >= 60 ? "spd-work-score--amber" : "spd-work-score--red"}`}>
            {rec.score}%
          </span>
        )}
        <WorkStatusBadge status={rec.status} />
        <button
          className={`btn-sm ${rec.status === "needs_retry" ? "btn-warn" : "btn-primary"}`}
          onClick={() => onOpenAssignedWork(work)}
        >
          {ctaLabel(rec.status)} <ArrowRight size={11} />
        </button>
      </div>
    </div>
  );

  if (!studentId) {
    return (
      <div className="spd-tab-content">
        <div className="spd-empty">
          <GraduationCap size={28} style={{ opacity: 0.3 }} />
          <div className="spd-empty-title">No profile selected</div>
          <p className="spd-empty-desc">Sign out and sign in again to choose your student profile.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="spd-tab-content">
      {/* Filter tabs */}
      <div className="spd-work-filters">
        {(["all", "active", "completed", "attention"] as WorkFilter[]).map((f) => (
          <button
            key={f}
            className={`spd-work-filter${filter === f ? " spd-work-filter--active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" && "All"}
            {f === "active" && "Active"}
            {f === "completed" && "Completed"}
            {f === "attention" && (
              <>Needs attention{attentionCount > 0 && <span className="spd-filter-badge">{attentionCount}</span>}</>
            )}
          </button>
        ))}
      </div>

      {myWorks.length === 0 ? (
        <div className="spd-empty">
          <div className="spd-empty-icon"><Inbox size={22} /></div>
          <div className="spd-empty-title">No work assigned yet</div>
          <p className="spd-empty-desc">
            Your teacher hasn't assigned any work yet. You can also import an assignment JSON file directly.
          </p>
          <button className="btn-primary btn-sm" onClick={onOpenAssignment}>
            Import Assignment JSON <ArrowRight size={11} />
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="spd-empty">
          <div className="spd-empty-title">No items match this filter</div>
          <button className="btn-secondary btn-sm" onClick={() => setFilter("all")}>Clear filter</button>
        </div>
      ) : (
        <>
          {assignments.length > 0 && (
            <div className="spd-work-section">
              <div className="spd-work-section-title">
                <BookMarked size={12} /> Assignments ({assignments.length})
              </div>
              {assignments.map(({ work, rec }) => <WorkRow key={work.assignedWorkId} work={work} rec={rec} />)}
            </div>
          )}

          {challenges.length > 0 && (
            <div className="spd-work-section">
              <div className="spd-work-section-title">
                <Target size={12} /> Challenges ({challenges.length})
              </div>
              {challenges.map(({ work, rec }) => <WorkRow key={work.assignedWorkId} work={work} rec={rec} />)}
            </div>
          )}
        </>
      )}

      {/* Import fallback */}
      <div className="spd-work-import-row">
        <span className="spd-work-import-label">Have a file from your teacher?</span>
        <button className="btn-secondary btn-sm" onClick={onOpenAssignment}>
          Import assignment JSON
        </button>
        <button className="btn-secondary btn-sm" onClick={onOpenHelp}>
          <HelpCircle size={11} /> Help
        </button>
      </div>

      {/* Lecture examples (collapsed) */}
      <div className="dash-section" style={{ marginTop: 12 }}>
        <button
          className="dash-section-title dash-section-toggle"
          onClick={() => setShowLectures((p) => !p)}
        >
          <BookOpen size={13} /> Lecture Examples
          {showLectures ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showLectures && (
          <div className="dash-lecture-list" style={{ marginTop: 10 }}>
            {LECTURE_EXAMPLES.map((ex) => {
              const isExpanded = expandedEx === ex.id;
              return (
                <div key={ex.id} className="dash-lecture-item">
                  <div className="dash-lecture-header">
                    <div className="dash-lecture-meta">
                      <span className="lecture-card-category">{ex.category}</span>
                      <span className="dash-lecture-title">{ex.title}</span>
                      <span className="dash-lecture-tagline">{ex.tagline}</span>
                    </div>
                    <div className="dash-lecture-actions">
                      <button className="icon-btn" onClick={() => setExpandedEx(isExpanded ? null : ex.id)}>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <button className="btn-primary btn-sm" onClick={() => onLoadLectureExample(ex)}>
                        Load &amp; Simulate <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="dash-lecture-details">
                      <ul className="lecture-card-watch">
                        {ex.whatToWatch.map((item, i) => (
                          <li key={i} className="lecture-card-watch-item">
                            <Check size={10} className="lecture-card-check" /> <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="lecture-card-insight">
                        <Lightbulb size={11} /> <span>{ex.insight}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Timeline tab ──────────────────────────────────────────────────────────────

const TimelineTab: React.FC<{ studentId: string | null }> = ({ studentId }) => {
  const events = useMemo(() => computeStudentTimeline(studentId), [studentId]);

  if (events.length === 0) {
    return (
      <div className="spd-tab-content">
        <div className="spd-empty">
          <Activity size={24} style={{ opacity: 0.3 }} />
          <div className="spd-empty-title">No activity yet</div>
          <p className="spd-empty-desc">Start a challenge or open a lecture and your activity will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="spd-tab-content">
      <div className="spd-section">
        <div className="spd-section-heading">Activity Timeline</div>
        <div className="spd-timeline">
          {events.map((ev, i) => (
            <div key={ev.id} className="spd-tl-row">
              <div className="spd-tl-left">
                <TimelineIcon action={ev.action} />
                {i < events.length - 1 && <div className="spd-tl-line" />}
              </div>
              <div className="spd-tl-body">
                <div className="spd-tl-title">{ev.title}</div>
                <div className="spd-tl-meta">
                  <span className="spd-tl-detail">{ev.detail}</span>
                  {ev.score !== undefined && (
                    <span className={`spd-tl-score ${ev.score >= 80 ? "spd-tl-score--green" : ev.score >= 60 ? "spd-tl-score--amber" : "spd-tl-score--red"}`}>
                      {ev.score}/100
                    </span>
                  )}
                  <span className="spd-tl-time">{relTime(ev.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="spd-tl-note">
        Activity is based on prototype demo data. In production, all challenge attempts, submissions, and interactions are tracked automatically.
      </div>
    </div>
  );
};

// ── Explore quick-actions (used in bottom of overview) ────────────────────────

const ExploreActions: React.FC<{
  onBuildLab: () => void;
  onOpenChallenges: () => void;
  onOpenSavedRuns: () => void;
  savedRunCount: number;
}> = ({ onBuildLab, onOpenChallenges, onOpenSavedRuns, savedRunCount }) => (
  <div className="spd-explore-row">
    <button className="home-card spd-explore-card" onClick={onBuildLab}>
      <Network size={15} className="home-card-icon" />
      <div className="home-card-body">
        <div className="home-card-title">Network Lab</div>
        <div className="home-card-desc">Free-form routing canvas</div>
      </div>
      <ArrowRight size={13} className="home-card-arrow" />
    </button>
    <button className="home-card spd-explore-card" onClick={onOpenChallenges}>
      <Target size={15} className="home-card-icon" />
      <div className="home-card-body">
        <div className="home-card-title">All Challenges</div>
        <div className="home-card-desc">Browse the challenge library</div>
      </div>
      <ArrowRight size={13} className="home-card-arrow" />
    </button>
    <button className="home-card spd-explore-card" onClick={onOpenSavedRuns}>
      <Clock size={15} className="home-card-icon" />
      <div className="home-card-body">
        <div className="home-card-title">Saved Runs</div>
        <div className="home-card-desc">{savedRunCount > 0 ? `${savedRunCount} saved` : "Reload simulations"}</div>
      </div>
      <ArrowRight size={13} className="home-card-arrow" />
    </button>
  </div>
);

// ── Main dashboard ────────────────────────────────────────────────────────────

const StudentDashboard: React.FC<StudentDashboardProps> = ({
  assignedWorks,
  currentStudentId,
  currentStudentName,
  savedRuns,
  onOpenAssignment,
  onOpenChallenges,
  onBuildLab,
  onLoadLectureExample,
  onOpenSavedRuns,
  onOpenHelp,
  onOpenAssignedWork,
  onOpenChallenge,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const firstName = currentStudentName?.split(" ")[0] ?? "Student";

  const myWorks = useMemo(
    () => assignedWorks.filter((w) => isAssignedToStudent(w, currentStudentId)),
    [assignedWorks, currentStudentId]
  );

  const attentionCount = useMemo(() => {
    return myWorks.filter((w) => {
      const rec = getStudentWorkRecord(currentStudentId, w.workId);
      return rec.status === "needs_retry";
    }).length;
  }, [myWorks, currentStudentId]);

  const TAB_LABELS: Record<Tab, React.ReactNode> = {
    overview: <><BarChart3 size={11} /> Overview</>,
    progress: <><Award size={11} /> Progress</>,
    work: <>My Work{myWorks.length > 0 ? ` (${myWorks.length})` : ""}</>,
    timeline: <><Activity size={11} /> Timeline</>,
  };

  return (
    <div className="home-page spd-page">
      {/* Hero */}
      <div className="home-hero spd-hero">
        <div>
          <h2 className="dash-heading">
            {currentStudentName ? `Hey, ${firstName}` : "Student Dashboard"}
          </h2>
          <p className="dash-sub">
            {currentStudentId
              ? `${currentStudentId} · Track your progress, review your work, and keep learning.`
              : "Log in to see your personalized learning progress."}
          </p>
        </div>
        {currentStudentId && attentionCount > 0 && (
          <div className="spd-hero-alert" onClick={() => setActiveTab("work")}>
            <AlertCircle size={12} />
            {attentionCount} item{attentionCount > 1 ? "s" : ""} need{attentionCount === 1 ? "s" : ""} attention
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="dash-tabs">
        {(["overview", "progress", "work", "timeline"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`dash-tab${activeTab === t ? " dash-tab--active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <>
          <OverviewTab
            studentId={currentStudentId}
            firstName={firstName}
            assignedWorks={assignedWorks}
            onOpenChallenge={onOpenChallenge}
            onLoadLectureExample={onLoadLectureExample}
            onBuildLab={onBuildLab}
          />
          <div style={{ padding: "0 0 12px" }}>
            <ExploreActions
              onBuildLab={onBuildLab}
              onOpenChallenges={onOpenChallenges}
              onOpenSavedRuns={onOpenSavedRuns}
              savedRunCount={savedRuns.length}
            />
          </div>
        </>
      )}

      {activeTab === "progress" && (
        <ProgressTab studentId={currentStudentId} onOpenChallenge={onOpenChallenge} />
      )}

      {activeTab === "work" && (
        <WorkTab
          studentId={currentStudentId}
          assignedWorks={assignedWorks}
          onOpenAssignedWork={onOpenAssignedWork}
          onOpenAssignment={onOpenAssignment}
          onOpenHelp={onOpenHelp}
          onLoadLectureExample={onLoadLectureExample}
        />
      )}

      {activeTab === "timeline" && (
        <TimelineTab studentId={currentStudentId} />
      )}
    </div>
  );
};

export default StudentDashboard;
