import React, { useState, useMemo } from "react";
import {
  FileText, Network, BookOpen, Clock, FileJson, HelpCircle, RefreshCw,
  ArrowRight, ChevronDown, ChevronUp, Check, Lightbulb, Users, Download, FileDown,
  LayoutDashboard, ClipboardList,
} from "lucide-react";
import { LectureExample, LECTURE_EXAMPLES } from "../utils/lectureExamples";
import { SavedSimulationSummary } from "../types/network";
import { AssignmentSummary } from "../types/assignment";
import { AssignedWork } from "../types/classroom";
import { DEMO_STUDENTS } from "../utils/demoUsers";
import AssignWorkModal from "../components/AssignWorkModal";
import TeacherOverviewPage from "./TeacherOverviewPage";
import SubmissionReviewCenter from "../components/SubmissionReviewCenter";
import { buildReviewRecords } from "../utils/reviewService";

type Tab = "overview" | "assignments" | "submissions" | "lab";

interface TeacherDashboardProps {
  savedAssignments: AssignmentSummary[];
  assignedWorks: AssignedWork[];
  savedRuns: SavedSimulationSummary[];
  onCreateAssignment: () => void;
  onBuildLab: () => void;
  onLoadLectureExample: (ex: LectureExample) => void;
  onOpenChallenges: () => void;
  onOpenSavedRuns: () => void;
  onImportJson: () => void;
  onDownloadExampleTopology: () => void;
  onOpenHelp: () => void;
  onAssignWork: (work: AssignedWork) => void;
  onExportAssignmentJson: (assignmentId: string) => void;
  onExportAssignmentPdf: (assignmentId: string, includeAnswer: boolean) => void;
  onRefreshAssignments: () => void;
  onOpenChallenge?: (workId: string) => void;
}

interface PendingAssign {
  workType: "assignment" | "challenge";
  workId: string;
  workTitle: string;
  workTopic?: string;
  workMode?: string;
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}

function assignedToLabel(a: AssignedWork): string {
  if (a.assignedTo === "all") return `All students (${DEMO_STUDENTS.length})`;
  const names = (a.assignedTo as string[])
    .map((id) => DEMO_STUDENTS.find((s) => s.studentId === id)?.name?.split(" ")[0] ?? id)
    .join(", ");
  return names || "—";
}

