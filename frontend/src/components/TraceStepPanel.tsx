import React from "react";
import {
  SimulationTraceEvent,
  NetworkInput,
  SimulationResult,
  DistanceVectorTableEntry,
} from "../types/network";

// ── Demand color palette (matches canvas path colors) ────────────────────────
const PATH_COLORS = [
  "#0071e3", "#34c759", "#ff9f0a", "#ff3b30", "#5856d6",
  "#30b0c7", "#ff2d55", "#a2845e", "#636366", "#007aff",
];

function getPathColor(index: number): string {
  return PATH_COLORS[index % PATH_COLORS.length] ?? "#607d8b";
}

// ── Step type classification ──────────────────────────────────────────────────
type StepType =
  | "ecmp_init" | "ecmp_paths" | "ecmp_split" | "ecmp_traffic"
  | "ecmp_util" | "ecmp_congestion" | "ecmp_final"
  | "dv_init" | "dv_table" | "dv_route" | "dv_traffic"
  | "dv_util" | "dv_congestion" | "dv_final"
  | "generic";

function classifyStep(event: SimulationTraceEvent): StepType {
  const t = event.title.toLowerCase();
  if (event.algorithm === "ECMP" || event.algorithm?.startsWith("ECMP")) {
    if (t.includes("initialize demand")) return "ecmp_init";
    if (t.includes("compute candidate") || t.includes("equal-cost")) return "ecmp_paths";
    if (t.includes("split demand")) return "ecmp_split";
    if (t.includes("add traffic share")) return "ecmp_traffic";
    if (t.includes("compute link utilization")) return "ecmp_util";
    if (t.includes("detect congestion")) return "ecmp_congestion";
    return "ecmp_final";
  }
  if (event.algorithm === "DISTANCE_VECTOR") {
    if (t.includes("initialize")) return "dv_init";
    if (t.includes("compute shortest") || t.includes("update next-hop")) return "dv_table";
    if (t.includes("select shortest path")) return "dv_route";
    if (t.includes("add traffic to chosen")) return "dv_traffic";
    if (t.includes("compute link utilization")) return "dv_util";
    if (t.includes("congested") || t.includes("mark")) return "dv_congestion";
    if (t.includes("final")) return "dv_final";
    return "generic";
  }
  return "generic";
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AlgBadgeProps { algorithm: string }
const AlgBadge: React.FC<AlgBadgeProps> = ({ algorithm }) => (
  <span className={`tsp-alg-badge tsp-alg-badge--${algorithm === "ECMP" ? "ecmp" : "dv"}`}>
    {algorithm === "ECMP" ? "ECMP" : "DV"}
  </span>
);

interface FormulaCardProps { text: string }
const FormulaCard: React.FC<FormulaCardProps> = ({ text }) => (
  <div className="tsp-formula">
    <pre>{text}</pre>
  </div>
);

interface DemandRowProps {
  demandId: string;
  network: NetworkInput;
}
const DemandRow: React.FC<DemandRowProps> = ({ demandId, network }) => {
  const demand = network.demands.find((d) => d.id === demandId);
  if (!demand) return null;
  const colorIdx = network.demands.findIndex((d) => d.id === demandId);
  const color = getPathColor(colorIdx);
  const srcLabel = network.nodes.find((n) => n.id === demand.source)?.label ?? demand.source;
  const dstLabel = network.nodes.find((n) => n.id === demand.target)?.label ?? demand.target;
  return (
    <div className="tsp-demand-row">
      <span className="tsp-demand-swatch" style={{ backgroundColor: color }} />
      <div className="tsp-demand-endpoints">
        <span>{srcLabel}</span>
        <span className="tsp-path-connector">→</span>
        <span>{dstLabel}</span>
      </div>
      <span className="tsp-demand-amount">{demand.amount} units</span>
    </div>
  );
};

interface PathNodesProps {
  nodeIds: string[];
  network: NetworkInput;
}
const PathNodes: React.FC<PathNodesProps> = ({ nodeIds, network }) => (
  <div className="tsp-path-nodes">
    {nodeIds.map((id, i) => {
      const label = network.nodes.find((n) => n.id === id)?.label ?? id;
      return (
        <React.Fragment key={id}>
          {i > 0 && <span className="tsp-path-connector">→</span>}
          <span className="tsp-path-node">{label}</span>
        </React.Fragment>
      );
    })}
  </div>
);

interface LinkDeltaTableProps {
  linkLoadDelta: Record<string, number>;
  currentLinkLoads: Record<string, number>;
  network: NetworkInput;
}
const LinkDeltaTable: React.FC<LinkDeltaTableProps> = ({ linkLoadDelta, currentLinkLoads, network }) => {
  const rows = Object.entries(linkLoadDelta).map(([linkId, delta]) => {
    const link = network.links.find((l) => l.id === linkId);
    const srcLabel = link ? (network.nodes.find((n) => n.id === link.source)?.label ?? link.source) : linkId;
    const dstLabel = link ? (network.nodes.find((n) => n.id === link.target)?.label ?? link.target) : "";
    const capacity = link?.capacity ?? 1;
    const newLoad = currentLinkLoads[linkId] ?? delta;
    const prevLoad = newLoad - delta;
    const util = newLoad / capacity;
    const utilPct = Math.round(util * 100);
    const modifier = util >= 1 ? "--danger" : util >= 0.8 ? "--warning" : "--safe";
    return { linkId, srcLabel, dstLabel, prevLoad, delta, newLoad, utilPct, modifier };
  });

  return (
    <div className="tsp-section">
      <div className="tsp-section-title">Link load updates</div>
      {rows.map((r) => (
        <div key={r.linkId} className={`tsp-link-delta tsp-link-delta${r.modifier}`}>
          <span className="tsp-link-delta-label">{r.srcLabel}{r.dstLabel ? ` → ${r.dstLabel}` : ""}</span>
          <div className="tsp-link-delta-values">
            <span className="tsp-delta-prev">{r.prevLoad.toFixed(2)}</span>
            <span className="tsp-delta-arrow">+{r.delta.toFixed(2)}</span>
            <span className={`tsp-delta-new${r.modifier}`}>{r.newLoad.toFixed(2)}</span>
            <span className={`tsp-delta-util${r.modifier}`}>({r.utilPct}%)</span>
          </div>
        </div>
      ))}
    </div>
  );
};

interface DVRowProps {
  entry: DistanceVectorTableEntry;
  network: NetworkInput;
  active?: boolean;
}
const DVRow: React.FC<DVRowProps> = ({ entry, network, active }) => {
  const srcLabel = network.nodes.find((n) => n.id === entry.nodeId)?.label ?? entry.nodeId;
  const dstLabel = network.nodes.find((n) => n.id === entry.destinationId)?.label ?? entry.destinationId;
  const hopLabel = entry.nextHop
    ? (network.nodes.find((n) => n.id === entry.nextHop)?.label ?? entry.nextHop)
    : "—";
  return (
    <div className={`tsp-dv-row${active ? " tsp-dv-row--active" : ""}`}>
      <span className="tsp-dv-row-source">{srcLabel}</span>
      <span className="tsp-dv-row-sep">→</span>
      <span>{dstLabel}</span>
      <span className="tsp-dv-row-cost">cost {entry.cost >= 0 ? entry.cost.toFixed(1) : "∞"}</span>
      <span className="tsp-dv-row-hop">via {hopLabel}</span>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface TraceStepPanelProps {
  event: SimulationTraceEvent;
  network: NetworkInput;
  result: SimulationResult | null;
  dvTable?: DistanceVectorTableEntry[];
  onShowFullTable?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

const TraceStepPanel: React.FC<TraceStepPanelProps> = ({
  event,
  network,
  result,
  dvTable,
  onShowFullTable,
}) => {
  const stepType = classifyStep(event);

  // Helper: parse costCalculation into path lines
  const parseCostCalcLines = (text: string): Array<{ route: string; detail: string }> => {
    return text.split("\n").filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(": cost =");
      if (colonIdx !== -1) {
        return { route: line.slice(0, colonIdx), detail: line.slice(colonIdx + 2) };
      }
      return { route: line, detail: "" };
    });
  };

  const renderHeader = () => (
    <div className="tsp-header-row">
      <AlgBadge algorithm={event.algorithm} />
      <span className="tsp-title">{event.title}</span>
    </div>
  );

  // ── ecmp_init ──────────────────────────────────────────────────────────────
  if (stepType === "ecmp_init") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      </div>
    );
  }

  // ── ecmp_paths ─────────────────────────────────────────────────────────────
  if (stepType === "ecmp_paths") {
    const lines = event.costCalculation ? parseCostCalcLines(event.costCalculation) : [];
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {lines.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Candidate paths</div>
            {lines.map((l, i) => (
              <div key={i} className="tsp-path-line">
                <div className="tsp-path-route">{l.route}</div>
                {l.detail && <div className="tsp-path-detail">{l.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ecmp_split ─────────────────────────────────────────────────────────────
  if (stepType === "ecmp_split") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {event.formulaText && (
          <div className="tsp-section">
            <div className="tsp-section-title">Split calculation</div>
            <FormulaCard text={event.formulaText} />
          </div>
        )}
      </div>
    );
  }

  // ── ecmp_traffic ───────────────────────────────────────────────────────────
  if (stepType === "ecmp_traffic") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {event.highlightedNodes.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Path</div>
            <PathNodes nodeIds={event.highlightedNodes} network={network} />
          </div>
        )}
        {event.linkLoadDelta && event.currentLinkLoads && (
          <LinkDeltaTable
            linkLoadDelta={event.linkLoadDelta}
            currentLinkLoads={event.currentLinkLoads}
            network={network}
          />
        )}
      </div>
    );
  }

  // ── ecmp_util ──────────────────────────────────────────────────────────────
  if (stepType === "ecmp_util") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.formulaText && <FormulaCard text={event.formulaText} />}
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      </div>
    );
  }

  // ── ecmp_congestion ────────────────────────────────────────────────────────
  if (stepType === "ecmp_congestion") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.highlightedLinks.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Congested links</div>
            {event.highlightedLinks.map((linkId) => {
              const link = network.links.find((l) => l.id === linkId);
              const label = link
                ? `${network.nodes.find((n) => n.id === link.source)?.label ?? link.source} → ${network.nodes.find((n) => n.id === link.target)?.label ?? link.target}`
                : linkId;
              return (
                <div key={linkId} className="tsp-congested-row">
                  <span style={{ color: "var(--danger)", fontWeight: 700 }}>⚠</span>
                  <span>{label}</span>
                  <span className="tsp-count-badge" style={{ marginLeft: "auto", color: "var(--danger)" }}>congested</span>
                </div>
              );
            })}
          </div>
        )}
        {event.formulaText && <FormulaCard text={event.formulaText} />}
      </div>
    );
  }

  // ── ecmp_final ─────────────────────────────────────────────────────────────
  if (stepType === "ecmp_final") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      </div>
    );
  }

  // ── dv_init ────────────────────────────────────────────────────────────────
  if (stepType === "dv_init") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
        <div className="tsp-section">
          <span className="tsp-count-badge">{network.nodes.length} nodes</span>
          <span className="tsp-count-badge">{network.links.length} links</span>
        </div>
      </div>
    );
  }

  // ── dv_table ───────────────────────────────────────────────────────────────
  if (stepType === "dv_table") {
    const tableCount = Array.isArray(event.tablesSnapshot)
      ? (event.tablesSnapshot as unknown[]).length
      : (dvTable?.length ?? 0);
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
        <div className="tsp-section">
          <span className="tsp-count-badge">{tableCount} table entries</span>
        </div>
        {onShowFullTable && (
          <button className="tsp-full-table-btn" onClick={onShowFullTable}>
            Show full routing table
          </button>
        )}
      </div>
    );
  }

  // ── dv_route ───────────────────────────────────────────────────────────────
  if (stepType === "dv_route") {
    const relevantRows = dvTable?.filter(
      (e) =>
        event.activeDemandId
          ? (() => {
              const d = network.demands.find((d) => d.id === event.activeDemandId);
              return d ? e.nodeId === d.source && e.destinationId === d.target : false;
            })()
          : false
    ) ?? [];
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {event.highlightedNodes.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Selected path</div>
            <PathNodes nodeIds={event.highlightedNodes} network={network} />
          </div>
        )}
        {event.costCalculation && (
          <div className="tsp-section">
            <div className="tsp-section-title">Path cost</div>
            <FormulaCard text={event.costCalculation} />
          </div>
        )}
        {relevantRows.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Routing table entry</div>
            <div className="tsp-dv-snippet">
              {relevantRows.map((row, i) => (
                <DVRow key={i} entry={row} network={network} active />
              ))}
            </div>
          </div>
        )}
        {onShowFullTable && (
          <button className="tsp-full-table-btn" onClick={onShowFullTable}>
            Show full routing table
          </button>
        )}
      </div>
    );
  }

  // ── dv_traffic ─────────────────────────────────────────────────────────────
  if (stepType === "dv_traffic") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.activeDemandId && (
          <div className="tsp-section">
            <div className="tsp-section-title">Active demand</div>
            <DemandRow demandId={event.activeDemandId} network={network} />
          </div>
        )}
        {event.highlightedNodes.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Path</div>
            <PathNodes nodeIds={event.highlightedNodes} network={network} />
          </div>
        )}
        {event.linkLoadDelta && event.currentLinkLoads && (
          <LinkDeltaTable
            linkLoadDelta={event.linkLoadDelta}
            currentLinkLoads={event.currentLinkLoads}
            network={network}
          />
        )}
      </div>
    );
  }

  // ── dv_util ────────────────────────────────────────────────────────────────
  if (stepType === "dv_util") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.formulaText && <FormulaCard text={event.formulaText} />}
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      </div>
    );
  }

  // ── dv_congestion ──────────────────────────────────────────────────────────
  if (stepType === "dv_congestion") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.highlightedLinks.length > 0 && (
          <div className="tsp-section">
            <div className="tsp-section-title">Congested links</div>
            {event.highlightedLinks.map((linkId) => {
              const link = network.links.find((l) => l.id === linkId);
              const label = link
                ? `${network.nodes.find((n) => n.id === link.source)?.label ?? link.source} → ${network.nodes.find((n) => n.id === link.target)?.label ?? link.target}`
                : linkId;
              return (
                <div key={linkId} className="tsp-congested-row">
                  <span style={{ color: "var(--danger)", fontWeight: 700 }}>⚠</span>
                  <span>{label}</span>
                  <span className="tsp-count-badge" style={{ marginLeft: "auto", color: "var(--danger)" }}>congested</span>
                </div>
              );
            })}
          </div>
        )}
        {event.formulaText && <FormulaCard text={event.formulaText} />}
      </div>
    );
  }

  // ── dv_final ───────────────────────────────────────────────────────────────
  if (stepType === "dv_final") {
    return (
      <div className="trace-step-panel">
        {renderHeader()}
        <p className="tsp-desc">{event.description}</p>
        {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      </div>
    );
  }

  // ── generic ────────────────────────────────────────────────────────────────
  return (
    <div className="trace-step-panel">
      {renderHeader()}
      <p className="tsp-desc">{event.description}</p>
      {event.explanationText && <p className="tsp-explain">{event.explanationText}</p>}
      {(event.costCalculation || event.formulaText) && (
        <FormulaCard text={event.costCalculation ?? event.formulaText ?? ""} />
      )}
    </div>
  );
};

export default TraceStepPanel;
