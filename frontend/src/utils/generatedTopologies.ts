import { LinkInput, NetworkInput, NodeInput, TopologyType } from "../types/network";

export type TopologySize = "small" | "medium" | "large";

export interface RandomGraphConfig {
  nodeCount: number;
  linkCount: number;
  weight: number;
  capacity: number;
  connected: boolean;
}

export interface GenerateOptions {
  weight?: number;
  capacity?: number;
  nodeCount?: number;
  rows?: number;
  cols?: number;
  spines?: number;
  leaves?: number;
  hostsPerLeaf?: number;
}

// ── Preview metadata ──────────────────────────────────────────────────────────

const PREVIEW: Partial<Record<TopologyType, Record<TopologySize, { nodes: number; links: number }>>> = {
  triangle:  { small: {nodes:3,  links:3},  medium: {nodes:3,  links:3},  large: {nodes:3,  links:3}  },
  ring:      { small: {nodes:6,  links:6},  medium: {nodes:12, links:12}, large: {nodes:24, links:24} },
  mesh:      { small: {nodes:8,  links:12}, medium: {nodes:16, links:30}, large: {nodes:25, links:60} },
  "fat-tree":{ small: {nodes:14, links:16}, medium: {nodes:16, links:24}, large: {nodes:28, links:48} },
  line:      { small: {nodes:4,  links:3},  medium: {nodes:10, links:9},  large: {nodes:20, links:19} },
  grid:      { small: {nodes:9,  links:12}, medium: {nodes:16, links:24}, large: {nodes:25, links:40} },
  path:      { small: {nodes:4,  links:3},  medium: {nodes:8,  links:7},  large: {nodes:16, links:15} },
  cycle:     { small: {nodes:5,  links:5},  medium: {nodes:7,  links:7},  large: {nodes:9,  links:9}  },
};

