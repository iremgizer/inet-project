import { LinkResult, NetworkInput, PathResult, PathShare, SimulationResult } from "../types/network";
import { OptimizationResult } from "../types/optimization";

// ── Optimization Lab — SimulationResult projection ─────────────────────────
//
// Turns an OptimizationResult into the exact same SimulationResult shape
// every routing algorithm already returns, so the Optimization Lab can reuse
// `buildComparison` (utils/comparison.ts), `ComparisonPanel`, and
// `ReactFlowCanvas`'s existing `linkResults`/`pathResults` props completely
// unmodified — no second comparison engine, no second graph viewer. Mirrors
// the projection docs/research/sprint2-mip-architecture-analysis-v1.md
// Part J originally sketched for this exact purpose.
//
// Deliberately transient: this function is called fresh every time a card
// needs to be viewed/compared, and its output is never written back into
// saved-run storage or topology JSON (see PR5's own "recommendations are
// transient" requirement) — only an explicit "Apply" mutates the real
// NetworkInput/AlgorithmConfig.

/** `PathResult[]` is only ever populated for OPT — it's the one mode whose
 * `flowAssignments` are literally path-shaped. WPO/LWO/JOINT only ever
 * report aggregate link loads, not explicit paths (see each optimizer's own
 * documented scope) — projecting an empty array for those modes is the
 * honest choice, not a gap: the route-changes section of a comparison
 * simply has nothing to show for them, which is accurate, not fabricated.
 */
function projectPathResults(result: OptimizationResult, network: NetworkInput): PathResult[] {
  if (result.mode !== "OPT" || result.flowAssignments.length === 0) return [];
  const byDemand = new Map<string, PathShare[]>();
  for (const flow of result.flowAssignments) {
    const shares = byDemand.get(flow.demandId) ?? [];
    // OPT's LP has no notion of "path cost" (it minimizes MLU, not cost) —
    // 0 here is an honest "not applicable," not a fabricated number.
    shares.push({ nodes: flow.nodes, cost: 0, trafficShare: flow.share });
    byDemand.set(flow.demandId, shares);
  }
  const pathResults: PathResult[] = [];
  for (const demand of network.demands) {
    const paths = byDemand.get(demand.id);
    if (!paths) continue;
    pathResults.push({ demandId: demand.id, source: demand.source, target: demand.target, paths });
  }
  return pathResults;
}

function projectLinkResults(
  result: OptimizationResult,
  network: NetworkInput,
  congestionThreshold: number,
): LinkResult[] {
  return network.links.map((link) => {
    const load = result.linkLoads[link.id] ?? 0;
    const utilization = result.linkUtilizations[link.id] ?? (link.capacity > 0 ? load / link.capacity : 0);
    return {
      linkId: link.id,
      source: link.source,
      target: link.target,
      load,
      capacity: link.capacity,
      utilization,
      isCongested: utilization > congestionThreshold,
      // Optimized weight if this mode recommended one (LWO/JOINT), else the
      // network's own current weight — never fabricated.
      weight: result.recommendedWeights?.[link.id] ?? link.weight,
    };
  });
}

const MODE_LABEL: Record<OptimizationResult["mode"], string> = {
  OPT: "OPTIMIZED_OPT",
  WAYPOINT_OPTIMIZATION: "OPTIMIZED_WPO",
  LINK_WEIGHT_OPTIMIZATION: "OPTIMIZED_LWO",
  JOINT_OPTIMIZATION: "OPTIMIZED_JOINT",
};

/** Projects an `OptimizationResult` into a `SimulationResult`-shaped object
 * for exactly one purpose: feeding it into the same comparison/visualization
 * machinery `SimulationResult` already drives. Never persisted, never sent
 * back to the backend, never shown as if it were an actual simulation run —
 * the Optimization Lab UI is the only consumer, and always labels it as a
 * recommendation, not a run. */
export function projectOptimizationResult(
  result: OptimizationResult,
  network: NetworkInput,
  congestionThreshold: number,
): SimulationResult {
  const linkResults = projectLinkResults(result, network, congestionThreshold);
  const pathResults = projectPathResults(result, network);
  const congestedLinkCount = linkResults.filter((l) => l.isCongested).length;
  // Best-effort, honestly-labeled aggregate: the sum of every demand's own
  // amount, since OptimizationResult doesn't expose a structured per-demand
  // "delivered" figure (only the free-text debugInfo notes an unreachable
  // demand, if any — see each optimizer's own docstring).
  const totalDeliveredTraffic = network.demands.reduce((sum, d) => sum + d.amount, 0);

  return {
    simulationRunId: `optimization-preview-${result.mode}`,
    algorithm: MODE_LABEL[result.mode],
    pathResults,
    linkResults,
    nodeRoles: [],
    traceEvents: [],
    maxUtilization: result.mlu,
    totalDeliveredTraffic,
    averagePathCost: 0,
    congestedLinkCount,
    runtimeMs: result.solverRuntime,
    debugInfo: result.debugInfo,
  };
}
