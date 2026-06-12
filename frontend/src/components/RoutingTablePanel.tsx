import React from "react";
import { DistanceVectorTableEntry } from "../types/network";

interface RoutingTablePanelProps {
  entries?: DistanceVectorTableEntry[];
}

const RoutingTablePanel: React.FC<RoutingTablePanelProps> = ({ entries }) => {
  if (!entries || entries.length === 0) {
    return (
      <div className="panel routing-table-panel">
        <h3>Routing Table</h3>
        <p>Distance Vector cost/next-hop table will appear here.</p>
      </div>
    );
  }

  return (
    <div className="panel routing-table-panel">
      <h3>Routing Table</h3>
      {entries.length > 200 && (
        <p className="placeholder-note">Large routing table detected. Future versions should use table virtualization.</p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Node</th>
              <th>Destination</th>
              <th>Cost</th>
              <th>Next Hop</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={`${entry.nodeId}-${entry.destinationId}-${index}`}>
                <td>{entry.nodeId}</td>
                <td>{entry.destinationId}</td>
                <td>{entry.cost >= 0 ? entry.cost.toFixed(1) : "∞"}</td>
                <td>{entry.nextHop || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RoutingTablePanel;