export function getTopologyPreview(type: TopologyType, size: TopologySize): { nodes: number; links: number } {
  if (type === "custom" || type === "random") return { nodes: 0, links: 0 };
  return PREVIEW[type]?.[size] ?? { nodes: 0, links: 0 };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export function generateTopology(type: TopologyType, size: TopologySize, opts?: GenerateOptions): NetworkInput {
  const w = opts?.weight ?? 1;
  const cap = opts?.capacity ?? 10;

  if (type === "custom" || type === "random") {
    return { nodes: [], links: [], demands: [], topologyType: type, isDirected: false };
  }

  if (type === "fat-tree") {
    const spines = opts?.spines;
    const leaves = opts?.leaves;
    const hpl = opts?.hostsPerLeaf ?? 2;
    if (spines !== undefined && leaves !== undefined) return closFatTree(spines, leaves, hpl, "fat-tree", w, cap);
    if (size === "small")  return closFatTree(2, 4, hpl, "fat-tree", w, cap);
    if (size === "medium") return closFatTree(4, 4, hpl, "fat-tree", w, cap);
    return closFatTree(4, 8, hpl, "fat-tree", w, cap);
  }

  if (type === "grid") {
    const rows = opts?.rows;
    const cols = opts?.cols;
    if (rows !== undefined && cols !== undefined) return gridTopology(rows, cols, "grid", w, cap);
    if (size === "small")  return gridTopology(3, 3, "grid", w, cap);
    if (size === "medium") return gridTopology(4, 4, "grid", w, cap);
    return gridTopology(5, 5, "grid", w, cap);
  }

  if (type === "path") {
    const nc = opts?.nodeCount;
    if (nc !== undefined) return pathTopology(nc, "path", w, cap);
    if (size === "small")  return pathTopology(4,  "path", w, cap);
    if (size === "medium") return pathTopology(8,  "path", w, cap);
    return pathTopology(16, "path", w, cap);
  }

  if (type === "cycle") {
    const nc = opts?.nodeCount;
    if (nc !== undefined) return cycleTopology(nc, "cycle", w, cap);
    if (size === "small")  return cycleTopology(5, "cycle", w, cap);
    if (size === "medium") return cycleTopology(7, "cycle", w, cap);
    return cycleTopology(9, "cycle", w, cap);
  }

  // Triangle is always the canonical 3-node topology — size selector has no effect.
  if (type === "triangle") return canonicalTriangle(w, cap);

  // Legacy generators: ring, mesh, line
  const nodeCounts: Record<string, Record<TopologySize, number>> = {
    ring:  { small: 6,  medium: 12, large: 24 },
    mesh:  { small: 8,  medium: 16, large: 25 },
    line:  { small: 4,  medium: 10, large: 20 },
  };
  const nc = opts?.nodeCount;
  const count = nc ?? (nodeCounts[type]?.[size] ?? 4);
  if (type === "ring") return ringTopology(count, type, w, cap);
  if (type === "mesh") return meshTopology(count, type, w, cap);
  return lineTopology(count, type, w, cap);
}

// ── Auto-layout ───────────────────────────────────────────────────────────────

export function applyAutoLayout(network: NetworkInput): NetworkInput {
  if (network.nodes.length <= 1) return network;
  const radius = Math.min(230, Math.max(110, network.nodes.length * 8));
  return {
    ...network,
    nodes: network.nodes.map((node, index) => {
      const angle = (index / network.nodes.length) * Math.PI * 2 - Math.PI / 2;
      return { ...node, x: 350 + Math.cos(angle) * radius, y: 260 + Math.sin(angle) * radius };
    }),
  };
}

// ── Clos Fat-Tree ─────────────────────────────────────────────────────────────

function closFatTree(spineCount: number, leafCount: number, hostsPerLeaf: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const hostCount = leafCount * hostsPerLeaf;
  const canvasWidth = 700;
  const marginX = 60;
  const effectiveW = canvasWidth - 2 * marginX;

  const hosts: NodeInput[] = Array.from({ length: hostCount }, (_, i) => ({
    id: `h${i + 1}`,
    label: `H${i + 1}`,
    x: hostCount === 1 ? canvasWidth / 2 : marginX + (i * effectiveW) / (hostCount - 1),
    y: 400,
  }));

  const leaves: NodeInput[] = Array.from({ length: leafCount }, (_, li) => {
    const slice = hosts.slice(li * hostsPerLeaf, (li + 1) * hostsPerLeaf);
    const avgX = slice.reduce((s, h) => s + h.x, 0) / slice.length;
    return { id: `l${li + 1}`, label: `L${li + 1}`, x: avgX, y: 245 };
  });

  const leafMinX = Math.min(...leaves.map((l) => l.x));
  const leafMaxX = Math.max(...leaves.map((l) => l.x));
  const spines: NodeInput[] = Array.from({ length: spineCount }, (_, si) => ({
    id: `s${si + 1}`,
    label: `S${si + 1}`,
    x: spineCount === 1 ? (leafMinX + leafMaxX) / 2 : leafMinX + (si * (leafMaxX - leafMinX)) / (spineCount - 1),
    y: 90,
  }));

  const nodes = [...spines, ...leaves, ...hosts];
  const links: LinkInput[] = [];
  let lid = 1;

  hosts.forEach((host, i) => {
    links.push({ id: `hl${lid++}`, source: host.id, target: leaves[Math.floor(i / hostsPerLeaf)].id, weight, capacity });
  });
  leaves.forEach((leaf) => {
    spines.forEach((spine) => {
      links.push({ id: `ls${lid++}`, source: leaf.id, target: spine.id, weight, capacity });
    });
  });

  return {
    nodes, links,
    demands: [{ id: "d1", source: hosts[0].id, target: hosts[hostCount - 1].id, amount: 1 }],
    topologyType, isDirected: false,
  };
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function gridTopology(rows: number, cols: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const spacingX = 560 / Math.max(1, cols - 1);
  const spacingY = 400 / Math.max(1, rows - 1);
  const nodes: NodeInput[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      nodes.push({
        id: `n${idx + 1}`,
        label: idx < 26 ? LETTERS[idx] : `N${idx + 1}`,
        x: 80 + c * spacingX,
        y: 80 + r * spacingY,
      });
    }
  }

  const links: LinkInput[] = [];
  let lid = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      links.push({ id: `l${lid++}`, source: nodes[r * cols + c].id, target: nodes[r * cols + c + 1].id, weight, capacity });
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      links.push({ id: `l${lid++}`, source: nodes[r * cols + c].id, target: nodes[(r + 1) * cols + c].id, weight, capacity });
    }
  }

  return {
    nodes, links,
    demands: [{ id: "d1", source: nodes[0].id, target: nodes[nodes.length - 1].id, amount: 1 }],
    topologyType, isDirected: false,
  };
}

