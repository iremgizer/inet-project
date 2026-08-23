import { OptimizationResult } from "../types/optimization";

// ── Sprint 2 PR6 §13/§14 — exact/heuristic/proven-optimal badges ──────────
//
// Two independent badge slots, never conflated:
//  - METHOD: how the search was actually carried out (EXACT SEARCH vs
//    HEURISTIC) — a property of *how* the result was produced.
//  - OUTCOME: what that run is entitled to claim about its own result
//    (PROVEN OPTIMAL / BEST FOUND / TIME LIMIT) — a property of what was
//    actually proven, never overstated (PR6's own explicit constraint:
//    "provenOptimal is never overstated"). Text labels, not just color, per
//    §13: "understandable without relying only on color."

export type BadgeVariant = "success" | "warning" | "neutral" | "danger";

export interface ResultBadge {
  label: string;
  variant: BadgeVariant;
  explanation: string;
}

function proofExplanation(result: OptimizationResult): string {
  if (result.mode === "OPT") {
    return "The linear program was solved to proven optimality (CBC reported OPTIMAL). No routing — of any kind, restricted or not — can do better.";
  }
  if (result.mode === "LINK_WEIGHT_OPTIMIZATION") {
    return "Every weight combination in the configured range was evaluated. No better assignment exists within that weight range.";
  }
  return "The optimizer evaluated the complete configured search space. No better solution exists within these bounds.";
}

function heuristicExplanation(result: OptimizationResult): string {
  const base = "Not proven optimal. A better configuration may exist";
  if (result.mode === "LINK_WEIGHT_OPTIMIZATION") return `${base} within the selected weight range.`;
  return `${base}.`;
}

/** Returns 0-2 badges for a result: an OUTCOME badge always (when the
 * result actually ran — ERROR/INFEASIBLE results get none, since the
 * existing status badge already says everything meaningful for those), and
 * a METHOD badge whenever a `searchMethod` exists (never for OPT, which is
 * solved via LP, not combinatorial search — PR6 §4). */
export function getResultBadges(result: OptimizationResult): ResultBadge[] {
  const badges: ResultBadge[] = [];
  if (result.status === "ERROR" || result.status === "INFEASIBLE") return badges;

  const isExactMethod = result.searchMethod === "EXACT_ENUMERATION" || result.searchMethod === "EXACT_JOINT_ENUMERATION";
  const isTimeLimited = result.status === "TIME_LIMIT";

  // OUTCOME
  if (isTimeLimited) {
    badges.push({
      label: "TIME LIMIT",
      variant: "warning",
      explanation: "The search stopped at the configured time limit before finishing. The result below is the best solution found so far — not proven optimal.",
    });
  } else if (result.provenOptimal) {
    badges.push({ label: "PROVEN OPTIMAL", variant: "success", explanation: proofExplanation(result) });
  } else {
    badges.push({ label: "BEST FOUND", variant: "neutral", explanation: heuristicExplanation(result) });
  }

  // METHOD (never shown for OPT — no searchMethod field at all)
  if (result.searchMethod) {
    badges.push(
      isExactMethod
        ? { label: isTimeLimited ? "EXACT SEARCH (interrupted)" : "EXACT SEARCH", variant: "neutral", explanation: "Every candidate in the configured search space was (or would have been) evaluated one by one — a brute-force enumeration, not a heuristic." }
        : { label: "HEURISTIC", variant: "neutral", explanation: `${result.searchMethod} — a fast, well-known algorithm with no optimality guarantee, used because the exact search space exceeded the configured budget.` }
    );
  }

  return badges;
}
