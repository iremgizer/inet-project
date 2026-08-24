import { NetworkInput, SimulationTraceEvent } from "../types/network";
import { OptimizationResult } from "../types/optimization";
import { resolveNodeLabel, NodeLabelMap } from "./nodeLabels";

// ── Optimization Lab — graph highlighting via the existing trace-event
//    mechanism ──────────────────────────────────────────────────────────
//
// ReactFlowCanvas already knows how to highlight nodes/links: whenever
// `isTraceMode` is true, it reads `currentTraceEvent.highlightedNodes`/
// `.highlightedLinks` (see ReactFlowCanvas's own overlay-context
// computation). Rather than adding a second, parallel highlighting prop,
// this builds one synthetic, static "step" describing an optimization
// recommendation — reusing that exact mechanism for a single frozen frame
// instead of a real multi-step replay. No new highlighting code exists in
// ReactFlowCanvas/NetworkEdge/NetworkNode because of this file.
export function buildOptimizationHighlightEvent(result: OptimizationResult): SimulationTraceEvent {
  const highlightedNodes = (result.recommendedWaypoints ?? [])
    .map((w) => w.waypointNodeId)
    .filter((id): id is string => !!id);

  const highlightedLinks = Object.entries(result.recommendedWeights ?? {})
    .filter(([linkId, weight]) => (result.baselineWeights?.[linkId] ?? weight) !== weight)
    .map(([linkId]) => linkId);

  const title =
    result.mode === "WAYPOINT_OPTIMIZATION" ? "Recommended waypoint(s)" :
    result.mode === "LINK_WEIGHT_OPTIMIZATION" ? "Recommended weight changes" :
    result.mode === "JOINT_OPTIMIZATION" ? "Recommended waypoint(s) and weight changes" :
    "Optimal flow";

  return {
    stepId: `optimization-${result.mode}`,
    algorithm: result.mode,
    title,
    description: result.message,
    explanationText: result.message,
    highlightedNodes,
    highlightedLinks,
    activeDemandId: null,
    pathColor: null,
  };
}

// ── "View on graph" — explicit, textual confirmation of what the button
// actually did (§F: "the user clicks it and receives no obvious feedback").
// Deliberately built from the exact same highlightedNodes/highlightedLinks
// buildOptimizationHighlightEvent already computes — one derivation, not
// two independent ones that could drift apart.

export interface ViewOnGraphSummary {
  /** Empty means nothing is highlighted on the canvas for this result —
   * the UI must say so explicitly, never leave the student guessing. */
  headline: string;
  detailLines: string[];
  isTheoretical: boolean;
  hasNoVisualChange: boolean;
}

export function describeViewOnGraphState(result: OptimizationResult, network: NetworkInput): ViewOnGraphSummary {
  const labels: NodeLabelMap | NetworkInput = network;
  const event = buildOptimizationHighlightEvent(result);
  const waypointLabels = event.highlightedNodes.map((id) => resolveNodeLabel(id, labels));
  const changedLinkIds = event.highlightedLinks;

  if (result.mode === "OPT") {
    return {
      headline: "Viewing OPT's unrestricted-flow projection",
      detailLines: [
        "Theoretical — assumes traffic can be split arbitrarily across any path, not a directly-applicable routing configuration.",
        `Projected max utilization: ${(result.mlu * 100).toFixed(1)}%.`,
      ],
      isTheoretical: true,
      hasNoVisualChange: false,
    };
  }

  const hasNoVisualChange = waypointLabels.length === 0 && changedLinkIds.length === 0;
  if (hasNoVisualChange) {
    return {
      headline: "No routing change to visualize",
      detailLines: ["This optimizer did not improve the current configuration — nothing to highlight on the graph."],
      isTheoretical: false,
      hasNoVisualChange: true,
    };
  }

  const detailLines: string[] = [];
  if (waypointLabels.length > 0) {
    detailLines.push(`Recommended waypoint${waypointLabels.length > 1 ? "s" : ""}: ${waypointLabels.join(", ")}`);
  }
  if (changedLinkIds.length > 0) {
    detailLines.push(`${changedLinkIds.length} link${changedLinkIds.length > 1 ? "s" : ""} reweighted: ${changedLinkIds.join(", ")}`);
  }
  detailLines.push(`Projected max utilization: ${(result.mlu * 100).toFixed(1)}%.`);

  return {
    headline:
      result.mode === "WAYPOINT_OPTIMIZATION" ? "Viewing WPO's recommended waypoint(s)" :
      result.mode === "LINK_WEIGHT_OPTIMIZATION" ? "Viewing LWO's recommended weight changes" :
      "Viewing Joint's recommended waypoint(s) and weight changes",
    detailLines,
    isTheoretical: false,
    hasNoVisualChange: false,
  };
}
