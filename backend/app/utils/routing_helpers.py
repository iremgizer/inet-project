"""Small, pure, algorithm-agnostic routing helpers.

These are net-new functions extracted for Segment Routing so its engine does
not duplicate the path-cost/link-id helper pattern that already exists
privately inside `ecmp.py` and `distance_vector.py`. ECMP and Distance Vector
are intentionally left untouched — nothing here is imported by them, and
nothing about their behavior changes. Future algorithms (weighted ECMP, TE
policies) can reuse these same helpers instead of re-duplicating the pattern
a third and fourth time.
"""
from typing import Dict, List, Tuple

import networkx as nx

from app.models import LinkInput, NetworkInput, NodeRoleResult, PathResult, SimulationTraceEvent

LinkMap = Dict[Tuple[str, str], LinkInput]


def resolve_segment_route(
    graph: "nx.Graph",
    source: str,
    destination: str,
    segments: List[str],
) -> Tuple[List[str], List[List[str]]]:
    """Resolve a Segment Routing V1 route through an ordered waypoint list.

    Semantics: `waypoints = [source] + segments + [destination]`. Between each
    consecutive pair of waypoints, traffic follows the normal weighted
    shortest path (NetworkX Dijkstra) — a waypoint only forces *which* nodes
    are visited, not how the graph is traversed between them.

    Returns `(full_path, leg_paths)`:
      - `leg_paths` is the list of per-leg shortest paths, one per consecutive
        waypoint pair, each including both of that leg's endpoints.
      - `full_path` is the concatenation of all legs with the shared boundary
        node de-duplicated, e.g. leg paths [A,B,C] + [C,D,E] concatenate to
        [A,B,C,D,E], not [A,B,C,C,D,E].

    Raises `nx.NetworkXNoPath` if any leg is unreachable, or `nx.NodeNotFound`
    if a waypoint/source/destination is not a node in `graph`. Callers should
    catch both and degrade to a per-demand soft failure rather than letting
    either propagate into a 500 response.
    """
    waypoints = [source] + list(segments) + [destination]
    leg_paths: List[List[str]] = []
    for i in range(len(waypoints) - 1):
        leg_paths.append(
            nx.shortest_path(graph, waypoints[i], waypoints[i + 1], weight="weight")
        )

    full_path: List[str] = [leg_paths[0][0]]
    for leg in leg_paths:
        full_path.extend(leg[1:])
    return full_path, leg_paths


def sanitize_segments(segments: List[str], source: str, target: str) -> List[str]:
    """Apply the documented Segment Routing edge-case rules to a raw segment list.

    - Leading occurrence(s) of `source`: ignored (the caller doesn't need to
      repeat the source; students commonly do anyway).
    - Any occurrence of `target`: removed (the destination is always appended
      automatically as the final waypoint — leaving it in `segments` would
      route through it twice).
    - Everything else (including legitimate repeated/non-adjacent waypoints)
      is preserved as authored.
    """
    cleaned = list(segments)
    while cleaned and cleaned[0] == source:
        cleaned.pop(0)
    return [seg for seg in cleaned if seg != target]


def path_link_ids(path: List[str], link_map: LinkMap) -> List[str]:
    link_ids: List[str] = []
    for u, v in zip(path, path[1:]):
        link = link_map.get((u, v))
        if link:
            link_ids.append(link.id)
    return link_ids


def path_total_weight(path: List[str], link_map: LinkMap) -> float:
    total = 0.0
    for u, v in zip(path, path[1:]):
        link = link_map.get((u, v))
        if link:
            total += link.weight
    return total


def path_cost_calculation(path: List[str], link_map: LinkMap) -> str:
    weights: List[float] = []
    parts: List[str] = []
    for u, v in zip(path, path[1:]):
        link = link_map.get((u, v))
        if link:
            weights.append(link.weight)
            parts.append(f"w({u},{v})")
    total = sum(weights)
    weight_text = " + ".join(str(w).rstrip("0").rstrip(".") for w in weights)
    return f"{' -> '.join(path)}: cost = {' + '.join(parts)} = {weight_text} = {total:g}"


def path_uses_link(path: List[str], link_map: LinkMap, link_id: str) -> bool:
    """True if `path` (a node sequence) crosses the given link id. Used by
    scheduled mid-simulation failures (PR 6) to find which already-routed
    demands need to be recomputed when a link goes down partway through a
    run — a committed `PathShare.nodes` sequence is checked against the
    *original* (pre-failure) `link_map`, which never changes, rather than
    the graph, which does.
    """
    for u, v in zip(path, path[1:]):
        link = link_map.get((u, v))
        if link and link.id == link_id:
            return True
    return False


def build_node_roles(network: NetworkInput, path_results: List[PathResult]) -> List[NodeRoleResult]:
    roles: Dict[str, NodeRoleResult] = {
        node.id: NodeRoleResult(nodeId=node.id, asSourceFor=[], asDestinationFor=[], asIntermediateFor=[])
        for node in network.nodes
    }
    for path in path_results:
        if not path.paths:
            continue
        roles[path.source].asSourceFor.append(path.demandId)
        roles[path.target].asDestinationFor.append(path.demandId)
        for share in path.paths:
            for node_id in share.nodes[1:-1]:
                roles[node_id].asIntermediateFor.append(path.demandId)
    return list(roles.values())


def cap_trace(events: List[SimulationTraceEvent], max_events: "int | None") -> List[SimulationTraceEvent]:
    if max_events and len(events) > max_events:
        return events[:max_events]
    return events
