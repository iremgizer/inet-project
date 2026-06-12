import React, { useEffect, useMemo, useState } from "react";
import GraphCanvas from "./GraphCanvas";
import MetricsPanel from "./MetricsPanel";
import RoutingTablePanel from "./RoutingTablePanel";
import SavedRunsPanel from "./SavedRunsPanel";
import StepExplanationPanel from "./StepExplanationPanel";
import TraceControls from "./TraceControls";
import WelcomePage from "../pages/WelcomePage";
import NetworkBuilderPage from "../pages/NetworkBuilderPage";
import TrafficConfigurationPage from "../pages/TrafficConfigurationPage";
import AlgorithmSelectionPage from "../pages/AlgorithmSelectionPage";
import SimulationStudioPage from "../pages/SimulationStudioPage";
import { simulateNetwork, listSavedRuns, getSavedRun, deleteSavedRun } from "../api/simulationApi";
import { triangleTemplate } from "../utils/topologyTemplates";
import { applyAutoLayout, generateTopology, TopologySize } from "../utils/generatedTopologies";
import {
  AlgorithmConfig,
  AlgorithmName,
  LinkInput,
  NetworkInput,
  NodeInput,
  SavedSimulationSummary,
  SimulationResult,
  TopologyType,
  TrafficDemandInput,
} from "../types/network";

export type WorkflowStep = 0 | 1 | 2 | 3 | 4;

const defaultAlgorithmConfig: AlgorithmConfig = {
  selectedAlgorithm: "ECMP",
  algorithmType: "real_world_heuristic",
  objective: "minimize_max_utilization",
  congestionThreshold: 1.0,
};

const makeId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const stepLabels = ["Goal", "Network", "Traffic", "Algorithm", "Studio"];

