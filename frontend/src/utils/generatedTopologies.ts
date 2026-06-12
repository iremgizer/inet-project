import { LinkInput, NetworkInput, NodeInput, TopologyType } from "../types/network";

export type TopologySize = "small" | "medium" | "large";

const counts: Record<Exclude<TopologyType, "custom">, Record<TopologySize, number>> = {
  triangle: { small: 3, medium: 6, large: 12 },
  ring: { small: 6, medium: 12, large: 24 },
  mesh: { small: 8, medium: 20, large: 50 },
  "fat-tree": { small: 8, medium: 32, large: 64 },
  line: { small: 4, medium: 10, large: 20 },
};

export function getTopologyPreview(type: TopologyType, size: TopologySize) {
  if (type === "custom") return { nodes: 0, links: 0 };
  const nodes = counts[type]?.[size] || 0;
  if (type === "ring") return { nodes, links: nodes };
  if (type === "triangle") return { nodes, links: nodes === 3 ? 3 : nodes + Math.floor(nodes / 2) };
  if (type === "mesh") return { nodes, links: estimateMeshLinks(nodes) };
  if (type === "fat-tree") return { nodes, links: Math.max(0, nodes + Math.floor(nodes / 2)) };
  return { nodes, links: Math.max(0, nodes - 1) };
}

export function generateTopology(type: TopologyType, size: TopologySize): NetworkInput {
  if (type === "custom") {
    return { nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false };
  }
  const nodeCount = counts[type]?.[size] || 3;
  if (type === "ring") return ringTopology(nodeCount, type);
  if (type === "mesh") return meshTopology(nodeCount, type);
  if (type === "fat-tree") return fatTreeTopology(nodeCount, type);
  if (type === "triangle") return triangleLikeTopology(nodeCount, type);
  return lineTopology(nodeCount, type);
}

export function applyAutoLayout(network: NetworkInput): NetworkInput {
  if (network.nodes.length <= 1) return network;
  const radius = Math.min(230, Math.max(110, network.nodes.length * 8));
  const centerX = 350;
  const centerY = 260;
  return {
    ...network,
    nodes: network.nodes.map((node, index) => {
      const angle = (index / network.nodes.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...node,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    }),
  };
}

function makeNodes(count: number, labelPrefix = "N"): NodeInput[] {
  const radius = Math.min(230, Math.max(110, count * 8));
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `n${index + 1}`,
      label: `${labelPrefix}${index + 1}`,
      x: 350 + Math.cos(angle) * radius,
      y: 260 + Math.sin(angle) * radius,
      visualType: "node",
    };
  });
}

function link(id: string, source: string, target: string, weight = 1, capacity = 10): LinkInput {
  return { id, source, target, weight, capacity };
}

function ringTopology(count: number, topologyType: TopologyType): NetworkInput {
  const nodes = makeNodes(count);
  const links = nodes.map((node, index) => link(`l${index + 1}`, node.id, nodes[(index + 1) % count].id));
  return withDemand(nodes, links, topologyType);
}

function triangleLikeTopology(count: number, topologyType: TopologyType): NetworkInput {
  const base = ringTopology(count, topologyType);
  const chords: LinkInput[] = [];
  for (let i = 0; i < count; i += 2) {
    const target = (i + 2) % count;
    if (target !== i) chords.push(link(`c${i + 1}`, base.nodes[i].id, base.nodes[target].id, 2, 10));
  }
  return withDemand(base.nodes, [...base.links, ...chords], topologyType);
}

function meshTopology(count: number, topologyType: TopologyType): NetworkInput {
  const nodes = makeNodes(count);
  const links: LinkInput[] = [];
  let id = 1;
  for (let i = 0; i < count; i++) {
    links.push(link(`l${id++}`, nodes[i].id, nodes[(i + 1) % count].id));
  }
  const stride = Math.max(2, Math.floor(Math.sqrt(count)));
  for (let i = 0; i < count; i++) {
    const target = (i + stride) % count;
    if (i < target) links.push(link(`l${id++}`, nodes[i].id, nodes[target].id, 2, 12));
  }
  for (let i = 0; i < count - stride; i += stride) {
    links.push(link(`l${id++}`, nodes[i].id, nodes[i + stride].id, 1, 12));
  }
  return withDemand(nodes, links, topologyType);
}

function fatTreeTopology(count: number, topologyType: TopologyType): NetworkInput {
  const coreCount = Math.max(1, Math.round(count * 0.125));
  const aggCount = Math.max(2, Math.round(count * 0.25));
  const edgeCount = Math.max(2, Math.round(count * 0.25));
  const hostCount = Math.max(1, count - coreCount - aggCount - edgeCount);
  const layers = [
    { count: coreCount, prefix: "C", y: 70 },
    { count: aggCount, prefix: "A", y: 180 },
    { count: edgeCount, prefix: "E", y: 300 },
    { count: hostCount, prefix: "H", y: 430 },
  ];
  const nodes: NodeInput[] = [];
  layers.forEach((layer) => {
    for (let i = 0; i < layer.count; i++) {
      nodes.push({
        id: `${layer.prefix.toLowerCase()}${i + 1}`,
        label: `${layer.prefix}${i + 1}`,
        x: 80 + (i * 540) / Math.max(1, layer.count - 1),
        y: layer.y,
        visualType: "node",
      });
    }
  });
  const links: LinkInput[] = [];
  let id = 1;
  const byPrefix = (prefix: string) => nodes.filter((node) => node.id.startsWith(prefix));
  const cores = byPrefix("c");
  const aggs = byPrefix("a");
  const edges = byPrefix("e");
  const hosts = byPrefix("h");
  aggs.forEach((agg, index) => links.push(link(`l${id++}`, cores[index % cores.length].id, agg.id)));
  edges.forEach((edge, index) => links.push(link(`l${id++}`, aggs[index % aggs.length].id, edge.id)));
  hosts.forEach((host, index) => links.push(link(`l${id++}`, edges[index % edges.length].id, host.id)));
  return withDemand(nodes, links, topologyType);
}

function lineTopology(count: number, topologyType: TopologyType): NetworkInput {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n${index + 1}`,
    label: `N${index + 1}`,
    x: 80 + index * (560 / Math.max(1, count - 1)),
    y: 260,
  }));
  const links = nodes.slice(0, -1).map((node, index) => link(`l${index + 1}`, node.id, nodes[index + 1].id));
  return withDemand(nodes, links, topologyType);
}

function withDemand(nodes: NodeInput[], links: LinkInput[], topologyType: TopologyType): NetworkInput {
  return {
    nodes,
    links,
    demands: nodes.length > 1 ? [{ id: "d1", source: nodes[0].id, target: nodes[nodes.length - 1].id, amount: 5 }] : [],
    topologyType,
    isDirected: false,
  };
}

function estimateMeshLinks(nodes: number) {
  return nodes + Math.max(0, nodes - Math.floor(Math.sqrt(nodes))) + Math.ceil(nodes / Math.max(2, Math.floor(Math.sqrt(nodes))));
}
