import React, { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Search, X, Maximize2 } from "lucide-react";
import { DistanceVectorTableEntry, NetworkInput } from "../types/network";

interface RoutingTablePanelProps {
  entries?: DistanceVectorTableEntry[];
  network?: NetworkInput;
  activeRowKeys?: string[];       // format "nodeId::destinationId"
  showModal?: boolean;
  onOpenModal?: () => void;
  onCloseModal?: () => void;
}

// ── Shared controls (search + filter) ────────────────────────────────────────

interface ControlsProps {
  search: string;
  onSearch: (v: string) => void;
  nodeFilter: string;
  onNodeFilter: (v: string) => void;
  uniqueNodes: string[];
  nodeLabel: (id: string) => string;
  relevantOnly: boolean;
  onRelevantOnly: (v: boolean) => void;
  hasActive: boolean;
}

const Controls: React.FC<ControlsProps> = ({
  search, onSearch, nodeFilter, onNodeFilter, uniqueNodes, nodeLabel,
  relevantOnly, onRelevantOnly, hasActive,
}) => (
  <div className="routing-panel-controls">
    <div className="routing-search-wrap">
      <Search size={13} className="routing-search-icon" />
      <input
        className="routing-search-input"
        placeholder="Search node, dest, hop…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        aria-label="Search routing table"
      />
      {search && (
        <button className="routing-search-clear" onClick={() => onSearch("")} aria-label="Clear search">
          <X size={11} />
        </button>
      )}
    </div>
    <div className="routing-filter-row">
      <select
        className="routing-node-filter"
        value={nodeFilter}
        onChange={(e) => onNodeFilter(e.target.value)}
        aria-label="Filter by node"
      >
        <option value="__all__">All nodes</option>
        {uniqueNodes.map((id) => (
          <option key={id} value={id}>{nodeLabel(id)}</option>
        ))}
      </select>
      {hasActive && (
        <button
          className={`routing-relevant-toggle${relevantOnly ? " routing-relevant-toggle--active" : ""}`}
          onClick={() => onRelevantOnly(!relevantOnly)}
          title="Show only rows relevant to current step"
        >
          Relevant only
        </button>
      )}
    </div>
  </div>
);

// ── Shared table body ─────────────────────────────────────────────────────────

