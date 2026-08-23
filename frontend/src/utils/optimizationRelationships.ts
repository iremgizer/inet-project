import { OptimizationResult } from "../types/optimization";

// ── Sprint 2 PR6 §22 — result relationships, from real computed values only ─
//
// [Parham21] Eq. 2.1: OPT <= Joint <= min(WPO, LWO). This module never
// fabricates the theoretical claim when actual numbers (a heuristic search
// having found a weaker result than theory guarantees, which can genuinely
// happen — GREEDY_WPO/HEURISTIC_LWO/JOINT_ALTERNATING carry no optimality
// proof) would contradict it: every relationship shown here is computed
// directly from whichever results actually exist, and a relationship is
// only ever reported as "holds" or "does not hold" based on the real
// numbers — never asserted independent of them.

const FLOAT_TOL = 1e-6;

export interface RelationshipCheck {
  label: string;
  holds: boolean;
  detail: string;
}

export function computeResultRelationships(
  opt: OptimizationResult | null,
  wpo: OptimizationResult | null,
  lwo: OptimizationResult | null,
  joint: OptimizationResult | null,
): RelationshipCheck[] {
  const checks: RelationshipCheck[] = [];
  const usable = (r: OptimizationResult | null) => !!r && (r.status === "OPTIMAL" || r.status === "FEASIBLE" || r.status === "TIME_LIMIT");

  const pushBound = (label: string, lower: OptimizationResult | null, upper: OptimizationResult | null) => {
    if (!usable(lower) || !usable(upper)) return;
    const holds = lower!.mlu <= upper!.mlu + FLOAT_TOL;
    checks.push({
      label,
      holds,
      detail: `${(lower!.mlu * 100).toFixed(1)}% ${holds ? "≤" : ">"} ${(upper!.mlu * 100).toFixed(1)}%`,
    });
  };

  pushBound("OPT ≤ WPO", opt, wpo);
  pushBound("OPT ≤ LWO", opt, lwo);
  pushBound("OPT ≤ Joint", opt, joint);

  if (usable(joint) && usable(wpo) && usable(lwo)) {
    const bound = Math.min(wpo!.mlu, lwo!.mlu);
    const holds = joint!.mlu <= bound + FLOAT_TOL;
    checks.push({
      label: "Joint ≤ min(WPO, LWO)",
      holds,
      detail: `${(joint!.mlu * 100).toFixed(1)}% ${holds ? "≤" : ">"} ${(bound * 100).toFixed(1)}%`,
    });
  }

  return checks;
}
