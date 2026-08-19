import { SimulationTraceEvent } from "../types/network";

// ── Mid-simulation failure replay derivation (PR 6) ───────────────────────────
//
// Same pattern as `segmentRoutingTrace.ts`'s `deriveSegmentRoutingDisplayState`:
// a pure, frontend-only derivation over the already-computed trace, no backend
// change. A LINK_FAILURE trace event — emitted once for links that were
// already down for the whole run (PR 5) and once per scheduled mid-simulation
// failure as it fires (PR 6) — is the single source of truth for "which links
// are down as of this replay step." A link never comes back UP within one
// simulation run (no recovery event exists), so this is a simple monotonic
// accumulation: walk from the start of the trace up to (and including) the
// current step and collect every LINK_FAILURE event's `highlightedLinks`.
//
// This is deliberately NOT derived from `NetworkInput.links[].operationalStatus`
// during replay — that field reflects the FINAL/persistent state, which would
// make a link that fails mid-trace show as DOWN even while replaying steps
// before its failure. Stepping backward past a scheduled failure must show
// the link UP again; only the trace (scoped to `activeIndex`) can answer
// "what was true at this point in the story."
export function deriveDownLinkIdsAtStep(
  events: SimulationTraceEvent[],
  activeIndex: number,
): Set<string> {
  const down = new Set<string>();
  const clampedIndex = Math.min(activeIndex, events.length - 1);
  for (let i = 0; i <= clampedIndex; i++) {
    const event = events[i];
    if (event.stepType === "LINK_FAILURE") {
      for (const linkId of event.highlightedLinks) down.add(linkId);
    }
  }
  return down;
}

/** True when `events` contains at least one scheduled (PR 6, as opposed to
 * PR 5 static) mid-simulation failure — i.e. at least one LINK_FAILURE event
 * carries `metadata.scheduled === true`. Used to decide whether the compact
 * "Network event" summary should mention mid-run rerouting. */
export function hasScheduledFailures(events: SimulationTraceEvent[]): boolean {
  return events.some((e) => e.stepType === "LINK_FAILURE" && e.metadata?.scheduled === true);
}
