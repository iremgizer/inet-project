import React, { useState } from "react";
import { Network, Shuffle } from "lucide-react";
import { NetworkInput, TopologyType } from "../types/network";
import { getTopologyPreview, RandomGraphConfig, TopologySize } from "../utils/generatedTopologies";

interface NetworkBuilderPageProps {
  network: NetworkInput;
  topologySize: TopologySize;
  topologyStats: { nodeCount: number; linkCount: number; avgDegree: number; components: number; density: number };
  randomConfig: RandomGraphConfig;
  onTopologyChange: (type: TopologyType) => void;
  onTopologySizeChange: (size: TopologySize) => void;
  onLoadTopology: () => void;
  onSelectAndLoad: (type: TopologyType) => void;
  onRandomConfigChange: (config: RandomGraphConfig) => void;
  onBack: () => void;
  onNext: () => void;
}

// ── Topology card metadata ────────────────────────────────────────────────────

type Category = "All" | "ECMP" | "Distance Vector" | "Exercises";

interface TopoCard {
  value: TopologyType;
  label: string;
  tagline: string;
  best: string;
  categories: Category[];
}

const TOPO_CARDS: TopoCard[] = [
  {
    value: "triangle",
    label: "Triangle",
    tagline: "Two equal-cost paths between endpoints. Classic ECMP demonstration.",
    best: "ECMP · Load splitting",
    categories: ["ECMP"],
  },
  {
    value: "ring",
    label: "Ring",
    tagline: "Nodes form a loop — two disjoint paths exist between any pair.",
    best: "ECMP · Path diversity",
    categories: ["ECMP", "Distance Vector"],
  },
  {
    value: "mesh",
    label: "Mesh",
    tagline: "Dense interconnect — stress test congestion and routing policies.",
    best: "Congestion · Full mesh",
    categories: ["ECMP"],
  },
  {
    value: "fat-tree",
    label: "Clos Fat-Tree",
    tagline: "Multi-tier data-center topology. Spines, leaves, and hosts with full bisection bandwidth.",
    best: "Data-center · ECMP",
    categories: ["ECMP"],
  },
  {
    value: "grid",
    label: "Grid",
    tagline: "Nodes arranged in a 2D lattice. Shows multiple equal-cost routes in all directions.",
    best: "Multiple paths",
    categories: ["Distance Vector", "Exercises"],
  },
  {
    value: "path",
    label: "Path Graph",
    tagline: "Linear chain A–B–C–D with weight=10. Perfect for DV convergence demos.",
    best: "Distance Vector · Bellman-Ford",
    categories: ["Distance Vector"],
  },
  {
    value: "cycle",
    label: "Cycle",
    tagline: "Closed loop with an odd number of nodes. Explore route diversity and Segment Routing.",
    best: "Segment Routing · Exercises",
    categories: ["Exercises"],
  },
  {
    value: "random",
    label: "Random Graph",
    tagline: "Generate a random connected graph. Control node count, link count, and weights.",
    best: "Exploration · Exercises",
    categories: ["Exercises"],
  },
];

const CATEGORIES: Category[] = ["All", "ECMP", "Distance Vector", "Exercises"];

// ── Mini SVG previews ─────────────────────────────────────────────────────────

const NODE_FILL  = "#334155";
const EDGE_COLOR = "#94a3b8";

