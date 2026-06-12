import React, { useMemo, useState } from "react";
import GraphCanvas from "./components/GraphCanvas";
import LeftSidebar from "./components/LeftSidebar";
import RightSidebar from "./components/RightSidebar";
import BottomPanel from "./components/BottomPanel";
import MetricsPanel from "./components/MetricsPanel";
import RoutingTablePanel from "./components/RoutingTablePanel";
import ParameterPanel from "./components/ParameterPanel";
import { triangleTemplate } from "./utils/topologyTemplates";
import { simulateNetwork, loadTopology as apiLoadTopology } from "./api/simulationApi";
import {
  NodeInput,
  LinkInput,
  TrafficDemandInput,
  NetworkInput,
  AlgorithmConfig,
  AlgorithmName,
  AlgorithmType,
  ObjectiveType,
  SimulationResult,
} from "./types/network";

const defaultAlgorithmConfig: AlgorithmConfig = {
  selectedAlgorithm: "ECMP",
  algorithmType: "real_world_heuristic",
  objective: "minimize_max_utilization",
  congestionThreshold: 1.0,
};

const initialNetwork: NetworkInput = triangleTemplate;

const App: React.FC = () => {
  const [network, setNetwork] = useState<NetworkInput>(initialNetwork);
  const [algorithmConfig, setAlgorithmConfig] = useState<AlgorithmConfig>(defaultAlgorithmConfig);
  const [selectedType, setSelectedType] = useState<"node" | "link" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleAddNode = () => {
    const index = network.nodes.length + 1;
    const id = `n${index}`;
    const nextId = network.nodes.some((node) => node.id === id) ? `${id}-${Date.now()}` : id;
    const newNode: NodeInput = {
      id: nextId,
      label: `N${index}`,
      x: 100 + 80 * index,
      y: 100 + 30 * index,
      visualType: "node",
    };
    setNetwork((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  };

  const handleAddLink = (partial: Omit<LinkInput, "id">) => {
    const id = `link-${network.links.length + 1}`;
    const newLink: LinkInput = { ...partial, id };
    setNetwork((prev) => ({ ...prev, links: [...prev.links, newLink] }));
  };

  const handleAddDemand = (partial: Omit<TrafficDemandInput, "id">) => {
    const id = `d${network.demands.length + 1}`;
    const newDemand: TrafficDemandInput = { ...partial, id };
    setNetwork((prev) => ({ ...prev, demands: [...prev.demands, newDemand] }));
  };

  const handleDeleteDemand = (id: string) => {
    setNetwork((prev) => ({ ...prev, demands: prev.demands.filter((item) => item.id !== id) }));
  };

  const handleUpdateNode = (id: string, update: Partial<NodeInput>) => {
    setNetwork((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...update } : node)),
    }));
  };

  const handleUpdateLink = (id: string, update: Partial<LinkInput>) => {
    setNetwork((prev) => ({
      ...prev,
      links: prev.links.map((link) => (link.id === id ? { ...link, ...update } : link)),
    }));
  };

  const handleLoadTopology = async () => {
    try {
      const loaded = await apiLoadTopology(network.topologyType);
      setNetwork(loaded);
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
      setMessage(`Loaded ${network.topologyType} topology.`);
    } catch (error) {
      setMessage((error as Error).message || "Could not load topology");
    }
  };

  const handleImport = (json: string) => {
    try {
      const parsed = JSON.parse(json) as NetworkInput;
      setNetwork(parsed);
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
      setMessage("Imported network JSON successfully.");
    } catch {
      setMessage("Invalid JSON import.");
    }
  };

  const handleResetNetwork = () => {
    setNetwork(initialNetwork);
    setSimulationResult(null);
    setSelectedType(null);
    setSelectedId(null);
    setMessage("Network reset to initial example.");
  };

  const handleSimulate = async () => {
    setMessage(null);
    const request = { network, algorithmConfig };
    try {
      const result = await simulateNetwork(request);
      setSimulationResult(result);
      setMessage("Simulation completed.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const handleResetSimulation = () => {
    setSimulationResult(null);
    setMessage("Simulation results cleared.");
  };

  const selectedResults = useMemo(() => ({ linkResults: simulationResult?.linkResults || [] }), [simulationResult]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Network Algorithm Visualization Tool</h1>
          <p>Routing & Traffic Engineering Playground</p>
        </div>
        <div className="status-bar">
          {message && <span>{message}</span>}
        </div>
      </header>
      <div className="main-grid">
        <LeftSidebar
          nodes={network.nodes}
          links={network.links}
          topologyType={network.topologyType}
          isDirected={network.isDirected}
          onAddNode={handleAddNode}
          onAddLink={handleAddLink}
          onTopologyChange={(type) => setNetwork((prev) => ({ ...prev, topologyType: type }))}
          onLoadTopology={handleLoadTopology}
          onToggleDirected={() => setNetwork((prev) => ({ ...prev, isDirected: !prev.isDirected }))}
          onResetNetwork={handleResetNetwork}
          onExport={() => {
            navigator.clipboard.writeText(JSON.stringify(network, null, 2));
            setMessage("Network JSON copied to clipboard.");
          }}
          onImport={handleImport}
        />
        <div className="canvas-column">
          <GraphCanvas
            nodes={network.nodes}
            links={network.links}
            selectedId={selectedId}
            selectedType={selectedType}
            setSelected={(type, id) => {
              setSelectedType(type);
              setSelectedId(id);
            }}
            onMoveNode={(id, x, y) => handleUpdateNode(id, { x, y })}
            resultLinks={simulationResult?.linkResults || []}
            pathResults={simulationResult?.pathResults || []}
            isDirected={network.isDirected}
          />
          <div className="bottom-row">
            <BottomPanel
              nodes={network.nodes}
              demands={network.demands}
              algorithm={algorithmConfig.selectedAlgorithm}
              algorithmType={algorithmConfig.algorithmType}
              objective={algorithmConfig.objective}
              congestionThreshold={algorithmConfig.congestionThreshold}
              onAddDemand={handleAddDemand}
              onDeleteDemand={handleDeleteDemand}
              onAlgorithmChange={(value) => setAlgorithmConfig((prev) => ({ ...prev, selectedAlgorithm: value }))}
              onAlgorithmTypeChange={(value) => setAlgorithmConfig((prev) => ({ ...prev, algorithmType: value }))}
              onObjectiveChange={(value) => setAlgorithmConfig((prev) => ({ ...prev, objective: value }))}
              onThresholdChange={(value) => setAlgorithmConfig((prev) => ({ ...prev, congestionThreshold: value }))}
              onSimulate={handleSimulate}
              onResetSimulation={handleResetSimulation}
            />
          </div>
        </div>
        <div className="right-column">
          <ParameterPanel
            selectedAlgorithm={algorithmConfig.selectedAlgorithm}
            algorithmType={algorithmConfig.algorithmType}
            objective={algorithmConfig.objective}
            congestionThreshold={algorithmConfig.congestionThreshold}
          />
          <RightSidebar
            selectedType={selectedType}
            selectedId={selectedId}
            nodes={network.nodes}
            links={network.links}
            results={selectedResults}
            nodeRoles={simulationResult?.nodeRoles || []}
            onUpdateNode={handleUpdateNode}
            onUpdateLink={handleUpdateLink}
          />
          <MetricsPanel result={simulationResult} />
          <RoutingTablePanel entries={simulationResult?.distanceVectorTable} />
        </div>
      </div>
    </div>
  );
};

export default App;
