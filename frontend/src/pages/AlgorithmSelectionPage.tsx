import React, { useState } from "react";
import { ChevronDown, ChevronUp, Zap, GitBranch } from "lucide-react";
import { AlgorithmConfig, AlgorithmName } from "../types/network";
import TermHint from "../components/TermHint";

interface AlgorithmSelectionPageProps {
  algorithmConfig: AlgorithmConfig;
  isRunning: boolean;
  onAlgorithmChange: (algorithm: AlgorithmName) => void;
  onThresholdChange: (value: number) => void;
  onBack: () => void;
  onStartSimulation: () => void;
  canChooseAlgorithm?: boolean;
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
    fullName: "Segment Routing",
    level: "Coming soon",
    tagline: "Route traffic through explicit waypoints.",
    detail: "Planned extension — allows specifying exact paths through the network.",
    formula: "–",
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
}) => {
  const [showTheory, setShowTheory] = useState(false);
  const selected = algorithms.find((a) => a.id === algorithmConfig.selectedAlgorithm) ?? algorithms[0];
  const isPlaceholder = selected.id === "SEGMENT_ROUTING";

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
          {isPlaceholder && (
            <div className="notice notice--warning">
              Segment Routing is a placeholder. Select ECMP or Distance Vector to simulate.
            </div>
          )}
        </div>
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
          disabled={isRunning || isPlaceholder}
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
