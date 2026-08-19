import { PathShare, SimulationResult } from "../types/network";
import { deriveDownLinkIdsAtStep } from "./failureReplay";

// ── Before / After comparison (PR 6, Part 2) ──────────────────────────────────
//
// Deliberately frontend-derived, pure, and stateless — the backend already
// returns everything two SimulationResults need (linkResults' load/
// utilization/isCongested, pathResults' node sequences, traceEvents for
// down-link detection). No new backend endpoint, no MIP, no new routing
// logic. Utilization deltas are reported in PERCENTAGE POINTS
// (afterUtilization*100 - beforeUtilization*100), not relative percent, per
// the spec: 42% -> 78% is "+36 pp", not "+86%".

export type ComparisonMode = "before" | "after" | "difference";

export type LinkComparisonStatus =
  | "IMPROVED" | "WORSENED" | "UNCHANGED" | "NEW_CONGESTION" | "RESOLVED_CONGESTION" | "DOWN";

export interface LinkComparisonEntry {
  linkId: string;
  beforeLoad: number;
  afterLoad: number;
  beforeUtilization: number;
  afterUtilization: number;
  /** Percentage points: afterUtilization*100 - beforeUtilization*100. */
  utilizationDeltaPct: number;
  status: LinkComparisonStatus;
}

export interface RouteChangeEntry {
  demandId: string;
  beforePaths: string[][];
  afterPaths: string[][];
}

export interface SimulationComparison {
  maxUtilizationBefore: number;
  maxUtilizationAfter: number;
  maxUtilizationDeltaPct: number;
  congestedLinksBefore: number;
  congestedLinksAfter: number;
  routeChanges: RouteChangeEntry[];
  linkDeltas: LinkComparisonEntry[];
  /** Largest utilization increase among links that are still up in both
   * runs — a link going DOWN is excluded, since "utilization dropped to 0
   * because it's off" isn't a meaningful congestion improvement. */
  largestIncrease: LinkComparisonEntry | null;
  largestImprovement: LinkComparisonEntry | null;
}

// Utilization deltas at or below this many percentage points read as
// UNCHANGED rather than a rounding-noise WORSENED/IMPROVED.
const UNCHANGED_EPSILON_PP = 0.05;

function pathSetKey(paths: PathShare[]): string {
  return paths.map((p) => p.nodes.join(">")).sort().join("|");
}

// ── Difference-mode color encoding ────────────────────────────────────────────
// A dedicated palette, deliberately not reused from congestion severity
// (graphVisuals.ts) or TE policy badges — this channel means "how did this
// link change," not "how loaded is it" or "what policy applies to it."
// Cool = better, warm = worse, per the spec; DOWN reuses the same
// stone/neutral hue PR 5's failure styling already established.
export const COMPARISON_STATUS_COLOR: Record<LinkComparisonStatus, string> = {
  IMPROVED: "#0d9488",
  UNCHANGED: "#94a3b8",
  WORSENED: "#f97316",
  NEW_CONGESTION: "#dc2626",
  RESOLVED_CONGESTION: "#16a34a",
  DOWN: "#a8a29e",
};

export const COMPARISON_STATUS_LABEL: Record<LinkComparisonStatus, string> = {
  IMPROVED: "Improved",
  UNCHANGED: "Unchanged",
  WORSENED: "Worsened",
  NEW_CONGESTION: "New congestion",
  RESOLVED_CONGESTION: "Resolved congestion",
  DOWN: "Down link",
};

export function buildComparison(
  baseline: SimulationResult,
  current: SimulationResult,
): SimulationComparison {
  const beforeDown = deriveDownLinkIdsAtStep(baseline.traceEvents, baseline.traceEvents.length - 1);
  const afterDown = deriveDownLinkIdsAtStep(current.traceEvents, current.traceEvents.length - 1);

  const beforeByLink = new Map(baseline.linkResults.map((l) => [l.linkId, l]));
  const afterByLink = new Map(current.linkResults.map((l) => [l.linkId, l]));
  const allLinkIds = new Set<string>([...beforeByLink.keys(), ...afterByLink.keys()]);

  const linkDeltas: LinkComparisonEntry[] = [];
  for (const linkId of allLinkIds) {
    const before = beforeByLink.get(linkId);
    const after = afterByLink.get(linkId);
    const beforeLoad = before?.load ?? 0;
    const afterLoad = after?.load ?? 0;
    const beforeUtilization = before?.utilization ?? 0;
    const afterUtilization = after?.utilization ?? 0;
    const utilizationDeltaPct = Math.round((afterUtilization - beforeUtilization) * 100 * 100) / 100;

    let status: LinkComparisonStatus;
    if (afterDown.has(linkId)) {
      status = "DOWN";
    } else {
      const beforeCongested = before?.isCongested ?? false;
      const afterCongested = after?.isCongested ?? false;
      if (!beforeCongested && afterCongested) status = "NEW_CONGESTION";
      else if (beforeCongested && !afterCongested) status = "RESOLVED_CONGESTION";
      else if (utilizationDeltaPct > UNCHANGED_EPSILON_PP) status = "WORSENED";
      else if (utilizationDeltaPct < -UNCHANGED_EPSILON_PP) status = "IMPROVED";
      else status = "UNCHANGED";
    }

    linkDeltas.push({ linkId, beforeLoad, afterLoad, beforeUtilization, afterUtilization, utilizationDeltaPct, status });
  }
  linkDeltas.sort((a, b) => a.linkId.localeCompare(b.linkId));

  const rankable = linkDeltas.filter((d) => d.status !== "DOWN");
  const largestIncrease = rankable.reduce<LinkComparisonEntry | null>(
    (max, d) => (d.utilizationDeltaPct > (max?.utilizationDeltaPct ?? -Infinity) ? d : max), null
  );
  const largestImprovement = rankable.reduce<LinkComparisonEntry | null>(
    (min, d) => (d.utilizationDeltaPct < (min?.utilizationDeltaPct ?? Infinity) ? d : min), null
  );

  const beforeByDemand = new Map(baseline.pathResults.map((pr) => [pr.demandId, pr]));
  const afterByDemand = new Map(current.pathResults.map((pr) => [pr.demandId, pr]));
  const routeChanges: RouteChangeEntry[] = [];
  for (const [demandId, beforePr] of beforeByDemand) {
    const afterPr = afterByDemand.get(demandId);
    if (!afterPr) continue; // demand set differs — shouldn't happen (baseline is cleared on demand edits), skip defensively
    if (pathSetKey(beforePr.paths) !== pathSetKey(afterPr.paths)) {
      routeChanges.push({
        demandId,
        beforePaths: beforePr.paths.map((p) => p.nodes),
        afterPaths: afterPr.paths.map((p) => p.nodes),
      });
    }
  }
  routeChanges.sort((a, b) => a.demandId.localeCompare(b.demandId));

  return {
    maxUtilizationBefore: baseline.maxUtilization,
    maxUtilizationAfter: current.maxUtilization,
    maxUtilizationDeltaPct: Math.round((current.maxUtilization - baseline.maxUtilization) * 100 * 100) / 100,
    congestedLinksBefore: baseline.congestedLinkCount,
    congestedLinksAfter: current.congestedLinkCount,
    routeChanges,
    linkDeltas,
    largestIncrease: largestIncrease && largestIncrease.utilizationDeltaPct > UNCHANGED_EPSILON_PP ? largestIncrease : null,
    largestImprovement: largestImprovement && largestImprovement.utilizationDeltaPct < -UNCHANGED_EPSILON_PP ? largestImprovement : null,
  };
}