interface TableBodyProps {
  filtered: DistanceVectorTableEntry[];
  activeKeySet: Set<string>;
  nodeLabel: (id: string) => string;
  compact?: boolean;
  activeRowRefs?: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

const TableBody: React.FC<TableBodyProps> = ({
  filtered, activeKeySet, nodeLabel, compact = false, activeRowRefs,
}) => (
  <div className={`routing-table${compact ? " routing-table--compact" : ""}`} role="table" aria-label="Distance vector routing table">
    {!compact && (
      <div className="routing-row routing-row--header" role="row">
        <div className="routing-cell routing-cell--header" role="columnheader">Node</div>
        <div className="routing-cell routing-cell--header" role="columnheader">Destination</div>
        <div className="routing-cell routing-cell--header" role="columnheader">Cost</div>
        <div className="routing-cell routing-cell--header" role="columnheader">Next hop</div>
      </div>
    )}
    {filtered.length === 0 ? (
      <div className="routing-row routing-row--empty" role="row">
        <div className="routing-cell" role="cell" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-3)" }}>
          No matching entries
        </div>
      </div>
    ) : (
      filtered.map((e) => {
        const key = `${e.nodeId}::${e.destinationId}`;
        const isActive = activeKeySet.has(key);
        const ref = (el: HTMLDivElement | null) => {
          if (!activeRowRefs) return;
          if (el) activeRowRefs.current.set(key, el);
          else activeRowRefs.current.delete(key);
        };
        if (compact) {
          return (
            <div
              key={key}
              ref={ref}
              className={`routing-row routing-row--2line${isActive ? " routing-row--active" : ""}`}
              role="row"
            >
              <div className="routing-2line-top" role="cell">
                <span className="routing-2line-from">{nodeLabel(e.nodeId)}</span>
                <span className="routing-2line-arrow">→</span>
                <span className="routing-2line-to">{nodeLabel(e.destinationId)}</span>
              </div>
              <div className="routing-2line-chips" role="cell">
                <span className="routing-cost-chip">{e.cost >= 0 ? e.cost.toFixed(1) : "∞"}</span>
                {e.nextHop ? (
                  <span className="routing-hop-chip">via {nodeLabel(e.nextHop)}</span>
                ) : (
                  <span className="routing-hop-chip routing-hop-chip--none">direct</span>
                )}
              </div>
            </div>
          );
        }
        return (
          <div
            key={key}
            ref={ref}
            className={`routing-row${isActive ? " routing-row--active" : ""}`}
            role="row"
          >
            <div className="routing-cell" role="cell">{nodeLabel(e.nodeId)}</div>
            <div className="routing-cell" role="cell">{nodeLabel(e.destinationId)}</div>
            <div className="routing-cell" role="cell">
              <span className="routing-cost-chip">{e.cost >= 0 ? e.cost.toFixed(1) : "∞"}</span>
            </div>
            <div className="routing-cell" role="cell">
              {e.nextHop ? (
                <span className="routing-hop-chip">{nodeLabel(e.nextHop)}</span>
              ) : (
                <span style={{ color: "var(--text-3)" }}>—</span>
              )}
            </div>
          </div>
        );
      })
    )}
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const RoutingTablePanel: React.FC<RoutingTablePanelProps> = ({
  entries,
  network,
  activeRowKeys = [],
  showModal = false,
  onOpenModal,
  onCloseModal,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [nodeFilter, setNodeFilter] = useState<string>("__all__");
  const [relevantOnly, setRelevantOnly] = useState(false);

  const [modalSearch, setModalSearch] = useState("");
  const [modalNodeFilter, setModalNodeFilter] = useState<string>("__all__");
  const [modalRelevantOnly, setModalRelevantOnly] = useState(false);

  const activeRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!open || activeRowKeys.length === 0) return;
    const el = activeRowRefs.current.get(activeRowKeys[0]);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, activeRowKeys]);

  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseModal?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, onCloseModal]);

  if (!entries || entries.length === 0) return null;

  const nodeLabel = (id: string): string =>
    network?.nodes.find((n) => n.id === id)?.label ?? id;

  const uniqueNodes = [...new Set(entries.map((e) => e.nodeId))]
    .sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeKeySet = useMemo(() => new Set(activeRowKeys), [activeRowKeys]);

  function applyFilters(
    src: DistanceVectorTableEntry[],
    nf: string,
    ro: boolean,
    q: string,
  ): DistanceVectorTableEntry[] {
    let res = src;
    if (nf !== "__all__") res = res.filter((e) => e.nodeId === nf);
    if (ro && activeKeySet.size > 0)
      res = res.filter((e) => activeKeySet.has(`${e.nodeId}::${e.destinationId}`));
    if (q.trim()) {
      const lq = q.toLowerCase();
      res = res.filter((e) => {
        const from = nodeLabel(e.nodeId).toLowerCase();
        const to = nodeLabel(e.destinationId).toLowerCase();
        const hop = e.nextHop ? nodeLabel(e.nextHop).toLowerCase() : "";
        return from.includes(lq) || to.includes(lq) || hop.includes(lq);
      });
    }
    return res;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => applyFilters(entries, nodeFilter, relevantOnly, search), [entries, nodeFilter, relevantOnly, search, activeKeySet]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const modalFiltered = useMemo(() => applyFilters(entries, modalNodeFilter, modalRelevantOnly, modalSearch), [entries, modalNodeFilter, modalRelevantOnly, modalSearch, activeKeySet]);

  const modal = showModal
    ? createPortal(
        <div
          className="rtp-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) onCloseModal?.(); }}
        >
          <div className="rtp-modal" role="dialog" aria-modal="true" aria-label="Full routing table">
            <div className="rtp-modal-header">
              <h2 className="rtp-modal-title">Routing table</h2>
              <span className="rtp-modal-count">{entries.length} entries</span>
              <button className="rtp-modal-close" onClick={onCloseModal} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="rtp-modal-controls">
              <Controls
                search={modalSearch}
                onSearch={setModalSearch}
                nodeFilter={modalNodeFilter}
                onNodeFilter={setModalNodeFilter}
                uniqueNodes={uniqueNodes}
                nodeLabel={nodeLabel}
                relevantOnly={modalRelevantOnly}
                onRelevantOnly={setModalRelevantOnly}
                hasActive={activeKeySet.size > 0}
              />
            </div>
            <div className="rtp-modal-body">
              <div className="routing-table-wrap">
                <TableBody
                  filtered={modalFiltered}
                  activeKeySet={activeKeySet}
                  nodeLabel={nodeLabel}
                  compact={false}
                />
              </div>
              {modalFiltered.length !== entries.length && (
                <div className="routing-panel-footer">
                  Showing {modalFiltered.length} of {entries.length} entries
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div className="panel routing-panel">
        <button className="routing-panel-toggle" onClick={() => setOpen((p) => !p)}>
          <span className="routing-panel-title">Routing table</span>
          <span className="panel-toggle-meta">
            <span className="routing-panel-count">{entries.length} entries</span>
            {onOpenModal && (
              <button
                className="routing-expand-btn"
                onClick={(e) => { e.stopPropagation(); onOpenModal(); }}
                title="Open full table"
                aria-label="Open full table"
              >
                <Maximize2 size={12} />
              </button>
            )}
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>

        {open && (
          <div className="routing-panel-body">
            <Controls
              search={search}
              onSearch={setSearch}
              nodeFilter={nodeFilter}
              onNodeFilter={setNodeFilter}
              uniqueNodes={uniqueNodes}
              nodeLabel={nodeLabel}
              relevantOnly={relevantOnly}
              onRelevantOnly={setRelevantOnly}
              hasActive={activeKeySet.size > 0}
            />
            <div className="routing-table-wrap">
              <TableBody
                filtered={filtered}
                activeKeySet={activeKeySet}
                nodeLabel={nodeLabel}
                compact={true}
                activeRowRefs={activeRowRefs}
              />
            </div>
            {filtered.length !== entries.length && (
              <div className="routing-panel-footer">
                Showing {filtered.length} of {entries.length} entries
              </div>
            )}
          </div>
        )}
      </div>
      {modal}
    </>
  );
};

export default RoutingTablePanel;
