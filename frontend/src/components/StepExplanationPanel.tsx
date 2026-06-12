import React from "react";
import { SimulationTraceEvent } from "../types/network";

interface StepExplanationPanelProps {
  event: SimulationTraceEvent | null;
  simulationRunId?: string;
}

const StepExplanationPanel: React.FC<StepExplanationPanelProps> = ({ event, simulationRunId }) => {
  return (
    <div className="panel step-explanation">
      <h3>Step Explanation</h3>
      {simulationRunId && <p className="run-id">Run: {simulationRunId}</p>}
      {!event ? (
        <p>Run a simulation to inspect algorithm steps.</p>
      ) : (
        <>
          <h4>{event.title}</h4>
          <p>{event.description}</p>
          <p>{event.explanationText}</p>
          {event.costCalculation && (
            <pre>{event.costCalculation}</pre>
          )}
          {event.formulaText && (
            <pre>{event.formulaText}</pre>
          )}
        </>
      )}
    </div>
  );
};

export default StepExplanationPanel;
