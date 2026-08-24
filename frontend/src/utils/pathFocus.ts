import { NetworkInput, SimulationTraceEvent } from "../types/network";

// ── Path focus (final-polish Part E) — "focus one path from the results
// list" reuses the exact same trace-event highlight mechanism the
// Optimization Lab already uses for "View on graph" (see
// optimizationHighlight.ts) and the real trace replay already uses for
// step-by-step highlighting — one highlighting mechanism in
// ReactFlowCanvas/NetworkNode/NetworkEdge, not a second graph renderer.

/** A stable identity for one specific path within a result's path list —
 * `${demandId}::${pathId ?? nodes.join(">")}` so a path without a stable
 * backend-assigned `pathId` (older result shapes, or path lists that never
 * had one) still gets a consistent key across renders. */
export function pathFocusKey(demandId: string, pathId: string | null | undefined, nodes: string[]): string {
  return `${demandId}::${pathId ?? nodes.join(">")}`;
}

/** Builds the highlighted-nodes/links trace event for one focused path.
 * Links are resolved by matching consecutive node pairs against the
 * network's own links (direction-agnostic, since ECMP/SR links are
 * frequently traversed either way) — a pair with no matching link is
 * silently skipped rather than throwing, so a stale/inconsistent path
 * (e.g. after a topology edit) degrades to "fewer links highlighted," never
 * a crash. */
export function buildPathFocusHighlightEvent(nodes: string[], network: NetworkInput): SimulationTraceEvent {
  const linkIds: string[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const link = network.links.find(
      (l) => (l.source === a && l.target === b) || (l.source === b && l.target === a)
    );
    if (link) linkIds.push(link.id);
  }
  return {
    stepId: "path-focus",
    algorithm: network.topologyType,
    title: "Focused path",
    description: "Highlighting one selected path — other paths are shown secondarily.",
    explanationText: "Highlighting one selected path — other paths are shown secondarily.",
    highlightedNodes: nodes,
    highlightedLinks: linkIds,
    activeDemandId: null,
    pathColor: "#0071e3",
  };
}
