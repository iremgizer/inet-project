// ── Sprint 2 PR6 — Optimization Settings (pure, deterministic) ─────────────
//
// Everything here is a pure function/constant — no React, no network calls
// — so it can be validated deterministically (see §25: "keep new
// computational frontend utilities pure and validate them deterministically",
// this project has no automated test runner). The backend
// (app/services/optimization_service.py) independently re-validates every
// one of these bounds server-side and is the actual source of truth; this
// module exists purely so the UI can give immediate, friendly feedback
// before a request is ever sent, and so the search-space preview (§3) has
// somewhere to live its own pure prediction logic.

export interface OptimizationSettings {
  maxExactCombinations: number;
  minWeight: number;
  maxWeight: number;
  timeLimitSeconds: number;
}

// Matches every optimizer's own DEFAULT_MAX_EXACT_COMBINATIONS (PR2/PR3/PR4)
// and OptimizeRequest.timeLimitSeconds's own backend default (PR6 §9).
export const DEFAULT_SETTINGS: OptimizationSettings = {
  maxExactCombinations: 50_000,
  minWeight: 1,
  maxWeight: 5,
  timeLimitSeconds: 30,
};

export type BudgetPresetId = "fast" | "default" | "deep" | "custom";

export interface BudgetPreset {
  id: BudgetPresetId;
  label: string;
  /** `null` only for "custom" — the user-entered value itself lives in
   * `OptimizationSettings.maxExactCombinations`, not here. */
  value: number | null;
}

// PR6 §2's own three named presets, in the order they should be offered.
export const BUDGET_PRESETS: BudgetPreset[] = [
  { id: "fast", label: "Fast", value: 10_000 },
  { id: "default", label: "Default", value: 50_000 },
  { id: "deep", label: "Deep", value: 250_000 },
  { id: "custom", label: "Custom", value: null },
];

/** Which preset (if any) a given budget value currently matches — drives
 * which preset button reads as "selected" in the settings panel. Any value
 * not exactly matching a preset's own number is "custom" by definition,
 * including a custom value a student happened to type in that happens to
 * differ from every preset by even 1. */
export function presetForBudget(budget: number): BudgetPresetId {
  const match = BUDGET_PRESETS.find((p) => p.value === budget);
  return match ? match.id : "custom";
}

// ── Validation bounds — mirrors optimization_service.py's own constants.
//    Kept as separate named exports (not folded into one "config" object)
//    so each one's own docstring/reasoning stays next to its number. ──────

/** Matches optimization_service.py's DEFAULT_MAX_EXACT_COMBINATIONS_CAP. */
export const MAX_EXACT_COMBINATIONS_SAFETY_CAP = 2_000_000;
/** Matches optimization_service.py's MIN/MAX_TIME_LIMIT_SECONDS. */
export const MIN_TIME_LIMIT_SECONDS = 1;
export const MAX_TIME_LIMIT_SECONDS = 300;
/** Matches optimization_service.py's MIN/MAX_ALLOWED_WEIGHT. */
export const MIN_ALLOWED_WEIGHT = 1;
export const MAX_ALLOWED_WEIGHT = 1000;

// PR6 §16 — a budget whose *effective* search (min(searchSpaceSize, budget))
// exceeds this triggers a non-blocking pre-run warning. Set well above the
// "Deep" preset (250,000) so routine preset use never warns, but a student
// who deliberately pushes past it gets a heads-up before committing to a
// potentially slow run.
export const LARGE_SEARCH_WARNING_THRESHOLD = 500_000;

export interface SettingsValidationResult {
  valid: boolean;
  errors: string[];
}

/** Pure, client-side pre-validation — never the final word (the backend
 * re-validates independently and is authoritative), but lets the settings
 * panel show an actionable error immediately instead of waiting on a round
 * trip for something a student could fix before ever submitting. */
export function validateOptimizationSettings(settings: OptimizationSettings): SettingsValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(settings.maxExactCombinations) || settings.maxExactCombinations <= 0) {
    errors.push("Search budget must be a positive number.");
  } else if (settings.maxExactCombinations > MAX_EXACT_COMBINATIONS_SAFETY_CAP) {
    errors.push(`Search budget cannot exceed ${MAX_EXACT_COMBINATIONS_SAFETY_CAP.toLocaleString()} (server safety cap).`);
  }

  if (
    !Number.isFinite(settings.timeLimitSeconds) ||
    settings.timeLimitSeconds < MIN_TIME_LIMIT_SECONDS ||
    settings.timeLimitSeconds > MAX_TIME_LIMIT_SECONDS
  ) {
    errors.push(`Timeout must be between ${MIN_TIME_LIMIT_SECONDS} and ${MAX_TIME_LIMIT_SECONDS} seconds.`);
  }

  if (settings.minWeight > settings.maxWeight) {
    errors.push("Minimum weight must be less than or equal to maximum weight.");
  }
  if (settings.minWeight < MIN_ALLOWED_WEIGHT || settings.maxWeight > MAX_ALLOWED_WEIGHT) {
    errors.push(`Weight range must be within ${MIN_ALLOWED_WEIGHT}-${MAX_ALLOWED_WEIGHT}.`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Search-space preview (PR6 §3) ───────────────────────────────────────────

export interface SearchSpacePrediction {
  willUseExact: boolean;
  label: "EXACT SEARCH AVAILABLE" | "HEURISTIC MODE WILL BE USED";
  detail: string;
}

/** Pure prediction of which search method a real run would choose, given
 * an already-computed `searchSpaceSize` (from the backend's own
 * `/optimize/search-space` preview — never estimated client-side, see
 * that endpoint's own docstring) and the currently-configured budget. Never
 * promises a runtime, only whether exact enumeration fits (PR6 §3: "Do not
 * promise that exact computation will be fast merely because it fits within
 * the budget"). `null` when there is nothing to predict yet (no estimate
 * available, e.g. OPT mode or a request still in flight). */
export function predictSearchMethod(searchSpaceSize: number | null, budget: number): SearchSpacePrediction | null {
  if (searchSpaceSize === null) return null;
  if (searchSpaceSize <= budget) {
    return {
      willUseExact: true,
      label: "EXACT SEARCH AVAILABLE",
      detail: "Every candidate in this search space will be evaluated. The result will be proven optimal within these bounds.",
    };
  }
  return {
    willUseExact: false,
    label: "HEURISTIC MODE WILL BE USED",
    detail: `Increase the budget to at least ${searchSpaceSize.toLocaleString()} to permit exact enumeration.`,
  };
}

/** PR6 §16 — whether to show the non-blocking "this may take a while"
 * warning before a student runs a search. Based on the *effective* number
 * of candidates a real run would actually evaluate (never more than the
 * budget itself, since the search stops choosing EXACT_ENUMERATION once the
 * space exceeds the budget) — so raising the budget past the search space's
 * own size never triggers a bigger warning than the space itself justifies. */
export function shouldWarnLargeSearch(searchSpaceSize: number | null, budget: number): boolean {
  if (searchSpaceSize === null) return false;
  const effective = Math.min(searchSpaceSize, budget);
  return effective > LARGE_SEARCH_WARNING_THRESHOLD;
}

export function formatLargeSearchWarning(searchSpaceSize: number, budget: number): string {
  const effective = Math.min(searchSpaceSize, budget);
  return `This configuration may require evaluating up to ${effective.toLocaleString()} candidates and can take noticeably longer.`;
}
