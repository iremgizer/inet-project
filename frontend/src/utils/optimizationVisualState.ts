import { OptimizationLabMode } from "../types/optimization";

// ── Sprint 2 PR6 §18 — single source of truth for which visualization
//    context owns the graph while the Optimization Lab is open ───────────
//
// PR5's known limitation: viewing one card ("selected") while comparing a
// different card ("comparing") could overlay both visual layers at once —
// a selected mode's waypoint/weight highlights drawn on top of a different
// mode's difference heatmap. Fixed here by making the precedence an
// explicit, pure, named rule instead of an implicit consequence of how
// WorkflowManager happened to combine two booleans:
//
//   Comparison active → comparison owns graph visualization (the difference
//   heatmap; no highlight overlay from `selected`, even if one is also set).
//   Else → the selected result owns visualization (its own highlight
//   overlay, no comparison heatmap).
//   Neither → nothing optimization-specific is shown; the graph falls back
//   to whatever the ordinary (non-Lab) simulation view would show.
//
// This function is the only place that decision is made — WorkflowManager
// calls it instead of inlining the precedence, so the rule can't drift
// between the derivation of `displayedResult` and the derivation of
// `currentTraceEvent` the way it implicitly could in PR5.

export type VisualizationOwner = "comparison" | "selected" | "none";

export function resolveVisualizationOwner(
  selectedMode: OptimizationLabMode | null,
  comparingMode: OptimizationLabMode | null,
): VisualizationOwner {
  if (comparingMode) return "comparison";
  if (selectedMode) return "selected";
  return "none";
}
