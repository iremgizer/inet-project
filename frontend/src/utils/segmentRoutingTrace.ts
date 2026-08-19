import { NetworkInput, SimulationTraceEvent } from "../types/network";

// ── Segment Routing replay derivation ─────────────────────────────────────────
//
// PR 1's backend emits `stepType` (machine-readable), `segmentList` (ordered
// waypoint stops + destination), and `activeSegmentIndex` on the relevant
// trace events — but only the events that carry them (LOAD_SEGMENT_LIST
// through COMPLETE_DEMAND). Everything below is a pure, frontend-only
// derivation that walks backward from the current trace step to find the
// most recent Segment-Routing-relevant event and turns it into a single
// display state the graph overlay, segment list panel, and packet token can
// all read from. No backend change, no algorithm change.

export interface SRDisplayState {
  demandId: string;
  stepType: string | null;
  /** Ordered waypoint stops for this demand, always ending with the destination. */
  segmentList: string[];
  /** Index into `segmentList` currently being routed toward; null once resolved or not yet started. */
  activeSegmentIndex: number | null;
  /** Node sequence of the in-progress leg (for token/edge highlighting); [] once resolved. */
  legPath: string[];
  /** True once the full route has been resolved for this demand. */
  isResolved: boolean;
  /** Which real node the packet token should currently sit at. */
  tokenNodeId: string | null;
}

const RESOLVED_STEP_TYPES = new Set(["FINAL_ROUTE_RESOLVED", "ADD_TRAFFIC_TO_LINK", "COMPLETE_DEMAND"]);

export function deriveSegmentRoutingDisplayState(
  events: SimulationTraceEvent[],
  activeIndex: number,
  network: NetworkInput,
): SRDisplayState | null {
  const clampedIndex = Math.min(activeIndex, events.length - 1);

  for (let i = clampedIndex; i >= 0; i--) {
    const event = events[i];
    if (!event.activeDemandId || !event.segmentList || event.segmentList.length === 0) continue;

    const demand = network.demands.find((d) => d.id === event.activeDemandId);
    if (!demand) continue;

    const stepType = event.stepType ?? null;
    const isResolved = stepType !== null && RESOLVED_STEP_TYPES.has(stepType);
    const legPath = isResolved ? [] : event.highlightedNodes ?? [];

    let tokenNodeId: string | null;
    if (isResolved) {
      tokenNodeId = demand.target;
    } else if (stepType === "SELECT_ACTIVE_SEGMENT") {
      tokenNodeId = event.activeNodeId ?? demand.source;
    } else if (
      (stepType === "COMPUTE_SEGMENT_PATH" || stepType === "ADVANCE_TO_NEXT_SEGMENT") &&
      legPath.length > 0
    ) {
      tokenNodeId = legPath[legPath.length - 1];
    } else {
      tokenNodeId = demand.source; // START_DEMAND / LOAD_SEGMENT_LIST — not moving yet
    }

    return {
      demandId: event.activeDemandId,
      stepType,
      segmentList: event.segmentList,
      activeSegmentIndex: isResolved ? null : event.activeSegmentIndex ?? null,
      legPath,
      isResolved,
      tokenNodeId,
    };
  }
  return null;
}

export type SegmentStopProgress = "completed" | "active" | "next" | "future";

/** Progress state of one stop in the segment chain — independent of whether
 * that stop is a waypoint or the final destination (the destination gets its
 * own fixed role styling layered on top by the component that renders it). */
export function classifySegmentStopProgress(
  index: number,
  activeSegmentIndex: number | null,
  isResolved: boolean,
): SegmentStopProgress {
  if (isResolved) return "completed";
  if (activeSegmentIndex === null) return "future";
  if (index < activeSegmentIndex) return "completed";
  if (index === activeSegmentIndex) return "active";
  if (index === activeSegmentIndex + 1) return "next";
  return "future";
}

/** True when `segments` contains at least one real waypoint (segmentList
 * always includes the destination as its last entry, so length > 1 means a
 * waypoint is present). Used by ResultSummaryPanel and the config editor. */
export function hasWaypoints(segments: string[]): boolean {
  return segments.length > 0;
}
