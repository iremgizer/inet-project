import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DistanceVectorTableEntry } from "../types/network";

interface RoutingTablePanelProps {
  entries?: DistanceVectorTableEntry[];
}

const RoutingTablePanel: React.FC<RoutingTablePanelProps> = ({ entries }) => {
  const [open, setOpen] = useState(false);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="panel routing-panel">
      <button className="panel-toggle" onClick={() => setOpen((p) => !p)}>
        <span>Routing table</span>
        <span className="panel-toggle-meta">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {entries.length} entries
        </span>
      </button>
      {open && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Destination</th>
                  <th>Cost</th>
                  <th>Next hop</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={`${e.nodeId}-${e.destinationId}-${i}`}>
                    <td>{e.nodeId}</td>
                    <td>{e.destinationId}</td>
                    <td>{e.cost >= 0 ? e.cost.toFixed(1) : "∞"}</td>
                    <td>{e.nextHop ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default RoutingTablePanel;
