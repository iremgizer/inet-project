import {
  NetworkInput,
  NodeInput,
  LinkInput,
  TrafficDemandInput,
  SimulationResult,
  LinkResult,
  NodeRoleResult,
  PathResult,
} from "../types/network";

// ── Topology helpers ──────────────────────────────────────────────────────────

export interface NeighborInfo {
  node: NodeInput;
  link: LinkInput;
  direction: "outgoing" | "incoming" | "both";
}

export function getNodeNeighbors(nodeId: string, network: NetworkInput): NeighborInfo[] {
  const nodeMap = new Map(network.nodes.map((n) => [n.id, n]));
  const results: NeighborInfo[] = [];

  for (const link of network.links) {
    if (link.source === nodeId) {
      const neighbor = nodeMap.get(link.target);
      if (neighbor) results.push({ node: neighbor, link, direction: "outgoing" });
    } else if (link.target === nodeId) {
      const neighbor = nodeMap.get(link.source);
      if (neighbor) results.push({ node: neighbor, link, direction: "incoming" });
    }
  }

  if (!network.isDirected) {
    return results.map((r) => ({ ...r, direction: "both" as const }));
  }
  return results;
}

export function getNodeConnectedLinks(nodeId: string, network: NetworkInput): LinkInput[] {
  return network.links.filter((l) => l.source === nodeId || l.target === nodeId);
}

// ── Demand roles ──────────────────────────────────────────────────────────────

export interface DemandRole {
  demand: TrafficDemandInput;
  role: "source" | "destination";
  otherLabel: string;
}

export function getNodeDemandRoles(nodeId: string, network: NetworkInput): DemandRole[] {
  const nodeLabel = (id: string) => network.nodes.find((n) => n.id === id)?.label ?? id;
  const roles: DemandRole[] = [];

  for (const d of network.demands) {
    if (d.source === nodeId)
      roles.push({ demand: d, role: "source", otherLabel: nodeLabel(d.target) });
    else if (d.target === nodeId)
      roles.push({ demand: d, role: "destination", otherLabel: nodeLabel(d.source) });
  }
  return roles;
}

// ── Simulation roles ──────────────────────────────────────────────────────────

export function getNodeSimulationRoles(
  nodeId: string,
  result: SimulationResult | null
): NodeRoleResult | null {
  if (!result) return null;
  return result.nodeRoles.find((r) => r.nodeId === nodeId) ?? null;
}

// ── Traffic summary ───────────────────────────────────────────────────────────

export interface NodeTrafficSummary {
  outgoingLoad: number;
  incomingLoad: number;
  transitLoad: number;
}

export function getNodeTrafficSummary(
  nodeId: string,
  network: NetworkInput,
  result: SimulationResult | null
): NodeTrafficSummary {
  if (!result) return { outgoingLoad: 0, incomingLoad: 0, transitLoad: 0 };

  const linkResultMap = new Map<string, LinkResult>(result.linkResults.map((r) => [r.linkId, r]));
  let outgoing = 0;
  let incoming = 0;

  for (const link of network.links) {
    const lr = linkResultMap.get(link.id);
    if (!lr) continue;
    if (link.source === nodeId) outgoing += lr.load;
    if (link.target === nodeId) incoming += lr.load;
  }

  const role = result.nodeRoles.find((r) => r.nodeId === nodeId);
  const isDst = (role?.asDestinationFor?.length ?? 0) > 0;
  const isSrc = (role?.asSourceFor?.length ?? 0) > 0;

  const transit = isDst ? 0 : incoming;

  return {
    outgoingLoad: parseFloat(outgoing.toFixed(3)),
    incomingLoad: parseFloat(incoming.toFixed(3)),
    transitLoad: parseFloat((isSrc || isDst ? 0 : transit).toFixed(3)),
  };
}

// ── Congested links ───────────────────────────────────────────────────────────

export function getConnectedCongestedLinks(
  nodeId: string,
  network: NetworkInput,
  result: SimulationResult | null
): LinkResult[] {
  if (!result) return [];
  const connectedIds = new Set(
    network.links
      .filter((l) => l.source === nodeId || l.target === nodeId)
      .map((l) => l.id)
  );
  return result.linkResults.filter((r) => connectedIds.has(r.linkId) && r.isCongested);
}

// ── Link usage ────────────────────────────────────────────────────────────────

export interface LinkUsage {
  demandId: string;
  source: string;
  target: string;
  trafficShare: number;
  pathNodes: string[];
}

export function getLinkUsageSummary(
  linkId: string,
  network: NetworkInput,
  result: SimulationResult | null
): LinkUsage[] {
  if (!result) return [];

  const link = network.links.find((l) => l.id === linkId);
  if (!link) return [];

  const usages: LinkUsage[] = [];

  for (const pr of result.pathResults) {
    for (const share of pr.paths) {
      const nodes = share.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        if (
          (a === link.source && b === link.target) ||
          (!network.isDirected && a === link.target && b === link.source)
        ) {
          usages.push({
            demandId: pr.demandId,
            source: pr.source,
            target: pr.target,
            trafficShare: share.trafficShare,
            pathNodes: nodes,
          });
        }
      }
    }
  }
  return usages;
}

// ── Utilization color ─────────────────────────────────────────────────────────

export function utilizationColor(util: number): "safe" | "warning" | "danger" {
  if (util > 1) return "danger";
  if (util > 0.7) return "warning";
  return "safe";
}

export function utilizationLabel(util: number): string {
  if (util > 1) return "Congested";
  if (util > 0.7) return "High load";
  return "Normal";
}
