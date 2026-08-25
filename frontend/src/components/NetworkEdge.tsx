import React, { useContext } from "react";
import {
  EdgeProps,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
  useInternalNode,
} from "@xyflow/react";
import { Ban, ShieldAlert, Star, XCircle } from "lucide-react";
import { SimulationOverlayContext } from "./ReactFlowCanvas";
import { LinkResult, LinkOperationalStatus } from "../types/network";
import {
  getUtilSeverity,
  getLinkDemandColor,
  severityStrokeWidth,
  severityGlowColor,
} from "../utils/graphVisuals";
import { COMPARISON_STATUS_COLOR } from "../utils/comparison";
import { computeCircleEdgeAnchors, computeLabelPerpendicularOffset, NODE_RADIUS } from "../utils/edgeGeometry";

export interface NetworkEdgeData extends Record<string, unknown> {
  weight: number;
  capacity: number;
  operationalStatus?: LinkOperationalStatus;
}

// Large topologies suppress inline labels to reduce noise.
const LABEL_SUPPRESS_THRESHOLD = 15;

const NetworkEdge: React.FC<EdgeProps & { source: string; target: string }> = ({
  id,
  source,
  target,
  // Handle-resolved fallback only (see below) — NOT used directly for the
  // rendered path anymore. With 4 fixed same-type handles and no
  // sourceHandle/targetHandle set per edge (ReactFlowCanvas's toRFEdge),
  // these don't reliably represent "the point on this node's own circle
  // facing its neighbor" — they're whichever handle React Flow happened to
  // resolve, independent of the neighbor's real direction. Kept only as a
  // fallback for the one render tick before useInternalNode below has
  // measured both nodes.
  sourceX: handleSourceX,
  sourceY: handleSourceY,
  targetX: handleTargetX,
  targetY: handleTargetY,
  data,
  selected,
  markerEnd,
}) => {
  const {
    highlightedLinkIds,
    linkResults,
    currentLinkLoads,
    pathColor,
    pathResults,
    demandColorMap,
    isTraceMode,
    isSimulated,
    hoveredNodeId,
    gradingLinkStatus,
    network,
    tePolicies,
    replayDownLinkIds,
    comparisonMode,
    comparisonByLink,
  } = useContext(SimulationOverlayContext);

  // ── Circle-boundary edge anchoring ──────────────────────────────────────
  // React Flow's own documented "floating edge" pattern: compute each
  // node's actual current center from its internal (measured) position
  // rather than trusting a resolved handle, then find where the straight
  // line between the two centers crosses each node's own circular boundary
  // (utils/edgeGeometry.ts). Works for any direction — horizontal,
  // vertical, diagonal, arbitrary angle — with one formula, no per-
  // topology special-casing. Falls back to the handle-resolved coordinates
  // above only if a node hasn't been measured yet (first paint).
  const sourceInternalNode = useInternalNode(source);
  const targetInternalNode = useInternalNode(target);
  let sourceX = handleSourceX, sourceY = handleSourceY, targetX = handleTargetX, targetY = handleTargetY;
  if (sourceInternalNode && targetInternalNode) {
    const sourceWidth = sourceInternalNode.measured.width ?? NODE_RADIUS * 2;
    const sourceHeight = sourceInternalNode.measured.height ?? NODE_RADIUS * 2;
    const targetWidth = targetInternalNode.measured.width ?? NODE_RADIUS * 2;
    const targetHeight = targetInternalNode.measured.height ?? NODE_RADIUS * 2;
    const sourceCenter = {
      x: sourceInternalNode.internals.positionAbsolute.x + sourceWidth / 2,
      y: sourceInternalNode.internals.positionAbsolute.y + sourceHeight / 2,
    };
    const targetCenter = {
      x: targetInternalNode.internals.positionAbsolute.x + targetWidth / 2,
      y: targetInternalNode.internals.positionAbsolute.y + targetHeight / 2,
    };
    const anchors = computeCircleEdgeAnchors(sourceCenter, sourceWidth / 2, targetCenter, targetWidth / 2);
    sourceX = anchors.source.x;
    sourceY = anchors.source.y;
    targetX = anchors.target.x;
    targetY = anchors.target.y;
  }

  const d = data as NetworkEdgeData;
  const result: LinkResult | undefined = linkResults.get(id);
  const isHighlighted = highlightedLinkIds.has(id);
  const gradingStatus = gradingLinkStatus.get(id);
  const nodeCount = network.nodes.length;
  const isLargeTopology = nodeCount > LABEL_SUPPRESS_THRESHOLD;

  // ── Link failure (PR 5) — a structural state, not a traffic outcome. A
  //    DOWN link cannot appear in any resolved path, so it must read as
  //    "out of service" regardless of grading/congestion/policy/path-color,
  //    all of which are about traffic that could never have crossed it.
  //    Deliberately NOT reusing the red congestion glow or FORBID_LINK's
  //    dash pattern — those mean "traffic avoided this" while DOWN means
  //    "traffic physically cannot use this."
  //
  //    Mid-simulation failure replay (PR 6) — while a trace is being
  //    replayed, `replayDownLinkIds` (derived from the trace itself, see
  //    utils/failureReplay.ts) is authoritative instead of the persistent
  //    field: a link scheduled to fail partway through the run must show
  //    UP for every step before that point, even though the network's
  //    final/persistent state has it DOWN. Outside trace mode
  //    (replayDownLinkIds === null), the persistent field is unchanged
  //    PR 5 behavior.
  // ── Before/After/Difference comparison (PR 6, Part 2) — a dedicated
  //    encoding, only active in "difference" mode, deliberately distinct
  //    from congestion severity/TE policy/path-identity colors (spec: "do
  //    not confuse this with normal path colors"). A DOWN entry folds into
  //    `isDown` below so "down" reuses the exact same stone/neutral
  //    treatment and reads the same way everywhere, trace replay included.
  const comparisonEntry = comparisonMode === "difference" ? comparisonByLink?.get(id) ?? null : null;

  const isDown =
    (replayDownLinkIds ? replayDownLinkIds.has(id) : d.operationalStatus === "DOWN") ||
    comparisonEntry?.status === "DOWN";

  // ── Traffic Engineering policy markers — a visual channel of their own,
  //    kept separate from path identity (stroke color) and congestion
  //    severity (stroke width/glow) per the app's established hierarchy. ────
  const linkPolicies = tePolicies.filter((p) => p.linkId === id);
  const isForbidden = linkPolicies.some((p) => p.type === "FORBID_LINK");
  const isAvoided = linkPolicies.some((p) => p.type === "AVOID_LINK");
  const isPreferred = linkPolicies.some((p) => p.type === "PREFER_LINK");

  const isConnectedToHovered =
    hoveredNodeId !== null && (source === hoveredNodeId || target === hoveredNodeId);
  const isDimmed = hoveredNodeId !== null && !isConnectedToHovered;

  // Effective load/util for this step
  const traceLoad   = currentLinkLoads[id];
  const displayLoad = typeof traceLoad === "number" ? traceLoad : result?.load;
  const displayUtil =
    typeof traceLoad === "number"
      ? traceLoad / (d.capacity || 1)
      : result?.utilization;

  // ── Path identity color (post-sim, non-trace) ──────────────────────────────
  // Which demand's color should this link show? First demand that routes through it.
  const demandColor = isSimulated && !isTraceMode
    ? getLinkDemandColor(source, target, pathResults, demandColorMap, network.isDirected)
    : null;

  // ── Utilization severity (for thickness and glow) ─────────────────────────
  const severity = isSimulated && displayUtil !== undefined
    ? getUtilSeverity(displayUtil)
    : "low";

  // ── Stroke color ────────────────────────────────────────────────────────────
  // Priority: DOWN (structural, out of service) > difference-mode comparison
  // > grading > trace-highlighted > demand color (path identity) > base
  let stroke = "#94a3b8";

  if (isDown) {
    stroke = "#a8a29e";
  } else if (comparisonEntry) {
    stroke = COMPARISON_STATUS_COLOR[comparisonEntry.status];
  } else if (gradingStatus === "correct") {
    stroke = "#22c55e";
  } else if (gradingStatus === "wrong") {
    stroke = "#ef4444";
  } else if (gradingStatus === "missed") {
    stroke = "#f97316";
  } else if (isTraceMode && isHighlighted && pathColor) {
    stroke = pathColor;
  } else if (isTraceMode && isHighlighted) {
    stroke = "#7c3aed";
  } else if (demandColor) {
    stroke = demandColor;
  } else if (isSimulated) {
    // Link not used by any routing path — render as muted gray
    stroke = "#cbd5e1";
  } else if (selected) {
    stroke = "#0071e3";
  } else if (isConnectedToHovered) {
    stroke = "#475569";
  }

  // ── Stroke width ────────────────────────────────────────────────────────────
  const strokeWidth = isDown
    ? 1.8
    : gradingStatus
    ? 4
    : selected
    ? Math.max(severityStrokeWidth(severity), 2.5)
    : isSimulated
    ? severityStrokeWidth(severity)
    : isConnectedToHovered ? 2.5 : 1.8;

  // ── Congestion glow (separate visual channel from path color) ───────────────
  // A wide semi-transparent halo behind the path communicates congestion severity
  // without overriding the demand identity color. Never shown for a DOWN link —
  // it carries no traffic, so there is no severity to glow about.
  const glowColor = !isDown && !comparisonEntry && isSimulated && !gradingStatus ? severityGlowColor(severity) : null;
  const showGlow = glowColor !== null;

  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // Perpendicular offset so the label doesn't sit on the edge line itself —
  // shifted to the "left" of the edge direction vector, scaled down for
  // short edges (Part 4: a short edge's label shouldn't sit disproportion-
  // ately far from its own line, which is what pushes it toward a
  // neighboring edge/node's label in a compact/dense layout). Deterministic
  // and derived only from this edge's own two endpoints — not a collision
  // detector against other edges.
  const { perpX, perpY } = computeLabelPerpendicularOffset(sourceX, sourceY, targetX, targetY);

  // ── Label content ────────────────────────────────────────────────────────────
  // Before sim: "w=1" (small, gray)
  // After sim:  "w=1 · 28%" — util text colored by severity
  // Large topology: only show label when selected or hovered, to reduce noise
  const suppressLabel = isDimmed || (isLargeTopology && !selected && !isConnectedToHovered);

  let labelContent: React.ReactNode = null;

  if (!suppressLabel) {
    if (isDown) {
      labelContent = (
        <div className="rf-edge-weight-label rf-edge-weight-label--down">
          DOWN
        </div>
      );
    } else if (isSimulated && displayUtil !== undefined) {
      const utilPct = (displayUtil * 100).toFixed(0);
      const utilColorClass =
        severity === "congested" || severity === "veryhigh"
          ? "rf-edge-util-pct--congested"
          : severity === "high"
          ? "rf-edge-util-pct--high"
          : "rf-edge-util-pct--normal";

      labelContent = (
        <div className="rf-edge-compact-label">
          <span className="rf-edge-compact-weight">w={d.weight}</span>
          <span className="rf-edge-compact-sep"> · </span>
          <span className={`rf-edge-compact-util ${utilColorClass}`}>{utilPct}%</span>
          {selected && displayLoad !== undefined && (
            <span className="rf-edge-compact-load"> ({displayLoad.toFixed(1)}/{d.capacity})</span>
          )}
        </div>
      );
    } else {
      labelContent = (
        <div className="rf-edge-weight-label rf-edge-weight-label--pill">
          w={d.weight}{selected ? <span className="rf-edge-cap"> · c={d.capacity}</span> : null}
        </div>
      );
    }
  }

  const baseOpacity = isDimmed
    ? 0.12
    : isDown
    ? 0.55
    : isSimulated && !demandColor && !isTraceMode
    ? 0.45
    : selected
    ? 1
    : 0.85;

  return (
    <>
      {showGlow && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: glowColor!,
            strokeWidth: strokeWidth * 3,
            opacity: 0.18,
            pointerEvents: "none",
          }}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          opacity: baseOpacity,
          strokeDasharray: isDown ? "2 6" : isForbidden ? "6 4" : undefined,
          transition: "stroke 0.18s, stroke-width 0.18s, opacity 0.18s",
        }}
      />
      {labelContent && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX + perpX}px,${labelY + perpY}px)`,
              pointerEvents: "none",
            }}
          >
            {labelContent}
          </div>
        </EdgeLabelRenderer>
      )}
      {isDown ? (
        <EdgeLabelRenderer>
          <div
            className="rf-edge-policy-badge rf-edge-policy-badge--down"
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX - perpX}px,${labelY - perpY}px)`,
              pointerEvents: "none",
            }}
            title="Link down — excluded from routing. Any TE policy on this link is stored but has no effect while down."
          >
            <XCircle size={11} />
          </div>
        </EdgeLabelRenderer>
      ) : (
        (isForbidden || isAvoided || isPreferred) && (
          <EdgeLabelRenderer>
            <div
              className={`rf-edge-policy-badge ${
                isForbidden ? "rf-edge-policy-badge--forbid" : isAvoided ? "rf-edge-policy-badge--avoid" : "rf-edge-policy-badge--prefer"
              }`}
              style={{
                position: "absolute",
                transform: `translate(-50%,-50%) translate(${labelX - perpX}px,${labelY - perpY}px)`,
                pointerEvents: "none",
              }}
              title={isForbidden ? "Forbidden link" : isAvoided ? "Avoided link" : "Preferred link"}
            >
              {isForbidden ? <Ban size={11} /> : isAvoided ? <ShieldAlert size={11} /> : <Star size={11} />}
            </div>
          </EdgeLabelRenderer>
        )
      )}
    </>
  );
};

export default NetworkEdge;
