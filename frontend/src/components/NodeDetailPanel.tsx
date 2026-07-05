import React, { useState } from "react";
import { Trash2, ChevronDown, ChevronUp, ArrowRight, ArrowLeft, Shuffle, Link2, Maximize2, PlusCircle } from "lucide-react";
import { NodeInput, SimulationResult } from "../types/network";
import TermHint from "./TermHint";
import {
  getNodeNeighbors,
  getNodeConnectedLinks,
  getNodeDemandRoles,
  getNodeSimulationRoles,
  getNodeTrafficSummary,
  getConnectedCongestedLinks,
  utilizationColor,
} from "../utils/networkInspectors";
import type { NetworkInput } from "../types/network";

interface NodeDetailPanelProps {
  node: NodeInput;
  network: NetworkInput;
  result: SimulationResult | null;
  onUpdate: (id: string, update: Partial<NodeInput>) => void;
  onDelete: (id: string) => void;
  onStartConnect?: (id: string) => void;
  onAddDemandFrom?: (id: string) => void;
  onCenterNode?: (id: string) => void;
  canEditNodes?: boolean;
}

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({
  node,
  network,
  result,
  onUpdate,
  onDelete,
  onStartConnect,
  onAddDemandFrom,
  onCenterNode,
  canEditNodes = true,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const neighbors      = getNodeNeighbors(node.id, network);
  const connLinks      = getNodeConnectedLinks(node.id, network);
  const demandRoles    = getNodeDemandRoles(node.id, network);
  const simRoles       = getNodeSimulationRoles(node.id, result);
  const traffic        = getNodeTrafficSummary(node.id, network, result);
  const congestedLinks = getConnectedCongestedLinks(node.id, network, result);

  const isSimulated = !!result;

  return (
    <div className="detail-panel">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <span className="detail-type-tag">Node</span>
          <div className="detail-name">{node.label}</div>
          <div className="detail-id">{node.id}</div>
        </div>
        <button
          className="icon-btn danger"
          onClick={() => onDelete(node.id)}
          title={canEditNodes ? "Delete node" : "Locked by teacher"}
          aria-label="Delete node"
          disabled={!canEditNodes}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Label edit */}
      <div className="detail-section">
        {!canEditNodes && (
          <div className="locked-notice">
            <span className="locked-notice-icon">🔒</span> Locked by teacher
          </div>
        )}
        <label className="field">
          <span>Label</span>
          <input
            className="text-input"
            value={node.label}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            aria-label="Node label"
            disabled={!canEditNodes}
          />
        </label>
      </div>

      {/* Simulation status */}
      {isSimulated && simRoles && (
        <div className="detail-section">
          <div className="detail-section-title">
            Simulation role
            <TermHint
              term="Routing role"
              shortDefinition="The function this node served during routing — source of traffic, final destination, or intermediate relay."
            />
          </div>
          <div className="role-chips">
            {simRoles.asSourceFor.length > 0 && (
              <span className="role-chip role-chip--src">
                <ArrowRight size={10} /> Source
              </span>
            )}
            {simRoles.asDestinationFor.length > 0 && (
              <span className="role-chip role-chip--dst">
                <ArrowLeft size={10} /> Destination
              </span>
            )}
            {simRoles.asIntermediateFor.length > 0 && (
              <span className="role-chip role-chip--mid">
                <Shuffle size={10} /> Relay
              </span>
            )}
            {simRoles.asSourceFor.length === 0 &&
              simRoles.asDestinationFor.length === 0 &&
              simRoles.asIntermediateFor.length === 0 && (
                <span className="muted" style={{ fontSize: "0.78rem" }}>No traffic passed through</span>
              )}
          </div>
        </div>
      )}

      {/* Traffic summary */}
      {isSimulated && (
        <div className="detail-section">
          <div className="detail-section-title">
            Traffic
            <TermHint
              term="Traffic flow"
              shortDefinition="How much routed traffic enters and leaves this node during simulation."
            />
          </div>
          <div className="traffic-summary">
            <div className="traffic-stat">
              <span className="traffic-stat-label">Out</span>
              <span className="traffic-stat-value">{traffic.outgoingLoad}</span>
            </div>
            <div className="traffic-stat">
              <span className="traffic-stat-label">In</span>
              <span className="traffic-stat-value">{traffic.incomingLoad}</span>
            </div>
          </div>
          {congestedLinks.length > 0 && (
            <div className="detail-warning">
              <AlertIcon />
              {congestedLinks.length} connected link{congestedLinks.length > 1 ? "s" : ""} congested
            </div>
          )}
        </div>
      )}

      {/* Neighbors */}
      {neighbors.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Neighbors ({neighbors.length})
            <TermHint
              term="Neighbors"
              shortDefinition="Directly connected nodes this node can forward traffic to."
            />
          </div>
          <div className="neighbor-list">
            {neighbors.map(({ node: nb, link }) => {
              const lr = result?.linkResults.find((r) => r.linkId === link.id);
              const uc = lr ? utilizationColor(lr.utilization) : "safe";
              return (
                <div key={nb.id} className="neighbor-item">
                  <div className="neighbor-node">
                    <span className="neighbor-badge">{nb.label}</span>
                    <span className="neighbor-weight">w={link.weight}</span>
                  </div>
                  {lr && (
                    <div className={`neighbor-util neighbor-util--${uc}`}>
                      {(lr.utilization * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Demands */}
      {demandRoles.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Traffic demands</div>
          <div className="demand-roles">
            {demandRoles.map(({ demand, role, otherLabel }) => (
              <div key={demand.id} className="demand-role-item">
                <span className={`demand-role-badge demand-role-badge--${role}`}>
                  {role === "source" ? "→" : "←"}
                </span>
                <span className="demand-role-label">
                  {role === "source" ? "To" : "From"}{" "}
                  <strong>{otherLabel}</strong>
                </span>
                <span className="demand-role-amount">{demand.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="detail-section">
        <div className="detail-section-title">Quick actions</div>
        <div className="quick-actions">
          {onStartConnect && (
            <button
              className="quick-action-btn"
              onClick={() => onStartConnect(node.id)}
              title="Click another node to create a link"
            >
              <Link2 size={13} />
              Connect from here
            </button>
          )}
          {onAddDemandFrom && (
            <button
              className="quick-action-btn"
              onClick={() => onAddDemandFrom(node.id)}
              title="Go to Traffic stage with this node as source"
            >
              <PlusCircle size={13} />
              Add demand from here
            </button>
          )}
          {onCenterNode && (
            <button
              className="quick-action-btn"
              onClick={() => onCenterNode(node.id)}
              title="Center canvas on this node"
            >
              <Maximize2 size={13} />
              Center on canvas
            </button>
          )}
        </div>
      </div>

      {/* Advanced */}
      <div className="detail-section">
        <button className="collapse-toggle" onClick={() => setShowAdvanced((p) => !p)}>
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Advanced
        </button>
        {showAdvanced && (
          <div className="advanced-grid">
            <span className="advanced-key">ID</span>
            <span className="advanced-val">{node.id}</span>
            <span className="advanced-key">X</span>
            <span className="advanced-val">{Math.round(node.x)}</span>
            <span className="advanced-key">Y</span>
            <span className="advanced-val">{Math.round(node.y)}</span>
            <span className="advanced-key">Links</span>
            <span className="advanced-val">{connLinks.length}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const AlertIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export default NodeDetailPanel;
