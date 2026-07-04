import React, { useContext } from "react";
import {
  EdgeProps,
  getStraightPath,
  EdgeLabelRenderer,
  BaseEdge,
} from "@xyflow/react";
import { SimulationOverlayContext } from "./ReactFlowCanvas";
import { LinkResult } from "../types/network";

export interface NetworkEdgeData extends Record<string, unknown> {
  weight: number;
  capacity: number;
}

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
  const { highlightedLinkIds, linkResults, currentLinkLoads, pathColor, isSimulated, hoveredNodeId, gradingLinkStatus } =
    useContext(SimulationOverlayContext);

  const d = data as NetworkEdgeData;
  const result: LinkResult | undefined = linkResults.get(id);
  const isHighlighted = highlightedLinkIds.has(id);
  const gradingStatus = gradingLinkStatus.get(id);

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

  // ── Stroke color ────────────────────────────────────────────────────────
  // Grading highlight takes priority over simulation coloring
  let stroke = "#94a3b8";
  if (gradingStatus === "correct") {
    stroke = "#22c55e";
  } else if (gradingStatus === "wrong") {
    stroke = "#ef4444";
  } else if (gradingStatus === "missed") {
    stroke = "#f97316";
  } else if (isHighlighted && pathColor) {
    stroke = pathColor;
  } else if (isHighlighted) {
    stroke = "#7c3aed";
  } else if (result) {
    if (result.isCongested || (result.utilization ?? 0) > 1) stroke = "#ef4444";
    else if ((result.utilization ?? 0) > 0.7)               stroke = "#f97316";
    else                                                      stroke = "#3b82f6";
  } else if (selected) {
    stroke = "#0071e3";
  } else if (isConnectedToHovered) {
    stroke = "#0071e3";
  }

  const strokeWidth = gradingStatus
    ? 4
    : isSimulated && displayUtil !== undefined
      ? Math.min(9, 2 + displayUtil * 7)
      : selected ? 3 : isConnectedToHovered ? 2.5 : 1.8;

  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // ── What to show in the label ────────────────────────────────────────────
  // Simulated: show utilization % as primary label
  // Selected (not simulated): show weight + capacity
  // Default: show just weight — small and unobtrusive
  // Dimmed: no label

  let labelContent: React.ReactNode = null;

  if (!isDimmed) {
    if (isSimulated && displayUtil !== undefined) {
      const utilClass =
        result?.isCongested || displayUtil > 1
          ? "rf-edge-util--congested"
          : displayUtil > 0.7
          ? "rf-edge-util--warning"
          : "rf-edge-util--safe";
      labelContent = (
        <>
          <div className={`rf-edge-util-badge ${utilClass}`}>
            {(displayUtil * 100).toFixed(0)}%
          </div>
          {selected && (
            <div className="rf-edge-detail">
              {displayLoad !== undefined && (
                <span>{displayLoad.toFixed(1)} / {d.capacity}</span>
              )}
            </div>
          )}
        </>
      );
    } else {
      // Not simulated — show weight. Only show capacity when selected.
      labelContent = (
        <div className="rf-edge-weight-label">
          w={d.weight}{selected ? <span className="rf-edge-cap"> · c={d.capacity}</span> : null}
        </div>
      );
    }
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth,
          opacity: isDimmed ? 0.15 : selected ? 1 : 0.82,
          transition: "stroke 0.18s, stroke-width 0.18s, opacity 0.18s",
        }}
      />
      {labelContent && (
        <EdgeLabelRenderer>
          <div
            className={[
              "rf-edge-label",
              isHighlighted ? "rf-edge-label--highlighted" : "",
              result?.isCongested ? "rf-edge-label--congested" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              position: "absolute",
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
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
