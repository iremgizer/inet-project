import React, { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { DistanceVectorTableEntry, NetworkInput } from "../types/network";

interface RoutingTablePanelProps {
  entries?: DistanceVectorTableEntry[];
  network?: NetworkInput;
  activeRowKeys?: string[];      // format "nodeId::destinationId"
  initiallyOpen?: boolean;
}

const RoutingTablePanel: React.FC<RoutingTablePanelProps> = ({
  entries,
  network,
  activeRowKeys = [],
  initiallyOpen = false,
}) => {
  const [open, setOpen] = useState(initiallyOpen);
  const [search, setSearch] = useState("");
  const [nodeFilter, setNodeFilter] = useState<string>("__all__");
  const [relevantOnly, setRelevantOnly] = useState(false);
  const activeRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Sync open state when initiallyOpen changes (triggered by "Show full table" button)
  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  // Auto-scroll to first active row when activeRowKeys changes
  useEffect(() => {
    if (!open || activeRowKeys.length === 0) return;
    const firstKey = activeRowKeys[0];
    const el = activeRowRefs.current.get(firstKey);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [open, activeRowKeys]);

  if (!entries || entries.length === 0) return null;

  // Node label lookup
  const nodeLabel = (id: string): string =>
    network?.nodes.find((n) => n.id === id)?.label ?? id;

  // Unique source nodes for filter dropdown
  const uniqueNodes = useMemo(() => {
    const ids = [...new Set(entries.map((e) => e.nodeId))];
    return ids.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b)));
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active row key set for quick lookup
  const activeKeySet = useMemo(() => new Set(activeRowKeys), [activeRowKeys]);

  // Filtered entries
  const filtered = useMemo(() => {
    let result = entries;

    // Node filter
    if (nodeFilter !== "__all__") {
      result = result.filter((e) => e.nodeId === nodeFilter);
    }

    // Relevant-only filter
    if (relevantOnly && activeKeySet.size > 0) {
      result = result.filter((e) => activeKeySet.has(`${e.nodeId}::${e.destinationId}`));
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const src = nodeLabel(e.nodeId).toLowerCase();
        const dst = nodeLabel(e.destinationId).toLowerCase();
        const hop = e.nextHop ? nodeLabel(e.nextHop).toLowerCase() : "";
        return src.includes(q) || dst.includes(q) || hop.includes(q);
      });
    }

    return result;
  }, [entries, nodeFilter, relevantOnly, activeKeySet, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="panel routing-panel">
      <button className="routing-panel-toggle" onClick={() => setOpen((p) => !p)}>
        <span className="routing-panel-title">Routing table</span>
        <span className="panel-toggle-meta">
          <span className="routing-panel-count">{entries.length} entries</span>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div className="routing-panel-body">
          {/* Controls */}
          <div className="routing-panel-controls">
            {/* Search */}
            <div className="routing-search-wrap">
              <Search size={13} className="routing-search-icon" />
              <input
                className="routing-search-input"
                placeholder="Search node, dest, hop…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search routing table"
              />
              {search && (
                <button
                  className="routing-search-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Filter row */}
            <div className="routing-filter-row">
              <select
                className="routing-node-filter"
                value={nodeFilter}
                onChange={(e) => setNodeFilter(e.target.value)}
                aria-label="Filter by node"
              >
                <option value="__all__">All nodes</option>
                {uniqueNodes.map((id) => (
                  <option key={id} value={id}>{nodeLabel(id)}</option>
                ))}
              </select>

              {activeKeySet.size > 0 && (
                <button
                  className={`routing-relevant-toggle${relevantOnly ? " routing-relevant-toggle--active" : ""}`}
                  onClick={() => setRelevantOnly((p) => !p)}
                  title="Show only rows relevant to current step"
                >
                  Relevant only
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="routing-table-wrap">
            <div className="routing-table" role="table" aria-label="Distance vector routing table">
              {/* Header */}
              <div className="routing-row routing-row--header" role="row">
                <div className="routing-cell routing-cell--header" role="columnheader">Node</div>
                <div className="routing-cell routing-cell--header" role="columnheader">Destination</div>
                <div className="routing-cell routing-cell--header" role="columnheader">Cost</div>
                <div className="routing-cell routing-cell--header" role="columnheader">Next hop</div>
              </div>

              {/* Body */}
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
                  return (
                    <div
                      key={key}
                      ref={(el) => {
                        if (el) activeRowRefs.current.set(key, el);
                        else activeRowRefs.current.delete(key);
                      }}
                      className={`routing-row${isActive ? " routing-row--active" : ""}`}
                      role="row"
                    >
                      <div className="routing-cell" role="cell">{nodeLabel(e.nodeId)}</div>
                      <div className="routing-cell" role="cell">{nodeLabel(e.destinationId)}</div>
                      <div className="routing-cell" role="cell">
                        <span className="routing-cost-chip">
                          {e.cost >= 0 ? e.cost.toFixed(1) : "∞"}
                        </span>
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
          </div>

          {/* Footer */}
          {filtered.length !== entries.length && (
            <div className="routing-panel-footer">
              Showing {filtered.length} of {entries.length} entries
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RoutingTablePanel;
