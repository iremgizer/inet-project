import React, { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Play, Eye, GitCompare, CheckCircle2 } from "lucide-react";
import { OptimizationLabMode, OptimizationResult } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO, explainResult } from "../utils/optimizationExplanations";
import TermHint from "./TermHint";

interface OptimizationCardProps {
  mode: Exclude<OptimizationLabMode, "CURRENT">;
  result: OptimizationResult | null;
  isRunning: boolean;
  isSelected: boolean;
  isComparing: boolean;
  canApply: boolean;
  onRun: () => void;
  onView: () => void;
  onCompare: () => void;
  onApply: () => void;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number): string {
  return n < 1 ? "<1 ms" : `${n.toFixed(1)} ms`;
}

const STATUS_BADGE_CLASS: Record<OptimizationResult["status"], string> = {
  OPTIMAL: "badge--success",
  FEASIBLE: "badge--warning",
  INFEASIBLE: "badge--danger",
  TIME_LIMIT: "badge--warning",
  ERROR: "badge--danger",
};

/** One card per optimization mode in the Optimization Lab. Each mode is
 * launched independently (its own "Run" button) — never auto-executed, per
 * PR5's own explicit instruction. */
const OptimizationCard: React.FC<OptimizationCardProps> = ({
  mode, result, isRunning, isSelected, isComparing, canApply, onRun, onView, onCompare, onApply,
}) => {
  const [showExplanation, setShowExplanation] = useState(false);
  const info = OPTIMIZATION_MODE_INFO[mode];

  // Explicit confirmation before applying — nothing is silently overwritten
  // (PR5 §5). Same "click again within a few seconds to confirm" pattern
  // SavedRunsDrawer already uses for delete, so this isn't a new UI idiom.
  const [applyConfirm, setApplyConfirm] = useState(false);
  const handleApplyClick = () => {
    if (applyConfirm) {
      onApply();
      setApplyConfirm(false);
    } else {
      setApplyConfirm(true);
      setTimeout(() => setApplyConfirm(false), 4000);
    }
  };

  return (
    <div className={`opt-card${isSelected ? " opt-card--selected" : ""}`}>
      <div className="opt-card-header">
        <div className="opt-card-title-row">
          <strong>{info.label}</strong>
          {result && <span className={`badge ${STATUS_BADGE_CLASS[result.status]}`}>{result.status}</span>}
        </div>
        <TermHint
          term={info.shortLabel}
          shortDefinition={info.optimizes}
          example={info.routingSemantics}
        />
      </div>

      {!result ? (
        <div className="opt-card-body opt-card-body--empty">
          <p className="opt-card-hint">{info.optimizes}</p>
          <button className="btn-primary btn-sm" onClick={onRun} disabled={isRunning}>
            {isRunning ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            {isRunning ? "Running…" : "Run"}
          </button>
        </div>
      ) : (
        <div className="opt-card-body">
          <div className="opt-card-metrics">
            <div className="metric-cell">
              <span className="metric-label">MLU</span>
              <strong className={result.mlu > 1 ? "text-danger" : result.mlu > 0.7 ? "text-warning" : ""}>
                {fmtPct(result.mlu)}
              </strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Improvement</span>
              <strong className={
                (result.improvement ?? 0) > 0 ? "text-success" : (result.improvement ?? 0) < 0 ? "text-danger" : ""
              }>
                {result.improvement !== null && result.improvement !== undefined
                  ? `${result.improvement > 0 ? "−" : ""}${fmtPct(Math.abs(result.improvement))}`
                  : "—"}
              </strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Runtime</span>
              <strong>{fmtMs(result.solverRuntime)}</strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Proven optimal</span>
              <strong>{result.provenOptimal === null || result.provenOptimal === undefined ? "—" : result.provenOptimal ? "Yes" : "No"}</strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Search method</span>
              <strong className="opt-card-small-value">{result.searchMethod ?? "LP solve"}</strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Candidates evaluated</span>
              <strong>{result.evaluatedCandidates ?? "—"}</strong>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Solver</span>
              <strong className="opt-card-small-value">{result.solverName}</strong>
            </div>
          </div>

          <p className="opt-card-explain">{explainResult(result)}</p>

          <div className="opt-card-actions">
            <button className="btn-secondary btn-sm" onClick={onRun} disabled={isRunning} title="Re-run">
              {isRunning ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
              Re-run
            </button>
            <button
              className={`btn-secondary btn-sm${isSelected ? " btn-secondary--active" : ""}`}
              onClick={onView}
            >
              <Eye size={13} /> View on graph
            </button>
            <button
              className={`btn-secondary btn-sm${isComparing ? " btn-secondary--active" : ""}`}
              onClick={onCompare}
            >
              <GitCompare size={13} /> Compare vs current
            </button>
            {canApply && (result.status === "OPTIMAL" || result.status === "FEASIBLE") && (
              <button
                className={`btn-primary btn-sm${applyConfirm ? " btn-primary--confirm" : ""}`}
                onClick={handleApplyClick}
                title={applyConfirm ? "Click again to confirm — this updates your network configuration" : undefined}
              >
                <CheckCircle2 size={13} /> {applyConfirm ? "Click to confirm" : "Apply recommendation"}
              </button>
            )}
          </div>

          <button className="collapse-toggle" onClick={() => setShowExplanation((p) => !p)}>
            {showExplanation ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            What this optimizer assumes
          </button>
          {showExplanation && (
            <div className="opt-card-info">
              <p><strong>Optimizes:</strong> {info.optimizes}</p>
              <p><strong>Assumptions:</strong> {info.assumptions}</p>
              <p><strong>Routing semantics:</strong> {info.routingSemantics}</p>
              <p><strong>Optimality:</strong> {info.optimalityNote}</p>
              {result.message && <p><strong>Result message:</strong> {result.message}</p>}
              {result.debugInfo.length > 0 && (
                <ul className="opt-card-debug">
                  {result.debugInfo.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OptimizationCard;
