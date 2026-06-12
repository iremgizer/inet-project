import React from "react";
import { SavedSimulationSummary } from "../types/network";

interface SavedRunsPanelProps {
  runs: SavedSimulationSummary[];
  onRefresh: () => void;
  onLoad: (simulationRunId: string) => void;
  onDelete: (simulationRunId: string) => void;
}

const SavedRunsPanel: React.FC<SavedRunsPanelProps> = ({ runs, onRefresh, onLoad, onDelete }) => {
  return (
    <div className="panel saved-runs">
      <div className="panel-heading-row">
        <h3>Saved Runs</h3>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      {runs.length === 0 ? (
        <p>No saved MongoDB runs found.</p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.simulationRunId}>
              <strong>{run.algorithm}</strong> {run.topologyType}
              <span>{run.nodeCount} nodes, max u {(run.maxUtilization * 100).toFixed(0)}%</span>
              <div className="saved-run-actions">
                <button onClick={() => onLoad(run.simulationRunId)}>Load</button>
                <button onClick={() => onDelete(run.simulationRunId)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SavedRunsPanel;
