"""Small, pure, algorithm-agnostic routing helpers.

These are net-new functions extracted for Segment Routing so its engine does
not duplicate the path-cost/link-id helper pattern that already exists
privately inside `ecmp.py` and `distance_vector.py`. Distance Vector is left
untouched — nothing here changes its behavior. ECMP's own equal-cost path
*discovery* now calls `resolve_equal_cost_paths` below (previously an inline
`sorted(nx.all_shortest_paths(...))` call) purely to avoid a second copy of
that logic once Segment Routing needed the exact same thing (PR0,
ECMP-within-segments) — ECMP's own distribution logic (equal split vs. a
custom per-path distribution, PR 3) is untouched and stays in `ecmp.py`.

Future algorithms (and Sprint 2's optimizer — see
`docs/research/sprint2-mip-architecture-analysis.md`) can reuse these same
helpers instead of re-duplicating the pattern a third and fourth time.
"""
from typing import Dict, List, NamedTuple, Tuple

import networkx as nx

from app.models import LinkInput, NetworkInput, NodeRoleResult, PathResult, SimulationTraceEvent

LinkMap = Dict[Tuple[str, str], LinkInput]


def resolve_equal_cost_paths(graph: "nx.Graph", source: str, destination: str) -> List[List[str]]:
    """All shortest (minimum total weight) paths between `source` and
    `destination`, sorted deterministically (lexicographically by full node
    sequence) so path ordering — and therefore any `pathId`/index derived
    from it — is stable across runs/edits, never dependent on NetworkX's
    internal (edge-insertion-order-dependent) enumeration order.

    A single shortest path is returned as a one-element list — callers don't
    need a separate "was there a tie" branch; `len(...) == 1` already tells
    them that. Raises `nx.NetworkXNoPath` if `source`/`destination` are
    disconnected, or `nx.NodeNotFound` if either is not a node in `graph` —
    exactly what `nx.shortest_path`/`nx.all_shortest_paths` already raise, so
    existing callers' `except` clauses keep working unchanged.
    """
    return sorted(nx.all_shortest_paths(graph, source, destination, weight="weight"))


def compute_equal_split_path_shares(paths: List[List[str]], amount: float) -> List[float]:
    """Equal ECMP split of `amount` across `paths` (already resolved, same
    order as the caller's `paths`) — each gets `amount / len(paths)`. Returns
    absolute per-path amounts (not fractions), summing to exactly `amount`
    (floating-point rounding aside — nothing here pre-rounds). `paths=[]`
    returns `[]`, matching the existing "no route, no share" convention used
    throughout `ecmp.py`/`segment_routing.py`.
    """
    if not paths:
        return []
    share = amount / len(paths)
    return [share] * len(paths)


class EcmpLegDistribution(NamedTuple):
    """The ECMP-split traffic distribution induced between two nodes by the
    current graph/weights — one "leg" in Segment Routing's sense (source to
    first waypoint, waypoint to waypoint, or last waypoint to destination),
    but equally meaningful standalone (a demand with no waypoints at all is
    just one leg, source to destination).

    `paths`: deterministically sorted equal-cost paths (see
    `resolve_equal_cost_paths`); a single entry when there is no tie.
    `shares`: absolute traffic amount per path, same order as `paths`,
    summing to the `amount` this leg was asked to carry.
    `link_loads`: this leg's own contribution to each link id's load —
    convenient for a caller to add directly into a running load total
    without re-deriving it from `paths`/`shares`.
    """
    paths: List[List[str]]
    shares: List[float]
    link_loads: Dict[str, float]


def compute_ecmp_leg_distribution(
    graph: "nx.Graph",
    link_map: LinkMap,
    source: str,
    destination: str,
    amount: float,
) -> EcmpLegDistribution:
    """Pure, side-effect-free: "what ECMP flow is induced between `source`
    and `destination`, carrying `amount`, under this graph's current
    weights?" Deliberately independent of `SegmentRoutingAlgorithm` (no trace
    events, no I/O) so it can be reused both by the SR engine (which wraps it
    with per-leg trace events, PR0) and — this is the point noted in
    `docs/research/sprint2-mip-architecture-analysis.md`'s "optimization
    future contract" — by a future Sprint 2 optimizer that needs the same
    question answered without invoking the whole UI-oriented simulator.

    Raises `nx.NetworkXNoPath`/`nx.NodeNotFound` exactly as
    `resolve_equal_cost_paths` does — callers degrade to a per-demand soft
    failure, not a 500, exactly as `resolve_segment_route`'s callers already
    do.
    """
    paths = resolve_equal_cost_paths(graph, source, destination)
    shares = compute_equal_split_path_shares(paths, amount)
    link_loads: Dict[str, float] = {}
    for path, share in zip(paths, shares):
        for u, v in zip(path, path[1:]):
            link = link_map.get((u, v))
            if link:
                link_loads[link.id] = link_loads.get(link.id, 0.0) + share
    return EcmpLegDistribution(paths=paths, shares=shares, link_loads=link_loads)


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
