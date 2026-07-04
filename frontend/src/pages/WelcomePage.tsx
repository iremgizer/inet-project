import React, { useState } from "react";
import {
  ArrowRight, Network, BookOpen, Upload, GraduationCap, Target,
  ChevronDown, ChevronUp, Zap, Activity, Check, Lightbulb,
} from "lucide-react";
import { SavedSimulationSummary } from "../types/network";
import { LECTURE_EXAMPLES, LectureExample } from "../utils/lectureExamples";
import { AppMode } from "../types/assignment";

interface WelcomePageProps {
  savedRuns: SavedSimulationSummary[];
  onBuildNetwork: () => void;
  onLoadSavedRun: (simulationRunId: string) => void;
  onOpenSavedRuns?: () => void;
  onLoadLectureExample?: (example: LectureExample) => void;
  onImportJson?: () => void;
  onSwitchMode?: (mode: AppMode) => void;
}

const WelcomePage: React.FC<WelcomePageProps> = ({
  savedRuns,
  onBuildNetwork,
  onLoadSavedRun,
  onOpenSavedRuns,
  onLoadLectureExample,
  onImportJson,
  onSwitchMode,
}) => {
  const [showExamples, setShowExamples] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  return (
    <div className="home-page">
      <div className="home-hero">
        <div className="home-logo-mark">◈</div>
        <h1 className="home-title">Network Algorithm Lab</h1>
        <p className="home-sub">Design networks, route traffic, visualize algorithms.</p>
      </div>

      <div className="home-cards">
        <button className="home-card home-card--primary" onClick={onBuildNetwork}>
          <Network size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Build Network</div>
            <div className="home-card-desc">Draw nodes and links, run ECMP or Distance Vector</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        <button
          className={`home-card${showExamples ? " home-card--active" : ""}`}
          onClick={() => setShowExamples((p) => !p)}
        >
          <BookOpen size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Load Lecture Example</div>
            <div className="home-card-desc">Pre-built scenarios from networking courses</div>
          </div>
          {showExamples
            ? <ChevronUp size={15} className="home-card-arrow" />
            : <ChevronDown size={15} className="home-card-arrow" />}
        </button>

        <button className="home-card" onClick={onImportJson}>
          <Upload size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Import JSON</div>
            <div className="home-card-desc">Load a saved topology from a JSON file</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        <button className="home-card" onClick={() => onSwitchMode?.("student")}>
          <GraduationCap size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Student Assignment</div>
            <div className="home-card-desc">Load a teacher-provided assignment file</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        <button className="home-card" onClick={() => onSwitchMode?.("challenge")}>
          <Target size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Challenge</div>
            <div className="home-card-desc">Solve routing problems with graded feedback</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>

        <button className="home-card" onClick={() => onSwitchMode?.("teacher")}>
          <BookOpen size={20} className="home-card-icon" />
          <div className="home-card-body">
            <div className="home-card-title">Teacher Workspace</div>
            <div className="home-card-desc">Create assignments and export JSON for students</div>
          </div>
          <ArrowRight size={15} className="home-card-arrow" />
        </button>
      </div>

      {showExamples && (
        <div className="home-lecture-list">
          {LECTURE_EXAMPLES.map((ex) => (
            <LectureExampleCard key={ex.id} example={ex} onLoad={onLoadLectureExample} />
          ))}
        </div>
      )}

      {savedRuns.length > 0 && (
        <div className="saved-shortcut">
          <div className="saved-shortcut-header">
            <button className="collapse-toggle" onClick={() => setShowSaved((p) => !p)}>
              {showSaved ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Previous sessions ({savedRuns.length})
            </button>
            {onOpenSavedRuns && (
              <button className="collapse-toggle" onClick={onOpenSavedRuns}>
                View all →
              </button>
            )}
          </div>
          {showSaved && (
            <ul className="saved-quick-list">
              {savedRuns.slice(0, 5).map((run) => (
                <li key={run.simulationRunId}>
                  <button
                    className="saved-quick-item"
                    onClick={() => onLoadSavedRun(run.simulationRunId)}
                  >
                    <div className="saved-quick-info">
                      <Zap size={12} />
                      <span>{run.algorithm}</span>
                      <span className="saved-meta">· {run.topologyType} · {run.nodeCount}N</span>
                    </div>
                    <div className="saved-quick-util">
                      {run.congestedLinkCount > 0
                        ? <Activity size={11} style={{ color: "var(--danger)" }} />
                        : <Activity size={11} style={{ color: "var(--success)" }} />}
                      <span>{(run.maxUtilization * 100).toFixed(0)}%</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// ── Lecture example card ───────────────────────────────────────────────────────

const LectureExampleCard: React.FC<{
  example: LectureExample;
  onLoad?: (ex: LectureExample) => void;
}> = ({ example, onLoad }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="lecture-card">
      <div className="lecture-card-header">
        <div className="lecture-card-header-left">
          <span className="lecture-card-category">{example.category}</span>
          <span className="lecture-card-title">{example.title}</span>
        </div>
        <button
          className="lecture-card-expand"
          onClick={() => setExpanded((p) => !p)}
          aria-label="Toggle details"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      <p className="lecture-card-tagline">{example.tagline}</p>
      {expanded && (
        <>
          <ul className="lecture-card-watch">
            {example.whatToWatch.map((item, i) => (
              <li key={i} className="lecture-card-watch-item">
                <Check size={10} className="lecture-card-check" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="lecture-card-insight">
            <Lightbulb size={11} />
            <span>{example.insight}</span>
          </div>
        </>
      )}
      <button
        className="lecture-card-cta"
        onClick={() => onLoad?.(example)}
        disabled={!onLoad}
      >
        Load &amp; Simulate
        <ArrowRight size={12} />
      </button>
    </div>
  );
};

export default WelcomePage;
