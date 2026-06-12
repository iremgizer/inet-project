import React from "react";
import { SavedSimulationSummary } from "../types/network";

interface WelcomePageProps {
  savedRuns: SavedSimulationSummary[];
  onStart: () => void;
  onLoadSavedRun: (simulationRunId: string) => void;
  onRefreshSavedRuns: () => void;
}

const cards = [
  {
    title: "ECMP",
    difficulty: "Beginner",
    description: "Routes traffic across all equal-cost shortest paths.",
    teaches: "Shortest paths, equal costs, traffic splitting, congestion.",
  },
  {
    title: "Distance Vector",
    difficulty: "Intermediate",
    description: "Builds cost and next-hop tables from link weights.",
    teaches: "Bellman-Ford reasoning, next hops, stable route selection.",
  },
  {
    title: "Segment Routing",
    difficulty: "Coming soon",
    description: "A planned extension for waypoint-based routing.",
    teaches: "Policy routing and explicit path control.",
  },
];

const WelcomePage: React.FC<WelcomePageProps> = ({ savedRuns, onStart, onLoadSavedRun, onRefreshSavedRuns }) => {
  return (
    <div className="workflow-page welcome-page">
      <div className="page-kicker">Step 0 · Learning Goal</div>
      <h2>Network Algorithm Visualization Tool</h2>
      <p className="page-subtitle">Learn Routing and Traffic Engineering interactively.</p>
      <div className="algorithm-card-grid">
        {cards.map((card) => (
          <article className="algorithm-learning-card" key={card.title}>
            <h3>{card.title}</h3>
            <span>{card.difficulty}</span>
            <p>{card.description}</p>
            <strong>Teaches</strong>
            <p>{card.teaches}</p>
          </article>
        ))}
      </div>
      <div className="workflow-actions">
        <button onClick={onStart}>Start Building Network</button>
        <button className="secondary" onClick={onRefreshSavedRuns}>Load Previous Simulation</button>
      </div>
      {savedRuns.length > 0 && (
        <div className="compact-run-list">
          {savedRuns.slice(0, 3).map((run) => (
            <button key={run.simulationRunId} onClick={() => onLoadSavedRun(run.simulationRunId)}>
              {run.algorithm} · {run.topologyType} · {(run.maxUtilization * 100).toFixed(0)}% max utilization
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default WelcomePage;
