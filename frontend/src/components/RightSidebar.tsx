import React from "react";
import { NodeInput, LinkInput, LinkResult, NodeRoleResult } from "../types/network";

interface RightSidebarProps {
  selectedType: "node" | "link" | null;
  selectedId: string | null;
  nodes: NodeInput[];
  links: LinkInput[];
  results: { linkResults: LinkResult[] };
  nodeRoles: NodeRoleResult[];
  onUpdateNode: (id: string, update: Partial<NodeInput>) => void;
  onUpdateLink: (id: string, update: Partial<LinkInput>) => void;
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  selectedType,
  selectedId,
  nodes,
  links,
  results,
  nodeRoles,
  onUpdateNode,
  onUpdateLink,
}) => {
  if (!selectedType || !selectedId) {
    return (
      <div className="panel right-sidebar">
        <h2>Network Inspector</h2>
        <p>Select a node or link to edit parameters and inspect results.</p>
        <div className="legend">
          <h3>Legend</h3>
          <ul>
            <li><strong>w</strong>: weight for shortest paths</li>
            <li><strong>c</strong>: capacity limit</li>
            <li><strong>l</strong>: load after simulation</li>
            <li><strong>u</strong>: utilization percentage</li>
          </ul>
        </div>
      </div>
    );
  }

  if (selectedType === "node") {
    const node = nodes.find((item) => item.id === selectedId);
    const role = nodeRoles.find((entry) => entry.nodeId === selectedId);
    if (!node) return null;
    return (
      <div className="panel right-sidebar">
        <h2>Node Properties</h2>
        <label>
          Label
          <input value={node.label} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })} />
        </label>
        <label>
          X
          <input type="number" value={node.x} onChange={(e) => onUpdateNode(node.id, { x: Number(e.target.value) })} />
        </label>
        <label>
          Y
          <input type="number" value={node.y} onChange={(e) => onUpdateNode(node.id, { y: Number(e.target.value) })} />
        </label>
        <label>
          Visual Type
          <input value={node.visualType || "node"} onChange={(e) => onUpdateNode(node.id, { visualType: e.target.value })} />
        </label>
        <div className="result-block">
          <h3>Role</h3>
          <p>Source for: {role?.asSourceFor.join(", ") || "none"}</p>
          <p>Destination for: {role?.asDestinationFor.join(", ") || "none"}</p>
          <p>Intermediate for: {role?.asIntermediateFor.join(", ") || "none"}</p>
        </div>
      </div>
    );
  }

  const link = links.find((item) => item.id === selectedId);
  const result = results.linkResults.find((item) => item.linkId === selectedId);
  if (!link) return null;

  return (
    <div className="panel right-sidebar">
      <h2>Link Properties</h2>
      <p>{link.source} → {link.target}</p>
      <label>
        Weight
        <input type="number" min="0" step="0.1" value={link.weight} onChange={(e) => onUpdateLink(link.id, { weight: Number(e.target.value) })} />
      </label>
      <label>
        Capacity
        <input type="number" min="0.1" step="0.1" value={link.capacity} onChange={(e) => onUpdateLink(link.id, { capacity: Number(e.target.value) })} />
      </label>
      <div className="result-block">
        <h3>Simulation Results</h3>
        <p>Load: {result ? result.load.toFixed(2) : "0.00"}</p>
        <p>Utilization: {result ? (result.utilization * 100).toFixed(0) : "0"}%</p>
        <p>Status: {result ? (result.isCongested ? "Congested" : "Safe") : "Unknown"}</p>
      </div>
    </div>
  );
};

export default RightSidebar;
