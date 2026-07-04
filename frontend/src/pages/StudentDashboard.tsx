import React, { useState } from "react";
import {
  GraduationCap, Network, Target, BookOpen, Clock, HelpCircle,
  ArrowRight, ChevronDown, ChevronUp, Check, Lightbulb,
} from "lucide-react";
import { LectureExample, LECTURE_EXAMPLES } from "../utils/lectureExamples";
import { SavedSimulationSummary } from "../types/network";

interface StudentDashboardProps {
  savedRuns: SavedSimulationSummary[];
  onOpenAssignment: () => void;
  onOpenChallenges: () => void;
  onBuildLab: () => void;
  onLoadLectureExample: (ex: LectureExample) => void;
  onOpenSavedRuns: () => void;
  onOpenHelp: () => void;
}

const StudentDashboard: React.FC<StudentDashboardProps> = ({
  savedRuns,
  onOpenAssignment,
  onOpenChallenges,
  onBuildLab,
  onLoadLectureExample,
  onOpenSavedRuns,
  onOpenHelp,
}) => {
  const [showLectures, setShowLectures] = useState(false);
  const [expandedEx, setExpandedEx] = useState<string | null>(null);

  return (
    <div className="home-page">
      <div className="home-hero">
        <h2 className="dash-heading">Student Dashboard</h2>
        <p className="dash-sub">Work on assignments, solve challenges, and explore routing algorithms.</p>
      </div>

      <div className="home-cards">
        {/* My Assignments */}
        <button className="home-card home-card--primary" onClick={onOpenAssignment}>
          <GraduationCap size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">My Assignments</div>
            <div className="home-card-desc">Upload the assignment JSON file provided by your teacher</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* Challenges */}
        <button className="home-card" onClick={onOpenChallenges}>
          <Target size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Challenges</div>
            <div className="home-card-desc">Solve built-in routing problems with hints and scored feedback</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* Network Lab */}
        <button className="home-card" onClick={onBuildLab}>
          <Network size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Network Lab</div>
            <div className="home-card-desc">Build your own network and run ECMP or Distance Vector freely</div>
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
            <div className="home-card-desc">Load course scenarios to study routing behaviour interactively</div>
          </div>
          {showLectures
            ? <ChevronUp size={15} className="home-card-arrow" />
            : <ChevronDown size={15} className="home-card-arrow" />}
        </button>

        {/* Saved Runs */}
        <button className="home-card" onClick={onOpenSavedRuns}>
          <Clock size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Saved Runs</div>
            <div className="home-card-desc">
              {savedRuns.length > 0
                ? `${savedRuns.length} saved simulation${savedRuns.length > 1 ? "s" : ""}`
                : "Reload previous simulation results"}
            </div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        {/* JSON Help */}
        <button className="home-card" onClick={onOpenHelp}>
          <HelpCircle size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">JSON Help</div>
            <div className="home-card-desc">How to use assignment and submission files from your teacher</div>
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

      {/* ── My submissions ── */}
      <div className="dash-section">
        <div className="dash-section-title">My Submissions</div>
        <div className="dash-empty-state">
          No submissions yet. Complete an assignment and use <strong>Export Submission</strong> to save your work.
          Send the exported <code>submission.json</code> file to your teacher.
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