// ── Path Graph ────────────────────────────────────────────────────────────────

function pathTopology(count: number, topologyType: TopologyType, weight = 10, capacity = 10): NetworkInput {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const marginX = count > 8 ? 40 : 80;
  const spacing = (640 - 2 * marginX) / Math.max(1, count - 1);

  const nodes: NodeInput[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i + 1}`,
    label: i < 26 ? LETTERS[i] : `N${i + 1}`,
    x: marginX + i * spacing,
    y: 260,
  }));

  const links: LinkInput[] = nodes.slice(0, -1).map((node, i) => ({
    id: `l${i + 1}`,
    source: node.id,
    target: nodes[i + 1].id,
    weight,
    capacity,
  }));

  return {
    nodes, links,
    demands: [{ id: "d1", source: nodes[0].id, target: nodes[count - 1].id, amount: 1 }],
    topologyType, isDirected: false,
  };
}

// ── Cycle ─────────────────────────────────────────────────────────────────────

function cycleTopology(count: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const radius = Math.min(220, Math.max(100, count * 24));

  const nodes: NodeInput[] = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `n${i + 1}`,
      label: i < 26 ? LETTERS[i] : `N${i + 1}`,
      x: Math.round(360 + Math.cos(angle) * radius),
      y: Math.round(270 + Math.sin(angle) * radius),
    };
  });

  const links: LinkInput[] = Array.from({ length: count }, (_, i) => ({
    id: `l${i + 1}`,
    source: nodes[i].id,
    target: nodes[(i + 1) % count].id,
    weight,
    capacity,
  }));

  return {
    nodes, links,
    demands: [{ id: "d1", source: nodes[0].id, target: nodes[Math.floor(count / 2)].id, amount: 1 }],
    topologyType, isDirected: false,
  };
}

// ── Random Graph ──────────────────────────────────────────────────────────────

export function generateRandomTopology(config: RandomGraphConfig): NetworkInput {
  const { nodeCount, linkCount, weight, capacity, connected } = config;
  if (nodeCount < 2) {
    return { nodes: [], links: [], demands: [], topologyType: "random", isDirected: false };
  }

  const radius = Math.min(240, Math.max(90, nodeCount * 20));
  const nodes: NodeInput[] = Array.from({ length: nodeCount }, (_, i) => {
    const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `n${i + 1}`,
      label: `N${i + 1}`,
      x: Math.round(360 + Math.cos(angle) * radius),
      y: Math.round(270 + Math.sin(angle) * radius),
    };
  });

  const links: LinkInput[] = [];
  const edgeSet = new Set<string>();
  let lid = 1;

  const addEdge = (src: string, tgt: string): boolean => {
    const key = src < tgt ? `${src}-${tgt}` : `${tgt}-${src}`;
    if (edgeSet.has(key) || src === tgt) return false;
    edgeSet.add(key);
    links.push({ id: `l${lid++}`, source: src, target: tgt, weight, capacity });
    return true;
  };

  if (connected) {
    const order = Array.from({ length: nodeCount }, (_, i) => i).sort(() => Math.random() - 0.5);
    for (let i = 1; i < nodeCount; i++) {
      addEdge(nodes[order[i]].id, nodes[order[Math.floor(Math.random() * i)]].id);
    }
  }

  const maxPossible = (nodeCount * (nodeCount - 1)) / 2;
  const target = Math.min(linkCount, maxPossible);
  let attempts = 0;
  while (links.length < target && attempts < target * 30) {
    const i = Math.floor(Math.random() * nodeCount);
    const j = Math.floor(Math.random() * nodeCount);
    addEdge(nodes[i].id, nodes[j].id);
    attempts++;
  }

  return {
    nodes, links,
    demands: [{ id: "d1", source: nodes[0].id, target: nodes[nodeCount - 1].id, amount: 1 }],
    topologyType: "random", isDirected: false,
  };
}

// ── Canonical triangle ────────────────────────────────────────────────────────
// Always exactly 3 nodes, 3 links, in a triangular layout.
// u (top-center), v (bottom-left), t (bottom-right).
// The diagonal link u–t has weight*2 so ECMP splits traffic evenly between
// the direct path u→t and the indirect path u→v→t.

function canonicalTriangle(weight = 1, capacity = 10): NetworkInput {
  const nodes: NodeInput[] = [
    { id: "u", label: "u", x: 300, y: 100 },
    { id: "v", label: "v", x: 130, y: 360 },
    { id: "t", label: "t", x: 470, y: 360 },
  ];
  const links: LinkInput[] = [
    { id: "u-v", source: "u", target: "v", weight, capacity },
    { id: "v-t", source: "v", target: "t", weight, capacity },
    { id: "u-t", source: "u", target: "t", weight: weight * 2, capacity },
  ];
  return {
    nodes, links,
    demands: [{ id: "d1", source: "u", target: "t", amount: 1.5 }],
    topologyType: "triangle", isDirected: false,
  };
}

// ── Legacy generators ─────────────────────────────────────────────────────────

function makeNodes(count: number): NodeInput[] {
  const radius = Math.min(230, Math.max(110, count * 8));
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `n${index + 1}`,
      label: `N${index + 1}`,
      x: 350 + Math.cos(angle) * radius,
      y: 260 + Math.sin(angle) * radius,
    };
  });
}

function lnk(id: string, source: string, target: string, weight = 1, capacity = 10): LinkInput {
  return { id, source, target, weight, capacity };
}

function ringTopology(count: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const nodes = makeNodes(count);
  const links = nodes.map((node, i) => lnk(`l${i + 1}`, node.id, nodes[(i + 1) % count].id, weight, capacity));
  return withDemand(nodes, links, topologyType);
}

function triangleLikeTopology(count: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const base = ringTopology(count, topologyType, weight, capacity);
  const chords: LinkInput[] = [];
  for (let i = 0; i < count; i += 2) {
    const target = (i + 2) % count;
    if (target !== i) chords.push(lnk(`c${i + 1}`, base.nodes[i].id, base.nodes[target].id, weight * 2, capacity));
  }
  return withDemand(base.nodes, [...base.links, ...chords], topologyType);
}

function meshTopology(count: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const nodes = makeNodes(count);
  const links: LinkInput[] = [];
  let id = 1;
  for (let i = 0; i < count; i++) {
    links.push(lnk(`l${id++}`, nodes[i].id, nodes[(i + 1) % count].id, weight, capacity));
  }
  const stride = Math.max(2, Math.floor(Math.sqrt(count)));
  for (let i = 0; i < count; i++) {
    const target = (i + stride) % count;
    if (i < target) links.push(lnk(`l${id++}`, nodes[i].id, nodes[target].id, weight * 2, capacity));
  }
  for (let i = 0; i < count - stride; i += stride) {
    links.push(lnk(`l${id++}`, nodes[i].id, nodes[i + stride].id, weight, capacity));
  }
  return withDemand(nodes, links, topologyType);
}

function lineTopology(count: number, topologyType: TopologyType, weight = 1, capacity = 10): NetworkInput {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i + 1}`,
    label: `N${i + 1}`,
    x: 80 + i * (560 / Math.max(1, count - 1)),
    y: 260,
  }));
  const links = nodes.slice(0, -1).map((node, i) => lnk(`l${i + 1}`, node.id, nodes[i + 1].id, weight, capacity));
  return withDemand(nodes, links, topologyType);
}

function withDemand(nodes: NodeInput[], links: LinkInput[], topologyType: TopologyType): NetworkInput {
  return {
    nodes, links,
    demands: nodes.length > 1 ? [{ id: "d1", source: nodes[0].id, target: nodes[nodes.length - 1].id, amount: 5 }] : [],
    topologyType, isDirected: false,
  };
}
