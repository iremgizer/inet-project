import React from "react";
import { SimulationResult } from "../types/network";

interface MetricsPanelProps {
  result: SimulationResult | null;
}

const MetricsPanel: React.FC<MetricsPanelProps> = ({ result }) => {
  if (!result) return null;
  return (
    <div className="panel metrics-panel">
      <h3>Metrics</h3>
      <div className="metric-grid-compact">
        <div className="metric-cell">
          <span className="metric-label">Max utilization</span>
          <strong className={result.maxUtilization > 1 ? "text-danger" : result.maxUtilization > 0.7 ? "text-warning" : ""}>
            {(result.maxUtilization * 100).toFixed(0)}%
          </strong>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Congested links</span>
          <strong className={result.congestedLinkCount > 0 ? "text-danger" : ""}>
            {result.congestedLinkCount}
          </strong>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Traffic delivered</span>
          <strong>{result.totalDeliveredTraffic.toFixed(2)}</strong>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Avg path cost</span>
          <strong>{result.averagePathCost.toFixed(2)}</strong>
        </div>
        <div className="metric-cell">
          <span className="metric-label">Algorithm</span>
          <strong>{result.algorithm}</strong>
        </div>
      </div>
    </div>
  );
};

export default MetricsPanel;