const WorkflowManager: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>(0);
  const [network, setNetwork] = useState<NetworkInput>(triangleTemplate);
  const [algorithmConfig, setAlgorithmConfig] = useState<AlgorithmConfig>(defaultAlgorithmConfig);
  const [selectedType, setSelectedType] = useState<"node" | "link" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(900);
  const [savedRuns, setSavedRuns] = useState<SavedSimulationSummary[]>([]);
  const [topologySize, setTopologySize] = useState<TopologySize>("small");
  const [isLinkCreateMode, setIsLinkCreateMode] = useState(false);

  const traceEvents = simulationResult?.traceEvents || [];
  const currentTraceEvent = traceEvents[activeStepIndex] || null;

  useEffect(() => {
    refreshSavedRuns();
  }, []);

  useEffect(() => {
    if (!isPlaying || traceEvents.length === 0) return;
    const timer = window.setInterval(() => {
      setActiveStepIndex((prev) => {
        if (prev >= traceEvents.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, playbackSpeedMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, playbackSpeedMs, traceEvents.length]);

  const selectedResults = useMemo(() => ({ linkResults: simulationResult?.linkResults || [] }), [simulationResult]);
  const topologyStats = useMemo(() => computeTopologyStats(network), [network]);

  const handleAddNode = () => {
    const index = network.nodes.length + 1;
    const newNode: NodeInput = {
      id: makeId("node"),
      label: `N${index}`,
      x: 120 + 60 * index,
      y: 120 + 35 * index,
      visualType: "node",
    };
    setNetwork((prev) => ({ ...prev, nodes: [...prev.nodes, newNode] }));
  };

  const handleDeleteSelected = () => {
    if (!selectedType || !selectedId) return;
    if (selectedType === "node") {
      setNetwork((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((node) => node.id !== selectedId),
        links: prev.links.filter((link) => link.source !== selectedId && link.target !== selectedId),
        demands: prev.demands.filter((demand) => demand.source !== selectedId && demand.target !== selectedId),
      }));
    } else {
      setNetwork((prev) => ({ ...prev, links: prev.links.filter((link) => link.id !== selectedId) }));
    }
    setSelectedType(null);
    setSelectedId(null);
    setSimulationResult(null);
  };

  const handleAddLink = (partial: Omit<LinkInput, "id">) => {
    const duplicate = network.links.some((link) =>
      (link.source === partial.source && link.target === partial.target) ||
      (!network.isDirected && link.source === partial.target && link.target === partial.source)
    );
    if (duplicate) {
      setMessage("That link already exists.");
      return;
    }
    setNetwork((prev) => ({ ...prev, links: [...prev.links, { ...partial, id: makeId("link") }] }));
    setSimulationResult(null);
  };

  const handleAddDemand = (partial: Omit<TrafficDemandInput, "id">) => {
    setNetwork((prev) => ({ ...prev, demands: [...prev.demands, { ...partial, id: makeId("demand") }] }));
    setSimulationResult(null);
  };

  const handleDeleteDemand = (id: string) => {
    setNetwork((prev) => ({ ...prev, demands: prev.demands.filter((demand) => demand.id !== id) }));
    setSimulationResult(null);
  };

  const handleUpdateNode = (id: string, update: Partial<NodeInput>) => {
    setNetwork((prev) => ({ ...prev, nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...update } : node)) }));
  };

  const handleUpdateLink = (id: string, update: Partial<LinkInput>) => {
    setNetwork((prev) => ({ ...prev, links: prev.links.map((link) => (link.id === id ? { ...link, ...update } : link)) }));
    setSimulationResult(null);
  };

  const handleLoadTopology = async () => {
    try {
      const generated = generateTopology(network.topologyType, topologySize);
      setNetwork(generated);
      setMessage(`Loaded ${network.topologyType} (${topologySize}) topology.`);
      setSimulationResult(null);
      setSelectedType(null);
      setSelectedId(null);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const handleResetNetwork = () => {
    setNetwork(triangleTemplate);
    setAlgorithmConfig(defaultAlgorithmConfig);
    setSimulationResult(null);
    setSelectedType(null);
    setSelectedId(null);
    setActiveStepIndex(0);
    setIsPlaying(false);
    setMessage("Network reset to the triangle learning example.");
  };

  const handleAutoLayout = () => {
    setNetwork((prev) => applyAutoLayout(prev));
    setMessage("Auto layout applied.");
  };

  const handleCreateVisualLink = (source: string, target: string) => {
    handleAddLink({ source, target, weight: 1, capacity: 10 });
    setIsLinkCreateMode(false);
  };

  const handleSimulate = async () => {
    setMessage(null);
    setIsRunning(true);
    setIsPlaying(false);
    try {
      const result = await simulateNetwork({ network, algorithmConfig });
      setSimulationResult(result);
      setActiveStepIndex(0);
      setCurrentStep(4);
      setMessage(`Simulation completed. Run ${result.simulationRunId}`);
      refreshSavedRuns();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const refreshSavedRuns = async () => {
    try {
      setSavedRuns(await listSavedRuns());
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const handleLoadSavedRun = async (simulationRunId: string) => {
    try {
      const run = await getSavedRun(simulationRunId);
      setNetwork(run.network);
      setAlgorithmConfig(run.algorithmConfig);
      setSimulationResult(run.simulationResult);
      setActiveStepIndex(0);
      setIsPlaying(false);
      setCurrentStep(4);
      setMessage(`Loaded saved run ${simulationRunId}.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const handleDeleteSavedRun = async (simulationRunId: string) => {
    try {
      await deleteSavedRun(simulationRunId);
      await refreshSavedRuns();
      setMessage("Saved run deleted.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  const page = (() => {
    if (currentStep === 0) {
      return (
        <WelcomePage
          savedRuns={savedRuns}
          onStart={() => setCurrentStep(1)}
          onLoadSavedRun={handleLoadSavedRun}
          onRefreshSavedRuns={refreshSavedRuns}
        />
      );
    }
    if (currentStep === 1) {
      return (
        <NetworkBuilderPage
          network={network}
          selectedType={selectedType}
          selectedId={selectedId}
          topologyStats={topologyStats}
          topologySize={topologySize}
          isLinkCreateMode={isLinkCreateMode}
          onTopologyChange={(topologyType) => setNetwork((prev) => ({ ...prev, topologyType }))}
          onTopologySizeChange={setTopologySize}
          onLoadTopology={handleLoadTopology}
          onAddNode={handleAddNode}
          onToggleCreateLink={() => setIsLinkCreateMode((prev) => !prev)}
          onDeleteSelected={handleDeleteSelected}
          onAutoLayout={handleAutoLayout}
          onCenterView={handleAutoLayout}
          onZoomToFit={handleAutoLayout}
          onReset={handleResetNetwork}
          onUpdateNode={handleUpdateNode}
          onUpdateLink={handleUpdateLink}
          onBack={() => setCurrentStep(0)}
          onNext={() => setCurrentStep(2)}
        />
      );
    }
    if (currentStep === 2) {
      return (
        <TrafficConfigurationPage
          nodes={network.nodes}
          demands={network.demands}
          onAddDemand={handleAddDemand}
          onDeleteDemand={handleDeleteDemand}
          onBack={() => setCurrentStep(1)}
          onNext={() => setCurrentStep(3)}
        />
      );
    }
    if (currentStep === 3) {
      return (
        <AlgorithmSelectionPage
          algorithmConfig={algorithmConfig}
          isRunning={isRunning}
          onAlgorithmChange={(selectedAlgorithm: AlgorithmName) => setAlgorithmConfig((prev) => ({ ...prev, selectedAlgorithm }))}
          onThresholdChange={(congestionThreshold) => setAlgorithmConfig((prev) => ({ ...prev, congestionThreshold }))}
          onBack={() => setCurrentStep(2)}
          onStartSimulation={handleSimulate}
        />
      );
    }
    return (
      <SimulationStudioPage
        result={simulationResult}
        currentTraceEvent={currentTraceEvent}
        activeStepIndex={activeStepIndex}
        totalSteps={traceEvents.length}
        isPlaying={isPlaying}
        playbackSpeedMs={playbackSpeedMs}
        selectedType={selectedType}
        selectedId={selectedId}
        network={network}
        selectedResults={selectedResults}
        topologyStats={topologyStats}
        onBack={() => setCurrentStep(3)}
        onStepBack={() => setActiveStepIndex((prev) => Math.max(0, prev - 1))}
        onStepForward={() => setActiveStepIndex((prev) => Math.min(traceEvents.length - 1, prev + 1))}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onResetTrace={() => {
          setActiveStepIndex(0);
          setIsPlaying(false);
        }}
        onSpeedChange={setPlaybackSpeedMs}
      />
    );
  })();

  return (
    <div className="learning-shell">
      <header className="learning-topbar">
        <div>
          <h1>Network Algorithm Visualization Tool</h1>
          <p>Learn routing and traffic engineering interactively</p>
        </div>
        <div className="workflow-steps">
          {stepLabels.map((label, index) => (
            <button
              key={label}
              className={index === currentStep ? "active" : ""}
              onClick={() => setCurrentStep(index as WorkflowStep)}
            >
              {index}. {label}
            </button>
          ))}
        </div>
      </header>
      {message && <div className="learning-message">{message}</div>}
      <main className={`learning-layout ${currentStep === 1 ? "builder-layout" : ""}`}>
        <section className="workflow-panel transition-panel">{page}</section>
        <section className="persistent-graph">
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
            onCreateLink={handleCreateVisualLink}
            resultLinks={simulationResult?.linkResults || []}
            pathResults={simulationResult?.pathResults || []}
            currentTraceEvent={currentTraceEvent}
            isDirected={network.isDirected}
            isLinkCreateMode={currentStep === 1 && isLinkCreateMode}
          />
        </section>
        <aside className="learning-sidebar transition-panel">
          {currentStep === 4 ? (
            <>
              <TraceControls
                activeStepIndex={activeStepIndex}
                totalSteps={traceEvents.length}
                isPlaying={isPlaying}
                playbackSpeedMs={playbackSpeedMs}
                onStepBack={() => setActiveStepIndex((prev) => Math.max(0, prev - 1))}
                onStepForward={() => setActiveStepIndex((prev) => Math.min(traceEvents.length - 1, prev + 1))}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onReset={() => {
                  setActiveStepIndex(0);
                  setIsPlaying(false);
                }}
                onSpeedChange={setPlaybackSpeedMs}
              />
              <StepExplanationPanel event={currentTraceEvent} simulationRunId={simulationResult?.simulationRunId} />
              <MetricsPanel result={simulationResult} />
              <RoutingTablePanel entries={simulationResult?.distanceVectorTable} />
            </>
          ) : (
            <>
              <TopologyInspector stats={topologyStats} />
              <SavedRunsPanel
                runs={savedRuns}
                onRefresh={refreshSavedRuns}
                onLoad={handleLoadSavedRun}
                onDelete={handleDeleteSavedRun}
              />
            </>
          )}
        </aside>
      </main>
    </div>
  );
};

function computeTopologyStats(network: NetworkInput) {
  const nodeCount = network.nodes.length;
  const linkCount = network.links.length;
  const averageDegree = nodeCount ? (network.isDirected ? linkCount / nodeCount : (2 * linkCount) / nodeCount) : 0;
  const maxLinks = network.isDirected ? nodeCount * (nodeCount - 1) : (nodeCount * (nodeCount - 1)) / 2;
  const density = maxLinks > 0 ? linkCount / maxLinks : 0;
  const components = countComponents(network);
  return { nodeCount, linkCount, averageDegree, density, components };
}

function countComponents(network: NetworkInput) {
  const unvisited = new Set(network.nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  network.nodes.forEach((node) => adjacency.set(node.id, []));
  network.links.forEach((link) => {
    adjacency.get(link.source)?.push(link.target);
    adjacency.get(link.target)?.push(link.source);
  });
  let components = 0;
  while (unvisited.size) {
    components += 1;
    const [start] = Array.from(unvisited);
    const stack = [start];
    unvisited.delete(start);
    while (stack.length) {
      const node = stack.pop() as string;
      for (const next of adjacency.get(node) || []) {
        if (unvisited.has(next)) {
          unvisited.delete(next);
          stack.push(next);
        }
      }
    }
  }
  return components;
}

const TopologyInspector: React.FC<{ stats: ReturnType<typeof computeTopologyStats> }> = ({ stats }) => (
  <div className="panel topology-inspector">
    <h3>Topology Inspector</h3>
    <div className="stat-list">
      <span>Nodes <strong>{stats.nodeCount}</strong></span>
      <span>Links <strong>{stats.linkCount}</strong></span>
      <span>Average degree <strong>{stats.averageDegree.toFixed(2)}</strong></span>
      <span>Components <strong>{stats.components}</strong></span>
      <span>Density <strong>{stats.density.toFixed(2)}</strong></span>
    </div>
    <p>
      A connected, denser topology usually gives routing algorithms more path choices. Sparse topologies make bottlenecks easier to see.
    </p>
  </div>
);

export default WorkflowManager;