function TopologySVG({ type, selected }: { type: string; selected: boolean }) {
  const nf = selected ? "#0071e3" : NODE_FILL;
  const ec = selected ? "#93c5fd" : EDGE_COLOR;
  const sw = "1.5";
  const nh = selected ? "#60a5fa" : "#64748b"; // host node color

  if (type === "triangle") return (
    <svg width="56" height="46" viewBox="0 0 56 46" fill="none">
      <line x1="28" y1="5" x2="5"  y2="41" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="28" y1="5" x2="51" y2="41" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="5"  y1="41" x2="51" y2="41" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <circle cx="28" cy="5"  r="4" fill={nf}/>
      <circle cx="5"  cy="41" r="4" fill={nf}/>
      <circle cx="51" cy="41" r="4" fill={nf}/>
    </svg>
  );

  if (type === "ring") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      <polygon points="28,4 52,21 44,46 12,46 4,21"
        stroke={ec} strokeWidth={sw} fill="none" strokeLinejoin="round"/>
      <circle cx="28" cy="4"  r="3.5" fill={nf}/>
      <circle cx="52" cy="21" r="3.5" fill={nf}/>
      <circle cx="44" cy="46" r="3.5" fill={nf}/>
      <circle cx="12" cy="46" r="3.5" fill={nf}/>
      <circle cx="4"  cy="21" r="3.5" fill={nf}/>
    </svg>
  );

  if (type === "mesh") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      <line x1="8" y1="10" x2="48" y2="10" stroke={ec} strokeWidth="1.2"/>
      <line x1="8" y1="10" x2="8"  y2="42" stroke={ec} strokeWidth="1.2"/>
      <line x1="8" y1="10" x2="48" y2="42" stroke={ec} strokeWidth="1.2"/>
      <line x1="48" y1="10" x2="8"  y2="42" stroke={ec} strokeWidth="1.2"/>
      <line x1="48" y1="10" x2="48" y2="42" stroke={ec} strokeWidth="1.2"/>
      <line x1="8"  y1="42" x2="48" y2="42" stroke={ec} strokeWidth="1.2"/>
      <circle cx="8"  cy="10" r="4" fill={nf}/>
      <circle cx="48" cy="10" r="4" fill={nf}/>
      <circle cx="8"  cy="42" r="4" fill={nf}/>
      <circle cx="48" cy="42" r="4" fill={nf}/>
    </svg>
  );

  if (type === "fat-tree") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      {/* Spines */}
      <line x1="20" y1="8" x2="10" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="20" y1="8" x2="30" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="36" y1="8" x2="26" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="36" y1="8" x2="46" y2="24" stroke={ec} strokeWidth={sw}/>
      {/* Leaves to hosts */}
      <line x1="10" y1="24" x2="6"  y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="10" y1="24" x2="14" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="30" y1="24" x2="26" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="30" y1="24" x2="34" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="26" y1="24" x2="22" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="46" y1="24" x2="42" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="46" y1="24" x2="50" y2="41" stroke={ec} strokeWidth="1.1"/>
      {/* Spines */}
      <circle cx="20" cy="8"  r="4"   fill={nf}/>
      <circle cx="36" cy="8"  r="4"   fill={nf}/>
      {/* Leaves */}
      <circle cx="10" cy="24" r="3.5" fill={nf}/>
      <circle cx="30" cy="24" r="3.5" fill={nf}/>
      <circle cx="26" cy="24" r="3.5" fill={nf}/>
      <circle cx="46" cy="24" r="3.5" fill={nf}/>
      {/* Hosts */}
      <circle cx="6"  cy="41" r="2.5" fill={nh}/>
      <circle cx="14" cy="41" r="2.5" fill={nh}/>
      <circle cx="22" cy="41" r="2.5" fill={nh}/>
      <circle cx="26" cy="41" r="2.5" fill={nh}/>
      <circle cx="34" cy="41" r="2.5" fill={nh}/>
      <circle cx="42" cy="41" r="2.5" fill={nh}/>
      <circle cx="50" cy="41" r="2.5" fill={nh}/>
    </svg>
  );

  if (type === "grid") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      {[8,28,48].map((x) => [10,27,44].map((y) => (
        <line key={`h${x}${y}`} x1={x} y1={y} x2={x+20} y2={y} stroke={ec} strokeWidth="1.2"/>
      )))}
      {[8,28,48].map((x) => [10,27].map((y) => (
        <line key={`v${x}${y}`} x1={x} y1={y} x2={x} y2={y+17} stroke={ec} strokeWidth="1.2"/>
      )))}
      {[8,28,48].map((x) => [10,27,44].map((y) => (
        <circle key={`n${x}${y}`} cx={x} cy={y} r="3.5" fill={nf}/>
      )))}
    </svg>
  );

  if (type === "path") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      <line x1="8" y1="25" x2="18" y2="25" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="22" y1="25" x2="32" y2="25" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <line x1="36" y1="25" x2="46" y2="25" stroke={ec} strokeWidth={sw} strokeLinecap="round"/>
      <circle cx="8"  cy="25" r="4" fill={nf}/>
      <circle cx="22" cy="25" r="4" fill={nf}/>
      <circle cx="36" cy="25" r="4" fill={nf}/>
      <circle cx="50" cy="25" r="4" fill={nf}/>
      {/* weight labels */}
      <text x="13" y="20" fontSize="7" fill={ec} textAnchor="middle">10</text>
      <text x="29" y="20" fontSize="7" fill={ec} textAnchor="middle">10</text>
      <text x="41" y="20" fontSize="7" fill={ec} textAnchor="middle">10</text>
    </svg>
  );

  if (type === "cycle") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      <polygon points="28,5 51,19 43,44 13,44 5,19"
        stroke={ec} strokeWidth={sw} fill="none" strokeLinejoin="round"/>
      <circle cx="28" cy="5"  r="3.5" fill={nf}/>
      <circle cx="51" cy="19" r="3.5" fill={nf}/>
      <circle cx="43" cy="44" r="3.5" fill={nf}/>
      <circle cx="13" cy="44" r="3.5" fill={nf}/>
      <circle cx="5"  cy="19" r="3.5" fill={nf}/>
    </svg>
  );

  if (type === "random") return (
    <svg width="56" height="50" viewBox="0 0 56 50" fill="none">
      <line x1="8"  y1="40" x2="22" y2="10" stroke={ec} strokeWidth="1.1"/>
      <line x1="8"  y1="40" x2="48" y2="28" stroke={ec} strokeWidth="1.1"/>
      <line x1="22" y1="10" x2="48" y2="28" stroke={ec} strokeWidth="1.1"/>
      <line x1="22" y1="10" x2="36" y2="42" stroke={ec} strokeWidth="1.1"/>
      <line x1="48" y1="28" x2="36" y2="42" stroke={ec} strokeWidth="1.1"/>
      <line x1="8"  y1="40" x2="36" y2="42" stroke={ec} strokeWidth="1.1" strokeDasharray="3 2"/>
      <circle cx="8"  cy="40" r="3.5" fill={nf}/>
      <circle cx="22" cy="10" r="3.5" fill={nf}/>
      <circle cx="48" cy="28" r="3.5" fill={nf}/>
      <circle cx="36" cy="42" r="3.5" fill={nf}/>
    </svg>
  );

  return <svg width="56" height="46" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

