import React from "react";
import { LinkResult, NetworkInput, SimulationResult, SimulationTraceEvent } from "../types/network";

interface SimulationStudioPageProps {
  result: SimulationResult | null;
  currentTraceEvent: SimulationTraceEvent | null;
  activeStepIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  playbackSpeedMs: number;
  selectedType: "node" | "link" | null;
  selectedId: string | null;
  network: NetworkInput;
  selectedResults: { linkResults: LinkResult[] };
  topologyStats: { nodeCount: number; linkCount: number; averageDegree: number; components: number; density: number };
  onBack: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onPlay: () => void;
  onPause: () => void;
  onResetTrace: () => void;
  onSpeedChange: (value: number) => void;
}

const SimulationStudioPage: React.FC<SimulationStudioPageProps> = ({
  result,
  currentTraceEvent,
  activeStepIndex,
  totalSteps,
  selectedType,
  selectedId,
  network,
  selectedResults,
  topologyStats,
  onBack,
}) => {
  const selectedLink = selectedType === "link" ? network.links.find((link) => link.id === selectedId) : null;
  const selectedLinkResult = selectedResults.linkResults.find((link) => link.linkId === selectedId);
  const activePathLinks = currentTraceEvent?.highlightedLinks || [];
  const activePaths = result?.pathResults.flatMap((pathResult) =>
    pathResult.paths
      .filter((path) => path.nodes.some((node, index) => index < path.nodes.length - 1 && activePathLinks.length > 0))
      .map((path) => ({ demandId: pathResult.demandId, ...path }))
  ) || [];

  return (
    <div className="workflow-page simulation-studio-page">
      <div className="page-kicker">Step 4 · Simulation Studio</div>
      <h2>Watch the algorithm think</h2>
      <p className="page-subtitle">Use the trace controls on the right. The graph highlights the current algorithm step.</p>

      <div className="studio-status">
        <span>Step {totalSteps ? activeStepIndex + 1 : 0} of {totalSteps}</span>
        <span>{result ? result.algorithm : "No simulation yet"}</span>
      </div>

      <div className="education-note">
        <h3>Current focus</h3>
        {currentTraceEvent ? (
          <>
            <p>{currentTraceEvent.title}</p>
            {currentTraceEvent.costCalculation && <pre>{currentTraceEvent.costCalculation}</pre>}
            {currentTraceEvent.formulaText && <pre>{currentTraceEvent.formulaText}</pre>}
          </>
        ) : (
          <p>Start a simulation from the previous step to generate trace events.</p>
        )}
      </div>

      <div className="inspector-grid">
        <div className="education-note">
          <h3>Path Inspector</h3>
          {activePaths.length === 0 ? (
            <p>When equal-cost paths are highlighted, their cost calculations appear here.</p>
          ) : (
            activePaths.slice(0, 3).map((path) => (
              <p key={`${path.demandId}-${path.nodes.join("-")}`}>
                {path.nodes.join(" -> ")} · cost {path.cost} · traffic {path.trafficShare}
              </p>
            ))
          )}
        </div>
        <div className="education-note">
          <h3>Congestion Inspector</h3>
          {selectedLink && selectedLinkResult ? (
            <>
              <p>{selectedLink.source} to {selectedLink.target}</p>
              <p>Load {selectedLinkResult.load.toFixed(2)} / Capacity {selectedLink.capacity}</p>
              <pre>Utilization = {selectedLinkResult.load.toFixed(2)} / {selectedLink.capacity} = {(selectedLinkResult.utilization).toFixed(2)}</pre>
              <p>{selectedLinkResult.isCongested ? "This link is congested because utilization exceeds the threshold." : "This link is not congested."}</p>
            </>
          ) : (
            <p>Click a link after simulation to inspect load, capacity, and utilization.</p>
          )}
        </div>
      </div>

      <div className="education-note">
        <h3>Topology Characteristics</h3>
        <p>{topologyStats.nodeCount} nodes, {topologyStats.linkCount} links, average degree {topologyStats.averageDegree.toFixed(2)}, density {topologyStats.density.toFixed(2)}.</p>
        <p>{topologyStats.components === 1 ? "The topology is connected, so routes can potentially span the whole graph." : "The topology has multiple components, so some demands may be unreachable."}</p>
      </div>

      <div className="workflow-actions">
        <button className="secondary" onClick={onBack}>Back</button>
      </div>
    </div>
  );
};

export default SimulationStudioPage;
