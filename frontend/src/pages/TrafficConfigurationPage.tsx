import React, { useEffect, useState } from "react";
import { Plus, Trash2, Waypoints } from "lucide-react";
import { NodeInput, TrafficDemandInput } from "../types/network";

interface TrafficConfigurationPageProps {
  nodes: NodeInput[];
  demands: TrafficDemandInput[];
  onAddDemand: (demand: Omit<TrafficDemandInput, "id">) => void;
  onDeleteDemand: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  initialSource?: string | null;
  onConsumeInitialSource?: () => void;
  canEditDemands?: boolean;
}

const TrafficConfigurationPage: React.FC<TrafficConfigurationPageProps> = ({
  nodes,
  demands,
  onAddDemand,
  onDeleteDemand,
  onBack,
  onNext,
  initialSource,
  onConsumeInitialSource,
  canEditDemands = true,
}) => {
  const [source, setSource] = useState(initialSource ?? "");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState(1);

  useEffect(() => {
    if (initialSource) {
      setSource(initialSource);
      onConsumeInitialSource?.();
    }
  }, [initialSource, onConsumeInitialSource]);

  const canAdd = source && target && source !== target && amount > 0;

  const add = () => {
    if (!canAdd) return;
    onAddDemand({ source, target, amount });
    setSource("");
    setTarget("");
    setAmount(1);
  };

  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="page">
      <div className="stage-kicker">
        <Waypoints size={13} />
        Traffic
      </div>
      <h2 className="page-title">Define traffic flows</h2>
      <p className="page-subtitle">
        Add demands — each one describes traffic that must travel from one node to another.
      </p>

      {!canEditDemands && (
        <div className="locked-notice">
          <span className="locked-notice-icon">🔒</span> Traffic demands are locked by teacher
        </div>
      )}

      {/* Add demand form */}
      <div className="form-card">
        <div className="form-row">
          <label className="field">
            <span>From</span>
            <select className="select-input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Node…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select className="select-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Node…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Amount</span>
            <input
              className="number-input"
              type="number"
              min="0.1"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          className="btn-primary btn-sm"
          onClick={add}
          disabled={!canAdd || nodes.length < 2 || !canEditDemands}
        >
          <Plus size={14} /> Add demand
        </button>
      </div>

      {/* Demand list */}
      {demands.length === 0 ? (
        <div className="empty-state">
          No demands yet.
        </div>
      ) : (
        <>
          <div className="section-label">{demands.length} demand{demands.length !== 1 ? "s" : ""}</div>
          <ul className="demand-list">
            {demands.map((d) => (
              <li key={d.id} className="demand-item">
                <div className="demand-route">
                  <span className="demand-node">{nodeLabel(d.source)}</span>
                  <span className="demand-arrow">→</span>
                  <span className="demand-node">{nodeLabel(d.target)}</span>
                </div>
                <span className="demand-amount">{d.amount}</span>
                <button
                  className="icon-btn danger"
                  onClick={() => onDeleteDemand(d.id)}
                  title={canEditDemands ? "Delete demand" : "Locked by teacher"}
                  disabled={!canEditDemands}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="page-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={demands.length === 0}>
          Next: Algorithm →
        </button>
      </div>
    </div>
  );
};

export default TrafficConfigurationPage;
