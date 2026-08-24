import { NetworkInput } from "../types/network";

// ── Node label resolution — the single source of truth for turning an
// internal node id ("n3") into the human-readable label the canvas already
// shows ("C"). Internal ids are never changed anywhere — this is purely a
// display-layer lookup, used by every user-facing view that shows a demand,
// a path, a segment list, or a route, instead of each component re-deriving
// its own ad-hoc `.find()` lookup (which is how the id/label mismatch this
// module fixes actually happened — most call sites just rendered the raw id
// they were handed).

export type NodeLabelMap = Map<string, string>;
type NetworkLike = Pick<NetworkInput, "nodes">;

/** Build a nodeId -> display label lookup once per network. Prefer this over
 * calling resolveNodeLabel/formatNodePath with a raw NetworkInput in a loop
 * — building the map once is O(nodes), each lookup after that is O(1). */
export function buildNodeLabelMap(network: NetworkLike | null | undefined): NodeLabelMap {
  const map = new Map<string, string>();
  if (!network) return map;
  for (const node of network.nodes) {
    map.set(node.id, node.label && node.label.trim() ? node.label : node.id);
  }
  return map;
}

/** Resolves one node id to its display label — node.label if present and
 * non-empty, else the raw id itself (never blank, never undefined). Accepts
 * either a pre-built NodeLabelMap or a raw network (built into a map
 * internally) so call sites with just one lookup don't need a separate
 * buildNodeLabelMap call. */
export function resolveNodeLabel(nodeId: string, source: NodeLabelMap | NetworkLike | null | undefined): string {
  const map = source instanceof Map ? source : buildNodeLabelMap(source);
  return map.get(nodeId) ?? nodeId;
}

/** Formats an ordered list of node ids as a human-readable path, e.g.
 * ["n1", "n2", "n3"] -> "A → B → C". Used for resolved routes, segment
 * listings, and any other node-id sequence shown as a path. */
export function formatNodePath(
  nodeIds: string[],
  source: NodeLabelMap | NetworkLike | null | undefined,
  separator = " → "
): string {
  const map = source instanceof Map ? source : buildNodeLabelMap(source);
  return nodeIds.map((id) => map.get(id) ?? id).join(separator);
}

/** For advanced/debug displays that want to show both the label and the
 * underlying id — "C (n3)" — never used in normal student-facing UI, which
 * should show just the label via resolveNodeLabel/formatNodePath. */
export function formatNodeWithId(nodeId: string, source: NodeLabelMap | NetworkLike | null | undefined): string {
  const map = source instanceof Map ? source : buildNodeLabelMap(source);
  const label = map.get(nodeId) ?? nodeId;
  return label === nodeId ? label : `${label} (${nodeId})`;
}
