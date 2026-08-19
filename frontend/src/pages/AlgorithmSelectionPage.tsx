import React, { useState } from "react";
import { ChevronDown, ChevronUp, Zap, GitBranch } from "lucide-react";
import {
  AlgorithmConfig,
  AlgorithmName,
  LinkInput,
  NodeInput,
  SimulationResult,
  TrafficDemandInput,
  TrafficDistributionMode,
  TrafficEngineeringPolicy,
} from "../types/network";
import TermHint from "../components/TermHint";
import SegmentRoutingEditor from "../components/SegmentRoutingEditor";
import TrafficDistributionEditor from "../components/TrafficDistributionEditor";
import TEPolicyEditor, { TEPolicyDraft } from "../components/TEPolicyEditor";
import { isDistributionValid } from "../utils/trafficDistribution";

interface AlgorithmSelectionPageProps {
  algorithmConfig: AlgorithmConfig;
  isRunning: boolean;
  onAlgorithmChange: (algorithm: AlgorithmName) => void;
  onThresholdChange: (value: number) => void;
  onBack: () => void;
  onStartSimulation: () => void;
  canChooseAlgorithm?: boolean;
  // Segment Routing configuration — only rendered/used when
  // selectedAlgorithm === "SEGMENT_ROUTING".
  demands: TrafficDemandInput[];
  nodes: NodeInput[];
  links: LinkInput[];
  waypointSelectDemandId: string | null;
  onStartWaypointSelect: (demandId: string) => void;
  onStopWaypointSelect: () => void;
  onAddWaypoint: (demandId: string, nodeId: string) => void;
  onRemoveWaypoint: (demandId: string, index: number) => void;
  onMoveWaypoint: (demandId: string, index: number, direction: "up" | "down") => void;
  // ECMP traffic distribution — only rendered/used when
  // selectedAlgorithm === "ECMP".
  simulationResult: SimulationResult | null;
  distributionMode: TrafficDistributionMode;
  onDistributionModeChange: (mode: TrafficDistributionMode) => void;
  onDistributionShareChange: (demandId: string, pathId: string, sharePercent: number) => void;
  // Traffic Engineering policies — rendered for ECMP and Segment Routing
  // (Distance Vector does not support them; see distance_vector.py).
  tePolicies: TrafficEngineeringPolicy[];
  teDraft: TEPolicyDraft | null;
  teIsSelecting: boolean;
  onOpenTEDraft: () => void;
  onCancelTEDraft: () => void;
  onUpdateTEDraft: (patch: Partial<TEPolicyDraft>) => void;
  onStartTEGraphSelect: () => void;
  onStopTEGraphSelect: () => void;
  onCommitTEDraft: () => void;
  onRemoveTEPolicy: (policyId: string) => void;
}

const algorithms = [
  {
    id: "ECMP" as AlgorithmName,
    name: "ECMP",
    fullName: "Equal-Cost Multi-Path",
    level: "Beginner",
    tagline: "Splits traffic equally across all shortest paths.",
    detail: "Finds every path with the same minimum cost and divides traffic evenly between them. Simple, predictable, and widely used in real networks.",
    formula: "share per path = demand ÷ number of equal-cost paths",
  },
  {
    id: "DISTANCE_VECTOR" as AlgorithmName,
    name: "Distance Vector",
    fullName: "Bellman-Ford Distance Vector",
    level: "Intermediate",
    tagline: "Builds a next-hop table by learning from neighbors.",
    detail: "Each node advertises its distance to every destination. Routers iteratively update until convergence. Shows how real protocols like RIP work.",
    formula: "cost = min(neighbor cost + link weight)",
  },
  {
    id: "SEGMENT_ROUTING" as AlgorithmName,
    name: "Segment Routing",
    fullName: "Segment Routing (waypoint-based)",
    level: "Intermediate",
    tagline: "Steer traffic through an ordered list of waypoints.",
    detail: "Each demand can carry an ordered list of waypoint nodes. Between the source and the first waypoint, between each waypoint, and from the last waypoint to the destination, traffic still follows the normal shortest path — a waypoint only decides which nodes are visited, not how the graph is crossed between them. No waypoints means plain shortest-path routing.",
    formula: "route = shortest(source→seg₁) + shortest(seg₁→seg₂) + … + shortest(segₙ→destination)",
  },
];

