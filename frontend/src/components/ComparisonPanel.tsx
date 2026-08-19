import React, { useState } from "react";
import { ChevronDown, ChevronUp, GitCompare } from "lucide-react";
import { SimulationResult } from "../types/network";
import {
  ComparisonMode,
  COMPARISON_STATUS_COLOR,
  COMPARISON_STATUS_LABEL,
  LinkComparisonStatus,
  SimulationComparison,
} from "../utils/comparison";
import TermHint from "./TermHint";

interface ComparisonPanelProps {
  baseline: SimulationResult | null;
  current: SimulationResult;
  comparison: SimulationComparison | null;
  mode: ComparisonMode;
  onModeChange: (mode: ComparisonMode) => void;
  onSetBaseline: () => void;
}

const MODES: { id: ComparisonMode; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "difference", label: "Difference" },
];

const LEGEND_STATUSES: LinkComparisonStatus[] = [
  "IMPROVED", "UNCHANGED", "WORSENED", "NEW_CONGESTION", "RESOLVED_CONGESTION", "DOWN",
];

function fmtPp(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(0)} pp`;
}

/** Before/After/Difference comparison (PR 6, Part 2) — reuses the existing
 * React Flow canvas for all three modes (see WorkflowManager's
 * `displayedResult`/`comparisonByLink`); this panel is just the control
 * surface: mode toggle, compact summary, and (difference mode only) legend. */
const ComparisonPanel: React.FC<ComparisonPanelProps> = ({
  baseline,
  current,
  comparison,
  mode,
  onModeChange,
  onSetBaseline,
}) => {
  const [showLegend, setShowLegend] = useState(false);
  const isBaselineCurrent = baseline === current;

  if (!baseline) return null;

  return (
    <div className="comparison-panel">
      <div className="comparison-panel-header">
        <span className="comparison-panel-title">
          <GitCompare size={13} />
          Before / After
          <TermHint
            term="Before / After comparison"
            shortDefinition="Compares the current result against a saved baseline run — utilization, congestion, and route changes."
            example="Fail a link, rerun, then switch to Difference to see exactly which links got worse."
          />
        </span>
        <button
          className="btn-secondary btn-sm"
          onClick={onSetBaseline}
          disabled={isBaselineCurrent}
          title={isBaselineCurrent ? "The current result is already the baseline" : "Use the current result as the new baseline"}
        >
          {isBaselineCurrent ? "This is the baseline" : "Set current as baseline"}
        </button>
      </div>

      {!comparison ? (
        <p className="comparison-empty-hint">
          This is the baseline run. Change something — fail a link, adjust a weight, edit a policy — and run
          again to compare.
        </p>
      ) : (
        <>
          <div className="comparison-mode-toggle" role="tablist" aria-label="Comparison mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`comparison-mode-btn${mode === m.id ? " comparison-mode-btn--active" : ""}`}
                onClick={() => onModeChange(m.id)}
                role="tab"
                aria-selected={mode === m.id}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="comparison-summary">
            <div className="comparison-summary-row">
              <span className="comparison-summary-label">Max utilization</span>
              <span className="comparison-summary-value">
                {(comparison.maxUtilizationBefore * 100).toFixed(0)}% &rarr; {(comparison.maxUtilizationAfter * 100).toFixed(0)}%
                <span className={`comparison-delta ${
                  comparison.maxUtilizationDeltaPct > 0 ? "comparison-delta--worse"
                  : comparison.maxUtilizationDeltaPct < 0 ? "comparison-delta--better" : ""
                }`}>
                  {fmtPp(comparison.maxUtilizationDeltaPct)}
                </span>
              </span>
            </div>
            <div className="comparison-summary-row">
              <span className="comparison-summary-label">Congested links</span>
              <span className="comparison-summary-value">
                {comparison.congestedLinksBefore} &rarr; {comparison.congestedLinksAfter}
              </span>
            </div>
            <div className="comparison-summary-row">
              <span className="comparison-summary-label">Routes changed</span>
              <span className="comparison-summary-value">{comparison.routeChanges.length}</span>
            </div>
            {comparison.largestIncrease && (
              <div className="comparison-summary-row">
                <span className="comparison-summary-label">Largest increase</span>
                <span className="comparison-summary-value">
                  {comparison.largestIncrease.linkId} <span className="comparison-delta comparison-delta--worse">{fmtPp(comparison.largestIncrease.utilizationDeltaPct)}</span>
                </span>
              </div>
            )}
            {comparison.largestImprovement && (
              <div className="comparison-summary-row">
                <span className="comparison-summary-label">Largest improvement</span>
                <span className="comparison-summary-value">
                  {comparison.largestImprovement.linkId} <span className="comparison-delta comparison-delta--better">{fmtPp(comparison.largestImprovement.utilizationDeltaPct)}</span>
                </span>
              </div>
            )}
          </div>

          {mode === "difference" && (
            <>
              <button className="collapse-toggle" onClick={() => setShowLegend((p) => !p)}>
                {showLegend ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Legend
              </button>
              {showLegend && (
                <div className="comparison-legend">
                  {LEGEND_STATUSES.map((status) => (
                    <span key={status} className="comparison-legend-item">
                      <span className="comparison-legend-swatch" style={{ background: COMPARISON_STATUS_COLOR[status] }} />
                      {COMPARISON_STATUS_LABEL[status]}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ComparisonPanel;
