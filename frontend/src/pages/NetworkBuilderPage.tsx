import React from "react";
import { LinkInput, NetworkInput, TopologyType } from "../types/network";
import { topologyOptions } from "../utils/topologyTemplates";
import { getTopologyPreview, TopologySize } from "../utils/generatedTopologies";

interface NetworkBuilderPageProps {
  network: NetworkInput;
  selectedType: "node" | "link" | null;
  selectedId: string | null;
  topologyStats: { nodeCount: number; linkCount: number; averageDegree: number; components: number; density: number };
  topologySize: TopologySize;
  isLinkCreateMode: boolean;
  onTopologyChange: (type: TopologyType) => void;
  onTopologySizeChange: (size: TopologySize) => void;
  onLoadTopology: () => void;
  onAddNode: () => void;
  onToggleCreateLink: () => void;
  onDeleteSelected: () => void;
  onAutoLayout: () => void;
  onCenterView: () => void;
  onZoomToFit: () => void;
  onReset: () => void;
  onUpdateNode: (id: string, update: Partial<NetworkInput["nodes"][number]>) => void;
  onUpdateLink: (id: string, update: Partial<LinkInput>) => void;
  onBack: () => void;
  onNext: () => void;
}

const NetworkBuilderPage: React.FC<NetworkBuilderPageProps> = ({
  network,
  selectedType,
  selectedId,
  topologyStats,
  topologySize,
  isLinkCreateMode,
  onTopologyChange,
  onTopologySizeChange,
  onLoadTopology,
  onAddNode,
  onToggleCreateLink,
  onDeleteSelected,
  onAutoLayout,
  onCenterView,
  onZoomToFit,
  onReset,
  onUpdateNode,
  onUpdateLink,
  onBack,
  onNext,
}) => {
  const selectedNode = selectedType === "node" ? network.nodes.find((node) => node.id === selectedId) : null;
  const selectedLink = selectedType === "link" ? network.links.find((link) => link.id === selectedId) : null;
  const preview = getTopologyPreview(network.topologyType, topologySize);

  return (
    <div className="workflow-page graph-builder-page">
      <div className="page-kicker">Step 1 · Visual Network Builder</div>
      <h2>Draw your network on the canvas</h2>
      <p className="page-subtitle">Use the graph toolbar, then edit properties after selecting a node or link.</p>

      <div className="graph-toolbar">
        <button onClick={onAddNode}>Add Node</button>
        <button className={isLinkCreateMode ? "selected-tool" : ""} onClick={onToggleCreateLink}>
          {isLinkCreateMode ? "Creating Link..." : "Create Link"}
        </button>
        <button onClick={onDeleteSelected} disabled={!selectedType}>Delete Selected</button>
        <button className="secondary" onClick={onAutoLayout}>Auto Layout</button>
        <button className="secondary" onClick={onCenterView}>Center View</button>
        <button className="secondary" onClick={onZoomToFit}>Zoom To Fit</button>
      </div>

      {isLinkCreateMode && (
        <div className="builder-hint">
          Click and drag from one node to another node to create a link. New links start with weight 1 and capacity 10.
        </div>
      )}

      <div className="preset-row">
        <label>
          Topology Type
          <select value={network.topologyType} onChange={(event) => onTopologyChange(event.target.value as TopologyType)}>
            {topologyOptions.filter((option) => option.value !== "line").map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Topology Size
          <select value={topologySize} onChange={(event) => onTopologySizeChange(event.target.value as TopologySize)}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <button onClick={onLoadTopology}>Load Topology</button>
        <button className="secondary" onClick={onReset}>Reset</button>
      </div>

      <div className="topology-preview-card">
        <strong>{network.topologyType} ({topologySize})</strong>
        <span>Nodes: {preview.nodes}</span>
        <span>Links: {preview.links}</span>
        <p>This preview shows the scale before generation, so students know what they are about to place on the canvas.</p>
      </div>

      <div className="builder-inspector">
        {selectedNode ? (
          <div className="form-section">
            <h3>Node Inspector</h3>
            <label>Label<input value={selectedNode.label} onChange={(event) => onUpdateNode(selectedNode.id, { label: event.target.value })} /></label>
            <label>X<input type="number" value={selectedNode.x.toFixed(0)} onChange={(event) => onUpdateNode(selectedNode.id, { x: Number(event.target.value) })} /></label>
            <label>Y<input type="number" value={selectedNode.y.toFixed(0)} onChange={(event) => onUpdateNode(selectedNode.id, { y: Number(event.target.value) })} /></label>
            <button onClick={onDeleteSelected}>Delete Node</button>
          </div>
        ) : selectedLink ? (
          <div className="form-section">
            <h3>Link Inspector</h3>
            <p>{selectedLink.source} to {selectedLink.target}</p>
            <label>Weight<input type="number" min="0" step="0.1" value={selectedLink.weight} onChange={(event) => onUpdateLink(selectedLink.id, { weight: Number(event.target.value) })} /></label>
            <label>Capacity<input type="number" min="0.1" step="0.1" value={selectedLink.capacity} onChange={(event) => onUpdateLink(selectedLink.id, { capacity: Number(event.target.value) })} /></label>
            <button onClick={onDeleteSelected}>Delete Link</button>
          </div>
        ) : (
          <div className="form-section">
            <h3>Inspector</h3>
            <p>Select a node or link on the canvas to edit it here.</p>
          </div>
        )}
      </div>

      <div className="education-note visual-example-note">
        <h3>Graph vocabulary</h3>
        <p><strong>Node:</strong> a router or network point. <strong>Link:</strong> a connection between nodes.</p>
        <p><strong>Weight:</strong> routing cost used by shortest-path algorithms. <strong>Capacity:</strong> maximum traffic before congestion.</p>
        <div className="mini-visual-example">
          <span className="mini-node">A</span>
          <span className="mini-link">w=2 c=10</span>
          <span className="mini-node">B</span>
        </div>
      </div>

      <div className="education-note">
        <h3>Current topology</h3>
        <p>{topologyStats.nodeCount} nodes, {topologyStats.linkCount} links, average degree {topologyStats.averageDegree.toFixed(2)}, density {topologyStats.density.toFixed(2)}.</p>
        <p>{network.nodes.length > 50 || network.links.length > 100 ? "Large topology detected. Future versions should add virtualization, clustering, and simplified rendering." : "This size is comfortable for step-by-step learning."}</p>
      </div>

      <div className="workflow-actions">
        <button className="secondary" onClick={onBack}>Back</button>
        <button onClick={onNext}>Next: Configure Traffic</button>
      </div>
    </div>
  );
};

export default NetworkBuilderPage;
