import React, { useCallback, useContext } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { MapPin, LogIn, LogOut, CheckCircle2 } from "lucide-react";
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
    srActiveWaypointId,
    srSelectSourceId,
    srSelectDestinationId,
    srSelectChosenIds,
    tePolicies,
  } = useContext(SimulationOverlayContext);

  const isHighlighted     = highlightedNodeIds.has(id);
  const isGradingNode     = gradingNodeIds.has(id);
  const isHovered         = hoveredNodeId === id;
  const isConnectSource   = connectSourceId === id;
  const isActiveWaypoint  = srActiveWaypointId === id;
  // Segment Routing waypoint-selection mode (editing) — deliberately
  // distinct states/classes from isActiveWaypoint above (trace playback):
  // source/destination use their own icon+color, never the waypoint ring,
  // so "which node is the demand's source" is never confused with "this
  // waypoint is currently being replayed".
  const isSrSelectSource      = srSelectSourceId === id;
  const isSrSelectDestination = srSelectDestinationId === id;
  const isSrSelectChosen      = srSelectChosenIds.has(id) && !isSrSelectSource && !isSrSelectDestination;
  // A REQUIRE_WAYPOINT policy marker — visually distinct (amber pin, dashed
  // ring) from SR's own solid teal "active SID" ring above.
  const isRequiredWaypoint = tePolicies.some((p) => p.type === "REQUIRE_WAYPOINT" && p.nodeId === id);
  const label             = (data as { label: string }).label;

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
        isActiveWaypoint  ? "rf-node--waypoint-active" : "",
        isRequiredWaypoint ? "rf-node--te-required"    : "",
        isSrSelectSource      ? "rf-node--sr-select-source"      : "",
        isSrSelectDestination ? "rf-node--sr-select-destination" : "",
        isSrSelectChosen      ? "rf-node--sr-select-chosen"      : "",
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
      {isRequiredWaypoint && (
        <span className="rf-node-te-badge" title="Required waypoint">
          <MapPin size={9} />
        </span>
      )}
      {/* Waypoint-selection mode badges — text + icon, not color alone, so
          source/destination/already-chosen are distinguishable even without
          relying on the ring color. */}
      {isSrSelectSource && (
        <span className="rf-node-sr-badge rf-node-sr-badge--source" title="Demand source">
          <LogOut size={9} /> SRC
        </span>
      )}
      {isSrSelectDestination && (
        <span className="rf-node-sr-badge rf-node-sr-badge--destination" title="Demand destination">
          <LogIn size={9} /> DST
        </span>
      )}
      {isSrSelectChosen && (
        <span className="rf-node-sr-badge rf-node-sr-badge--chosen" title="Already-selected waypoint">
          <CheckCircle2 size={9} /> WP
        </span>
      )}

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
