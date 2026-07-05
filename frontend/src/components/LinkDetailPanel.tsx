import React, { useState } from "react";
import { Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { LinkInput, SimulationResult } from "../types/network";
import TermHint from "./TermHint";
import {
  getLinkUsageSummary,
  utilizationColor,
  utilizationLabel,
} from "../utils/networkInspectors";
import type { NetworkInput } from "../types/network";

interface LinkDetailPanelProps {
  link: LinkInput;
  network: NetworkInput;
  result: SimulationResult | null;
  onUpdate: (id: string, update: Partial<LinkInput>) => void;
  onDelete: (id: string) => void;
  canEditLinks?: boolean;
  canEditWeights?: boolean;
  canEditCapacities?: boolean;
}

const LinkDetailPanel: React.FC<LinkDetailPanelProps> = ({
  link,
  network,
  result,
  onUpdate,
  onDelete,
  canEditLinks = true,
  canEditWeights = true,
  canEditCapacities = true,
}) => {
  const [showFormula, setShowFormula] = useState(false);

  const lr = result?.linkResults.find((r) => r.linkId === link.id);
  const usages = getLinkUsageSummary(link.id, network, result);
  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;

  const uc = lr ? utilizationColor(lr.utilization) : null;

  return (
    <div className="detail-panel">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <span className="detail-type-tag">Link</span>
          <div className="detail-endpoint">
            <span className="detail-endpoint-node">{nodeLabel(link.source)}</span>
            <span className="detail-endpoint-arrow">→</span>
            <span className="detail-endpoint-node">{nodeLabel(link.target)}</span>
          </div>
        </div>
        <button
          className="icon-btn danger"
          onClick={() => onDelete(link.id)}
          title={canEditLinks ? "Delete link" : "Locked by teacher"}
          aria-label="Delete link"
          disabled={!canEditLinks}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Simulation status badge */}
      {lr && (
        <div className={`link-status-badge link-status-badge--${uc}`}>
          {lr.isCongested ? "⚠ Congested" : utilizationLabel(lr.utilization)}
        </div>
      )}

      {/* Parameters */}
      <div className="detail-section">
        <div className="detail-section-title">Parameters</div>
        {(!canEditWeights || !canEditCapacities) && (
          <div className="locked-notice">
            <span className="locked-notice-icon">🔒</span>
            {!canEditWeights && !canEditCapacities
              ? "Weights and capacities locked by teacher"
              : !canEditWeights
              ? "Weight locked by teacher"
              : "Capacity locked by teacher"}
          </div>
        )}
        <div className="param-grid">
          <label className="field">
            <span className="field-label-row">
              Weight
              <TermHint
                term="Weight"
                shortDefinition="Routing cost. Lower weight = algorithm prefers this link for shortest paths."
                example="A link with weight 1 is used before a link with weight 2."
              />
            </span>
            <input
              className="number-input"
              type="number"
              min="0"
              step="0.1"
              value={link.weight}
              onChange={(e) => onUpdate(link.id, { weight: Number(e.target.value) })}
              disabled={!canEditWeights}
            />
          </label>
          <label className="field">
            <span className="field-label-row">
              Capacity
              <TermHint
                term="Capacity"
                shortDefinition="Maximum traffic this link can carry before becoming congested."
                formula="congested if load > capacity"
              />
            </span>
            <input
              className="number-input"
              type="number"
              min="0.1"
              step="0.1"
              value={link.capacity}
              onChange={(e) => onUpdate(link.id, { capacity: Number(e.target.value) })}
              disabled={!canEditCapacities}
            />
          </label>
        </div>
      </div>

      {/* Simulation result */}
      {lr && (
        <div className="detail-section">
          <div className="detail-section-title">
            Simulation result
            <TermHint
              term="Utilization"
              shortDefinition="Fraction of capacity currently used. 1.0 = 100% = congestion threshold."
              formula="utilization = load / capacity"
            />
          </div>

          {/* Utilization bar */}
          <div className="util-bar-track">
            <div
              className={`util-bar-fill util-bar-fill--${uc}`}
              style={{ width: `${Math.min(100, (lr.utilization * 100))}%` }}
            />
          </div>
          <div className="util-row">
            <span className={`util-pct util-pct--${uc}`}>
              {(lr.utilization * 100).toFixed(1)}%
            </span>
            <span className="util-detail">
              {lr.load.toFixed(2)} / {lr.capacity}
            </span>
            {lr.isCongested && <span className="badge badge--danger">Congested</span>}
          </div>

          {/* Formula toggle */}
          <button className="collapse-toggle" onClick={() => setShowFormula((p) => !p)}>
            {showFormula ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showFormula ? "Hide" : "Show"} formula
          </button>
          {showFormula && (
            <pre className="formula-block">
              {`util = load / capacity\n     = ${lr.load.toFixed(2)} / ${lr.capacity}\n     = ${lr.utilization.toFixed(4)}`}
            </pre>
          )}
        </div>
      )}

      {/* Demands using this link */}
      {usages.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">
            Traffic using this link ({usages.length})
          </div>
          <div className="usage-list">
            {usages.map((u, i) => (
              <div key={i} className="usage-item">
                <div className="usage-route">
                  {nodeLabel(u.source)} → {nodeLabel(u.target)}
                </div>
                <div className="usage-share">{u.trafficShare.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!lr && (
        <div className="detail-section">
          <p className="muted" style={{ fontSize: "0.78rem" }}>
            Run a simulation to see load and utilization.
          </p>
        </div>
      )}
    </div>
  );
};

export default LinkDetailPanel;
