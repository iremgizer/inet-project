import { PathResult, TrafficDemandInput, TrafficDistribution } from "../types/network";

// Same tolerance style as the other ~0.01-magnitude tolerances already used
// in this codebase (e.g. GradingRules.tolerance) — generous enough that
// rounding a percent input to one decimal never falsely reads as invalid.
export const DISTRIBUTION_TOTAL_TOLERANCE_PCT = 0.5;

/** Builds a fully-populated CUSTOM TrafficDistribution list from a just-run
 * ECMP result: one entry per demand with 2+ discovered equal-cost paths,
 * pre-filled with the equal split that result already computed. Demands
 * with a single path (nothing to distribute) are omitted entirely. */
export function buildCustomDistributionsFromResult(
  demands: TrafficDemandInput[],
  pathResults: PathResult[],
): TrafficDistribution[] {
  const amountByDemand = new Map(demands.map((d) => [d.id, d.amount]));
  return pathResults
    .filter((pr) => pr.paths.length >= 2)
    .map((pr) => {
      const amount = amountByDemand.get(pr.demandId) || 1;
      return {
        demandId: pr.demandId,
        mode: "CUSTOM" as const,
        paths: pr.paths.map((p, i) => ({
          pathId: p.pathId ?? `path-${i + 1}`,
          share: amount > 0 ? p.trafficShare / amount : 0,
        })),
      };
    });
}

/** True when every CUSTOM-mode distribution's own shares sum to ~100%. An
 * empty `paths` list (not yet populated) is treated as valid/no-op — it
 * simply hasn't been filled in yet and won't be sent as CUSTOM until it is. */
export function isDistributionValid(distributions: TrafficDistribution[]): boolean {
  for (const dist of distributions) {
    if (dist.mode !== "CUSTOM" || dist.paths.length === 0) continue;
    const totalPct = dist.paths.reduce((sum, p) => sum + p.share, 0) * 100;
    if (Math.abs(totalPct - 100) > DISTRIBUTION_TOTAL_TOLERANCE_PCT) return false;
  }
  return true;
}
