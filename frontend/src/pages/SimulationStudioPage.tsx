import React from "react";
import { ArrowLeft, X, BarChart3, Lightbulb } from "lucide-react";
import ResultSummaryPanel from "../components/ResultSummaryPanel";
import ComparisonPanel from "../components/ComparisonPanel";
import { SimulationResult, SimulationTraceEvent } from "../types/network";
import { ComparisonMode, SimulationComparison } from "../utils/comparison";

interface SimulationStudioPageProps {
  result: SimulationResult | null;
  isTraceMode: boolean;
  currentTraceEvent: SimulationTraceEvent | null;
  activeStepIndex: number;
  totalSteps: number;
  onEnableTrace: () => void;
  onDisableTrace: () => void;
  onBack: () => void;
  lectureInsight?: string | null;
  // Before/After comparison (PR 6, Part 2) — `result` above is "current";
  // `baselineResult` may be the same object (nothing to compare yet).
  baselineResult: SimulationResult | null;
  comparison: SimulationComparison | null;
  comparisonMode: ComparisonMode;
  onComparisonModeChange: (mode: ComparisonMode) => void;
  onSetBaseline: () => void;
}

const SimulationStudioPage: React.FC<SimulationStudioPageProps> = ({
  result,
  isTraceMode,
  activeStepIndex,
  totalSteps,
  onEnableTrace,
  onDisableTrace,
  onBack,
  lectureInsight,
  baselineResult,
  comparison,
  comparisonMode,
  onComparisonModeChange,
  onSetBaseline,
}) => {
  // ── No result yet ──────────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="page">
        <div className="stage-kicker">
          <BarChart3 size={13} />
          Result
        </div>
        <h2 className="page-title">No simulation yet</h2>
        <p className="page-subtitle">Go back and run a simulation to see results here.</p>
        <div className="page-actions">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Back to algorithm
          </button>
        </div>
      </div>
    );
  }

  // ── Result overview (default) ──────────────────────────────────────────────
  if (!isTraceMode) {
    return (
      <div className="page">
        <div className="stage-kicker">
          <BarChart3 size={13} />
          Result · <span style={{ fontWeight: 500 }}>{result.algorithm}</span>
        </div>
        <h2 className="page-title">Simulation complete</h2>

        {/* Lecture insight callout — only shown when a lecture example was loaded */}
        {lectureInsight && (
          <div className="lecture-insight-box">
            <Lightbulb size={14} className="lecture-insight-icon" />
            <p className="lecture-insight-text">{lectureInsight}</p>
          </div>
        )}

        <ComparisonPanel
          baseline={baselineResult}
          current={result}
          comparison={comparison}
          mode={comparisonMode}
          onModeChange={onComparisonModeChange}
          onSetBaseline={onSetBaseline}
        />

        <ResultSummaryPanel result={result} onShowTrace={onEnableTrace} />

        <div className="page-actions">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      </div>
    );
  }

  // ── Step-by-step mode ──────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="stage-kicker stage-kicker--trace">
        <span>Step-by-step · {result.algorithm}</span>
        <button className="icon-btn" onClick={onDisableTrace} title="Back to result overview">
          <X size={13} />
        </button>
      </div>
      <h2 className="page-title">Watching {result.algorithm} route traffic</h2>
      <p className="page-subtitle">
        Step {totalSteps > 0 ? activeStepIndex + 1 : 0} of {totalSteps}
      </p>

      <div className="page-actions">
        <button className="btn-secondary btn-sm" onClick={onDisableTrace}>
          ← Back to overview
        </button>
      </div>
    </div>
  );
};

export default SimulationStudioPage;
