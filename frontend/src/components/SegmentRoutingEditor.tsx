import React from "react";
import { ArrowUp, ArrowDown, X, MousePointerClick, Check } from "lucide-react";
import { NodeInput, SegmentRoutingPolicy, TrafficDemandInput } from "../types/network";
import TermHint from "./TermHint";

interface SegmentRoutingEditorProps {
  demands: TrafficDemandInput[];
  nodes: NodeInput[];
  policies: SegmentRoutingPolicy[];
  waypointSelectDemandId: string | null;
  onStartWaypointSelect: (demandId: string) => void;
  onStopWaypointSelect: () => void;
  onAddWaypoint: (demandId: string, nodeId: string) => void;
  onRemoveWaypoint: (demandId: string, index: number) => void;
  onMoveWaypoint: (demandId: string, index: number, direction: "up" | "down") => void;
}

const SegmentRoutingEditor: React.FC<SegmentRoutingEditorProps> = ({
  demands,
  nodes,
  policies,
  waypointSelectDemandId,
  onStartWaypointSelect,
  onStopWaypointSelect,
  onAddWaypoint,
  onRemoveWaypoint,
  onMoveWaypoint,
}) => {
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  if (demands.length === 0) {
    return (
      <div className="sr-editor-empty">
        Add a traffic demand first — waypoints are configured per demand.
      </div>
    );
  }

  return (
    <div className="sr-editor">
      <div className="sr-editor-heading">
        <span>Waypoints</span>
        <TermHint
          term="Waypoint"
          shortDefinition="A node traffic must pass through. Between waypoints (and from source to the first one, and the last one to the destination), routing still follows the normal shortest path."
          example="A → D with waypoint C routes A → shortest path to C → shortest path to D."
        />
      </div>

      {demands.map((demand) => {
        const policy = policies.find((p) => p.demandId === demand.id);
        const segments = policy?.segments ?? [];
        const isSelecting = waypointSelectDemandId === demand.id;
        const lastWaypoint = segments[segments.length - 1];
        const options = nodes.filter(
          (n) => n.id !== demand.source && n.id !== demand.target && n.id !== lastWaypoint
        );

        return (
          <div key={demand.id} className={`sr-demand-card${isSelecting ? " sr-demand-card--selecting" : ""}`}>
            <div className="sr-demand-header">
              <span className="sr-demand-route">
                {nodeLabel(demand.source)} <span className="sr-demand-arrow">→</span> {nodeLabel(demand.target)}
              </span>
              <span className="sr-demand-amount">{demand.amount} units</span>
            </div>

            <div className="sr-chip-chain">
              <span className="sr-chip sr-chip--endpoint" title="Source (fixed)">
                {nodeLabel(demand.source)}
              </span>
              {segments.map((segId, i) => (
                <React.Fragment key={`${segId}-${i}`}>
                  <span className="sr-chip-connector">→</span>
                  <span className="sr-chip sr-chip--waypoint">
                    {nodeLabel(segId)}
                    <span className="sr-chip-controls">
                      <button
                        className="sr-chip-btn"
                        onClick={() => onMoveWaypoint(demand.id, i, "up")}
                        disabled={i === 0}
                        title="Move earlier"
                        aria-label="Move waypoint earlier"
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        className="sr-chip-btn"
                        onClick={() => onMoveWaypoint(demand.id, i, "down")}
                        disabled={i === segments.length - 1}
                        title="Move later"
                        aria-label="Move waypoint later"
                      >
                        <ArrowDown size={10} />
                      </button>
                      <button
                        className="sr-chip-btn sr-chip-btn--danger"
                        onClick={() => onRemoveWaypoint(demand.id, i)}
                        title="Remove waypoint"
                        aria-label="Remove waypoint"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  </span>
                </React.Fragment>
              ))}
              <span className="sr-chip-connector">→</span>
              <span className="sr-chip sr-chip--endpoint" title="Destination (fixed)">
                {nodeLabel(demand.target)}
              </span>
            </div>

            {segments.length === 0 && (
              <p className="sr-empty-hint">No waypoints — routes via plain shortest path.</p>
            )}

            <div className="sr-demand-actions">
              <button
                className={`sr-add-waypoint-btn${isSelecting ? " sr-add-waypoint-btn--active" : ""}`}
                onClick={() => (isSelecting ? onStopWaypointSelect() : onStartWaypointSelect(demand.id))}
              >
                {isSelecting ? (
                  <>
                    <Check size={13} /> Done selecting
                  </>
                ) : (
                  <>
                    <MousePointerClick size={13} /> Add waypoint on graph
                  </>
                )}
              </button>

              <select
                className="sr-select-fallback"
                value=""
                onChange={(e) => {
                  if (e.target.value) onAddWaypoint(demand.id, e.target.value);
                }}
                aria-label={`Add waypoint for ${nodeLabel(demand.source)} to ${nodeLabel(demand.target)}`}
              >
                <option value="">+ Add from list…</option>
                {options.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>

            {isSelecting && (
              <p className="sr-selecting-hint">Click nodes on the graph, in order · Esc to stop</p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SegmentRoutingEditor;
