import React, { useState, useEffect, useMemo } from "react";
import {
  Users, FileText, Target, Upload, BarChart2, Clock, RefreshCcw,
  Lightbulb, Play, BookOpen, Download, Activity, Timer, Network,
  HelpCircle, ArrowRight, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, FileDown, TrendingUp, Zap,
} from "lucide-react";
import { AssignmentSummary } from "../types/assignment";
import { AssignedWork } from "../types/classroom";
import { SavedSimulationSummary } from "../types/network";
import { ActivityAction, ActivityEvent, CourseInsight, StudentMetrics } from "../types/analytics";
import {
  computeCourseMetrics,
  computeStudentMetrics,
  computeInsights,
  mergeActivityLog,
} from "../utils/analyticsService";
import { loadActivityLog } from "../utils/classroomStorage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function actionLabel(action: ActivityAction, subject: string, actor: string): string {
  switch (action) {
    case "submitted": return `${actor} submitted ${subject}`;
    case "completed_challenge": return `${actor} completed ${subject}`;
    case "watched_replay": return `${actor} replayed ${subject}`;
    case "opened_lecture": return `${actor} opened lecture: ${subject}`;
    case "exported_pdf": return `${actor} exported PDF — ${subject}`;
    case "assigned_work": return `${actor} assigned ${subject}`;
    case "exported_json": return `${actor} exported JSON — ${subject}`;
    case "opened_assignment": return `${actor} opened ${subject}`;
    default: return `${actor} — ${subject}`;
  }
}

function ActivityIcon({ action }: { action: ActivityAction }) {
  const s = 13;
  switch (action) {
    case "submitted": return <Upload size={s} />;
    case "completed_challenge": return <Target size={s} />;
    case "watched_replay": return <Play size={s} />;
    case "opened_lecture": return <BookOpen size={s} />;
    case "exported_pdf": return <FileDown size={s} />;
    case "assigned_work": return <Users size={s} />;
    case "exported_json": return <Download size={s} />;
    case "opened_assignment": return <FileText size={s} />;
    default: return <Activity size={s} />;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 65) return "#fbbf24";
  return "#f87171";
}

function StatusChip({ status }: { status: StudentMetrics["status"] }) {
  const map = {
    on_track: { label: "On track", icon: <CheckCircle2 size={11} />, cls: "st-chip--green" },
    at_risk: { label: "At risk", icon: <AlertTriangle size={11} />, cls: "st-chip--yellow" },
    not_started: { label: "Needs help", icon: <XCircle size={11} />, cls: "st-chip--red" },
  };
  const { label, icon, cls } = map[status];
  return <span className={`st-chip ${cls}`}>{icon}{label}</span>;
}

// ── Progress bar with mount animation ────────────────────────────────────────

function ProgressBar({ value, color = "blue", thin = false }: { value: number; color?: string; thin?: boolean }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(value), 80);
    return () => clearTimeout(t);
  }, [value]);

  const clr = color === "green" ? "#4ade80" : color === "yellow" ? "#fbbf24" : color === "red" ? "#f87171" : "var(--accent)";
  return (
    <div className={`tov-pbar${thin ? " tov-pbar--thin" : ""}`}>
      <div className="tov-pbar-fill" style={{ width: `${width}%`, background: clr }} />
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  subtitle: string;
  accentColor?: string;
  isEstimate?: boolean;
  delay?: number;
}

function MetricCard({ icon, title, value, subtitle, accentColor = "var(--accent)", isEstimate, delay = 0 }: MetricCardProps) {
  return (
    <div className="tov-metric" style={{ animationDelay: `${delay * 60}ms` }}>
      <div className="tov-metric-icon" style={{ background: `${accentColor}18`, color: accentColor }}>{icon}</div>
      <div className="tov-metric-body">
        <div className="tov-metric-title">{title}</div>
        <div className="tov-metric-value">{value}</div>
        <div className="tov-metric-sub">
          {subtitle}
          {isEstimate && <span className="tov-est-badge">est.</span>}
        </div>
      </div>
    </div>
  );
}

// ── Course health card ────────────────────────────────────────────────────────

