import React, { useState } from "react";
import { NodeInput, LinkInput, TopologyType } from "../types/network";
import { topologyOptions } from "../utils/topologyTemplates";

interface LeftSidebarProps {
  nodes: NodeInput[];
  links: LinkInput[];
  topologyType: TopologyType;
  isDirected: boolean;
  onAddNode: () => void;
  onAddLink: (link: Omit<LinkInput, "id">) => void;
  onTopologyChange: (type: TopologyType) => void;
  onLoadTopology: () => void;
  onToggleDirected: () => void;
  onResetNetwork: () => void;
  onExport: () => void;
  onImport: (json: string) => void;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  nodes,
  links,
  topologyType,
  isDirected,
  onAddNode,
  onAddLink,
  onTopologyChange,
  onLoadTopology,
  onToggleDirected,
  onResetNetwork,
  onExport,
  onImport,
}) => {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [weight, setWeight] = useState(1);
  const [capacity, setCapacity] = useState(1);

  const handleAddLink = () => {
    if (!source || !target || source === target) return;
    onAddLink({ source, target, weight, capacity });
    setSource("");
    setTarget("");
    setWeight(1);
    setCapacity(1);
  };

  return (
    <div className="panel left-sidebar">
      <h2>Network Builder</h2>
      <button onClick={onAddNode}>Add Node</button>
      <div className="section">
        <h3>Create Link</h3>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Select</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        <label>
          Target
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        <label>
          Weight
          <input type="number" min="0" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        </label>
        <label>
          Capacity
          <input type="number" min="0.1" step="0.1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </label>
        <button onClick={handleAddLink}>Add Link</button>
      </div>
      <div className="section">
        <h3>Topology</h3>
        <select value={topologyType} onChange={(e) => onTopologyChange(e.target.value as TopologyType)}>
          {topologyOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button onClick={onLoadTopology}>Load Topology</button>
      </div>
      <div className="section">
        <label>
          <input type="checkbox" checked={isDirected} onChange={onToggleDirected} /> Directed
        </label>
      </div>
      <div className="section">
        <button onClick={onResetNetwork}>Reset Network</button>
        <button onClick={onExport}>Export JSON</button>
        <button onClick={() => {
          const json = prompt("Paste network JSON here:");
          if (json) onImport(json);
        }}>Import JSON</button>
      </div>
    </div>
  );
};

export default LeftSidebar;
