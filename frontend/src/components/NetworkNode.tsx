import React, { useCallback, useContext } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { SimulationOverlayContext } from "./ReactFlowCanvas";

const NetworkNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const {
    highlightedNodeIds,
    hoveredNodeId,
    setHoveredNodeId,
    connectSourceId,
    network,
    linkResults,
    isSimulated,
    gradingNodeIds,
  } = useContext(SimulationOverlayContext);

  const isHighlighted    = highlightedNodeIds.has(id);
  const isGradingNode    = gradingNodeIds.has(id);
  const isHovered        = hoveredNodeId === id;
  const isConnectSource  = connectSourceId === id;
  const label            = (data as { label: string }).label;

  // Compute tooltip info from context
  const connectedLinks = network.links.filter((l) => l.source === id || l.target === id);
  const neighborCount  = connectedLinks.length;
  const hasCongestion  = isSimulated && connectedLinks.some((l) => linkResults.get(l.id)?.isCongested);

  const handleMouseEnter = useCallback(() => setHoveredNodeId(id), [id, setHoveredNodeId]);
  const handleMouseLeave = useCallback(() => setHoveredNodeId(null), [setHoveredNodeId]);

  return (
    <div
      className={[
        "rf-node",
        selected          ? "rf-node--selected"       : "",
        isHighlighted     ? "rf-node--highlighted"    : "",
        isHovered         ? "rf-node--hovered"        : "",
        isConnectSource   ? "rf-node--connect-source" : "",
        hasCongestion     ? "rf-node--congested"      : "",
        isGradingNode     ? "rf-node--grading"        : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Handle type="source" position={Position.Top}    id="top"    className="rf-handle" />
      <Handle type="source" position={Position.Right}  id="right"  className="rf-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="rf-handle" />
      <Handle type="source" position={Position.Left}   id="left"   className="rf-handle" />

      <span className="rf-node-label">{label}</span>

      {/* Hover tooltip */}
      {isHovered && (
        <div className="node-tooltip">
          <div className="node-tooltip-row">
            {neighborCount} neighbor{neighborCount !== 1 ? "s" : ""}
          </div>
          {hasCongestion && (
            <div className="node-tooltip-warn">⚠ congested link</div>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworkNode;
