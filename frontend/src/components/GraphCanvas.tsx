import React, { useMemo, useState } from "react";
import { NodeInput, LinkInput, PathResult, LinkResult, SimulationTraceEvent } from "../types/network";
import { edgeKey, getHighlightedEdges, getLinkStyle } from "../utils/graphUtils";

interface GraphCanvasProps {
  nodes: NodeInput[];
  links: LinkInput[];
  selectedId: string | null;
  selectedType: "node" | "link" | null;
  setSelected: (type: "node" | "link" | null, id: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onCreateLink?: (source: string, target: string) => void;
  resultLinks: LinkResult[];
  pathResults: PathResult[];
  currentTraceEvent: SimulationTraceEvent | null;
  isDirected: boolean;
  isLinkCreateMode?: boolean;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  links,
  selectedId,
  selectedType,
  setSelected,
  onMoveNode,
  onCreateLink,
  resultLinks,
  pathResults,
  currentTraceEvent,
  isDirected,
  isLinkCreateMode = false,
}) => {
  const [dragging, setDragging] = useState<string | null>(null);
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<{ x: number; y: number } | null>(null);

  const linkResultMap = useMemo(() => {
    const map: Record<string, LinkResult> = {};
    for (const link of resultLinks) {
      map[link.linkId] = link;
    }
    return map;
  }, [resultLinks]);

  const highlightedEdges = useMemo(() => getHighlightedEdges(pathResults, isDirected), [pathResults, isDirected]);
  const traceLinkIds = useMemo(() => new Set(currentTraceEvent?.highlightedLinks || []), [currentTraceEvent]);
  const traceNodeIds = useMemo(() => new Set(currentTraceEvent?.highlightedNodes || []), [currentTraceEvent]);
  const traceLoads = currentTraceEvent?.currentLinkLoads || {};

  const getSvgPoint = (event: React.PointerEvent) => {
    const svg = event.currentTarget.closest("svg") as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM()?.inverse());
  };

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation();
    if (isLinkCreateMode) {
      setLinkStart(nodeId);
      setLinkPreview(getSvgPoint(event));
      setSelected("node", nodeId);
      return;
    }
    setDragging(nodeId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const transformed = getSvgPoint(event);
    if (linkStart) {
      setLinkPreview({ x: transformed.x, y: transformed.y });
      return;
    }
    if (dragging) {
      onMoveNode(dragging, transformed.x, transformed.y);
    }
  };

  const finishLinkCreation = (targetId: string) => {
    if (linkStart && linkStart !== targetId && onCreateLink) {
      onCreateLink(linkStart, targetId);
      setSelected(null, null);
    }
    setLinkStart(null);
    setLinkPreview(null);
  };

  const renderArrow = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const unitX = dx / length;
    const unitY = dy / length;
    const arrowSize = 8;
    const arrowX = x2 - unitX * 18;
    const arrowY = y2 - unitY * 18;
    return (
      <polygon
        points={`${arrowX},${arrowY} ${arrowX - unitY * arrowSize},${arrowY + unitX * arrowSize} ${arrowX + unitY * arrowSize},${arrowY - unitX * arrowSize}`}
        fill="#333"
      />
    );
  };

  return (
    <div className="graph-canvas">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 700 520"
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          setDragging(null);
          setLinkStart(null);
          setLinkPreview(null);
        }}
        onPointerLeave={() => {
          setDragging(null);
          setLinkStart(null);
          setLinkPreview(null);
        }}
        onClick={() => setSelected(null, null)}
      >
        {links.map((link) => {
          const source = nodes.find((node) => node.id === link.source);
          const target = nodes.find((node) => node.id === link.target);
          if (!source || !target) return null;
          const result = linkResultMap[link.id];
          const highlighted = traceLinkIds.has(link.id) || highlightedEdges.has(edgeKey(link.source, link.target));
          const style = getLinkStyle(link, result);
          const traceLoad = traceLoads[link.id];
          const displayLoad = typeof traceLoad === "number" ? traceLoad : result?.load;
          const displayUtilization = typeof traceLoad === "number" ? traceLoad / link.capacity : result?.utilization;
          const stroke = traceLinkIds.has(link.id) && currentTraceEvent?.pathColor ? currentTraceEvent.pathColor : style.stroke;
          return (
            <g key={link.id} onClick={() => setSelected("link", link.id)} style={{ cursor: "pointer" }}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={stroke}
                strokeWidth={highlighted ? (style.strokeWidth + 2) : style.strokeWidth}
                opacity={highlighted ? 0.95 : 0.7}
              />
              {isDirected && renderArrow(source.x, source.y, target.x, target.y)}
              <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 10} fontSize={12} fill="#222">
                w={link.weight} c={link.capacity}
              </text>
              {typeof displayLoad === "number" && typeof displayUtilization === "number" && (
                <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 + 10} fontSize={12} fill="#222">
                  l={displayLoad.toFixed(2)} u={(displayUtilization * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })}

        {linkStart && linkPreview && (
          <line
            x1={nodes.find((node) => node.id === linkStart)?.x}
            y1={nodes.find((node) => node.id === linkStart)?.y}
            x2={linkPreview.x}
            y2={linkPreview.y}
            stroke="#2563eb"
            strokeWidth={3}
            strokeDasharray="8 6"
            opacity={0.8}
          />
        )}

        {nodes.map((node) => {
          const isSelected = selectedType === "node" && selectedId === node.id;
          const isTraceHighlighted = traceNodeIds.has(node.id);
          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <circle
                r={20}
                fill={isSelected ? "#ffcc00" : isTraceHighlighted ? "#d8b4fe" : "#ffffff"}
                stroke={isTraceHighlighted ? "#7c3aed" : "#333"}
                strokeWidth={isSelected || isTraceHighlighted ? 4 : 2}
                onPointerDown={(event) => handlePointerDown(event, node.id)}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  finishLinkCreation(node.id);
                  setDragging(null);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected("node", node.id);
                }}
              />
              <text x={0} y={5} textAnchor="middle" fontSize={14} fill="#222">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default GraphCanvas;
