import React, { useMemo, useState } from "react";
import { NodeInput, LinkInput, PathResult, LinkResult } from "../types/network";
import { edgeKey, getHighlightedEdges, getLinkStyle } from "../utils/graphUtils";

interface GraphCanvasProps {
  nodes: NodeInput[];
  links: LinkInput[];
  selectedId: string | null;
  selectedType: "node" | "link" | null;
  setSelected: (type: "node" | "link" | null, id: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  resultLinks: LinkResult[];
  pathResults: PathResult[];
  isDirected: boolean;
}

const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  links,
  selectedId,
  selectedType,
  setSelected,
  onMoveNode,
  resultLinks,
  pathResults,
  isDirected,
}) => {
  const [dragging, setDragging] = useState<string | null>(null);

  const linkResultMap = useMemo(() => {
    const map: Record<string, LinkResult> = {};
    for (const link of resultLinks) {
      map[link.linkId] = link;
    }
    return map;
  }, [resultLinks]);

  const highlightedEdges = useMemo(() => getHighlightedEdges(pathResults, isDirected), [pathResults, isDirected]);

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation();
    setDragging(nodeId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging) return;
    const svg = event.currentTarget as SVGSVGElement;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    onMoveNode(dragging, transformed.x, transformed.y);
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
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        {links.map((link) => {
          const source = nodes.find((node) => node.id === link.source);
          const target = nodes.find((node) => node.id === link.target);
          if (!source || !target) return null;
          const result = linkResultMap[link.id];
          const highlighted = highlightedEdges.has(edgeKey(link.source, link.target));
          const style = getLinkStyle(link, result);
          return (
            <g key={link.id} onClick={() => setSelected("link", link.id)} style={{ cursor: "pointer" }}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={style.stroke}
                strokeWidth={highlighted ? (style.strokeWidth + 2) : style.strokeWidth}
                opacity={highlighted ? 0.95 : 0.7}
              />
              {isDirected && renderArrow(source.x, source.y, target.x, target.y)}
              <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 10} fontSize={12} fill="#222">
                w={link.weight} c={link.capacity}
              </text>
              {result && (
                <text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 + 10} fontSize={12} fill="#222">
                  l={result.load} u={(result.utilization * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const isSelected = selectedType === "node" && selectedId === node.id;
          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <circle
                r={20}
                fill={isSelected ? "#ffcc00" : "#ffffff"}
                stroke="#333"
                strokeWidth={isSelected ? 4 : 2}
                onPointerDown={(event) => handlePointerDown(event, node.id)}
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