const ModeBadge: React.FC<{ mode: string }> = ({ mode }) => (
  <span className={`mode-badge mode-badge--${mode}`}>{mode}</span>
);

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  savedAssignments,
  assignedWorks,
  savedRuns,
  onCreateAssignment,
  onBuildLab,
  onLoadLectureExample,
  onOpenChallenges,
  onOpenSavedRuns,
  onImportJson,
  onDownloadExampleTopology,
  onOpenHelp,
  onAssignWork,
  onExportAssignmentJson,
  onExportAssignmentPdf,
  onRefreshAssignments,
  onOpenChallenge,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const reviewRecords = useMemo(
    () => buildReviewRecords(assignedWorks, savedAssignments),
    [assignedWorks, savedAssignments],
  );
  const pendingReviews = reviewRecords.filter((r) => r.status === "needs_review").length;
  const [showLectures, setShowLectures] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null);

  return (
    <div className="home-page">
      <div className="home-hero">
        <h2 className="dash-heading">Teacher Dashboard</h2>
        <p className="dash-sub">Manage assignments, review submissions, and run live demos.</p>
      </div>

      {/* ── Tabs ── */}
      <div className="dash-tabs">
        {(["overview", "assignments", "submissions", "lab"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`dash-tab${activeTab === t ? " dash-tab--active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t === "overview" && <><LayoutDashboard size={11} /> Overview</>}
            {t === "assignments" && `Assignments${savedAssignments.length > 0 ? ` (${savedAssignments.length})` : ""}`}
            {t === "submissions" && (
              <>
                <ClipboardList size={11} />
                Submissions
                {pendingReviews > 0 && (
                  <span className="dash-tab-badge src-status-badge src-status--red">{pendingReviews}</span>
                )}
              </>
            )}
            {t === "lab" && "Lab & Demos"}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === "overview" && (
        <TeacherOverviewPage
          savedAssignments={savedAssignments}
          assignedWorks={assignedWorks}
          savedRuns={savedRuns}
          onCreateAssignment={onCreateAssignment}
          onBuildLab={onBuildLab}
          onOpenChallenges={onOpenChallenges}
          onOpenSavedRuns={onOpenSavedRuns}
          onImportJson={onImportJson}
          onOpenHelp={onOpenHelp}
        />
      )}

      {/* ── Assignments tab ── */}
      {activeTab === "assignments" && (
        <div className="dash-tab-content">
          <div className="dash-tab-toolbar">
            <button className="btn-primary btn-sm" onClick={onCreateAssignment}>
              <FileText size={12} /> Create New Assignment
            </button>
            <button className="btn-secondary btn-sm" onClick={onRefreshAssignments} title="Refresh from MongoDB">
              <RefreshCw size={12} /> Refresh
            </button>
            <span className="dash-tab-toolbar-note">
              {savedAssignments.length > 0
                ? `${savedAssignments.length} assignment${savedAssignments.length > 1 ? "s" : ""} saved`
                : "Requires MongoDB"}
            </span>
          </div>

          {savedAssignments.length === 0 ? (
            <div className="dash-empty-box">
              <div className="dash-empty-icon"><FileText size={22} /></div>
              <div className="dash-empty-title">No assignments yet</div>
              <p className="dash-empty-desc">
                Click <strong>Create New Assignment</strong> to open the Teacher Workspace, then save
                your work. MongoDB must be running for assignments to persist.
              </p>
              <button className="btn-primary btn-sm" onClick={onCreateAssignment}>
                <FileText size={12} /> Create New Assignment
              </button>
            </div>
          ) : (
            <div className="assign-table-wrap">
              <table className="assign-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Topic</th>
                    <th>Mode</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedAssignments.map((a) => (
                    <tr key={a.assignmentId} className="assign-table-row">
                      <td className="assign-table-title">{a.title}</td>
                      <td className="assign-table-topic">{a.topic}</td>
                      <td><ModeBadge mode={a.mode} /></td>
                      <td className="assign-table-date">{a.createdAt ? formatDate(a.createdAt) : "—"}</td>
                      <td>
                        <div className="assign-table-actions">
                          <button
                            className="btn-secondary btn-xs"
                            title="Assign to students"
                            onClick={() =>
                              setPendingAssign({
                                workType: a.mode === "challenge" ? "challenge" : "assignment",
                                workId: a.assignmentId,
                                workTitle: a.title,
                                workTopic: a.topic,
                                workMode: a.mode,
                              })
                            }
                          >
                            <Users size={11} /> Assign
                          </button>
                          <button
                            className="btn-secondary btn-xs"
                            title="Export as JSON"
                            onClick={() => onExportAssignmentJson(a.assignmentId)}
                          >
                            <Download size={11} /> JSON
                          </button>
                          <button
                            className="btn-secondary btn-xs"
                            title="Export student PDF (no answer)"
                            onClick={() => onExportAssignmentPdf(a.assignmentId, false)}
                          >
                            <FileDown size={11} /> PDF
                          </button>
                          <button
                            className="btn-secondary btn-xs"
                            title="Export teacher PDF (with answer)"
                            onClick={() => onExportAssignmentPdf(a.assignmentId, true)}
                          >
                            <FileDown size={11} /> PDF+Ans
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Submissions tab ── */}
      {activeTab === "submissions" && (
        <div className="dash-tab-content" style={{ padding: 0 }}>
          <SubmissionReviewCenter
            records={reviewRecords}
            onOpenChallenge={(workId) => onOpenChallenge?.(workId)}
          />
        </div>
      )}

      {/* ── Lab & Demos tab ── */}
      {activeTab === "lab" && (
        <div className="dash-tab-content">
          <div className="dash-lab-actions">
            <button className="home-card" onClick={onBuildLab} style={{ flex: 1 }}>
              <Network size={18} className="home-card-icon" />
              <div className="home-card-body">
                <div className="home-card-title">Network Lab</div>
                <div className="home-card-desc">Free-form canvas to demonstrate routing algorithms</div>
              </div>
              <ArrowRight size={14} className="home-card-arrow" />
            </button>
            <button className="home-card" onClick={onOpenChallenges} style={{ flex: 1 }}>
              <FileText size={18} className="home-card-icon" />
              <div className="home-card-body">
                <div className="home-card-title">Challenge Library</div>
                <div className="home-card-desc">Preview built-in challenges for demonstration</div>
              </div>
              <ArrowRight size={14} className="home-card-arrow" />
            </button>
          </div>

          <div className="dash-lab-secondary">
            <div className="dash-lab-secondary-row">
              <button className="home-card" onClick={onOpenSavedRuns}>
                <Clock size={16} className="home-card-icon" />
                <div className="home-card-body">
                  <div className="home-card-title">Saved Runs</div>
                  <div className="home-card-desc">
                    {savedRuns.length > 0 ? `${savedRuns.length} saved` : "Browse previous simulations"}
                  </div>
                </div>
                <ArrowRight size={13} className="home-card-arrow" />
              </button>
              <button className="home-card" onClick={onOpenHelp}>
                <HelpCircle size={16} className="home-card-icon" />
                <div className="home-card-body">
                  <div className="home-card-title">JSON Guide</div>
                  <div className="home-card-desc">How assignment and submission files work</div>
                </div>
                <ArrowRight size={13} className="home-card-arrow" />
              </button>
            </div>

            <div className="dash-json-row">
              <span className="dash-json-label"><FileJson size={12} /> JSON tools</span>
              <button className="btn-secondary btn-sm" onClick={onImportJson}>Import topology JSON</button>
              <button className="btn-secondary btn-sm" onClick={onDownloadExampleTopology}>Download example</button>
            </div>
          </div>

          {/* Lecture examples */}
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
                          <button
                            className="icon-btn"
                            onClick={() => setExpandedEx(isExpanded ? null : ex.id)}
                          >
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
      )}

      {/* ── Assign work modal ── */}
      {pendingAssign && (
        <AssignWorkModal
          open
          workType={pendingAssign.workType}
          workId={pendingAssign.workId}
          workTitle={pendingAssign.workTitle}
          workTopic={pendingAssign.workTopic}
          workMode={pendingAssign.workMode}
          onAssign={onAssignWork}
          onClose={() => setPendingAssign(null)}
        />
      )}
    </div>
  );
};

export default TeacherDashboard;
