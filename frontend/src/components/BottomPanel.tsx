import React, { useState } from "react";
import { AlgorithmName, AlgorithmType, ObjectiveType, TrafficDemandInput, NodeInput } from "../types/network";

interface BottomPanelProps {
  nodes: NodeInput[];
  demands: TrafficDemandInput[];
  algorithm: AlgorithmName;
  algorithmType: AlgorithmType;
  objective: ObjectiveType;
  congestionThreshold: number;
  onAddDemand: (demand: Omit<TrafficDemandInput, "id">) => void;
  onDeleteDemand: (id: string) => void;
  onAlgorithmChange: (value: AlgorithmName) => void;
  onAlgorithmTypeChange: (value: AlgorithmType) => void;
  onObjectiveChange: (value: ObjectiveType) => void;
  onThresholdChange: (value: number) => void;
  onSimulate: () => void;
  onResetSimulation: () => void;
}

const BottomPanel: React.FC<BottomPanelProps> = ({
  nodes,
  demands,
  algorithm,
  algorithmType,
  objective,
  congestionThreshold,
  onAddDemand,
  onDeleteDemand,
  onAlgorithmChange,
  onAlgorithmTypeChange,
  onObjectiveChange,
  onThresholdChange,
  onSimulate,
  onResetSimulation,
}) => {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(1);

  const handleAddDemand = () => {
    if (!source || !target || source === target) return;
    onAddDemand({ source, target, amount });
    setSource("");
    setTarget("");
    setAmount(1);
  };

  return (
    <div className="panel bottom-panel">
      <div className="demand-form">
        <h3>Add Traffic Demand</h3>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Select</option>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
        </label>
        <label>
          Target
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select</option>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
        </label>
        <label>
          Amount
          <input type="number" min="0" step="0.1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>
        <button onClick={handleAddDemand}>Add Demand</button>
      </div>
      <div className="demand-list">
        <h3>Demands</h3>
        {demands.length === 0 ? <p>No demands yet</p> : (
          <ul>
            {demands.map((demand) => (
              <li key={demand.id}>
                {demand.source} → {demand.target}: {demand.amount}
                <button onClick={() => onDeleteDemand(demand.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="algorithm-controls">
        <h3>Algorithm</h3>
        <label>
          Algorithm
          <select value={algorithm} onChange={(e) => onAlgorithmChange(e.target.value as AlgorithmName)}>
            <option value="ECMP">ECMP</option>
            <option value="DISTANCE_VECTOR">Distance Vector</option>
            <option value="SEGMENT_ROUTING">Segment Routing</option>
            <option value="CUSTOM_SPLITTING">Custom Splitting</option>
          </select>
        </label>
        <label>
          Type
          <select value={algorithmType} onChange={(e) => onAlgorithmTypeChange(e.target.value as AlgorithmType)}>
            <option value="exact">exact</option>
            <option value="real_world_heuristic">real_world_heuristic</option>
            <option value="custom">custom</option>
          </select>
        </label>
        <label>
          Objective
          <select value={objective} onChange={(e) => onObjectiveChange(e.target.value as ObjectiveType)}>
            <option value="minimize_max_utilization">minimize max utilization</option>
            <option value="minimize_path_cost">minimize path cost</option>
          </select>
        </label>
        <label>
          Congestion Threshold
          <input type="number" min="0.1" step="0.1" value={congestionThreshold} onChange={(e) => onThresholdChange(Number(e.target.value))} />
        </label>
        <button onClick={onSimulate}>Start Simulation</button>
        <button onClick={onResetSimulation}>Reset Simulation Result</button>
      </div>
    </div>
  );
};

export default BottomPanel;
