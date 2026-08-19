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
    const customDemands = result.traceEvents.filter(
      (e) => e.stepType === "PATH_DISTRIBUTION" && e.metadata?.mode === "CUSTOM"
    ).length;
    if (customDemands > 0) {
      return `ECMP found equal-cost paths and applied a custom traffic distribution on ${customDemands} demand${customDemands > 1 ? "s" : ""}, splitting the rest equally.`;
    }
    if (multiPathDemands > 0) {
      return `ECMP found equal-cost paths and split traffic across ${totalPaths} routes — ${multiPathDemands} demand${multiPathDemands > 1 ? "s" : ""} used multiple paths simultaneously.`;
    }
    return `ECMP routed ${totalDemands} demand${totalDemands > 1 ? "s" : ""} along the single shortest path per flow.`;
  }

  if (algo === "Distance Vector") {
    return `Distance Vector ran Bellman-Ford on each node to build routing tables, then forwarded ${totalDemands} demand${totalDemands > 1 ? "s" : ""} via minimum-cost next hops.`;
  }

  if (algo === "SEGMENT_ROUTING") {
    const withWaypoints = result.traceEvents.filter(
      (e) => e.stepType === "LOAD_SEGMENT_LIST" && (e.segmentList?.length ?? 0) > 1
    ).length;
    if (withWaypoints > 0) {
      return `Segment Routing steered ${withWaypoints} of ${totalDemands} demand${totalDemands > 1 ? "s" : ""} through explicit waypoints — the rest routed via plain shortest path.`;
    }
    return `Segment Routing routed ${totalDemands} demand${totalDemands > 1 ? "s" : ""} via plain shortest path — no waypoints configured.`;
  }

  return `${algo} routed ${totalDemands} demand${totalDemands > 1 ? "s" : ""} through the network.`;
}

// ── Segment Routing compact section ───────────────────────────────────────────

interface SRDemandSummary {
  demandId: string;
  sourceLabel: string;
  targetLabel: string;
  waypointLabels: string[];
  resolvedPathLabels: string[];
}

// ResultSummaryPanel only receives `result` (no `network`), consistent with
// the existing "Show paths" list below, which also renders raw node ids
// rather than resolved labels.
function buildSRDemandSummaries(result: SimulationResult): SRDemandSummary[] {
  const loadEvents = result.traceEvents.filter((e) => e.stepType === "LOAD_SEGMENT_LIST" && e.activeDemandId);
  return result.pathResults
    .filter((pr) => pr.paths.length > 0)
    .map((pr) => {
      const loadEvent = loadEvents.find((e) => e.activeDemandId === pr.demandId);
      const stops = loadEvent?.segmentList ?? [];
      const waypoints = stops.slice(0, -1); // last stop is always the destination
      return {
        demandId: pr.demandId,
        sourceLabel: pr.source,
        targetLabel: pr.target,
        waypointLabels: waypoints,
        resolvedPathLabels: pr.paths[0].nodes,
      };
    });
}

// ── ECMP traffic distribution section ─────────────────────────────────────────

interface ECMPPathShareSummary {
  pathId: string;
  pathLabel: string;
  route: string;
  percent: number;
}

interface ECMPDistributionSummary {
  demandId: string;
  mode: "EQUAL" | "CUSTOM";
  paths: ECMPPathShareSummary[];
}

// Self-contained like buildSRDemandSummaries above: percentages are derived
// from each path's own share of its demand's *delivered* traffic, so no
// `network` prop is needed to know the original demand amount.
function buildDistributionSummaries(result: SimulationResult): ECMPDistributionSummary[] {
  const distEvents = result.traceEvents.filter((e) => e.stepType === "PATH_DISTRIBUTION" && e.activeDemandId);
  return result.pathResults
    .filter((pr) => pr.paths.length > 1)
    .map((pr) => {
      const demandTotal = pr.paths.reduce((sum, p) => sum + p.trafficShare, 0);
      const distEvent = distEvents.find((e) => e.activeDemandId === pr.demandId);
      const mode: "EQUAL" | "CUSTOM" = distEvent?.metadata?.mode === "CUSTOM" ? "CUSTOM" : "EQUAL";
      return {
        demandId: pr.demandId,
        mode,
        paths: pr.paths.map((p, i) => ({
          pathId: p.pathId ?? `path-${i + 1}`,
          pathLabel: `Path ${i + 1}`,
          route: p.nodes.join(" → "),
          percent: demandTotal > 0 ? (p.trafficShare / demandTotal) * 100 : 0,
        })),
      };
    });
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
  const isSegmentRouting = result.algorithm === "SEGMENT_ROUTING";
  const srDemandSummaries = isSegmentRouting ? buildSRDemandSummaries(result) : [];
  const isEcmp = result.algorithm === "ECMP";
  const distributionSummaries = isEcmp ? buildDistributionSummaries(result) : [];

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

      {/* Segment Routing compact section */}
      {isSegmentRouting && srDemandSummaries.length > 0 && (
        <div className="result-sr-section">
          <div className="result-sr-title">Segment Routing</div>
          {srDemandSummaries.map((s) => (
            <div key={s.demandId} className="result-sr-demand">
              <div className="result-sr-demand-route">
                Demand {s.sourceLabel} → {s.targetLabel}
              </div>
              <div className="result-sr-demand-line">
                <span className="result-sr-demand-label">Segments:</span>{" "}
                {s.waypointLabels.length > 0 ? s.waypointLabels.join(" → ") : "(none — shortest path)"}
              </div>
              <div className="result-sr-demand-line">
                <span className="result-sr-demand-label">Resolved path:</span>{" "}
                {s.resolvedPathLabels.join(" → ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ECMP traffic distribution section */}
      {isEcmp && distributionSummaries.length > 0 && (
        <div className="result-td-section">
          <div className="result-td-title">Traffic Distribution</div>
          {distributionSummaries.map((s) => (
            <div key={s.demandId} className="result-td-demand">
              <span className={`result-td-mode-badge result-td-mode-badge--${s.mode.toLowerCase()}`}>
                {s.mode === "CUSTOM" ? "Custom split" : "Equal split"}
              </span>
              {s.paths.map((p) => (
                <div key={p.pathId} className="result-td-path-row">
                  <span className="result-td-path-label">{p.pathLabel}</span>
                  <span className="result-td-path-route">{p.route}</span>
                  <span className="result-td-path-pct">{p.percent.toFixed(0)}%</span>
                </div>
              ))}
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
