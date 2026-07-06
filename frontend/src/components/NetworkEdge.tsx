import React, { useContext } from "react";
import {
  EdgeProps,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
} from "@xyflow/react";
import { SimulationOverlayContext } from "./ReactFlowCanvas";
import { LinkResult } from "../types/network";
import {
  getUtilSeverity,
  getLinkDemandColor,
  severityStrokeWidth,
  severityGlowColor,
} from "../utils/graphVisuals";

export interface NetworkEdgeData extends Record<string, unknown> {
  weight: number;
  capacity: number;
}

// Large topologies suppress inline labels to reduce noise.
const LABEL_SUPPRESS_THRESHOLD = 15;

const NetworkEdge: React.FC<EdgeProps & { source: string; target: string }> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
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
  } = useContext(SimulationOverlayContext);

  const d = data as NetworkEdgeData;
  const result: LinkResult | undefined = linkResults.get(id);
  const isHighlighted = highlightedLinkIds.has(id);
  const gradingStatus = gradingLinkStatus.get(id);
  const nodeCount = network.nodes.length;
  const isLargeTopology = nodeCount > LABEL_SUPPRESS_THRESHOLD;

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
  // Priority: grading > trace-highlighted > demand color (path identity) > base
  let stroke = "#94a3b8";

  if (gradingStatus === "correct") {
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
  const strokeWidth = gradingStatus
    ? 4
    : selected
    ? Math.max(severityStrokeWidth(severity), 2.5)
    : isSimulated
    ? severityStrokeWidth(severity)
    : isConnectedToHovered ? 2.5 : 1.8;

  // ── Congestion glow (separate visual channel from path color) ───────────────
  // A wide semi-transparent halo behind the path communicates congestion severity
  // without overriding the demand identity color.
  const glowColor = isSimulated && !gradingStatus ? severityGlowColor(severity) : null;
  const showGlow = glowColor !== null;

  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // Perpendicular offset so the label doesn't sit on the edge line itself.
  // Shift label to the "left" of the edge direction vector.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const edgeLen = Math.sqrt(dx * dx + dy * dy) || 1;
  const PERP = 11;
  const perpX = (-dy / edgeLen) * PERP;
  const perpY = (dx / edgeLen) * PERP;

  // ── Label content ────────────────────────────────────────────────────────────
  // Before sim: "w=1" (small, gray)
  // After sim:  "w=1 · 28%" — util text colored by severity
  // Large topology: only show label when selected or hovered, to reduce noise
  const suppressLabel = isDimmed || (isLargeTopology && !selected && !isConnectedToHovered);

  let labelContent: React.ReactNode = null;

  if (!suppressLabel) {
    if (isSimulated && displayUtil !== undefined) {
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

  const baseOpacity = isDimmed ? 0.12 : isSimulated && !demandColor && !isTraceMode ? 0.45 : selected ? 1 : 0.85;

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
    </>
  );
};

export default NetworkEdge;
