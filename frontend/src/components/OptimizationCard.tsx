import React from "react";
import { Loader2, Play, Eye, AlertTriangle } from "lucide-react";
import { OptimizationLabMode, OptimizationResult, SearchSpaceEstimate } from "../types/optimization";
import { OPTIMIZATION_MODE_INFO } from "../utils/optimizationExplanations";
import { getResultBadges } from "../utils/optimizationBadges";
import {
  OptimizationSettings,
  formatLargeSearchWarning,
  predictSearchMethod,
  shouldWarnLargeSearch,
} from "../utils/optimizationSettings";

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
  onRun: () => void;
  onView: () => void;
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

const MODE_SUMMARY: Record<OptimizationCardProps["mode"], string> = {
  OPT: "Theoretical best possible MLU",
  WPO: "Choose up to one waypoint per demand",
  LWO: "Tune link weights",
  JOINT: "Tune weights and waypoints together",
};

/** One card per optimization mode in the Optimization Lab. Each mode is
 * launched independently (its own "Run" button) — never auto-executed, per
 * PR5's own explicit instruction. PR6 adds: badges (§13/§14), a pre-run
 * search-space preview and large-search warning (§3/§16), and mode-specific
 * scientific metadata (§5/§6/§8/§12) — OPT never shows search/candidate
 * fields (§4), LWO shows its weight range and optimizable-link count (§6). */
const OptimizationCard: React.FC<OptimizationCardProps> = ({
  mode, result, settingsUsed, currentSettings, searchSpaceEstimate,
  isRunning, isSelected, onRun, onView,
}) => {
  const info = OPTIMIZATION_MODE_INFO[mode];

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
          {result && result.status !== "OPTIMAL" && <span className={`badge ${STATUS_BADGE_CLASS[result.status]}`}>{result.status}</span>}
          {badges.map((b) => (
            <span key={b.label} className={`badge ${OUTCOME_BADGE_CLASS[b.variant]}`} title={b.explanation}>
              {b.label}
            </span>
          ))}
        </div>
        <span className="opt-card-summary">{MODE_SUMMARY[mode]}</span>
      </div>

      {!result ? (
        <div className="opt-card-body opt-card-body--empty">
          {/* Compact preview keeps the search mode visible without repeating its explanation. */}
          {mode !== "OPT" && searchSpaceEstimate && (
            <div className="opt-card-preview">
              {searchSpaceEstimate.error ? (
                <p className="opt-card-hint">{searchSpaceEstimate.error}</p>
              ) : (
                <>
                  <div className="opt-card-preview-row">
                    <span>Search space</span>
                    <strong>{searchSpaceEstimate.searchSpaceSize?.toLocaleString() ?? "—"}</strong>
                  </div>
                  <div className="opt-card-preview-row">
                    <span>Budget</span>
                    <strong>{currentSettings.maxExactCombinations.toLocaleString()}</strong>
                  </div>
                  {prediction && (
                    <div
                      className={`opt-card-prediction${prediction.willUseExact ? " opt-card-prediction--exact" : " opt-card-prediction--heuristic"}`}
                      title={prediction.detail}
                    >
                      {prediction.willUseExact ? "Exact within budget" : "Heuristic above budget"}
                    </div>
                  )}
                  {warnLargeSearch && searchSpaceEstimate.searchSpaceSize && (
                    <div className="opt-card-warning">
                      <AlertTriangle size={12} />
                      <span title={formatLargeSearchWarning(searchSpaceEstimate.searchSpaceSize, currentSettings.maxExactCombinations)}>
                        Large search may take longer
                      </span>
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
            {mode !== "OPT" && (
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
            )}
            <div className="metric-cell">
              <span className="metric-label">Runtime</span>
              <strong>{fmtMs(result.solverRuntime)}</strong>
            </div>
            {mode === "OPT" && (
              <div className="metric-cell">
                <span className="metric-label">Solver</span>
                <strong>{result.solverName}</strong>
              </div>
            )}

            {/* Search-method fields — never shown for OPT (PR6 §4/§12: "OPT does not have candidate enumeration"). */}
            {mode !== "OPT" && (
              <>
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
          </div>
        </div>
      )}
    </div>
  );
};

export default OptimizationCard;
