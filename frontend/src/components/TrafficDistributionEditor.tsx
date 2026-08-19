import React from "react";
import {
  NodeInput,
  SimulationResult,
  TrafficDemandInput,
  TrafficDistribution,
  TrafficDistributionMode,
} from "../types/network";
import TermHint from "./TermHint";
import { DISTRIBUTION_TOTAL_TOLERANCE_PCT } from "../utils/trafficDistribution";

interface TrafficDistributionEditorProps {
  demands: TrafficDemandInput[];
  nodes: NodeInput[];
  distributionMode: TrafficDistributionMode;
  distributions: TrafficDistribution[];
  simulationResult: SimulationResult | null;
  onModeChange: (mode: TrafficDistributionMode) => void;
  onShareChange: (demandId: string, pathId: string, sharePercent: number) => void;
}

const TrafficDistributionEditor: React.FC<TrafficDistributionEditorProps> = ({
  demands,
  nodes,
  distributionMode,
  distributions,
  simulationResult,
  onModeChange,
  onShareChange,
}) => {
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const hasFreshEcmpResult = simulationResult?.algorithm === "ECMP";

  return (
    <div className="td-editor">
      <div className="td-editor-heading">
        <span>Traffic Distribution</span>
        <TermHint
          term="Traffic Distribution"
          shortDefinition="How much of a demand's traffic goes over each equal-cost path — separate from Link Cost, which decides which paths are equal-cost in the first place."
          example="70% on Path 1, 30% on Path 2 instead of an even 50/50 split."
        />
      </div>

      <div className="td-mode-toggle" role="radiogroup" aria-label="Traffic distribution mode">
        <label className="td-mode-option">
          <input
            type="radio"
            name="td-mode"
            checked={distributionMode === "EQUAL"}
            onChange={() => onModeChange("EQUAL")}
          />
          Equal Split
        </label>
        <label className="td-mode-option">
          <input
            type="radio"
            name="td-mode"
            checked={distributionMode === "CUSTOM"}
            onChange={() => onModeChange("CUSTOM")}
          />
          Custom Split
        </label>
      </div>

      {distributionMode === "CUSTOM" && !hasFreshEcmpResult && (
        <p className="td-hint">
          Run once with Equal Split to discover each demand's equal-cost paths, then customize their share.
        </p>
      )}

      {distributionMode === "CUSTOM" && hasFreshEcmpResult && distributions.length === 0 && (
        <p className="td-hint">No demand currently has more than one equal-cost path to distribute.</p>
      )}

      {distributionMode === "CUSTOM" && hasFreshEcmpResult && distributions.map((dist) => {
        const demand = demands.find((d) => d.id === dist.demandId);
        const pr = simulationResult!.pathResults.find((p) => p.demandId === dist.demandId);
        if (!demand || !pr) return null;

        const total = dist.paths.reduce((sum, p) => sum + p.share, 0) * 100;
        const isValid = Math.abs(total - 100) <= DISTRIBUTION_TOTAL_TOLERANCE_PCT;

        return (
          <div key={dist.demandId} className="td-demand-card">
            <div className="td-demand-header">
              <span className="td-demand-route">
                {nodeLabel(demand.source)} <span className="td-demand-arrow">→</span> {nodeLabel(demand.target)}
              </span>
              <span className="td-demand-amount">{demand.amount} units</span>
            </div>

            {dist.paths.map((pathDist, i) => {
              const path = pr.paths.find((p) => (p.pathId ?? `path-${i + 1}`) === pathDist.pathId) ?? pr.paths[i];
              const percent = Math.round(pathDist.share * 1000) / 10;
              return (
                <div key={pathDist.pathId} className="td-path-row">
                  <div className="td-path-label">
                    <span className="td-path-index">Path {i + 1}</span>
                    <span className="td-path-route">{path.nodes.map((n) => nodeLabel(n)).join(" → ")}</span>
                  </div>
                  <div className="td-path-input-wrap">
                    <input
                      className="td-path-input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={percent}
                      onChange={(e) => onShareChange(dist.demandId, pathDist.pathId, Number(e.target.value))}
                      aria-label={`Traffic share for path ${i + 1}`}
                    />
                    <span className="td-path-pct-sign">%</span>
                  </div>
                </div>
              );
            })}

            <div className={`td-total-row ${isValid ? "td-total-row--ok" : "td-total-row--invalid"}`}>
              <span>Total</span>
              <span className="td-total-value">{total.toFixed(1)}%</span>
              {!isValid && <span className="td-total-warning">must equal 100%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TrafficDistributionEditor;
