import React, { useMemo, useState, useCallback } from "react";
import {
  Search, X, Download, ChevronUp, ChevronDown,
  ExternalLink, FileText, AlertTriangle, CheckCircle2,
  Clock, Lightbulb, Play, User, Filter,
} from "lucide-react";
import { ReviewRecord, ReviewStatus } from "../types/review";
import { exportGradebookCsv } from "../utils/reviewService";
import { loadTeacherNotes, saveTeacherNote } from "../utils/classroomStorage";
import { EXAMPLE_CHALLENGES } from "../utils/exampleChallenges";
import { EXAMPLE_ASSIGNMENTS } from "../utils/exampleAssignments";

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<ReviewStatus, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "src-status--gray" },
  in_progress:  { label: "In progress",  cls: "src-status--blue" },
  submitted:    { label: "Submitted",    cls: "src-status--yellow" },
  checked:      { label: "Checked",      cls: "src-status--green" },
  needs_review: { label: "Needs review", cls: "src-status--red" },
};

const StatusBadge: React.FC<{ status: ReviewStatus }> = ({ status }) => {
  const { label, cls } = STATUS_CFG[status] ?? STATUS_CFG.not_started;
  return <span className={`src-status-badge ${cls}`}>{label}</span>;
};

// ── Score badge ───────────────────────────────────────────────────────────────

function scoreClass(pct: number | null): string {
  if (pct === null) return "src-score--gray";
  if (pct >= 90) return "src-score--green";
  if (pct >= 70) return "src-score--blue";
  if (pct >= 50) return "src-score--amber";
  return "src-score--red";
}

const ScoreBadge: React.FC<{ score: number | null; maxScore: number; pct: number | null }> = ({
  score, maxScore, pct,
}) => (
  <span className={`src-score-badge ${scoreClass(pct)}`}>
    {score !== null ? `${score}/${maxScore}` : "—"}
  </span>
);

// ── Sort indicator ────────────────────────────────────────────────────────────

type SortKey = "submittedAt" | "score" | "attempts" | "student" | "status";
type SortDir = "asc" | "desc";

const SortBtn: React.FC<{
  col: SortKey; current: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}> = ({ col, current, dir, onSort }) => (
  <button className="src-sort-btn" onClick={() => onSort(col)} title={`Sort by ${col}`}>
    {current === col
      ? dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
      : <ChevronDown size={11} style={{ opacity: 0.3 }} />}
  </button>
);

// ── Review drawer ─────────────────────────────────────────────────────────────

interface DrawerProps {
  record: ReviewRecord;
  note: string;
  onNoteChange: (n: string) => void;
  onOpenChallenge: (workId: string) => void;
  onClose: () => void;
}

