import { OptimizationLabMode, OptimizationResult } from "../types/optimization";

// ── Optimization Lab — educational copy ────────────────────────────────────
//
// Two kinds of text live here:
//  1. STATIC per-mode explanation (`OPTIMIZATION_MODE_INFO`) — what each
//     optimizer assumes, always true regardless of any particular result.
//     Plain language, no notation, matching PR5's own instruction.
//  2. DATA-DRIVEN "why" sentences (`explainResult`) — built from the actual
//     numbers a real backend call returned (recommended waypoint count,
//     changed-weight count, MLU delta). Never fabricated: a mode that made
//     no recommendation says so plainly rather than inventing a reason.

export interface OptimizationModeInfo {
  label: string;
  shortLabel: string;
  optimizes: string;
  assumptions: string;
  theoreticalOrHeuristic: "theoretical" | "heuristic-or-exact";
  optimalityNote: string;
  routingSemantics: string;
}

export const OPTIMIZATION_MODE_INFO: Record<Exclude<OptimizationLabMode, "CURRENT">, OptimizationModeInfo> = {
  OPT: {
    label: "Optimal Flow (OPT)",
    shortLabel: "OPT",
    optimizes:
      "The theoretical minimum possible congestion (Maximum Link Utilization) for this topology and these demands.",
    assumptions:
      "Traffic may split across any number of paths, in any proportion, at any node — arbitrary splitting, not just even splits.",
    theoreticalOrHeuristic: "theoretical",
    optimalityNote:
      "This is a mathematical lower bound. It answers \"how good could routing possibly be?\" — not a routing a real router (ECMP, Segment Routing, or OSPF) can actually perform. It cannot be applied to the network directly.",
    routingSemantics: "Unrestricted multi-commodity flow — no waypoint, ECMP, or shortest-path restriction of any kind.",
  },
  WPO: {
    label: "Waypoint Optimization (WPO)",
    shortLabel: "WPO",
    optimizes:
      "The best single extra stop (waypoint) to route each demand through, to reduce congestion.",
    assumptions:
      "At most one additional waypoint per demand. Between any two stops, traffic still follows ordinary shortest-path routing and splits evenly across every equal-cost path (ECMP) — exactly what Segment Routing already does in this simulator.",
    theoreticalOrHeuristic: "heuristic-or-exact",
    optimalityNote:
      "When the number of demands and candidate waypoints is small, this searches every possible combination and is provably the best choice within that search. For larger networks it falls back to a fast, well-known heuristic (GreedyWPO) that isn't guaranteed to find the single best combination.",
    routingSemantics: "Segment Routing with ECMP between segments — the same engine as the Segment Routing algorithm.",
  },
  LWO: {
    label: "Link Weight Optimization (LWO)",
    shortLabel: "LWO",
    optimizes: "The best link weights (routing costs) to reduce congestion, without changing which links exist.",
    assumptions:
      "Routing still follows ordinary OSPF/ECMP: shortest path by weight, split evenly across ties. Weights are chosen from a small integer range (1-5 by default).",
    theoreticalOrHeuristic: "heuristic-or-exact",
    optimalityNote:
      "Finding the mathematically best weight setting for any network is a famously hard problem (proven NP-hard) — there is no fast exact method in general. For small networks, every weight combination in range is tried and the best is provably optimal within that range. For larger networks, a step-by-step local search is used instead, which can get stuck short of the true best.",
    routingSemantics: "OSPF / ECMP — the same engine as the ECMP algorithm.",
  },
  JOINT: {
    label: "Joint Optimization",
    shortLabel: "Joint",
    optimizes: "Link weights and waypoints together, since choosing them separately can miss improvements either alone would.",
    assumptions:
      "Same routing rules as Waypoint Optimization and Link Weight Optimization, applied together.",
    theoreticalOrHeuristic: "heuristic-or-exact",
    optimalityNote:
      "By default, this alternates between improving weights and improving waypoints, back and forth, until neither improves things further. That process is never guaranteed to find the single best combination (it's a well-known limitation of this kind of step-by-step search) — only very small networks are searched exhaustively.",
    routingSemantics: "Segment Routing plus optimized weights — the same ECMP-based engine as WPO and LWO, combined.",
  },
};

