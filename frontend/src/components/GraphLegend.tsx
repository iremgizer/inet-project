import React, { useContext, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SimulationOverlayContext } from "./ReactFlowCanvas";
import { getPathColor } from "../utils/graphVisuals";

const SEVERITY_ROWS: { label: string; width: number; color: string }[] = [
  { label: "Normal (≤40%)",       width: 1.8, color: "#94a3b8" },
  { label: "Moderate (40–70%)",   width: 2.5, color: "#94a3b8" },
  { label: "High (70–90%)",       width: 3.5, color: "#f97316" },
  { label: "Very high (90–100%)", width: 5,   color: "#ef4444" },
  { label: "Congested (>100%)",   width: 6,   color: "#ef4444" },
];

const GraphLegend: React.FC = () => {
  const { isSimulated, pathResults, network } = useContext(SimulationOverlayContext);
  const [open, setOpen] = useState(true);

  if (!isSimulated || pathResults.length === 0) return null;

  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="graph-legend">
      <button className="graph-legend-toggle" onClick={() => setOpen((p) => !p)}>
        <span>Legend</span>
        {open ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
      </button>
      {open && (
        <>
          <div className="graph-legend-section">
            <div className="graph-legend-section-title">Paths</div>
            {pathResults.map((pr, i) => (
              <div key={pr.demandId} className="graph-legend-row">
                <div
                  className="graph-legend-swatch"
                  style={{ background: getPathColor(i) }}
                />
                <span>
                  {nodeLabel(pr.source)} → {nodeLabel(pr.target)}
                </span>
              </div>
            ))}
          </div>
          <div className="graph-legend-section">
            <div className="graph-legend-section-title">Utilization</div>
            {SEVERITY_ROWS.map((row) => (
              <div key={row.label} className="graph-legend-row">
                <div className="graph-legend-line-wrap">
                  <div
                    className="graph-legend-line"
                    style={{ height: Math.max(row.width, 1.5), background: row.color }}
                  />
                </div>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default GraphLegend;