const ReviewDrawer: React.FC<DrawerProps> = ({
  record, note, onNoteChange, onOpenChallenge, onClose,
}) => {
  // Look up full assignment from example libraries
  const assignment = useMemo(() => {
    return (
      EXAMPLE_CHALLENGES.find((c) => c.assignmentId === record.workId) ??
      EXAMPLE_ASSIGNMENTS.find((a) => a.assignmentId === record.workId) ??
      null
    );
  }, [record.workId]);

  const expectedAnswer = useMemo(() => {
    if (!assignment?.expectedSolution) return null;
    const es = assignment.expectedSolution;
    const parts: string[] = [];
    if (es.congestedLinks?.length) parts.push(`Congested links: ${es.congestedLinks.join(", ")}`);
    if (es.maxUtilizationTarget !== undefined) parts.push(`Max utilization target: ${(es.maxUtilizationTarget * 100).toFixed(0)}%`);
    if (es.explanation) parts.push(es.explanation);
    return parts.join("\n") || null;
  }, [assignment]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `review-${record.reviewId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="src-drawer-overlay" onClick={onClose} />
      <div className="src-drawer src-drawer--open">
        {/* Header */}
        <div className="src-drawer-header">
          <div className="src-drawer-header-top">
            <div className="src-drawer-student">
              <User size={13} />
              <span className="src-drawer-student-name">{record.studentName}</span>
              <span className="src-drawer-student-id">{record.studentId}</span>
            </div>
            <button className="src-drawer-close" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          </div>
          <div className="src-drawer-title">{record.workTitle}</div>
          <div className="src-drawer-meta">
            <StatusBadge status={record.status} />
            <ScoreBadge score={record.score} maxScore={record.maxScore} pct={record.percentage} />
            {record.topic && (
              <span className="chip chip--topic">{record.topic.replace("_", " ")}</span>
            )}
            {record.difficulty && (
              <span className={`chip ${record.difficulty === "beginner" ? "chip--green" : record.difficulty === "advanced" ? "chip--red" : "chip--amber"}`}>
                {record.difficulty}
              </span>
            )}
          </div>
          {record.isDemo && (
            <div className="src-demo-pill">Prototype demo data — not real student submission</div>
          )}
        </div>

        {/* Score breakdown */}
        <div className="src-drawer-section">
          <div className="src-drawer-section-title">Submission details</div>
          <div className="src-drawer-stats">
            <div className="src-drawer-stat">
              <div className="src-drawer-stat-label">Score</div>
              <div className="src-drawer-stat-value">
                {record.score !== null ? `${record.score} / ${record.maxScore}` : "Not submitted"}
              </div>
            </div>
            <div className="src-drawer-stat">
              <div className="src-drawer-stat-label">Attempts</div>
              <div className="src-drawer-stat-value">{record.attempts || "—"}</div>
            </div>
            <div className="src-drawer-stat">
              <div className="src-drawer-stat-label">Hints used</div>
              <div className="src-drawer-stat-value">{record.hintsUsed || "—"}</div>
            </div>
            <div className="src-drawer-stat">
              <div className="src-drawer-stat-label">Replay used</div>
              <div className="src-drawer-stat-value">{record.replayUsed ? "Yes" : "No"}</div>
            </div>
            <div className="src-drawer-stat">
              <div className="src-drawer-stat-label">Submitted</div>
              <div className="src-drawer-stat-value">
                {record.submittedAt ? fmtDate(record.submittedAt) : "—"}
              </div>
            </div>
            {record.dueDate && (
              <div className="src-drawer-stat">
                <div className="src-drawer-stat-label">Due</div>
                <div className="src-drawer-stat-value">{fmtDate(record.dueDate)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Assignment / expected answer */}
        {assignment && (
          <div className="src-drawer-section">
            <div className="src-drawer-section-title">Assignment</div>
            <p className="src-drawer-text">{assignment.studentTask.prompt}</p>
            {expectedAnswer && (
              <>
                <div className="src-drawer-sub-label">Expected answer</div>
                <pre className="src-drawer-answer">{expectedAnswer}</pre>
              </>
            )}
          </div>
        )}

        {/* Status context */}
        {record.status === "needs_review" && (
          <div className="src-drawer-alert src-drawer-alert--warn">
            <AlertTriangle size={12} />
            This submission scored below 60% or exhausted all attempts. Manual review recommended.
          </div>
        )}
        {record.status === "checked" && (
          <div className="src-drawer-alert src-drawer-alert--ok">
            <CheckCircle2 size={12} />
            This submission has been marked as checked.
          </div>
        )}

        {/* Teacher notes */}
        <div className="src-drawer-section">
          <div className="src-drawer-section-title">Teacher notes</div>
          <textarea
            className="src-notes-area"
            rows={4}
            placeholder="Add private notes about this submission..."
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
          />
          <p className="src-drawer-hint">Notes are saved locally in your browser.</p>
        </div>

        {/* Actions */}
        <div className="src-drawer-section">
          <div className="src-drawer-section-title">Actions</div>
          <div className="src-drawer-actions">
            {record.workType === "challenge" && (
              <button
                className="btn-primary btn-sm"
                onClick={() => onOpenChallenge(record.workId)}
              >
                <Play size={12} /> Open in Challenge Mode
              </button>
            )}
            <button className="btn-secondary btn-sm" onClick={exportJson}>
              <Download size={12} /> Export record JSON
            </button>
          </div>
          {record.workType === "challenge" && (
            <p className="src-drawer-hint">
              Replay and Compare are available in Challenge Mode after running the simulation.
            </p>
          )}
        </div>
      </div>
    </>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

interface SubmissionReviewCenterProps {
  records: ReviewRecord[];
  onOpenChallenge: (workId: string) => void;
}

const SubmissionReviewCenter: React.FC<SubmissionReviewCenterProps> = ({
  records,
  onOpenChallenge,
}) => {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<ReviewStatus | "all">("all");
  const [filterType, setFilterType] = useState<"all" | "assignment" | "challenge">("all");
  const [filterTopic, setFilterTopic] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedRecord, setSelectedRecord] = useState<ReviewRecord | null>(null);
  const [teacherNotes, setTeacherNotes] = useState<Record<string, string>>(() => loadTeacherNotes());

  // Derive available topics for filter
  const topics = useMemo(() => {
    const t = new Set(records.map((r) => r.topic).filter(Boolean));
    return ["all", ...Array.from(t).sort()];
  }, [records]);

  // Filter
  const filtered = useMemo(() => {
    let rs = records;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rs = rs.filter(
        (r) =>
          r.studentName.toLowerCase().includes(q) ||
          r.workTitle.toLowerCase().includes(q) ||
          r.studentId.toLowerCase().includes(q),
      );
    }
    if (filterStatus !== "all") rs = rs.filter((r) => r.status === filterStatus);
    if (filterType !== "all") rs = rs.filter((r) => r.workType === filterType);
    if (filterTopic !== "all") rs = rs.filter((r) => r.topic === filterTopic);
    return rs;
  }, [records, search, filterStatus, filterType, filterTopic]);

  // Sort
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let va: number | string, vb: number | string;
      switch (sortKey) {
        case "score":
          va = a.percentage ?? -1;
          vb = b.percentage ?? -1;
          break;
        case "attempts":
          va = a.attempts;
          vb = b.attempts;
          break;
        case "student":
          va = a.studentName;
          vb = b.studentName;
          break;
        case "status": {
          const order: Record<string, number> = { needs_review: 0, submitted: 1, in_progress: 2, checked: 3, not_started: 4 };
          va = order[a.status] ?? 5;
          vb = order[b.status] ?? 5;
          break;
        }
        default: // submittedAt
          va = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
          vb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  const handleNoteChange = (note: string) => {
    if (!selectedRecord) return;
    setTeacherNotes((prev) => ({ ...prev, [selectedRecord.reviewId]: note }));
    saveTeacherNote(selectedRecord.reviewId, note);
  };

  // Summary pills
  const needsReview = records.filter((r) => r.status === "needs_review").length;
  const submitted = records.filter((r) => r.status === "submitted" || r.status === "checked" || r.status === "needs_review").length;
  const hasDemoData = records.some((r) => r.isDemo);

  return (
    <div className="src-layout">
      {/* Demo banner */}
      {hasDemoData && (
        <div className="src-demo-banner">
          <FileText size={12} />
          Prototype — demo data shown. Connect MongoDB and have students submit work to see real submissions.
        </div>
      )}

      {/* Quick stats */}
      <div className="src-quick-stats">
        <div className="src-quick-stat">
          <span className="src-quick-stat-val">{records.length}</span>
          <span className="src-quick-stat-label">Total records</span>
        </div>
        <div className="src-quick-stat">
          <span className="src-quick-stat-val">{submitted}</span>
          <span className="src-quick-stat-label">Submitted</span>
        </div>
        <div className={`src-quick-stat${needsReview > 0 ? " src-quick-stat--warn" : ""}`}>
          <span className="src-quick-stat-val">{needsReview}</span>
          <span className="src-quick-stat-label">Needs review</span>
        </div>
        <div className="src-quick-stat">
          <span className="src-quick-stat-val">
            {(() => {
              const withScore = records.filter((r) => r.percentage !== null);
              if (!withScore.length) return "—";
              return Math.round(withScore.reduce((s, r) => s + (r.percentage ?? 0), 0) / withScore.length) + "%";
            })()}
          </span>
          <span className="src-quick-stat-label">Avg score</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="src-toolbar">
        <div className="src-search-wrap">
          <Search size={13} className="src-search-icon" />
          <input
            className="src-search"
            type="text"
            placeholder="Search student or assignment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="src-search-clear" onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="src-filters">
          <Filter size={11} className="src-filter-icon" />
          <select
            className="src-filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as ReviewStatus | "all")}
          >
            <option value="all">All statuses</option>
            <option value="needs_review">Needs review</option>
            <option value="submitted">Submitted</option>
            <option value="in_progress">In progress</option>
            <option value="checked">Checked</option>
            <option value="not_started">Not started</option>
          </select>

          <select
            className="src-filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as "all" | "assignment" | "challenge")}
          >
            <option value="all">All types</option>
            <option value="challenge">Challenges</option>
            <option value="assignment">Assignments</option>
          </select>

          <select
            className="src-filter-select"
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value)}
          >
            {topics.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All topics" : t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="src-toolbar-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => exportGradebookCsv(sorted)}
            title="Export gradebook as CSV"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="src-empty">
          {records.length === 0 ? (
            <>
              <div className="src-empty-icon"><Lightbulb size={24} /></div>
              <div className="src-empty-title">No submissions yet</div>
              <p className="src-empty-desc">
                Assign work to students and have them submit. Submissions will appear here.
              </p>
            </>
          ) : (
            <>
              <div className="src-empty-icon"><Search size={24} /></div>
              <div className="src-empty-title">No matching submissions</div>
              <p className="src-empty-desc">Try clearing filters or adjusting your search.</p>
              <button className="btn-secondary btn-sm" onClick={() => { setSearch(""); setFilterStatus("all"); setFilterType("all"); setFilterTopic("all"); }}>
                Clear all filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="src-table-wrap">
          <table className="src-table">
            <thead>
              <tr>
                <th>
                  Student
                  <SortBtn col="student" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th>Work</th>
                <th>Type</th>
                <th>
                  Status
                  <SortBtn col="status" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th>
                  Score
                  <SortBtn col="score" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th>
                  Attempts
                  <SortBtn col="attempts" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th>Hints</th>
                <th>
                  Submitted
                  <SortBtn col="submittedAt" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.reviewId}
                  className={`src-row${selectedRecord?.reviewId === r.reviewId ? " src-row--selected" : ""}${r.status === "needs_review" ? " src-row--warn" : ""}`}
                >
                  <td>
                    <div className="src-student-cell">
                      <span className="src-student-name">{r.studentName}</span>
                      <span className="src-student-id">{r.studentId}</span>
                    </div>
                  </td>
                  <td>
                    <span className="src-work-title">{r.workTitle}</span>
                    {r.topic && (
                      <span className="src-work-topic">{r.topic.replace("_", " ")}</span>
                    )}
                  </td>
                  <td>
                    <span className={`src-type-badge src-type-badge--${r.workType}`}>
                      {r.workType}
                    </span>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <ScoreBadge score={r.score} maxScore={r.maxScore} pct={r.percentage} />
                  </td>
                  <td className="src-num-cell">{r.attempts || "—"}</td>
                  <td className="src-num-cell">
                    {r.hintsUsed > 0 ? (
                      <span className="src-hint-pill">
                        <Lightbulb size={9} /> {r.hintsUsed}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="src-time-cell">
                    <span title={r.submittedAt ?? ""}>
                      <Clock size={10} style={{ marginRight: 3 }} />
                      {relTime(r.submittedAt)}
                    </span>
                  </td>
                  <td>
                    <div className="src-row-actions">
                      <button
                        className="src-action-btn src-action-btn--primary"
                        onClick={() => setSelectedRecord(r)}
                      >
                        <ExternalLink size={11} /> Review
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Count */}
      {sorted.length > 0 && (
        <div className="src-count-row">
          Showing {sorted.length} of {records.length} record{records.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Drawer */}
      {selectedRecord && (
        <ReviewDrawer
          record={selectedRecord}
          note={teacherNotes[selectedRecord.reviewId] ?? ""}
          onNoteChange={handleNoteChange}
          onOpenChallenge={(workId) => {
            onOpenChallenge(workId);
            setSelectedRecord(null);
          }}
          onClose={() => setSelectedRecord(null)}
        />
      )}
    </div>
  );
};

export default SubmissionReviewCenter;