/** A concise, honest, result-specific sentence explaining WHY this
 * particular result improved (or didn't) — built only from fields the
 * backend actually returned, never invented. */
export function explainResult(result: OptimizationResult): string {
  if (result.status === "ERROR") return `Optimization could not run: ${result.message}`;
  if (result.status === "INFEASIBLE") return "No valid routing exists for this configuration — check for disconnected demands.";

  if (result.mode === "OPT") {
    return result.mlu > 1
      ? "Even with arbitrarily flexible splitting, some link must carry more traffic than its capacity — congestion is unavoidable here, not a routing-algorithm limitation."
      : "Congestion-free routing exists in theory — some routing (not necessarily one a real router can perform) keeps every link under capacity.";
  }

  const baseline = result.baselineMLU ?? null;
  const optimized = result.optimizedMLU ?? result.mlu;
  const improved = baseline !== null && optimized < baseline - 1e-9;

  if (result.mode === "WAYPOINT_OPTIMIZATION") {
    const moved = (result.recommendedWaypoints ?? []).filter((w) => w.waypointNodeId !== null).length;
    if (!improved || moved === 0) {
      return "No additional waypoint improved on the current routing — the existing shortest paths already balance traffic as well as a single extra stop can.";
    }
    return `Congestion reduced because ${moved} demand${moved === 1 ? " was" : "s were"} routed through an added waypoint, moving traffic away from the busiest link(s).`;
  }

  if (result.mode === "LINK_WEIGHT_OPTIMIZATION") {
    const changed = Object.entries(result.recommendedWeights ?? {}).filter(
      ([linkId, weight]) => (result.baselineWeights?.[linkId] ?? weight) !== weight
    ).length;
    if (!improved || changed === 0) {
      return "No weight change improved on the current routing — the existing weights already produce the best shortest-path split this optimizer could find.";
    }
    return `Congestion reduced because ${changed} link weight${changed === 1 ? " was" : "s were"} adjusted, redirecting traffic onto less-congested paths.`;
  }

  if (result.mode === "JOINT_OPTIMIZATION") {
    const moved = (result.recommendedWaypoints ?? []).filter((w) => w.waypointNodeId !== null).length;
    const changed = Object.entries(result.recommendedWeights ?? {}).filter(
      ([linkId, weight]) => (result.baselineWeights?.[linkId] ?? weight) !== weight
    ).length;
    if (!improved || (moved === 0 && changed === 0)) {
      return "No combination of weight and waypoint changes improved on the current routing.";
    }
    const parts: string[] = [];
    if (changed > 0) parts.push(`${changed} link weight${changed === 1 ? "" : "s"} adjusted`);
    if (moved > 0) parts.push(`${moved} demand${moved === 1 ? "" : "s"} routed through an added waypoint`);
    return `Congestion reduced because ${parts.join(" and ")}.`;
  }

  return result.message;
}

/** Congestion-free framing for the dedicated result section (PR5 §7) —
 * only meaningful once OPT has actually been run (it is the theoretical
 * lower bound every other mode is measured against). */
export function describeCongestionFreeStatus(optMlu: number): { possible: boolean; text: string } {
  if (optMlu <= 1) {
    return {
      possible: true,
      text: "Congestion-free routing is theoretically possible under the current capacities and demands — the theoretical optimum keeps every link at or under 100% utilization.",
    };
  }
  return {
    possible: false,
    text: "Congestion-free routing is impossible under the current capacities and demands — even the theoretical optimum cannot keep every link under 100% utilization. Only added capacity or reduced demand can fix this, not a smarter routing algorithm.",
  };
}
