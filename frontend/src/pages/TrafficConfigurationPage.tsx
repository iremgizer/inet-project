import React, { useState } from "react";
import { NodeInput, TrafficDemandInput } from "../types/network";

interface TrafficConfigurationPageProps {
  nodes: NodeInput[];
  demands: TrafficDemandInput[];
  onAddDemand: (demand: Omit<TrafficDemandInput, "id">) => void;
  onDeleteDemand: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

const TrafficConfigurationPage: React.FC<TrafficConfigurationPageProps> = ({
  nodes,
  demands,
  onAddDemand,
  onDeleteDemand,
  onBack,
  onNext,
}) => {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(1);

  const addDemand = () => {
    if (!source || !target || source === target) return;
    onAddDemand({ source, target, amount });
    setSource("");
    setTarget("");
    setAmount(1);
  };

  return (
    <div className="workflow-page">
      <div className="page-kicker">Step 2 · Configure Traffic</div>
      <h2>Define what must be routed</h2>
      <p className="page-subtitle">A traffic demand says how much continuous flow should travel from one node to another.</p>

      <div className="form-section">
        <h3>Add Traffic Demand</h3>
        <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Select</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
        <label>Destination<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Select</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="0.1" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
        <button onClick={addDemand} disabled={nodes.length < 2}>Add Demand</button>
      </div>

      <div className="demand-list guided-list">
        <h3>Demand List</h3>
        {demands.length === 0 ? <p>No demands yet.</p> : (
          <ul>
            {demands.map((demand) => (
              <li key={demand.id}>
                <span>{demand.source} to {demand.target}: {demand.amount}</span>
                <button onClick={() => onDeleteDemand(demand.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="education-note">
        <h3>What is a traffic demand?</h3>
        <p><strong>A to D : 10</strong> means 10 units of traffic must be routed from A to D.</p>
        <p>The simulator treats this as continuous flow, not individual packets.</p>
      </div>

      <div className="workflow-actions">
        <button className="secondary" onClick={onBack}>Back</button>
        <button onClick={onNext}>Next: Choose Algorithm</button>
      </div>
    </div>
  );
};

export default TrafficConfigurationPage;
