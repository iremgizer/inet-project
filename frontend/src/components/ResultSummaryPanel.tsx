import React, { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, PlayCircle, PowerOff, Target, X } from "lucide-react";
import { NetworkInput, SimulationResult } from "../types/network";
import TermHint from "./TermHint";
import { buildNodeLabelMap, resolveNodeLabel, formatNodePath, NodeLabelMap } from "../utils/nodeLabels";
import { pathFocusKey } from "../utils/pathFocus";

interface ResultSummaryPanelProps {
  result: SimulationResult;
  onShowTrace: () => void;
  /** Node id -> label lookup — the canvas's own network. Optional only so
   * this component still degrades gracefully (raw ids) if ever rendered
   * without one; every real call site should pass it. */
  network?: NetworkInput | null;
  /** Path-focus (final-polish Part E) — which path (by pathFocusKey) is
   * currently focused on the canvas, and the setter to focus/clear one.
   * Optional so this component still renders (as a passive list, PR5/PR6
   * behavior) if ever used without focus wiring. */
  focusedPathKey?: string | null;
  onFocusPath?: (key: string | null, nodes: string[]) => void;
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

interface SRResolvedRoute {
  nodes: string[];
  percent: number;
}

interface SRDemandSummary {
  demandId: string;
  sourceLabel: string;
  targetLabel: string;
  waypointLabels: string[];
  /** One entry per resolved end-to-end route (PR0: more than one when any
   * segment leg had an equal-cost tie — see `segment_routing.py`'s module
   * docstring). Always at least one entry when `pathResults` has any paths
   * at all. */
  resolvedRoutes: SRResolvedRoute[];
}

// Node ids in `result` (demand source/target, segmentList stops, path
// nodes) are resolved to display labels via the shared nodeLabels utility —
// the same lookup every other user-facing view goes through — using the
// `labels` map built once in the component body below.
function buildSRDemandSummaries(result: SimulationResult, labels: NodeLabelMap): SRDemandSummary[] {
  const loadEvents = result.traceEvents.filter((e) => e.stepType === "LOAD_SEGMENT_LIST" && e.activeDemandId);
  return result.pathResults
    .filter((pr) => pr.paths.length > 0)
    .map((pr) => {
      const loadEvent = loadEvents.find((e) => e.activeDemandId === pr.demandId);
      const stops = loadEvent?.segmentList ?? [];
      const waypoints = stops.slice(0, -1); // last stop is always the destination
      const demandTotal = pr.paths.reduce((sum, p) => sum + p.trafficShare, 0);
      return {
        demandId: pr.demandId,
        sourceLabel: resolveNodeLabel(pr.source, labels),
        targetLabel: resolveNodeLabel(pr.target, labels),
        waypointLabels: waypoints.map((id) => resolveNodeLabel(id, labels)),
        resolvedRoutes: pr.paths.map((p) => ({
          nodes: p.nodes,
          percent: demandTotal > 0 ? (p.trafficShare / demandTotal) * 100 : 0,
        })),
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

// Percentages are derived from each path's own share of its demand's
// *delivered* traffic; node ids are resolved to labels via `labels`.
function buildDistributionSummaries(result: SimulationResult, labels: NodeLabelMap): ECMPDistributionSummary[] {
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
          route: formatNodePath(p.nodes, labels),
          percent: demandTotal > 0 ? (p.trafficShare / demandTotal) * 100 : 0,
        })),
      };
    });
}

// ── Link failure compact indicator (PR 5) ─────────────────────────────────────
// Deliberately self-contained — derived only from THIS result's own
// LINK_FAILURE trace event (see GraphBuilder.down_link_ids), with no
// `previousResult` prop and no before/after comparison. That fuller
// diff/heatmap treatment is PR 6's job; here a student just needs to see,
// at a glance, that the run they're looking at included a down link.

interface DownLinkSummary {
  linkId: string;
  source: string;
  target: string;
}

function buildDownLinksSummary(result: SimulationResult, labels: NodeLabelMap): DownLinkSummary[] {
  const failureEvent = result.traceEvents.find((e) => e.stepType === "LINK_FAILURE");
  if (!failureEvent) return [];
  return failureEvent.highlightedLinks.map((linkId) => {
    const lr = result.linkResults.find((l) => l.linkId === linkId);
    return {
      linkId,
      source: lr ? resolveNodeLabel(lr.source, labels) : "?",
      target: lr ? resolveNodeLabel(lr.target, labels) : "?",
    };
  });
}

// ── Traffic Engineering policy section ────────────────────────────────────────

interface TEPolicySummaryLine {
  key: string;
  kind: "forbid" | "avoid" | "prefer" | "waypoint";
  text: string;
}

