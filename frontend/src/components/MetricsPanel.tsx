import React from "react";
import { SimulationResult } from "../types/network";

interface MetricsPanelProps {
  result: SimulationResult | null;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({ result }) => {
  if (!result) {
    return (
      <div className="panel metrics-panel">
        <h3>Metrics</h3>
        <p>Run a simulation to see metrics here.</p>
      </div>
    );
  }
  return (
    <div className="panel metrics-panel">
      <h3>Metrics</h3>
      <div className="metric-grid">
        <div className="metric-card">
          <span>Max Utilization</span>
          <strong>{(result.maxUtilization * 100).toFixed(0)}%</strong>
        </div>
        <div className="metric-card">
          <span>Congested Links</span>
          <strong>{result.congestedLinkCount}</strong>
        </div>
        <div className="metric-card">
          <span>Total Delivered Traffic</span>
          <strong>{result.totalDeliveredTraffic.toFixed(2)}</strong>
        </div>
        <div className="metric-card">
          <span>Average Path Cost</span>
          <strong>{result.averagePathCost.toFixed(2)}</strong>
        </div>
        <div className="metric-card">
          <span>Runtime</span>
          <strong>{result.runtimeMs.toFixed(2)} ms</strong>
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