const AlgorithmSelectionPage: React.FC<AlgorithmSelectionPageProps> = ({
  algorithmConfig,
  isRunning,
  onAlgorithmChange,
  onThresholdChange,
  onBack,
  onStartSimulation,
  canChooseAlgorithm = true,
  demands,
  nodes,
  links,
  waypointSelectDemandId,
  onStartWaypointSelect,
  onStopWaypointSelect,
  onAddWaypoint,
  onRemoveWaypoint,
  onMoveWaypoint,
  simulationResult,
  distributionMode,
  onDistributionModeChange,
  onDistributionShareChange,
  tePolicies,
  teDraft,
  teIsSelecting,
  onOpenTEDraft,
  onCancelTEDraft,
  onUpdateTEDraft,
  onStartTEGraphSelect,
  onStopTEGraphSelect,
  onCommitTEDraft,
  onRemoveTEPolicy,
}) => {
  const [showTheory, setShowTheory] = useState(false);
  const selected = algorithms.find((a) => a.id === algorithmConfig.selectedAlgorithm) ?? algorithms[0];
  const isSegmentRouting = selected.id === "SEGMENT_ROUTING";
  const isEcmp = selected.id === "ECMP";
  const supportsTEPolicies = isEcmp || isSegmentRouting;
  const distributionsInvalid = isEcmp && !isDistributionValid(algorithmConfig.trafficDistributions ?? []);

  return (
    <div className="page">
      <div className="stage-kicker">
        <GitBranch size={13} />
        Algorithm
      </div>
      <h2 className="page-title">Choose routing algorithm</h2>

      {!canChooseAlgorithm && (
        <div className="locked-notice">
          <span className="locked-notice-icon">🔒</span> Algorithm locked by teacher
        </div>
      )}

      <div className="algo-card-list">
        {algorithms.map((a) => {
          const isSelected = algorithmConfig.selectedAlgorithm === a.id;
          const isDisabled = a.level === "Coming soon" || !canChooseAlgorithm;
          return (
            <button
              key={a.id}
              className={`algo-card ${isSelected ? "algo-card--selected" : ""} ${isDisabled ? "algo-card--disabled" : ""}`}
              onClick={() => !isDisabled && onAlgorithmChange(a.id)}
              disabled={isDisabled}
              title={!canChooseAlgorithm && a.level !== "Coming soon" ? "Locked by teacher" : undefined}
            >
              <div className="algo-card-header">
                <div className="algo-card-name">
                  <strong>{a.name}</strong>
                </div>
                <span className={`level-badge ${
                  a.level === "Beginner" ? "level-beginner"
                  : a.level === "Coming soon" ? "level-soon"
                  : "level-mid"
                }`}>
                  {a.level}
                </span>
              </div>
              <p>{a.tagline}</p>
              {isSelected && !isDisabled && (
                <div className="algo-card-selected-indicator">
                  <span>Selected</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Theory toggle */}
      <button className="collapse-toggle" onClick={() => setShowTheory((p) => !p)}>
        {showTheory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showTheory ? "Hide" : "How"} {selected.name} works
      </button>
      {showTheory && (
        <div className="theory-box">
          <p>{selected.detail}</p>
          <pre className="formula-block">{selected.formula}</pre>
        </div>
      )}

      {/* Segment Routing waypoint configuration */}
      {isSegmentRouting && (
        <SegmentRoutingEditor
          demands={demands}
          nodes={nodes}
          policies={algorithmConfig.segmentRoutingPolicies ?? []}
          waypointSelectDemandId={waypointSelectDemandId}
          onStartWaypointSelect={onStartWaypointSelect}
          onStopWaypointSelect={onStopWaypointSelect}
          onAddWaypoint={onAddWaypoint}
          onRemoveWaypoint={onRemoveWaypoint}
          onMoveWaypoint={onMoveWaypoint}
        />
      )}

      {/* ECMP traffic distribution configuration */}
      {isEcmp && (
        <TrafficDistributionEditor
          demands={demands}
          nodes={nodes}
          distributionMode={distributionMode}
          distributions={algorithmConfig.trafficDistributions ?? []}
          simulationResult={simulationResult}
          onModeChange={onDistributionModeChange}
          onShareChange={onDistributionShareChange}
        />
      )}

      {/* Traffic Engineering policies — advanced, collapsed by default */}
      {supportsTEPolicies && (
        <TEPolicyEditor
          policies={tePolicies}
          demands={demands}
          links={links}
          nodes={nodes}
          draft={teDraft}
          isSelecting={teIsSelecting}
          onOpenDraft={onOpenTEDraft}
          onCancelDraft={onCancelTEDraft}
          onUpdateDraft={onUpdateTEDraft}
          onStartGraphSelect={onStartTEGraphSelect}
          onStopGraphSelect={onStopTEGraphSelect}
          onCommitDraft={onCommitTEDraft}
          onRemovePolicy={onRemoveTEPolicy}
        />
      )}

      {/* Congestion threshold */}
      <div className="threshold-row">
        <label className="field field--inline">
          <span className="field-label-row">
            Congestion threshold
            <TermHint
              term="Congestion threshold"
              shortDefinition="A link is marked congested when its utilization exceeds this value. Default is 1.0 (100% of capacity)."
              formula="congested if load / capacity > threshold"
            />
          </span>
          <input
            className="number-input number-input--sm"
            type="number"
            min="0.1"
            step="0.1"
            value={algorithmConfig.congestionThreshold}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="page-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>Back</button>
        <button
          className="btn-primary btn-run"
          onClick={onStartSimulation}
          disabled={isRunning || distributionsInvalid}
          title={distributionsInvalid ? "Traffic distribution shares must total 100% for every demand" : undefined}
        >
          {isRunning ? (
            <><span className="spinner" /> Running…</>
          ) : (
            <><Zap size={14} /> Run simulation</>
          )}
        </button>
      </div>
    </div>
  );
};

export default AlgorithmSelectionPage;
