import React from "react";
import { AlgorithmName, AlgorithmType, ObjectiveType } from "../types/network";

interface ParameterPanelProps {
  selectedAlgorithm: AlgorithmName;
  algorithmType: AlgorithmType;
  objective: ObjectiveType;
  congestionThreshold: number;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({ selectedAlgorithm, algorithmType, objective, congestionThreshold }) => {
  return (
    <div className="panel parameter-panel">
      <h3>Parameters</h3>
      <p><strong>Algorithm:</strong> {selectedAlgorithm}</p>
      <p><strong>Type:</strong> {algorithmType}</p>
      <p><strong>Objective:</strong> {objective}</p>
      <p><strong>Congestion threshold:</strong> {congestionThreshold.toFixed(1)}</p>
      {selectedAlgorithm === "SEGMENT_ROUTING" && (
        <div className="placeholder-note">
          Segment Routing is planned for the next version and will support waypoint-based routing.
        </div>
      )}
      {selectedAlgorithm === "CUSTOM_SPLITTING" && (
        <div className="placeholder-note">
          Custom Splitting Ratios is planned for the next version and will allow manual path share assignment.
        </div>
      )}
    </div>
  );
};

export default ParameterPanel;
