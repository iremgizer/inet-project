import React, { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Play, Eye, GitCompare, CheckCircle2, AlertTriangle } from "lucide-react";
import { OptimizationLabMode, OptimizationResult, SearchSpaceEstimate } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO, explainResult } from "../utils/optimizationExplanations";
import { getResultBadges } from "../utils/optimizationBadges";
import {
  OptimizationSettings,
  formatLargeSearchWarning,
  predictSearchMethod,
  shouldWarnLargeSearch,
} from "../utils/optimizationSettings";
import TermHint from "./TermHint";
import { breakableIdentifier } from "../utils/breakableText";

interface OptimizationCardProps {
  mode: Exclude<OptimizationLabMode, "CURRENT">;
  result: OptimizationResult | null;
  /** The settings actually used to produce `result` — distinct from
   * `currentSettings` below, which may have changed since (PR6 §6: LWO's
   * own weight range must be shown as what was *actually* searched, not
   * whatever the settings panel currently reads). `null` until first run. */
  settingsUsed: OptimizationSettings | null;
  currentSettings: OptimizationSettings;
  searchSpaceEstimate: SearchSpaceEstimate | null;
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

const OUTCOME_BADGE_CLASS: Record<string, string> = {
  success: "badge--success",
  warning: "badge--warning",
  danger: "badge--danger",
  neutral: "badge--neutral",
};

/** One card per optimization mode in the Optimization Lab. Each mode is
 * launched independently (its own "Run" button) — never auto-executed, per
 * PR5's own explicit instruction. PR6 adds: badges (§13/§14), a pre-run
 * search-space preview and large-search warning (§3/§16), and mode-specific
 * scientific metadata (§5/§6/§8/§12) — OPT never shows search/candidate
 * fields (§4), LWO shows its weight range and optimizable-link count (§6). */
const OptimizationCard: React.FC<OptimizationCardProps> = ({
  mode, result, settingsUsed, currentSettings, searchSpaceEstimate,
  isRunning, isSelected, isComparing, canApply, onRun, onView, onCompare, onApply,
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

  const prediction = mode !== "OPT" && searchSpaceEstimate
    ? predictSearchMethod(searchSpaceEstimate.searchSpaceSize, currentSettings.maxExactCombinations)
    : null;
  const warnLargeSearch = mode !== "OPT" && searchSpaceEstimate?.searchSpaceSize
    ? shouldWarnLargeSearch(searchSpaceEstimate.searchSpaceSize, currentSettings.maxExactCombinations)
    : false;

  const badges = result ? getResultBadges(result) : [];

  return (
    <div className={`opt-card${isSelected ? " opt-card--selected" : ""}`}>
      <div className="opt-card-header">
        <div className="opt-card-title-row">
          <strong>{info.label}</strong>
          {result && <span className={`badge ${STATUS_BADGE_CLASS[result.status]}`}>{result.status}</span>}
          {badges.map((b) => (
            <span key={b.label} className={`badge ${OUTCOME_BADGE_CLASS[b.variant]}`} title={b.explanation}>
              {b.label}
            </span>
          ))}
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

          {/* ── PR6 §3/§16 — pre-run search-space preview + warning (WPO/LWO/JOINT only) ── */}
          {mode !== "OPT" && searchSpaceEstimate && (
            <div className="opt-card-preview">
              {searchSpaceEstimate.error ? (
                <p className="opt-card-hint">{searchSpaceEstimate.error}</p>
              ) : (
                <>
                  <div className="opt-card-preview-row">
                    <span>Estimated search space</span>
                    <strong>{searchSpaceEstimate.searchSpaceSize?.toLocaleString() ?? "—"}</strong>
                  </div>
                  <div className="opt-card-preview-row">
                    <span>Exact search budget</span>
                    <strong>{currentSettings.maxExactCombinations.toLocaleString()}</strong>
                  </div>
                  {prediction && (
                    <div className={`opt-card-prediction${prediction.willUseExact ? " opt-card-prediction--exact" : " opt-card-prediction--heuristic"}`}>
                      {prediction.label}
                      <span className="opt-card-prediction-detail">{prediction.detail}</span>
                    </div>
                  )}
                  {warnLargeSearch && searchSpaceEstimate.searchSpaceSize && (
                    <div className="opt-card-warning">
                      <AlertTriangle size={12} />
                      {formatLargeSearchWarning(searchSpaceEstimate.searchSpaceSize, currentSettings.maxExactCombinations)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {mode === "OPT" && (
            <div className="opt-card-preview">
              <div className="opt-card-preview-row"><span>Method</span><strong>Linear Programming</strong></div>
              <div className="opt-card-preview-row"><span>Solver</span><strong>CBC</strong></div>
              <div className="opt-card-preview-row"><span>Search combinations</span><strong>Not applicable</strong></div>
            </div>
          )}

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
              <span className="metric-label">Solver</span>
              <strong className="opt-card-small-value">{breakableIdentifier(result.solverName)}</strong>
            </div>

            {/* Search-method fields — never shown for OPT (PR6 §4/§12: "OPT does not have candidate enumeration"). */}
            {mode !== "OPT" && (
              <>
                <div className="metric-cell">
                  <span className="metric-label">Search method</span>
                  <strong className="opt-card-small-value">{result.searchMethod && breakableIdentifier(result.searchMethod)}</strong>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Search-space size</span>
                  <strong>{result.searchSpaceSize?.toLocaleString() ?? "—"}</strong>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Candidates evaluated</span>
                  <strong>{result.evaluatedCandidates?.toLocaleString() ?? "—"}</strong>
                </div>
              </>
            )}

            {/* LWO/Joint only: weight range + optimizable-link count actually used (PR6 §6). */}
            {(mode === "LWO" || mode === "JOINT") && settingsUsed && (
              <div className="metric-cell">
                <span className="metric-label">Weight range used</span>
                <strong>{settingsUsed.minWeight}-{settingsUsed.maxWeight}</strong>
              </div>
            )}

            {/* Joint only: iterations + convergence reason (PR6 §8). */}
            {mode === "JOINT" && result.iterations !== null && result.iterations !== undefined && (
              <div className="metric-cell">
                <span className="metric-label">Iterations</span>
                <strong>{result.iterations}</strong>
              </div>
            )}
          </div>

          {mode === "JOINT" && result.convergenceReason && (
            <p className="opt-card-convergence">{result.convergenceReason}</p>
          )}

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
            {canApply && (result.status === "OPTIMAL" || result.status === "FEASIBLE" || result.status === "TIME_LIMIT") && (
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
