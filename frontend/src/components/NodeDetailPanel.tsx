import React, { useState } from "react";
import { Trash2, Link2, Maximize2, PlusCircle, ArrowRight, ArrowLeft, Shuffle } from "lucide-react";
import { NodeInput, LinkInput, SimulationResult } from "../types/network";
import TermHint from "./TermHint";
import {
  getNodeConnectedLinks,
  getNodeDemandRoles,
  getNodeSimulationRoles,
  getConnectedCongestedLinks,
  utilizationColor,
} from "../utils/networkInspectors";
import type { NetworkInput } from "../types/network";

interface NodeDetailPanelProps {
  node: NodeInput;
  network: NetworkInput;
  result: SimulationResult | null;
  canEditNodes?: boolean;
  canEditWeights?: boolean;
  canEditCapacities?: boolean;
  onUpdate: (id: string, update: Partial<NodeInput>) => void;
  onDelete: (id: string) => void;
  onStartConnect?: (id: string) => void;
  onAddDemandFrom?: (id: string) => void;
  onCenterNode?: (id: string) => void;
  onSelectLink?: (linkId: string) => void;
  onUpdateLink?: (id: string, update: Partial<LinkInput>) => void;
  onDeleteLink?: (id: string) => void;
}

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({
  node,
  network,
  result,
  canEditNodes = true,
  canEditWeights = true,
  canEditCapacities = true,
  onUpdate,
  onDelete,
  onStartConnect,
  onAddDemandFrom,
  onCenterNode,
  onSelectLink,
  onUpdateLink,
  onDeleteLink,
}) => {
  const [labelDraft, setLabelDraft] = useState(node.label);

  // Sync draft when node changes
  React.useEffect(() => { setLabelDraft(node.label); }, [node.id, node.label]);

  const connLinks = getNodeConnectedLinks(node.id, network);
  const demandRoles = getNodeDemandRoles(node.id, network);
  const simRoles = getNodeSimulationRoles(node.id, result);
  const congestedLinks = getConnectedCongestedLinks(node.id, network, result);
  const degree = connLinks.length;

  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="detail-panel">
      {/* ── Header ── */}
      <div className="ni-header">
        <div className="ni-header-left">
          <span className="ni-label">{node.label}</span>
          <span className="ni-id">{node.id}</span>
          <div className="ni-header-chips">
            <span className="ni-degree-chip">{degree} link{degree !== 1 ? "s" : ""}</span>
            {simRoles && simRoles.asSourceFor.length > 0 && (
              <span className="ni-role-chip ni-role-chip--src"><ArrowRight size={9} /> Source</span>
            )}
            {simRoles && simRoles.asDestinationFor.length > 0 && (
              <span className="ni-role-chip ni-role-chip--dst"><ArrowLeft size={9} /> Destination</span>
            )}
            {simRoles && simRoles.asIntermediateFor.length > 0 && (
              <span className="ni-role-chip ni-role-chip--mid"><Shuffle size={9} /> Relay</span>
            )}
            {congestedLinks.length > 0 && (
              <span className="ni-role-chip ni-role-chip--warn">&#9888; {congestedLinks.length} congested</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Label edit ── */}
      <div className="ni-section">
        {!canEditNodes && (
          <div className="locked-notice">
            <span className="locked-notice-icon">&#128274;</span> Locked by teacher
          </div>
        )}
        <label className="field">
          <span>Label</span>
          <input
            className="text-input"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => { if (labelDraft !== node.label) onUpdate(node.id, { label: labelDraft }); }}
            onKeyDown={(e) => { if (e.key === "Enter") onUpdate(node.id, { label: labelDraft }); }}
            aria-label="Node label"
            disabled={!canEditNodes}
          />
        </label>
      </div>

      {/* ── Connected Links ── */}
      <div className="ni-section">
        <div className="ni-section-title">
          Connected Links ({connLinks.length})
          <TermHint
            term="Link"
            shortDefinition="A connection between two nodes. Weight affects routing preference; capacity limits traffic before congestion."
          />
        </div>
        {connLinks.length === 0 ? (
          <p className="ni-muted">No links &mdash; draw a connection from this node.</p>
        ) : (
          <>
            {connLinks.map((link) => {
              const isSource = link.source === node.id;
              const neighborId = isSource ? link.target : link.source;
              const neighborLabel = nodeLabel(neighborId);
              const lr = result?.linkResults.find((r) => r.linkId === link.id);
              const uc = lr ? utilizationColor(lr.utilization) : null;
              return (
                <div
                  key={link.id}
                  className={`ni-link-row${onSelectLink ? " ni-link-row--clickable" : ""}`}
                  onClick={() => onSelectLink?.(link.id)}
                  role={onSelectLink ? "button" : undefined}
                  tabIndex={onSelectLink ? 0 : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelectLink?.(link.id); }}
                >
                  <div className="ni-link-row-neighbor">
                    <span className="ni-link-arrow">{isSource ? "→" : "←"}</span>
                    <span className="ni-neighbor-label">{neighborLabel}</span>
                    <span className="ni-link-id">{link.id}</span>
                  </div>
                  <div className="ni-link-row-inputs" onClick={(e) => e.stopPropagation()}>
                    <label className="ni-inline-field">
                      <span>w</span>
                      <input
                        type="number"
                        className="ni-num-input"
                        value={link.weight}
                        min={0}
                        step={0.1}
                        disabled={!canEditWeights || !onUpdateLink}
                        onChange={(e) => onUpdateLink?.(link.id, { weight: Number(e.target.value) })}
                        title="Weight"
                      />
                    </label>
                    <label className="ni-inline-field">
                      <span>cap</span>
                      <input
                        type="number"
                        className="ni-num-input"
                        value={link.capacity}
                        min={0.1}
                        step={0.1}
                        disabled={!canEditCapacities || !onUpdateLink}
                        onChange={(e) => onUpdateLink?.(link.id, { capacity: Number(e.target.value) })}
                        title="Capacity"
                      />
                    </label>
                    {onDeleteLink && (
                      <button
                        className="ni-link-delete"
                        onClick={(e) => { e.stopPropagation(); onDeleteLink(link.id); }}
                        disabled={!canEditNodes}
                        title="Delete link"
                        aria-label="Delete link"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  {lr && uc && (
                    <div className="ni-link-util" onClick={(e) => e.stopPropagation()}>
                      <div className="ni-util-mini-track">
                        <div
                          className={`ni-util-mini-fill ni-util-mini-fill--${uc}`}
                          style={{ width: `${Math.min(100, lr.utilization * 100)}%` }}
                        />
                      </div>
                      <span className={`ni-util-pct ni-util-pct--${uc}`}>
                        {(lr.utilization * 100).toFixed(0)}%
                      </span>
                      {lr.isCongested && <span className="badge badge--danger" style={{ fontSize: "0.7rem", padding: "1px 4px" }}>!</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {!result && (
              <p className="ni-muted ni-muted--small">Run a simulation to see load and utilization on each link.</p>
            )}
          </>
        )}
      </div>

      {/* ── Traffic Demands ── */}
      {demandRoles.length > 0 && (
        <div className="ni-section">
          <div className="ni-section-title">Traffic Demands</div>
          <div className="demand-roles">
            {demandRoles.map(({ demand, role, otherLabel }) => (
              <div key={demand.id} className="demand-role-item">
                <span className={`demand-role-badge demand-role-badge--${role}`}>
                  {role === "source" ? "→" : "←"}
                </span>
                <span className="demand-role-label">
                  {role === "source" ? "To" : "From"} <strong>{otherLabel}</strong>
                </span>
                <span className="demand-role-amount">{demand.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="ni-actions">
        {onStartConnect && (
          <button
            className="ni-action-btn"
            onClick={() => onStartConnect(node.id)}
            title="Click another node to create a link"
          >
            <Link2 size={13} /> Connect from here
          </button>
        )}
        {onAddDemandFrom && (
          <button
            className="ni-action-btn"
            onClick={() => onAddDemandFrom(node.id)}
            title="Go to Traffic stage with this node as source"
          >
            <PlusCircle size={13} /> Add traffic from here
          </button>
        )}
        {onCenterNode && (
          <button
            className="ni-action-btn"
            onClick={() => onCenterNode(node.id)}
            title="Center canvas on this node"
          >
            <Maximize2 size={13} /> Center on canvas
          </button>
        )}
        <button
          className="ni-action-btn ni-action-btn--danger"
          onClick={() => onDelete(node.id)}
          disabled={!canEditNodes}
          title={canEditNodes ? "Delete node" : "Locked by teacher"}
        >
          <Trash2 size={13} /> Delete node
        </button>
      </div>
    </div>
  );
};

export default NodeDetailPanel;
