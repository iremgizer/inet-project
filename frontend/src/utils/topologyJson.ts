import { NetworkInput, NodeInput, LinkInput, TrafficDemandInput, TopologyType } from "../types/network";
import { applyAutoLayout } from "./generatedTopologies";

// ── Raw schema shape ──────────────────────────────────────────────────────────

interface RawNode   { id: string; label: string; x?: number; y?: number }
interface RawLink   { id: string; source: string; target: string; weight?: number; capacity?: number }
interface RawDemand { id: string; source: string; target: string; amount: number }

export interface TopologyJsonFile {
  name?: string;
  topologyType?: string;
  isDirected?: boolean;
  nodes: RawNode[];
  links: RawLink[];
  demands?: RawDemand[];
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTopologyJson(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["Root value must be a JSON object."] };
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.nodes)) errors.push('"nodes" must be an array.');
  if (!Array.isArray(obj.links)) errors.push('"links" must be an array.');

  if (errors.length) return { valid: false, errors };

  const nodes = obj.nodes as unknown[];
  const links = obj.links as unknown[];
  const demands = Array.isArray(obj.demands) ? (obj.demands as unknown[]) : [];

  // Node validation
  const nodeIds = new Set<string>();
  nodes.forEach((n, i) => {
    if (typeof n !== "object" || n === null) { errors.push(`nodes[${i}]: must be an object.`); return; }
    const node = n as Record<string, unknown>;
    if (typeof node.id !== "string" || !node.id) errors.push(`nodes[${i}]: "id" must be a non-empty string.`);
    if (typeof node.label !== "string" || !node.label) errors.push(`nodes[${i}]: "label" must be a non-empty string.`);
    if (node.id) {
      if (nodeIds.has(node.id as string)) errors.push(`nodes[${i}]: duplicate id "${node.id}".`);
      nodeIds.add(node.id as string);
    }
  });

  // Link validation
  const linkIds = new Set<string>();
  links.forEach((l, i) => {
    if (typeof l !== "object" || l === null) { errors.push(`links[${i}]: must be an object.`); return; }
    const lk = l as Record<string, unknown>;
    if (typeof lk.id !== "string" || !lk.id) errors.push(`links[${i}]: "id" must be a non-empty string.`);
    if (typeof lk.source !== "string" || !lk.source) errors.push(`links[${i}]: "source" must be a non-empty string.`);
    if (typeof lk.target !== "string" || !lk.target) errors.push(`links[${i}]: "target" must be a non-empty string.`);
    if (lk.id) {
      if (linkIds.has(lk.id as string)) errors.push(`links[${i}]: duplicate id "${lk.id}".`);
      linkIds.add(lk.id as string);
    }
    if (lk.source && !nodeIds.has(lk.source as string)) errors.push(`links[${i}]: source "${lk.source}" does not exist in nodes.`);
    if (lk.target && !nodeIds.has(lk.target as string)) errors.push(`links[${i}]: target "${lk.target}" does not exist in nodes.`);
    if (lk.capacity !== undefined && (typeof lk.capacity !== "number" || lk.capacity <= 0))
      errors.push(`links[${i}]: "capacity" must be a positive number.`);
    if (lk.weight !== undefined && (typeof lk.weight !== "number" || lk.weight < 0))
      errors.push(`links[${i}]: "weight" must be >= 0.`);
  });

  // Demand validation
  const demandIds = new Set<string>();
  demands.forEach((d, i) => {
    if (typeof d !== "object" || d === null) { errors.push(`demands[${i}]: must be an object.`); return; }
    const dm = d as Record<string, unknown>;
    if (typeof dm.id !== "string" || !dm.id) errors.push(`demands[${i}]: "id" must be a non-empty string.`);
    if (dm.id) {
      if (demandIds.has(dm.id as string)) errors.push(`demands[${i}]: duplicate id "${dm.id}".`);
      demandIds.add(dm.id as string);
    }
    if (dm.source && !nodeIds.has(dm.source as string)) errors.push(`demands[${i}]: source "${dm.source}" does not exist in nodes.`);
    if (dm.target && !nodeIds.has(dm.target as string)) errors.push(`demands[${i}]: target "${dm.target}" does not exist in nodes.`);
    if (typeof dm.amount !== "number" || dm.amount <= 0) errors.push(`demands[${i}]: "amount" must be a positive number.`);
  });

  return { valid: errors.length === 0, errors };
}

// ── Import ────────────────────────────────────────────────────────────────────

export function importTopologyJson(data: TopologyJsonFile): NetworkInput {
  const hasPositions = data.nodes.some((n) => typeof n.x === "number" && typeof n.y === "number");

  const nodes: NodeInput[] = data.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    x: typeof n.x === "number" ? n.x : 0,
    y: typeof n.y === "number" ? n.y : 0,
    visualType: "node",
  }));

  const links: LinkInput[] = data.links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    weight: typeof l.weight === "number" ? l.weight : 1,
    capacity: typeof l.capacity === "number" ? l.capacity : 10,
  }));

  const demands: TrafficDemandInput[] = (data.demands ?? []).map((d) => ({
    id: d.id,
    source: d.source,
    target: d.target,
    amount: d.amount,
  }));

  const validTopologyTypes: TopologyType[] = ["custom", "triangle", "ring", "mesh", "fat-tree", "line", "grid", "path", "cycle", "random"];
  const topologyType = validTopologyTypes.includes(data.topologyType as TopologyType)
    ? (data.topologyType as TopologyType)
    : "custom";

  let network: NetworkInput = {
    nodes,
    links,
    demands,
    topologyType,
    isDirected: data.isDirected ?? false,
  };

  // Auto-layout if positions are missing
  if (!hasPositions && network.nodes.length > 0) {
    network = applyAutoLayout(network);
  }

  return network;
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportTopologyJson(network: NetworkInput, name?: string): string {
  const file: TopologyJsonFile & { name?: string } = {
    name: name ?? `${network.topologyType} network`,
    topologyType: network.topologyType,
    isDirected: network.isDirected,
    nodes: network.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      x: Math.round(n.x),
      y: Math.round(n.y),
    })),
    links: network.links.map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      weight: l.weight,
      capacity: l.capacity,
    })),
    demands: network.demands.map((d) => ({
      id: d.id,
      source: d.source,
      target: d.target,
      amount: d.amount,
    })),
  };
  return JSON.stringify(file, null, 2);
}

export function downloadTopologyJson(network: NetworkInput, filename = "topology.json"): void {
  const json = exportTopologyJson(network);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Example JSON ──────────────────────────────────────────────────────────────

const EXAMPLE_TOPOLOGY: TopologyJsonFile & { name: string } = {
  name: "Example Triangle Network",
  topologyType: "custom",
  isDirected: false,
  nodes: [
    { id: "A", label: "A", x: 120, y: 220 },
    { id: "B", label: "B", x: 320, y: 80  },
    { id: "C", label: "C", x: 520, y: 220 },
  ],
  links: [
    { id: "A-B", source: "A", target: "B", weight: 1, capacity: 10 },
    { id: "B-C", source: "B", target: "C", weight: 1, capacity: 10 },
    { id: "A-C", source: "A", target: "C", weight: 2, capacity: 10 },
  ],
  demands: [
    { id: "d1", source: "A", target: "C", amount: 5 },
  ],
};

export function downloadExampleTopologyJson(): void {
  const json = JSON.stringify(EXAMPLE_TOPOLOGY, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "example-topology.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Parse file ────────────────────────────────────────────────────────────────

export function parseTopologyFile(file: File): Promise<TopologyJsonFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        resolve(data);
      } catch {
        reject(new Error("Invalid JSON file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}
