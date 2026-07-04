import React, { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, PlayCircle } from "lucide-react";
import { SimulationResult } from "../types/network";
import TermHint from "./TermHint";

interface ResultSummaryPanelProps {
  result: SimulationResult;
  onShowTrace: () => void;
}

// ── Narrative generator ───────────────────────────────────────────────────────

function buildNarrative(result: SimulationResult): string {
  const totalPaths   = result.pathResults.reduce((acc, pr) => acc + pr.paths.length, 0);
  const totalDemands = result.pathResults.length;
  const algo         = result.algorithm;

  if (totalDemands === 0) return `${algo} processed an empty demand set.`;

  if (algo === "ECMP") {
    const multiPathDemands = result.pathResults.filter((pr) => pr.paths.length > 1).length;
    if (multiPathDemands > 0) {
      return `ECMP found equal-cost paths and split traffic across ${totalPaths} routes — ${multiPathDemands} demand${multiPathDemands > 1 ? "s" : ""} used multiple paths simultaneously.`;
    }
    return `ECMP routed ${totalDemands} demand${totalDemands > 1 ? "s" : ""} along the single shortest path per flow.`;
  }

  if (algo === "Distance Vector") {
    return `Distance Vector ran Bellman-Ford on each node to build routing tables, then forwarded ${totalDemands} demand${totalDemands > 1 ? "s" : ""} via minimum-cost next hops.`;
  }

  return `${algo} routed ${totalDemands} demand${totalDemands > 1 ? "s" : ""} through the network.`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ResultSummaryPanel: React.FC<ResultSummaryPanelProps> = ({ result, onShowTrace }) => {
  const [showPaths, setShowPaths] = useState(false);
  const hasCongestion = result.congestedLinkCount > 0;
  const narrative     = buildNarrative(result);

  const maxUtilPct = (result.maxUtilization * 100).toFixed(0);
  const utilClass  =
    result.maxUtilization > 1   ? "result-util--danger"
    : result.maxUtilization > 0.7 ? "result-util--warning"
    : "result-util--ok";

  const totalPaths = result.pathResults.reduce((acc, pr) => acc + pr.paths.length, 0);

  return (
    <div className="result-summary">

      {/* Hero status banner */}
      <div className={`result-hero-status ${hasCongestion ? "result-hero-status--warn" : "result-hero-status--ok"}`}>
        <div className="result-hero-icon">
          {hasCongestion
            ? <AlertTriangle size={18} />
            : <CheckCircle2 size={18} />}
        </div>
        <div className="result-hero-text">
          <div className="result-hero-headline">
            {hasCongestion
              ? `${result.congestedLinkCount} congested link${result.congestedLinkCount > 1 ? "s" : ""}`
              : "No congestion detected"}
          </div>
          <div className="result-hero-sub">{result.algorithm} · max {maxUtilPct}% utilization</div>
        </div>
      </div>

      {/* Narrative */}
      <p className="result-narrative">{narrative}</p>

      {/* Metric cards */}
      <div className="result-metrics">
        <div className="result-metric">
          <span className="result-metric-label">
            Max utilization
            <TermHint
              term="Utilization"
              shortDefinition="Load / Capacity. Above 1.0 means congestion."
              formula="utilization = load / capacity"
            />
          </span>
          <span className={`result-metric-value ${utilClass}`}>{maxUtilPct}%</span>
        </div>
        <div className="result-metric">
          <span className="result-metric-label">Traffic delivered</span>
          <span className="result-metric-value">{result.totalDeliveredTraffic.toFixed(2)}</span>
        </div>
        <div className="result-metric">
          <span className="result-metric-label">Avg path cost</span>
          <span className="result-metric-value">{result.averagePathCost.toFixed(2)}</span>
        </div>
        <div className="result-metric">
          <span className="result-metric-label">Paths used</span>
          <span className="result-metric-value">{totalPaths}</span>
        </div>
      </div>

      {/* Congested links detail */}
      {hasCongestion && result.linkResults.filter((l) => l.isCongested).length > 0 && (
        <div className="result-congested-list">
          <div className="result-congested-title">Congested links</div>
          {result.linkResults
            .filter((l) => l.isCongested)
            .map((l) => (
              <div key={l.linkId} className="result-congested-item">
                <span className="result-congested-id">{l.linkId}</span>
                <span className="result-congested-util result-util--danger">
                  {(l.utilization * 100).toFixed(0)}%
                </span>
              </div>
            ))}
        </div>
      )}

      {/* Paths collapsible */}
      <button className="collapse-toggle" onClick={() => setShowPaths((p) => !p)}>
        {showPaths ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showPaths ? "Hide" : "Show"} paths ({totalPaths})
      </button>

      {showPaths && (
        <div className="path-list">
          {result.pathResults.map((pr) =>
            pr.paths.map((share, i) => (
              <div key={`${pr.demandId}-${i}`} className="path-item">
                <span className="path-route">{share.nodes.join(" → ")}</span>
                <span className="path-meta">cost {share.cost} · traffic {share.trafficShare.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Step-by-step CTA */}
      <button className="result-trace-cta" onClick={onShowTrace}>
        <PlayCircle size={14} />
        Explore step-by-step
      </button>
    </div>
  );
};

export default ResultSummaryPanel;