const NetworkBuilderPage: React.FC<NetworkBuilderPageProps> = ({
  network,
  topologySize,
  topologyStats,
  randomConfig,
  onTopologyChange,
  onTopologySizeChange,
  onLoadTopology,
  onSelectAndLoad,
  onRandomConfigChange,
  onBack,
  onNext,
}) => {
  const [activeCategory, setActiveCategory] = useState<Category>("All");
  const [showRandomAdvanced, setShowRandomAdvanced] = useState(false);

  const visibleCards = activeCategory === "All"
    ? TOPO_CARDS
    : TOPO_CARDS.filter((c) => c.categories.includes(activeCategory));

  const selectedCard = TOPO_CARDS.find((c) => c.value === network.topologyType);
  const preview      = getTopologyPreview(network.topologyType, topologySize);
  const isRandom     = network.topologyType === "random";

  return (
    <div className="page">
      <div className="stage-kicker">
        <Network size={13} />
        Design
      </div>
      <h2 className="page-title">Build your network</h2>

      <div className="builder-hints">
        <div className="builder-hint"><span className="hint-dot" />Drag a node handle to another node to create a link</div>
        <div className="builder-hint"><span className="hint-dot" />Click any node or link to inspect and edit it</div>
      </div>

      <div className="page-divider" />

      {/* Category filter */}
      <div className="section-label">Start from a template</div>
      <div className="topo-cat-chips">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`topo-cat-chip ${activeCategory === cat ? "topo-cat-chip--active" : ""}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template cards */}
      <div className="topo-card-grid">
        {visibleCards.map((card) => {
          const isSel = network.topologyType === card.value;
          return (
            <button
              key={card.value}
              className={`topo-card ${isSel ? "topo-card--selected" : ""}`}
              onClick={() => {
                if (card.value === "random") {
                  onTopologyChange(card.value);
                } else {
                  onSelectAndLoad(card.value);
                }
              }}
              title={card.tagline}
            >
              <div className="topo-card-preview">
                <TopologySVG type={card.value} selected={isSel} />
              </div>
              <div className="topo-card-body">
                <span className="topo-card-name">{card.label}</span>
                <span className="topo-card-best">{card.best}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Load controls */}
      {selectedCard && (
        <div className="topo-load-row">
          <p className="topo-card-tagline">{selectedCard.tagline}</p>

          {isRandom ? (
            /* Random graph configuration form */
            <div className="random-config-form">
              <button
                className="random-config-advanced-toggle"
                onClick={() => setShowRandomAdvanced((p) => !p)}
              >
                Advanced options {showRandomAdvanced ? "▲" : "▼"}
              </button>
              {showRandomAdvanced && (
                <>
                  <div className="random-config-row">
                    <div className="random-config-field">
                      <label>Nodes</label>
                      <input
                        type="number"
                        min={2}
                        max={40}
                        value={randomConfig.nodeCount}
                        onChange={(e) => onRandomConfigChange({ ...randomConfig, nodeCount: Math.max(2, +e.target.value) })}
                      />
                    </div>
                    <div className="random-config-field">
                      <label>Links</label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={randomConfig.linkCount}
                        onChange={(e) => onRandomConfigChange({ ...randomConfig, linkCount: Math.max(1, +e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="random-config-row">
                    <div className="random-config-field">
                      <label>Weight</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={randomConfig.weight}
                        onChange={(e) => onRandomConfigChange({ ...randomConfig, weight: Math.max(0, +e.target.value) })}
                      />
                    </div>
                    <div className="random-config-field">
                      <label>Capacity</label>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={randomConfig.capacity}
                        onChange={(e) => onRandomConfigChange({ ...randomConfig, capacity: Math.max(1, +e.target.value) })}
                      />
                    </div>
                  </div>
                  <label className="random-config-connected">
                    <input
                      type="checkbox"
                      checked={randomConfig.connected}
                      onChange={(e) => onRandomConfigChange({ ...randomConfig, connected: e.target.checked })}
                    />
                    Ensure connected graph
                  </label>
                </>
              )}
              <button className="btn-primary btn-sm" onClick={onLoadTopology} style={{ marginTop: 4 }}>
                <Shuffle size={13} /> Generate
              </button>
            </div>
          ) : (
            /* S/M/L size picker */
            <div className="topo-size-controls">
              <div className="size-pills">
                {(["small", "medium", "large"] as TopologySize[]).map((s) => (
                  <button
                    key={s}
                    className={`size-pill ${topologySize === s ? "size-pill--active" : ""}`}
                    onClick={() => onTopologySizeChange(s)}
                  >
                    {s[0].toUpperCase()}
                  </button>
                ))}
              </div>
              <span className="topo-preview-count">{preview.nodes}N · {preview.links}L</span>
              <button className="btn-primary btn-sm" onClick={onLoadTopology}>
                Load
              </button>
            </div>
          )}
        </div>
      )}

      {/* Current network stats — only shown when there's a warning */}
      {(topologyStats.components > 1 || network.nodes.length > 40) && (
        <div className="topo-stats-row">
          <span className="topo-stat">{topologyStats.nodeCount} <em>nodes</em></span>
          <span className="topo-stat">{topologyStats.linkCount} <em>links</em></span>
          {topologyStats.components > 1 && (
            <span className="badge badge--warning">{topologyStats.components} components</span>
          )}
          {network.nodes.length > 40 && (
            <span className="badge badge--warning">Large graph</span>
          )}
        </div>
      )}

      <div className="page-actions">
        <button className="btn-secondary btn-sm" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onNext} disabled={topologyStats.nodeCount === 0}>
          Next: Traffic →
        </button>
      </div>
    </div>
  );
};

export default NetworkBuilderPage;
