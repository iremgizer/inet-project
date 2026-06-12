import React from "react";
import { AlgorithmConfig, AlgorithmName } from "../types/network";

interface AlgorithmSelectionPageProps {
  algorithmConfig: AlgorithmConfig;
  isRunning: boolean;
  onAlgorithmChange: (algorithm: AlgorithmName) => void;
  onThresholdChange: (value: number) => void;
  onBack: () => void;
  onStartSimulation: () => void;
}

const algorithmCards = [
  {
    id: "ECMP" as AlgorithmName,
    title: "ECMP",
    difficulty: "Beginner",
    definition: "Equal-Cost Multi-Path routing uses every shortest path with the same total weight.",
    advantages: "Simple, intuitive, balances flow across equal routes.",
    disadvantages: "Cannot use longer paths even if they have spare capacity.",
    formula: "Path Cost = Sum of Link Weights; Traffic Share = Demand / Equal-Cost Path Count",
    example: "If A-B-C and A-D-C both cost 5, ECMP splits the demand across both.",
  },
  {
    id: "DISTANCE_VECTOR" as AlgorithmName,
    title: "Distance Vector",
    difficulty: "Intermediate",
    definition: "Each node stores a cost and next hop for every destination.",
    advantages: "Explains distributed routing and Bellman-Ford reasoning.",
    disadvantages: "Real networks need convergence handling, which is deferred in V1.",
    formula: "Cost(x,d) = min(linkWeight(x,n) + Cost(n,d))",
    example: "Node A forwards toward C through neighbor B if B gives the lowest total cost.",
  },
  {
    id: "SEGMENT_ROUTING" as AlgorithmName,
    title: "Segment Routing",
    difficulty: "Coming soon",
    definition: "Routes through planned waypoints or segments.",
    advantages: "Powerful for policy routing.",
    disadvantages: "Placeholder in this version.",
    formula: "Planned extension",
    example: "Future: force A to reach D through B first.",
  },
];

const AlgorithmSelectionPage: React.FC<AlgorithmSelectionPageProps> = ({
  algorithmConfig,
  isRunning,
  onAlgorithmChange,
  onThresholdChange,
  onBack,
  onStartSimulation,
}) => {
  const selected = algorithmCards.find((card) => card.id === algorithmConfig.selectedAlgorithm) || algorithmCards[0];
  return (
    <div className="workflow-page">
      <div className="page-kicker">Step 3 · Choose Algorithm</div>
      <h2>Select the routing idea to study</h2>
      <p className="page-subtitle">The algorithm decides which paths carry the traffic demand.</p>

      <div className="algorithm-card-grid">
        {algorithmCards.map((card) => (
          <button
            key={card.id}
            className={`algorithm-choice-card ${algorithmConfig.selectedAlgorithm === card.id ? "selected" : ""}`}
            onClick={() => onAlgorithmChange(card.id)}
          >
            <strong>{card.title}</strong>
            <span>{card.difficulty}</span>
            <p>{card.definition}</p>
          </button>
        ))}
      </div>

      <div className="education-note theory-panel">
        <h3>{selected.title} Theory</h3>
        <p><strong>Definition:</strong> {selected.definition}</p>
        <p><strong>Advantages:</strong> {selected.advantages}</p>
        <p><strong>Disadvantages:</strong> {selected.disadvantages}</p>
        <pre>{selected.formula}</pre>
        <p><strong>Worked example:</strong> {selected.example}</p>
        {selected.id === "SEGMENT_ROUTING" && <p className="placeholder-note">Segment Routing is planned and returns placeholder output in V1.</p>}
      </div>

      <div className="form-section">
        <label>
          Congestion Threshold
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={algorithmConfig.congestionThreshold}
            onChange={(event) => onThresholdChange(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="workflow-actions">
        <button className="secondary" onClick={onBack}>Back</button>
        <button onClick={onStartSimulation} disabled={isRunning}>{isRunning ? "Running..." : "Start Simulation"}</button>
      </div>
    </div>
  );
};

export default AlgorithmSelectionPage;
