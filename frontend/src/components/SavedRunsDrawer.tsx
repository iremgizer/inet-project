import React, { useState } from "react";
import { X, RefreshCw, Upload, Trash2, Search, Zap, Activity, Clock } from "lucide-react";
import { SavedSimulationSummary } from "../types/network";

interface SavedRunsDrawerProps {
  open: boolean;
  runs: SavedSimulationSummary[];
  onClose: () => void;
  onRefresh: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

const SavedRunsDrawer: React.FC<SavedRunsDrawerProps> = ({
  open,
  runs,
  onClose,
  onRefresh,
  onLoad,
  onDelete,
}) => {
  const [query, setQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const filtered = runs.filter(
    (r) =>
      !query ||
      r.algorithm.toLowerCase().includes(query.toLowerCase()) ||
      r.topologyType.toLowerCase().includes(query.toLowerCase())
  );

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      onDelete(id);
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div className="drawer" role="dialog" aria-label="Saved runs" aria-modal="true">
        <div className="drawer-header">
          <div className="drawer-title">
            <Clock size={15} />
            Saved runs
          </div>
          <div className="drawer-header-actions">
            <button className="icon-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh saved runs">
              <RefreshCw size={13} />
            </button>
            <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close drawer">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="drawer-search">
          <Search size={13} className="drawer-search-icon" />
          <input
            className="drawer-search-input"
            placeholder="Filter by algorithm or topology…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search saved runs"
          />
        </div>

        {/* Content */}
        <div className="drawer-body">
          {runs.length === 0 ? (
            <div className="drawer-empty">
              <Clock size={24} />
              <p>No saved runs yet.</p>
              <span>MongoDB must be running to persist simulations.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="drawer-empty">
              <Search size={20} />
              <p>No runs match "{query}"</p>
            </div>
          ) : (
            <ul className="runs-list">
              {filtered.map((run) => {
                const hasCongestion = run.congestedLinkCount > 0;
                const util = run.maxUtilization;
                const isDeleteConfirm = deleteConfirm === run.simulationRunId;

                return (
                  <li key={run.simulationRunId} className="run-card">
                    <div className="run-card-body">
                      <div className="run-card-top">
                        <div className="run-algo">
                          <Zap size={12} />
                          <strong>{run.algorithm}</strong>
                        </div>
                        <div className={`run-util ${hasCongestion ? "run-util--danger" : util > 0.7 ? "run-util--warn" : "run-util--ok"}`}>
                          <Activity size={11} />
                          {(util * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div className="run-card-meta">
                        {run.topologyType} · {run.nodeCount}N · {run.linkCount}L · {run.demandCount} demand{run.demandCount !== 1 ? "s" : ""}
                        {hasCongestion && (
                          <span className="run-congestion-badge">
                            {run.congestedLinkCount} congested
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="run-card-actions">
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => { onLoad(run.simulationRunId); onClose(); }}
                        title="Load this run"
                        aria-label={`Load ${run.algorithm} ${run.topologyType} run`}
                      >
                        <Upload size={12} /> Load
                      </button>
                      <button
                        className={`icon-btn ${isDeleteConfirm ? "danger" : ""}`}
                        onClick={() => handleDelete(run.simulationRunId)}
                        title={isDeleteConfirm ? "Click again to confirm delete" : "Delete"}
                        aria-label={isDeleteConfirm ? "Confirm delete" : "Delete run"}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="drawer-footer">
          <span className="muted">{runs.length} total · {filtered.length} shown</span>
        </div>
      </div>
    </>
  );
};

export default SavedRunsDrawer;
