import { OptimizationLabMode } from "../types/optimization";

// ── Sprint 2 PR6 §18, extended final-polish Part K — single source of
//    truth for which visualization context owns the graph ─────────────────
//
// Two things share this file rather than being documented in two places:
//
// (1) `resolveVisualizationOwner` below — the Optimization Lab's OWN
//     internal precedence (only relevant at workflow step 5, the Lab
//     itself), between a *selected* result's highlight overlay and a
//     *compared* result's difference heatmap. PR5's known limitation was
//     that both could render at once — a selected mode's waypoint/weight
//     highlight drawn on top of a different mode's heatmap. Fixed by making
//     the precedence an explicit, pure, named rule instead of an implicit
//     consequence of how WorkflowManager happened to combine two booleans.
//
// (2) The APP-WIDE precedence (documented here, implemented directly in
//     WorkflowManager's `currentTraceEvent`/`canvasIsTraceMode`
//     derivation, since it spans state that belongs to different workflow
//     steps and doesn't reduce to a single pure function the way (1) does):
//
//       Comparison mode active (Optimization Lab, step 5 only)
//         → comparison owns the canvas (difference heatmap).
//       Else if an optimization result is selected (step 5 only)
//         → the selected result's highlight overlay owns the canvas.
//       Else if a path is focused (Result step, step 4 — final-polish
//       Part E; mutually exclusive with the two states above, since path
//       focus only exists outside the Lab)
//         → the focused path owns route emphasis (strong highlight; other
//           paths render without their own per-demand color identity while
//           this is active, the same "secondary" treatment optimization
//           highlighting already gets).
//       Else if real trace replay is active (`isTraceMode`)
//         → the current replay step's own highlight owns the canvas (PR1-6
//           behavior, unchanged).
//       Else
//         → the ordinary (non-highlighted) current simulation/comparison
//           view — normal utilization coloring, demand-color path identity.
//
//     Path focus and trace replay are mutually exclusive in practice (each
//     clears the other's state when it starts — see WorkflowManager's
//     onEnableTrace/handleFocusPath), and Lab-internal state
//     (selected/comparing) is only ever non-null at step 5, where path
//     focus is never set — so despite five "tiers," at most one is ever
//     actually active for a given canvas render.
//
// resolveVisualizationOwner is the only place decision (1) is made —
// WorkflowManager calls it instead of inlining the precedence, so the rule
// can't drift between the derivation of `displayedResult` and the
// derivation of `currentTraceEvent` the way it implicitly could in PR5.

export type VisualizationOwner = "comparison" | "selected" | "none";

export function resolveVisualizationOwner(
  selectedMode: OptimizationLabMode | null,
  comparingMode: OptimizationLabMode | null,
): VisualizationOwner {
  if (comparingMode) return "comparison";
  if (selectedMode) return "selected";
  return "none";
}
