import React from "react";
import { Check } from "lucide-react";
import { NetworkInput } from "../types/network";
import { SRDisplayState, classifySegmentStopProgress } from "../utils/segmentRoutingTrace";
import TermHint from "./TermHint";

interface SegmentListPanelProps {
  srState: SRDisplayState;
  network: NetworkInput;
}

const SegmentListPanel: React.FC<SegmentListPanelProps> = ({ srState, network }) => {
  const demand = network.demands.find((d) => d.id === srState.demandId);
  if (!demand) return null;

  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="panel sr-segment-panel">
      <div className="sr-segment-panel-header">
        <span className="sr-segment-panel-title">Segment Routing</span>
        <TermHint
          term="Node SID"
          shortDefinition="A segment instruction telling traffic to reach this node."
          example="Segment list [C, E] means: reach SID C, then reach SID E, then the destination."
        />
      </div>
      <div className="sr-segment-panel-demand">
        {nodeLabel(demand.source)} <span className="sr-chip-connector">→</span> {nodeLabel(demand.target)}
      </div>

      <div className="sr-segment-track">
        <div className="sr-segment-stop sr-segment-stop--source">
          <span className="sr-segment-dot sr-segment-dot--done">
            <Check size={9} />
          </span>
          <span className="sr-segment-stop-label">{nodeLabel(demand.source)}</span>
        </div>

        {srState.segmentList.map((nodeId, i) => {
          const progress = classifySegmentStopProgress(i, srState.activeSegmentIndex, srState.isResolved);
          const isDestination = i === srState.segmentList.length - 1;
          return (
            <div
              key={`${nodeId}-${i}`}
              className={`sr-segment-stop sr-segment-stop--${progress}${isDestination ? " sr-segment-stop--destination" : ""}`}
            >
              <span className={`sr-segment-dot sr-segment-dot--${progress === "completed" ? "done" : progress}`}>
                {progress === "completed" ? <Check size={9} /> : null}
              </span>
              <span className="sr-segment-stop-label">
                {nodeLabel(nodeId)}
                {!isDestination && <span className="sr-segment-sid-label">SID</span>}
              </span>
              {progress === "active" && <span className="sr-segment-status-badge">ACTIVE</span>}
              {progress === "next" && <span className="sr-segment-status-badge sr-segment-status-badge--next">NEXT</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SegmentListPanel;
