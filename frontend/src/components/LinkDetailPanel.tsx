import React, { useState } from "react";
import { Trash2, ChevronDown, ChevronUp, PowerOff, Power } from "lucide-react";
import { LinkInput, SimulationResult } from "../types/network";
import TermHint from "./TermHint";
import {
  getLinkUsageSummary,
  utilizationColor,
  utilizationLabel,
} from "../utils/networkInspectors";
import type { NetworkInput } from "../types/network";
import { COMPARISON_STATUS_LABEL, LinkComparisonEntry } from "../utils/comparison";

interface LinkDetailPanelProps {
  link: LinkInput;
  network: NetworkInput;
  result: SimulationResult | null;
  onUpdate: (id: string, update: Partial<LinkInput>) => void;
  onDelete: (id: string) => void;
  /** Fail/restore this link (PR 5). Omitted entirely in contexts that don't
   * wire it up (e.g. read-only views) — the section below simply doesn't
   * render rather than calling something undefined. */
  onToggleOperationalStatus?: (id: string) => void;
  canEditLinks?: boolean;
  canEditWeights?: boolean;
  canEditCapacities?: boolean;
  /** Before/After comparison (PR 6, Part 2) — set only when a baseline
   * exists and differs from the current result. Undefined/null renders
   * nothing extra (no comparison available). */
  comparisonEntry?: LinkComparisonEntry | null;
}

const LinkDetailPanel: React.FC<LinkDetailPanelProps> = ({
  link,
  network,
  result,
  onUpdate,
  onDelete,
  onToggleOperationalStatus,
  canEditLinks = true,
  canEditWeights = true,
  canEditCapacities = true,
  comparisonEntry = null,
}) => {
  const [showFormula, setShowFormula] = useState(false);

  const lr = result?.linkResults.find((r) => r.linkId === link.id);
  const usages = getLinkUsageSummary(link.id, network, result);
  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;

  const uc = lr ? utilizationColor(lr.utilization) : null;
  const isDown = (link.operationalStatus ?? "UP") === "DOWN";

  return (
    <div className="detail-panel">
      {/* ── Header ── */}
      <div className="li-header">
        <div className="li-header-endpoints">
          <span className="li-endpoint-node">{nodeLabel(link.source)}</span>
          <span className="li-endpoint-arrow">&#8594;</span>
          <span className="li-endpoint-node">{nodeLabel(link.target)}</span>
        </div>
        <div className="li-header-meta">
          <span className="detail-id">{link.id}</span>
          {isDown && <span className="link-status-badge link-status-badge--down">Down</span>}
          {!isDown && lr && <span className={`link-status-badge link-status-badge--${uc}`}>
            {lr.isCongested ? "Congested" : utilizationLabel(lr.utilization)}
          </span>}
        </div>
        <button
          className="icon-btn danger"
          onClick={() => onDelete(link.id)}
          title={canEditLinks ? "Delete link" : "Locked by teacher"}
          aria-label="Delete link"
          disabled={!canEditLinks}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* ── Operational status (PR 5) ── */}
      {onToggleOperationalStatus && (
        <div className={`li-section li-opstatus${isDown ? " li-opstatus--down" : ""}`}>
          <div className="li-opstatus-row">
            <div className="li-opstatus-text">
              <div className="li-opstatus-label">
                {isDown ? "Link is down" : "Link is up"}
              </div>
              <div className="li-opstatus-hint">
                {isDown
                  ? "Excluded from routing. Same id, weight, and capacity — restore to make it eligible again."
                  : "Fail this link to simulate an outage and see traffic reroute around it."}
              </div>
            </div>
            <button
              className={`btn-secondary li-opstatus-btn${isDown ? " li-opstatus-btn--restore" : " li-opstatus-btn--fail"}`}
              onClick={() => onToggleOperationalStatus(link.id)}
              title={canEditLinks ? (isDown ? "Restore link" : "Fail link") : "Locked by teacher"}
              disabled={!canEditLinks}
            >
              {isDown ? <Power size={14} /> : <PowerOff size={14} />}
              {isDown ? "Restore link" : "Fail link"}
            </button>
          </div>
        </div>
      )}

      {/* ── Parameters ── */}
      <div className="li-section">
        <div className="detail-section-title" style={{ fontSize: ".8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)", marginBottom: 14 }}>Parameters</div>
        {(!canEditWeights || !canEditCapacities) && (
          <div className="locked-notice">
            <span className="locked-notice-icon">&#128274;</span>
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

      {/* ── Simulation result ── */}
      {!lr ? (
        <div className="li-section">
          <div className="li-presim-note">
            <div className="li-presim-title">Before simulation:</div>
            <ul>
              <li>Weight affects which paths the routing algorithm uses</li>
              <li>Capacity determines when this link becomes congested</li>
            </ul>
            <div className="li-presim-hint">Run a simulation to see load, utilization, and path membership.</div>
          </div>
        </div>
      ) : (
        <div className="li-section">
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

      {/* ── Before/After comparison (PR 6, Part 2) ── */}
      {comparisonEntry && (
        <div className="li-section li-comparison">
          <div className="detail-section-title">Before / After</div>
          <div className="li-comparison-grid">
            <div className="li-comparison-metric">
              <span className="li-comparison-metric-label">Utilization</span>
              <span className="li-comparison-metric-value">
                {(comparisonEntry.beforeUtilization * 100).toFixed(0)}% &rarr; {(comparisonEntry.afterUtilization * 100).toFixed(0)}%
              </span>
              <span className={`li-comparison-change ${
                comparisonEntry.utilizationDeltaPct > 0 ? "li-comparison-change--worse"
                : comparisonEntry.utilizationDeltaPct < 0 ? "li-comparison-change--better" : ""
              }`}>
                {comparisonEntry.utilizationDeltaPct > 0 ? "+" : ""}{comparisonEntry.utilizationDeltaPct.toFixed(0)} pp
              </span>
            </div>
            <div className="li-comparison-metric">
              <span className="li-comparison-metric-label">Load</span>
              <span className="li-comparison-metric-value">
                {comparisonEntry.beforeLoad.toFixed(2)} &rarr; {comparisonEntry.afterLoad.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="li-comparison-status-row">
            <span className="li-comparison-metric-label">Status</span>
            <span className={`li-comparison-status-badge li-comparison-status-badge--${comparisonEntry.status.toLowerCase()}`}>
              {COMPARISON_STATUS_LABEL[comparisonEntry.status]}
            </span>
          </div>
          {comparisonEntry.status === "DOWN" && (
            <div className="li-comparison-status-row">
              <span className="li-comparison-metric-label">Operational state</span>
              <span className="li-comparison-metric-value">UP &rarr; DOWN</span>
            </div>
          )}
        </div>
      )}

      {/* ── Demands using this link ── */}
      {usages.length > 0 && (
        <div className="li-section">
          <div className="li-section-title">
            Traffic using this link ({usages.length})
          </div>
          <div className="usage-list">
            {usages.map((u, i) => (
              <div key={i} className="usage-item">
                <div className="usage-route">
                  {nodeLabel(u.source)} &rarr; {nodeLabel(u.target)}
                </div>
                <div className="usage-share">{u.trafficShare.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkDetailPanel;