function CourseHealthCard({ completionPct, assignmentPct, challengePct, replayPct }: {
  completionPct: number; assignmentPct: number; challengePct: number; replayPct: number;
}) {
  const bars = [
    { label: "Assignments", value: assignmentPct, color: assignmentPct >= 70 ? "green" : assignmentPct >= 40 ? "yellow" : "red" },
    { label: "Challenges", value: challengePct, color: challengePct >= 70 ? "green" : challengePct >= 40 ? "yellow" : "red" },
    { label: "Replay adoption", value: replayPct, color: replayPct >= 60 ? "green" : "yellow" },
  ];

  return (
    <div className="tov-card tov-health">
      <div className="tov-card-heading">Course Health</div>
      <div className="tov-health-main">
        <div className="tov-health-pct" style={{ color: completionPct >= 70 ? "#4ade80" : completionPct >= 40 ? "#fbbf24" : "#f87171" }}>
          {completionPct}%
        </div>
        <div className="tov-health-label">Overall completion</div>
        <ProgressBar value={completionPct} color={completionPct >= 70 ? "green" : completionPct >= 40 ? "yellow" : "red"} />
      </div>
      <div className="tov-health-bars">
        {bars.map(b => (
          <div key={b.label} className="tov-health-bar-row">
            <span className="tov-health-bar-label">{b.label}</span>
            <ProgressBar value={b.value} color={b.color} thin />
            <span className="tov-health-bar-pct">{b.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Activity timeline ─────────────────────────────────────────────────────────

function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="tov-card tov-activity">
      <div className="tov-card-heading">Recent Activity</div>
      <div className="tov-activity-list">
        {events.slice(0, 8).map((ev, i) => (
          <div key={ev.id} className="tov-activity-item" style={{ animationDelay: `${i * 40}ms` }}>
            <div className={`tov-act-icon ${ev.actorType === "teacher" ? "tov-act-icon--teacher" : "tov-act-icon--student"}`}>
              <ActivityIcon action={ev.action} />
            </div>
            <div className="tov-act-body">
              <div className="tov-act-desc">
                {actionLabel(ev.action, ev.subject, ev.actorName)}
              </div>
              <div className="tov-act-time">{relativeTime(ev.timestamp)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Student performance table ─────────────────────────────────────────────────

function StudentTable({ students }: { students: StudentMetrics[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="tov-card tov-student-card">
      <div className="tov-card-heading">Student Performance</div>
      <div className="tov-student-note">Performance data are prototype estimates. Real data requires backend submission tracking.</div>
      <table className="tov-student-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Assignments</th>
            <th>Challenges</th>
            <th>Avg Score</th>
            <th>Attempts</th>
            <th>Hints</th>
            <th>Replays</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {students.map(s => (
            <React.Fragment key={s.studentId}>
              <tr
                className={`tov-student-row${expanded === s.studentId ? " tov-student-row--expanded" : ""}`}
                onClick={() => setExpanded(expanded === s.studentId ? null : s.studentId)}
              >
                <td>
                  <div className="tov-student-name">
                    <span className={`tov-student-dot tov-student-dot--${s.status}`} />
                    {s.name.split(" ")[0]}
                    <span className="tov-student-id">{s.studentId}</span>
                  </div>
                </td>
                <td>
                  <div className="tov-prog-cell">
                    <span>{s.assignmentsCompleted}/{s.assignmentsTotal}</span>
                    <ProgressBar value={Math.round(s.assignmentsCompleted / s.assignmentsTotal * 100)} color="blue" thin />
                  </div>
                </td>
                <td>
                  <div className="tov-prog-cell">
                    <span>{s.challengesCompleted}/{s.challengesTotal}</span>
                    <ProgressBar value={Math.round(s.challengesCompleted / s.challengesTotal * 100)} color="orange" thin />
                  </div>
                </td>
                <td>
                  <span className="tov-score" style={{ color: scoreColor(s.averageScore) }}>
                    {s.averageScore}%
                  </span>
                </td>
                <td className="tov-num">{s.totalAttempts}</td>
                <td className="tov-num">{s.hintsUsed}</td>
                <td className="tov-num">{s.replays}</td>
                <td><StatusChip status={s.status} /></td>
                <td>
                  <button className="icon-btn">
                    {expanded === s.studentId ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </td>
              </tr>
              {expanded === s.studentId && (
                <tr className="tov-expanded-row">
                  <td colSpan={9}>
                    <div className="tov-expanded-body">
                      <div className="tov-expanded-grid">
                        <div className="tov-expanded-section">
                          <div className="tov-expanded-label">Assignment progress</div>
                          <ProgressBar value={Math.round(s.assignmentsCompleted / s.assignmentsTotal * 100)} color={s.assignmentsCompleted === s.assignmentsTotal ? "green" : "blue"} />
                          <div className="tov-expanded-stat">{s.assignmentsCompleted} of {s.assignmentsTotal} completed · avg {s.averageScore}%</div>
                        </div>
                        <div className="tov-expanded-section">
                          <div className="tov-expanded-label">Challenge progress</div>
                          <ProgressBar value={Math.round(s.challengesCompleted / s.challengesTotal * 100)} color={s.challengesCompleted === s.challengesTotal ? "green" : "orange"} />
                          <div className="tov-expanded-stat">{s.challengesCompleted} of {s.challengesTotal} solved</div>
                        </div>
                        <div className="tov-expanded-section">
                          <div className="tov-expanded-label">Engagement</div>
                          <div className="tov-expanded-pills">
                            <span className="tov-pill">{s.totalAttempts} attempts</span>
                            <span className="tov-pill">{s.hintsUsed} hint{s.hintsUsed !== 1 ? "s" : ""} used</span>
                            <span className="tov-pill">{s.replays} replay{s.replays !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                        <div className="tov-expanded-section">
                          <div className="tov-expanded-label">Recommendation</div>
                          <div className="tov-expanded-rec">
                            {s.status === "on_track" && "Strong performer. No immediate action needed."}
                            {s.status === "at_risk" && "Moderate performance. Consider a check-in or additional hints."}
                            {s.status === "not_started" && "Falling behind. Recommend direct outreach and extra support."}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Insights grid ─────────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: CourseInsight }) {
  const colorMap: Record<string, string> = {
    green: "#4ade80", yellow: "#fbbf24", red: "#f87171", blue: "var(--accent)",
  };
  const clr = colorMap[insight.severity] ?? "var(--accent)";
  return (
    <div className="tov-insight" style={{ borderLeftColor: clr }}>
      <div className="tov-insight-value" style={{ color: clr }}>{insight.value}</div>
      <div className="tov-insight-title">{insight.title}</div>
      <div className="tov-insight-sub">{insight.subtitle}</div>
    </div>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────────

interface QAItem {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
  primary?: boolean;
}

function QuickActions({ items }: { items: QAItem[] }) {
  return (
    <div className="tov-card">
      <div className="tov-card-heading">Quick Actions</div>
      <div className="tov-qa-grid">
        {items.map(item => (
          <button
            key={item.label}
            className={`tov-qa-btn${item.primary ? " tov-qa-btn--primary" : ""}`}
            onClick={item.onClick}
          >
            <div className="tov-qa-icon">{item.icon}</div>
            <div className="tov-qa-body">
              <div className="tov-qa-label">{item.label}</div>
              <div className="tov-qa-desc">{item.desc}</div>
            </div>
            <ArrowRight size={13} className="tov-qa-arrow" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface TeacherOverviewPageProps {
  savedAssignments: AssignmentSummary[];
  assignedWorks: AssignedWork[];
  savedRuns: SavedSimulationSummary[];
  onCreateAssignment: () => void;
  onBuildLab: () => void;
  onOpenChallenges: () => void;
  onOpenSavedRuns: () => void;
  onImportJson: () => void;
  onOpenHelp: () => void;
}

const TeacherOverviewPage: React.FC<TeacherOverviewPageProps> = ({
  savedAssignments,
  assignedWorks,
  savedRuns,
  onCreateAssignment,
  onBuildLab,
  onOpenChallenges,
  onOpenSavedRuns,
  onImportJson,
  onOpenHelp,
}) => {
  const metrics = useMemo(
    () => computeCourseMetrics(savedAssignments, assignedWorks),
    [savedAssignments, assignedWorks]
  );
  const students = useMemo(
    () => computeStudentMetrics(savedAssignments),
    [savedAssignments]
  );
  const insights = useMemo(
    () => computeInsights(metrics, students),
    [metrics, students]
  );
  const activity = useMemo(
    () => mergeActivityLog(loadActivityLog()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const metricCards = [
    { id: "students", icon: <Users size={18} />, title: "Students", value: metrics.studentCount, subtitle: "Registered in course", color: "#60a5fa" },
    { id: "assignments", icon: <FileText size={18} />, title: "Assignments", value: metrics.assignmentCount, subtitle: "Created", color: "#a78bfa" },
    { id: "challenges", icon: <Target size={18} />, title: "Challenges", value: metrics.challengeCount, subtitle: "Published", color: "#fb923c" },
    { id: "submissions", icon: <Upload size={18} />, title: "Submissions", value: metrics.submissionCount, subtitle: "Total received", color: "#4ade80", est: true },
    { id: "score", icon: <BarChart2 size={18} />, title: "Avg Score", value: `${metrics.averageScore}%`, subtitle: "Across submissions", color: scoreColor(metrics.averageScore), est: true },
    { id: "pending", icon: <Clock size={18} />, title: "Pending Reviews", value: metrics.pendingReviews, subtitle: metrics.pendingReviews > 0 ? "Need attention" : "All reviewed", color: metrics.pendingReviews > 0 ? "#fbbf24" : "#4ade80" },
    { id: "attempts", icon: <RefreshCcw size={18} />, title: "Avg Attempts", value: metrics.averageAttempts, subtitle: "Per submission", color: "#60a5fa", est: true },
    { id: "replay", icon: <Play size={18} />, title: "Replay Usage", value: `${metrics.replayUsagePct}%`, subtitle: "Students used trace replay", color: "#a78bfa", est: true },
    { id: "hints", icon: <Lightbulb size={18} />, title: "Hint Usage", value: `${metrics.hintUsagePct}%`, subtitle: "Avg per challenge attempt", color: "#fbbf24", est: true },
    { id: "time", icon: <Timer size={18} />, title: "Avg Completion", value: `${metrics.averageCompletionTimeMin} min`, subtitle: "Per assignment", color: "#60a5fa", est: true },
  ];

  const qaItems: QAItem[] = [
    { icon: <FileText size={16} />, label: "Create Assignment", desc: "Build a new task for students", onClick: onCreateAssignment, primary: true },
    { icon: <Target size={16} />, label: "Challenge Library", desc: "Preview and assign challenges", onClick: onOpenChallenges },
    { icon: <Network size={16} />, label: "Open Network Lab", desc: "Free-form canvas demo", onClick: onBuildLab },
    { icon: <BookOpen size={16} />, label: "Lecture Library", desc: "Load pre-built examples", onClick: onBuildLab },
    { icon: <Upload size={16} />, label: "Import Assignment", desc: "Import from JSON file", onClick: onImportJson },
    { icon: <HelpCircle size={16} />, label: "JSON Guide", desc: "How assignment files work", onClick: onOpenHelp },
  ];

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="tov-page">
      {/* ── Header ── */}
      <div className="tov-header">
        <div>
          <div className="tov-course">Network Engineering · WS2026</div>
          <h2 className="tov-title">Teacher Dashboard</h2>
          <p className="tov-greeting">{greeting()}, Professor.</p>
        </div>
        <div className="tov-header-right">
          <div className="tov-date">{today}</div>
          <div className="tov-demo-note">
            <Zap size={11} /> Prototype — performance data are derived estimates
          </div>
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="tov-metrics">
        {metricCards.map((c, i) => (
          <MetricCard
            key={c.id}
            icon={c.icon}
            title={c.title}
            value={c.value}
            subtitle={c.subtitle}
            accentColor={c.color}
            isEstimate={c.est}
            delay={i}
          />
        ))}
      </div>

      {/* ── Course health + Activity timeline ── */}
      <div className="tov-mid">
        <CourseHealthCard
          completionPct={metrics.completionPct}
          assignmentPct={metrics.assignmentCompletionPct}
          challengePct={metrics.challengeCompletionPct}
          replayPct={metrics.replayUsagePct}
        />
        <ActivityTimeline events={activity} />
      </div>

      {/* ── Student performance ── */}
      <StudentTable students={students} />

      {/* ── Course insights ── */}
      <div className="tov-card">
        <div className="tov-card-heading">
          <TrendingUp size={15} /> Course Insights
        </div>
        <div className="tov-insight-grid">
          {insights.map(ins => <InsightCard key={ins.id} insight={ins} />)}
        </div>
      </div>

      {/* ── Quick actions ── */}
      <QuickActions items={qaItems} />
    </div>
  );
};

export default TeacherOverviewPage;
