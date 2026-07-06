import React, { useState, useCallback, useEffect } from "react";
import { Network, Shuffle } from "lucide-react";
import { NetworkInput, TopologyType } from "../types/network";
import {
  generateTopology,
  generateRandomTopology,
  getTopologyPreview,
  RandomGraphConfig,
  TopologySize,
} from "../utils/generatedTopologies";

interface NetworkBuilderPageProps {
  network: NetworkInput;
  topologyStats: { nodeCount: number; linkCount: number; avgDegree: number; components: number; density: number };
  onGenerateTopology: (network: NetworkInput) => void;
  onBack: () => void;
  onNext: () => void;
}

// ── Topology card metadata ────────────────────────────────────────────────────

type Category = "All" | "ECMP" | "Distance Vector" | "Exercises";

interface TopoCard {
  value: TopologyType;
  label: string;
  tagline: string;
  categories: Category[];
}

const TOPO_CARDS: TopoCard[] = [
  {
    value: "triangle",
    label: "Triangle",
    tagline: "3 nodes · 3 links. Two equal-cost paths between u and t.",
    categories: ["ECMP"],
  },
  {
    value: "ring",
    label: "Ring",
    tagline: "Nodes in a loop — two disjoint paths between any pair.",
    categories: ["ECMP", "Distance Vector"],
  },
  {
    value: "mesh",
    label: "Mesh",
    tagline: "Dense interconnect with many crossing paths.",
    categories: ["ECMP"],
  },
  {
    value: "fat-tree",
    label: "Clos Fat-Tree",
    tagline: "Multi-tier data-center topology.",
    categories: ["ECMP"],
  },
  {
    value: "grid",
    label: "Grid",
    tagline: "2D lattice with multiple equal-cost routes.",
    categories: ["Distance Vector", "Exercises"],
  },
  {
    value: "path",
    label: "Path Graph",
    tagline: "Linear chain with configurable length.",
    categories: ["Distance Vector"],
  },
  {
    value: "cycle",
    label: "Cycle",
    tagline: "Closed loop with configurable node count.",
    categories: ["Exercises"],
  },
  {
    value: "random",
    label: "Random Graph",
    tagline: "Random connected graph with configurable density.",
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
  const nh = selected ? "#60a5fa" : "#64748b";

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
      <line x1="20" y1="8" x2="10" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="20" y1="8" x2="30" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="36" y1="8" x2="26" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="36" y1="8" x2="46" y2="24" stroke={ec} strokeWidth={sw}/>
      <line x1="10" y1="24" x2="6"  y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="10" y1="24" x2="14" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="30" y1="24" x2="26" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="30" y1="24" x2="34" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="26" y1="24" x2="22" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="46" y1="24" x2="42" y2="41" stroke={ec} strokeWidth="1.1"/>
      <line x1="46" y1="24" x2="50" y2="41" stroke={ec} strokeWidth="1.1"/>
      <circle cx="20" cy="8"  r="4"   fill={nf}/>
      <circle cx="36" cy="8"  r="4"   fill={nf}/>
      <circle cx="10" cy="24" r="3.5" fill={nf}/>
      <circle cx="30" cy="24" r="3.5" fill={nf}/>
      <circle cx="26" cy="24" r="3.5" fill={nf}/>
      <circle cx="46" cy="24" r="3.5" fill={nf}/>
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
  topologyStats,
  onGenerateTopology,
  onBack,
  onNext,
}) => {
  // Internal state — all generation happens here
  const [selectedType, setSelectedType] = useState<TopologyType>(
    network.topologyType !== "custom" && network.topologyType !== "random" ? network.topologyType : "triangle"
  );
  const [size, setSize] = useState<TopologySize>("small");
  const [defaultWeight, setDefaultWeight] = useState(1);
  const [defaultCapacity, setDefaultCapacity] = useState(10);
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  // Custom counts per topology type
  const [pathNodes, setPathNodes] = useState(4);
  const [cycleNodes, setCycleNodes] = useState(5);
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(3);
  const [fatSpines, setFatSpines] = useState(2);
  const [fatLeaves, setFatLeaves] = useState(4);
  const [ringNodes, setRingNodes] = useState(6);
  const [meshNodes, setMeshNodes] = useState(8);

  const [randomConfig, setRandomConfig] = useState<RandomGraphConfig>({
    nodeCount: 8, linkCount: 12, weight: 1, capacity: 10, connected: true,
  });

  // Triangle always generates a canonical 3-node topology — no size selector needed.
  const isFixedSize = selectedType === "triangle";
  // These types use explicit numeric count inputs instead of S/M/L.
  const supportsCustomCount = ["path", "cycle", "ring", "mesh", "grid", "fat-tree"].includes(selectedType);
  const preview = getTopologyPreview(selectedType, size);

  const generate = useCallback(() => {
    if (selectedType === "random") return;
    try {
      const net = generateTopology(selectedType, size, {
        weight: defaultWeight,
        capacity: defaultCapacity,
        nodeCount: selectedType === "path" ? pathNodes
                 : selectedType === "cycle" ? cycleNodes
                 : selectedType === "ring" ? ringNodes
                 : selectedType === "mesh" ? meshNodes
                 : undefined,
        rows: selectedType === "grid" ? gridRows : undefined,
        cols: selectedType === "grid" ? gridCols : undefined,
        spines: selectedType === "fat-tree" ? fatSpines : undefined,
        leaves: selectedType === "fat-tree" ? fatLeaves : undefined,
      });
      onGenerateTopology(net);
    } catch {
      // silently fail on invalid configs
    }
  }, [selectedType, size, defaultWeight, defaultCapacity, pathNodes, cycleNodes, gridRows, gridCols, fatSpines, fatLeaves, ringNodes, meshNodes, onGenerateTopology]); // eslint-disable-line

  // Auto-generate on any config change (not random)
  useEffect(() => {
    if (selectedType !== "random") generate();
  }, [generate]); // eslint-disable-line

  const handleGenerateRandom = () => {
    const net = generateRandomTopology({ ...randomConfig });
    onGenerateTopology(net);
  };

  const visibleCards = activeCategory === "All"
    ? TOPO_CARDS
    : TOPO_CARDS.filter((c) => c.categories.includes(activeCategory));

  const selectedCard = TOPO_CARDS.find((c) => c.value === selectedType);

  return (
    <div className="page">
      <div className="stage-kicker">
        <Network size={13} />
        Design
      </div>
      <h2 className="page-title">Build your network</h2>

      <div className="page-divider" />

      {/* ── Category filter ── */}
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

      {/* ── Template cards ── */}
      <div className="topo-card-grid">
        {visibleCards.map((card) => {
          const isSel = selectedType === card.value;
          return (
            <button
              key={card.value}
              className={`topo-card ${isSel ? "topo-card--selected" : ""}`}
              onClick={() => setSelectedType(card.value)}
              title={card.tagline}
            >
              <div className="topo-card-preview">
                <TopologySVG type={card.value} selected={isSel} />
              </div>
              <div className="topo-card-body">
                <span className="topo-card-name">{card.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Config section for selected type ── */}
      {selectedCard && (
        <div className="topo-load-row">
          {isFixedSize ? (
            /* ── Fixed-size topology (triangle) — no size controls ── */
            <div className="topo-defaults-row">
              <span className="topo-defaults-label">Default weight &amp; capacity</span>
              <label className="topo-count-field">
                <span>Weight</span>
                <input
                  type="number" min={0} step={0.1} value={defaultWeight}
                  onChange={(e) => setDefaultWeight(Math.max(0, +e.target.value))}
                />
              </label>
              <label className="topo-count-field">
                <span>Capacity</span>
                <input
                  type="number" min={0.1} step={0.1} value={defaultCapacity}
                  onChange={(e) => setDefaultCapacity(Math.max(0.1, +e.target.value))}
                />
              </label>
            </div>
          ) : selectedType === "random" ? (
            /* ── Random graph config ── */
            <div className="random-config-form">
              <div className="random-config-row">
                <div className="random-config-field">
                  <label>Nodes</label>
                  <input
                    type="number" min={2} max={40} value={randomConfig.nodeCount}
                    onChange={(e) => setRandomConfig((p) => ({ ...p, nodeCount: Math.max(2, +e.target.value) }))}
                  />
                </div>
                <div className="random-config-field">
                  <label>Links</label>
                  <input
                    type="number" min={1} max={200} value={randomConfig.linkCount}
                    onChange={(e) => setRandomConfig((p) => ({ ...p, linkCount: Math.max(1, +e.target.value) }))}
                  />
                </div>
              </div>
              <div className="random-config-row">
                <div className="random-config-field">
                  <label>Weight</label>
                  <input
                    type="number" min={0} max={100} value={randomConfig.weight}
                    onChange={(e) => setRandomConfig((p) => ({ ...p, weight: Math.max(0, +e.target.value) }))}
                  />
                </div>
                <div className="random-config-field">
                  <label>Capacity</label>
                  <input
                    type="number" min={1} max={1000} value={randomConfig.capacity}
                    onChange={(e) => setRandomConfig((p) => ({ ...p, capacity: Math.max(1, +e.target.value) }))}
                  />
                </div>
              </div>
              <label className="random-config-connected">
                <input
                  type="checkbox" checked={randomConfig.connected}
                  onChange={(e) => setRandomConfig((p) => ({ ...p, connected: e.target.checked }))}
                />
                Ensure connected graph
              </label>
              <button className="btn-primary btn-sm" onClick={handleGenerateRandom} style={{ marginTop: 4 }}>
                <Shuffle size={13} /> Generate
              </button>
            </div>
          ) : (
            /* ── Non-random: S/M/L + optional custom count + default weight/capacity ── */
            <div className="topo-size-controls">
              {/* S/M/L preset pills */}
              {!supportsCustomCount ? (
                <>
                  <div className="size-pills">
                    {(["small", "medium", "large"] as TopologySize[]).map((s) => (
                      <button
                        key={s}
                        className={`size-pill ${size === s ? "size-pill--active" : ""}`}
                        onClick={() => setSize(s)}
                      >
                        {s[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <span className="topo-preview-count">{preview.nodes}N · {preview.links}L</span>
                </>
              ) : (
                /* Custom count inputs for types that support it */
                <div className="topo-custom-count-row">
                  {selectedType === "path" && (
                    <label className="topo-count-field">
                      <span>Path length</span>
                      <input type="number" min={2} max={30} value={pathNodes}
                        onChange={(e) => setPathNodes(Math.max(2, Math.min(30, +e.target.value)))} />
                    </label>
                  )}
                  {selectedType === "cycle" && (
                    <label className="topo-count-field">
                      <span>Cycle size</span>
                      <input type="number" min={3} max={20} value={cycleNodes}
                        onChange={(e) => setCycleNodes(Math.max(3, Math.min(20, +e.target.value)))} />
                    </label>
                  )}
                  {selectedType === "ring" && (
                    <label className="topo-count-field">
                      <span>Ring size</span>
                      <input type="number" min={3} max={30} value={ringNodes}
                        onChange={(e) => setRingNodes(Math.max(3, Math.min(30, +e.target.value)))} />
                    </label>
                  )}
                  {selectedType === "mesh" && (
                    <label className="topo-count-field">
                      <span>Mesh nodes</span>
                      <input type="number" min={4} max={25} value={meshNodes}
                        onChange={(e) => setMeshNodes(Math.max(4, Math.min(25, +e.target.value)))} />
                    </label>
                  )}
                  {selectedType === "grid" && (
                    <>
                      <label className="topo-count-field">
                        <span>Rows</span>
                        <input type="number" min={1} max={8} value={gridRows}
                          onChange={(e) => setGridRows(Math.max(1, Math.min(8, +e.target.value)))} />
                      </label>
                      <label className="topo-count-field">
                        <span>Cols</span>
                        <input type="number" min={1} max={8} value={gridCols}
                          onChange={(e) => setGridCols(Math.max(1, Math.min(8, +e.target.value)))} />
                      </label>
                    </>
                  )}
                  {selectedType === "fat-tree" && (
                    <>
                      <label className="topo-count-field">
                        <span>Spines</span>
                        <input type="number" min={2} max={8} value={fatSpines}
                          onChange={(e) => setFatSpines(Math.max(2, Math.min(8, +e.target.value)))} />
                      </label>
                      <label className="topo-count-field">
                        <span>Leaves</span>
                        <input type="number" min={2} max={8} value={fatLeaves}
                          onChange={(e) => setFatLeaves(Math.max(2, Math.min(8, +e.target.value)))} />
                      </label>
                    </>
                  )}
                </div>
              )}

              {/* Equal weights/capacities row */}
              <div className="topo-defaults-row">
                <span className="topo-defaults-label">Default weight &amp; capacity</span>
                <label className="topo-count-field">
                  <span>Weight</span>
                  <input
                    type="number" min={0} step={0.1} value={defaultWeight}
                    onChange={(e) => setDefaultWeight(Math.max(0, +e.target.value))}
                  />
                </label>
                <label className="topo-count-field">
                  <span>Capacity</span>
                  <input
                    type="number" min={0.1} step={0.1} value={defaultCapacity}
                    onChange={(e) => setDefaultCapacity(Math.max(0.1, +e.target.value))}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stats row — only shown when there is a warning ── */}
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
          Next: Traffic &#8594;
        </button>
      </div>
    </div>
  );
};

export default NetworkBuilderPage;
