import React, { useState } from "react";
import {
  GraduationCap, Network, BookOpen, Clock, HelpCircle, Target,
  ArrowRight, ChevronDown, ChevronUp, Check, Lightbulb, Inbox,
} from "lucide-react";
import { LectureExample, LECTURE_EXAMPLES } from "../utils/lectureExamples";
import { SavedSimulationSummary } from "../types/network";
import { AssignedWork } from "../types/classroom";

type Tab = "work" | "explore";

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
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return iso; }
}

function isAssignedToStudent(work: AssignedWork, studentId: string | null): boolean {
  if (!studentId) return false;
  if (work.assignedTo === "all") return true;
  return (work.assignedTo as string[]).includes(studentId);
}

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
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("work");
  const [showLectures, setShowLectures] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);

  const myAssignments = assignedWorks.filter(
    (w) => w.workType === "assignment" && isAssignedToStudent(w, currentStudentId)
  );
  const myChallenges = assignedWorks.filter(
    (w) => w.workType === "challenge" && isAssignedToStudent(w, currentStudentId)
  );
  const totalWork = myAssignments.length + myChallenges.length;

  return (
    <div className="home-page">
      <div className="home-hero">
        <h2 className="dash-heading">
          {currentStudentName ? `Welcome, ${currentStudentName.split(" ")[0]}` : "Student Dashboard"}
        </h2>
        <p className="dash-sub">
          {currentStudentId
            ? `${currentStudentId} · Work on assignments, solve challenges, and explore routing algorithms.`
            : "Work on assignments, solve challenges, and explore routing algorithms."}
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="dash-tabs">
        {(["work", "explore"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`dash-tab${activeTab === t ? " dash-tab--active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            {t === "work" && `My Work${totalWork > 0 ? ` (${totalWork})` : ""}`}
            {t === "explore" && "Explore"}
          </button>
        ))}
      </div>

      {/* ── My Work tab ── */}
      {activeTab === "work" && (
        <div className="dash-tab-content">
          {!currentStudentId ? (
            <div className="dash-no-profile">
              <GraduationCap size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
              <div style={{ marginBottom: 6 }}>No profile selected.</div>
              <div>Sign out and sign in again to choose your student profile.</div>
            </div>
          ) : totalWork === 0 ? (
            <div className="dash-empty-box">
              <div className="dash-empty-icon"><Inbox size={22} /></div>
              <div className="dash-empty-title">No work assigned yet</div>
              <p className="dash-empty-desc">
                Your teacher hasn&apos;t assigned any work to you yet. You can also import an
                assignment JSON file directly from <strong>My Assignments</strong>.
              </p>
              <button className="btn-primary btn-sm" onClick={onOpenAssignment}>
                Import Assignment JSON <ArrowRight size={11} />
              </button>
            </div>
          ) : (
            <>
              {/* Assigned Assignments */}
              {myAssignments.length > 0 && (
                <div className="dash-work-section">
                  <div className="dash-work-section-title">
                    Assignments ({myAssignments.length})
                  </div>
                  {myAssignments.map((w) => (
                    <div key={w.assignedWorkId} className="dash-work-item">
                      <div className="dash-work-info">
                        <div className="dash-work-title">{w.workTitle}</div>
                        <div className="dash-work-meta">
                          {w.workTopic && <span>{w.workTopic}</span>}
                          {w.workMode && <span> · {w.workMode}</span>}
                          {w.dueDate && (
                            <span className="dash-work-due"> · Due {formatDate(w.dueDate)}</span>
                          )}
                        </div>
                      </div>
                      <span className="dash-work-status dash-work-status--pending">pending</span>
                      <button className="btn-primary btn-sm" onClick={() => onOpenAssignedWork(w)}>
                        Open <ArrowRight size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Assigned Challenges */}
              {myChallenges.length > 0 && (
                <div className="dash-work-section">
                  <div className="dash-work-section-title">
                    Challenges ({myChallenges.length})
                  </div>
                  {myChallenges.map((w) => (
                    <div key={w.assignedWorkId} className="dash-work-item">
                      <div className="dash-work-info">
                        <div className="dash-work-title">{w.workTitle}</div>
                        <div className="dash-work-meta">
                          {w.workTopic && <span>{w.workTopic}</span>}
                          {w.dueDate && (
                            <span className="dash-work-due"> · Due {formatDate(w.dueDate)}</span>
                          )}
                        </div>
                      </div>
                      <span className="dash-work-status dash-work-status--pending">pending</span>
                      <button className="btn-primary btn-sm" onClick={() => onOpenAssignedWork(w)}>
                        Open <ArrowRight size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Manual import fallback */}
          <div className="dash-manual-import">
            <span className="dash-manual-import-label">Have a file from your teacher?</span>
            <button className="btn-secondary btn-sm" onClick={onOpenAssignment}>
              Import assignment JSON
            </button>
            <button className="btn-secondary btn-sm" onClick={onOpenHelp}>
              <HelpCircle size={11} /> JSON Help
            </button>
          </div>
        </div>
      )}

      {/* ── Explore tab ── */}
      {activeTab === "explore" && (
        <div className="dash-tab-content">
          <div className="dash-lab-actions">
            <button className="home-card" onClick={onBuildLab} style={{ flex: 1 }}>
              <Network size={18} className="home-card-icon" />
              <div className="home-card-body">
                <div className="home-card-title">Network Lab</div>
                <div className="home-card-desc">Build your own network and run ECMP or Distance Vector freely</div>
              </div>
              <ArrowRight size={14} className="home-card-arrow" />
            </button>
            <button className="home-card" onClick={onOpenChallenges} style={{ flex: 1 }}>
              <Target size={18} className="home-card-icon" />
              <div className="home-card-body">
                <div className="home-card-title">Challenges</div>
                <div className="home-card-desc">Solve built-in problems with hints and scored feedback</div>
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
                    {savedRuns.length > 0 ? `${savedRuns.length} saved` : "Reload previous simulations"}
                  </div>
                </div>
                <ArrowRight size={13} className="home-card-arrow" />
              </button>
              <button className="home-card" onClick={onOpenHelp}>
                <HelpCircle size={16} className="home-card-icon" />
                <div className="home-card-body">
                  <div className="home-card-title">JSON Help</div>
                  <div className="home-card-desc">How to use assignment and submission files</div>
                </div>
                <ArrowRight size={13} className="home-card-arrow" />
              </button>
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
    </div>
  );
};

export default StudentDashboard;