// Derived from APPLY_TE_POLICY trace events (what was actually applied),
// not from the request's tePolicies list — a policy that referenced an
// unknown link/node id was ignored, and this reflects that reality. Link
// ids are kept as-is (links don't have a separate display label the way
// nodes do); the waypoint node id is resolved to its label.
function buildAppliedPolicySummary(result: SimulationResult, labels: NodeLabelMap): TEPolicySummaryLine[] {
  const events = result.traceEvents.filter((e) => e.stepType === "APPLY_TE_POLICY");
  if (events.length === 0) return [];

  const forbidden = new Set<string>();
  const adjustments = new Map<string, TEPolicySummaryLine>();
  const waypoints = new Set<string>();

  for (const e of events) {
    const meta = e.metadata as {
      excludedLinkIds?: string[];
      costAdjustments?: { linkId: string; policyType: string; originalWeight: number; effectiveWeight: number }[];
      requiredWaypointNodeIds?: string[];
    } | null | undefined;
    (meta?.excludedLinkIds ?? []).forEach((id) => forbidden.add(id));
    (meta?.costAdjustments ?? []).forEach((a) => {
      const kind: "avoid" | "prefer" = a.policyType === "PREFER_LINK" ? "prefer" : "avoid";
      adjustments.set(`${a.linkId}-${kind}`, {
        key: `${a.linkId}-${kind}`,
        kind,
        text: `${kind === "avoid" ? "Avoid" : "Prefer"} link ${a.linkId} (${a.originalWeight} → ${a.effectiveWeight})`,
      });
    });
    (meta?.requiredWaypointNodeIds ?? []).forEach((id) => waypoints.add(id));
  }

  const lines: TEPolicySummaryLine[] = [];
  forbidden.forEach((id) => lines.push({ key: `forbid-${id}`, kind: "forbid", text: `Forbid link ${id}` }));
  lines.push(...adjustments.values());
  waypoints.forEach((id) =>
    lines.push({ key: `wp-${id}`, kind: "waypoint", text: `Require waypoint ${resolveNodeLabel(id, labels)}` })
  );
  return lines;
}

// ── Component ─────────────────────────────────────────────────────────────────

const ResultSummaryPanel: React.FC<ResultSummaryPanelProps> = ({
  result, onShowTrace, network, focusedPathKey = null, onFocusPath,
}) => {
  const [showPaths, setShowPaths] = useState(false);
  const hasCongestion = result.congestedLinkCount > 0;
  const narrative     = buildNarrative(result);
  const labels = buildNodeLabelMap(network);

  const maxUtilPct = (result.maxUtilization * 100).toFixed(0);
  const utilClass  =
    result.maxUtilization > 1   ? "result-util--danger"
    : result.maxUtilization > 0.7 ? "result-util--warning"
    : "result-util--ok";

  const totalPaths = result.pathResults.reduce((acc, pr) => acc + pr.paths.length, 0);
  const isSegmentRouting = result.algorithm === "SEGMENT_ROUTING";
  const srDemandSummaries = isSegmentRouting ? buildSRDemandSummaries(result, labels) : [];
  const isEcmp = result.algorithm === "ECMP";
  const distributionSummaries = isEcmp ? buildDistributionSummaries(result, labels) : [];
  const policySummary = buildAppliedPolicySummary(result, labels);
  const downLinks = buildDownLinksSummary(result, labels);

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

      {/* Network event — compact operational-status note (PR 5). Distinct
          from the congestion hero above: this reports topology state, not
          a traffic outcome. */}
      {downLinks.length > 0 && (
        <div className="result-network-event">
          <PowerOff size={13} />
          <span>
            Network event: {downLinks.map((d) => `${d.source}-${d.target}`).join(", ")}{" "}
            link{downLinks.length > 1 ? "s" : ""} down
          </span>
        </div>
      )}

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

      {/* Traffic Engineering policies applied */}
      {policySummary.length > 0 && (
        <div className="result-te-section">
          <div className="result-te-title">Applied policies</div>
          {policySummary.map((line) => (
            <div key={line.key} className={`result-te-line result-te-line--${line.kind}`}>
              {line.text}
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
                <span className="result-sr-demand-label">
                  {s.resolvedRoutes.length > 1 ? "Resolved routes:" : "Resolved path:"}
                </span>
              </div>
              {s.resolvedRoutes.map((route, i) => (
                <div key={i} className="result-sr-route-row">
                  <span className="result-sr-route-path">{formatNodePath(route.nodes, labels)}</span>
                  {s.resolvedRoutes.length > 1 && (
                    <span className="result-sr-route-pct">{route.percent.toFixed(0)}%</span>
                  )}
                </div>
              ))}
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

      {/* Paths collapsible — each row is clickable (Part E): selecting one
          focuses it on the canvas (strong highlight, other paths secondary)
          via the same trace-event highlight mechanism the Optimization
          Lab's "View on graph" already uses — see utils/pathFocus.ts and
          WorkflowManager's currentTraceEvent precedence. Clicking the
          already-selected path again clears the focus. */}
      <div className="path-list-header">
        <button className="collapse-toggle" onClick={() => setShowPaths((p) => !p)}>
          {showPaths ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showPaths ? "Hide" : "Show"} paths ({totalPaths})
        </button>
        {focusedPathKey && onFocusPath && (
          <button className="path-list-clear-focus" onClick={() => onFocusPath(null, [])}>
            <X size={11} /> Clear path focus
          </button>
        )}
      </div>

      {showPaths && (
        <div className="path-list">
          {result.pathResults.map((pr) =>
            pr.paths.map((share, i) => {
              const key = pathFocusKey(pr.demandId, share.pathId, share.nodes);
              const isFocused = focusedPathKey === key;
              const clickable = !!onFocusPath;
              return (
                <div
                  key={`${pr.demandId}-${i}`}
                  className={`path-item${clickable ? " path-item--clickable" : ""}${isFocused ? " path-item--focused" : ""}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onFocusPath(isFocused ? null : key, share.nodes) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocusPath(isFocused ? null : key, share.nodes); } } : undefined}
                >
                  {clickable && <Target size={11} className="path-item-focus-icon" />}
                  <span className="path-route">{formatNodePath(share.nodes, labels)}</span>
                  <span className="path-meta">cost {share.cost} · traffic {share.trafficShare.toFixed(2)}</span>
                </div>
              );
            })
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
