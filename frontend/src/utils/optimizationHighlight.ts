import { SimulationTraceEvent } from "../types/network";
import { OptimizationResult } from "../types/optimization";

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
