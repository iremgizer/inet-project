import React, { useState } from "react";
import {
  BookOpen, Network, Target, Clock, FileJson, HelpCircle,
  ArrowRight, ChevronDown, ChevronUp, Check, Lightbulb, FileText,
} from "lucide-react";
import { LectureExample, LECTURE_EXAMPLES } from "../utils/lectureExamples";
import { SavedSimulationSummary } from "../types/network";

interface TeacherDashboardProps {
  savedRuns: SavedSimulationSummary[];
  onCreateAssignment: () => void;
  onBuildLab: () => void;
  onLoadLectureExample: (ex: LectureExample) => void;
  onOpenChallenges: () => void;
  onOpenSavedRuns: () => void;
  onImportJson: () => void;
  onDownloadExampleTopology: () => void;
  onOpenHelp: () => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  savedRuns,
  onCreateAssignment,
  onBuildLab,
  onLoadLectureExample,
  onOpenChallenges,
  onOpenSavedRuns,
  onImportJson,
  onDownloadExampleTopology,
  onOpenHelp,
}) => {
  const [showLectures, setShowLectures] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);

  return (
    <div className="home-page">
      <div className="home-hero">
        <h2 className="dash-heading">Teacher Dashboard</h2>
        <p className="dash-sub">Manage assignments, run live demos, and review student work.</p>
      </div>

      <div className="home-cards">
        {/* Create Assignment */}
        <button className="home-card home-card--primary" onClick={onCreateAssignment}>
          <FileText size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Create Assignment</div>
            <div className="home-card-desc">Build a task, lock fields, set expected solution, export JSON for students</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* Lecture Examples */}
        <button
          className={`home-card${showLectures ? " home-card--active" : ""}`}
          onClick={() => setShowLectures((p) => !p)}
        >
          <BookOpen size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Lecture Examples</div>
            <div className="home-card-desc">Load pre-built ECMP and Distance Vector scenarios for live teaching</div>
          </div>
          {showLectures
            ? <ChevronUp size={15} className="home-card-arrow" />
            : <ChevronDown size={15} className="home-card-arrow" />}
        </button>

        {/* Build Network Lab */}
        <button className="home-card" onClick={onBuildLab}>
          <Network size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Build Network Lab</div>
            <div className="home-card-desc">Free-form canvas to demonstrate routing algorithms</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* Challenge Library */}
        <button className="home-card" onClick={onOpenChallenges}>
          <Target size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Challenge Library</div>
            <div className="home-card-desc">Preview built-in challenges and load them for demonstration</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* Saved Runs */}
        <button className="home-card" onClick={onOpenSavedRuns}>
          <Clock size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Saved Runs</div>
            <div className="home-card-desc">
              {savedRuns.length > 0
                ? `${savedRuns.length} saved simulation${savedRuns.length > 1 ? "s" : ""}`
                : "Browse and reload previous simulations"}
            </div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* JSON Guide */}
        <button className="home-card" onClick={onOpenHelp}>
          <HelpCircle size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">JSON Guide</div>
            <div className="home-card-desc">How assignment and submission JSON files work; download examples</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>
      </div>

      {/* ── Lecture examples (inline) ── */}
      {showLectures && (
        <div className="dash-lecture-list">
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
                      title="Toggle details"
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

      {/* ── JSON quick actions ── */}
      <div className="dash-json-row">
        <span className="dash-json-label"><FileJson size={13} /> JSON tools</span>
        <button className="btn-secondary btn-sm" onClick={onImportJson}>Import topology JSON</button>
        <button className="btn-secondary btn-sm" onClick={onDownloadExampleTopology}>Download example topology</button>
      </div>

      {/* ── Review submissions placeholder ── */}
      <div className="dash-section">
        <div className="dash-section-title">Review Submissions</div>
        <div className="dash-placeholder-note">
          Submission review is prototype-only. Students export <code>submission.json</code> files and send them manually.
          Real course integration (submission queue, grade book) is pending.
        </div>
      </div>
    </div>
  );
};

export default TeacherDashboard;
