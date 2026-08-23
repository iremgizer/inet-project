"""Topology extraction (existing GraphBuilder output -> LP-ready structures)
and flow-path decomposition (an LP's raw per-edge flow solution -> explicit
weighted paths for `OptimizationResult.flowAssignments`).

Deliberately two separate concerns living in one small module: topology
extraction is needed by every future optimization mode (WPO/LWO/JOINT will
all route over the same physical arcs/capacities), while flow decomposition
is only ever meaningful for OPT's arbitrary-splitting model (a
routing-restricted mode already knows its own explicit paths, since its
flow variables are indexed by path/segment choice rather than by raw edge).

Reuses `GraphBuilder.build_graph` exactly as every simulation algorithm does
— no second topology representation, no separately-maintained DOWN-link
exclusion rule.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from app.models import NetworkInput
from app.optimization.models import FlowAssignment
from app.utils.graph_builder import GraphBuilder

ArcKey = Tuple[str, str]

# Flow values at or below this are treated as numerical noise from the LP
# solve, not real traffic — used both while decomposing a demand's flow into
# paths (stop once no arc has more than this much remaining flow) and are
# small enough to never mask genuine traffic on the tiny/medium topologies
# this project simulates.
FLOW_EPSILON = 1e-9


@dataclass
class CapacityGroup:
    """One physical link's LP-facing shape: its id/capacity, plus every
    directed arc that draws from that single capacity pool.

    A directed network's link has exactly one arc. An undirected link has
    *two* — (source, target) and (target, source) — sharing this one
    `capacity` as a single combined pool, never two independent per-direction
    constraints. This was verified empirically against `GraphBuilder` and
    `ECMPAlgorithm` directly (two opposing 6-unit demands over one
    capacity-10 undirected link produced a combined load of 12 and
    utilization of 1.2, i.e. both directions counted against one shared
    capacity) — see docs/research/sprint2-mip-architecture-analysis.md's
    PR1 addendum, which also corrects an earlier, unverified Revision 1
    inference to the contrary.
    """
    link_id: str
    capacity: float
    arcs: List[ArcKey] = field(default_factory=list)


@dataclass
class OptimizationTopology:
    capacity_groups: List[CapacityGroup]
    out_arcs: Dict[str, List[ArcKey]]
    in_arcs: Dict[str, List[ArcKey]]


def build_optimization_topology(network: NetworkInput) -> OptimizationTopology:
    """The single place `NetworkInput` is turned into the arc/capacity-group
    shape the optimization LP needs. Built from `GraphBuilder.build_graph`'s
    own output, so a DOWN link is excluded identically to ECMP/SR/DV — there
    is no separate exclusion rule to keep in sync.
    """
    graph, _link_map = GraphBuilder.build_graph(network)
    capacity_groups: List[CapacityGroup] = []
    out_arcs: Dict[str, List[ArcKey]] = {}
    in_arcs: Dict[str, List[ArcKey]] = {}

    for u, v, data in graph.edges(data=True):
        arcs: List[ArcKey] = [(u, v)] if network.isDirected else [(u, v), (v, u)]
        capacity_groups.append(CapacityGroup(link_id=data["linkId"], capacity=data["capacity"], arcs=arcs))
        for (a, b) in arcs:
            out_arcs.setdefault(a, []).append((a, b))
            in_arcs.setdefault(b, []).append((a, b))

    return OptimizationTopology(capacity_groups=capacity_groups, out_arcs=out_arcs, in_arcs=in_arcs)


def decompose_flow_to_paths(
    demand_id: str,
    source: str,
    target: str,
    amount: float,
    arc_flows: Dict[ArcKey, float],
) -> List[FlowAssignment]:
    """Standard flow-decomposition-into-paths: repeatedly finds a
    source -> ... -> target walk through arcs that still carry positive flow,
    records the bottleneck amount along it as one `FlowAssignment`, and
    subtracts that bottleneck from every arc on the path — until no
    source -> target path remains in the residual flow graph.

    `arc_flows` must already be filtered to one demand's own flow values
    (the LP has independent flow variables per commodity; see
    `constraints.py`) — this function does not know about demands other than
    the one it's decomposing.

    Any left-over positive flow once no source -> target path remains is a
    flow cycle: nothing in a pure conservation/capacity LP forbids a solver
    from returning one (it carries zero net demand and zero cost under this
    objective), so it is silently discarded rather than reported as a path —
    it would not correspond to anything a student could usefully read.
    """
    if amount <= FLOW_EPSILON:
        return []

    remaining: Dict[ArcKey, float] = {arc: value for arc, value in arc_flows.items() if value > FLOW_EPSILON}
    assignments: List[FlowAssignment] = []

    while True:
        path = _find_path(remaining, source, target)
        if path is None:
            break
        arcs_on_path = list(zip(path, path[1:]))
        bottleneck = min(remaining[arc] for arc in arcs_on_path)
        if bottleneck <= FLOW_EPSILON:
            break
        assignments.append(FlowAssignment(demandId=demand_id, nodes=path, share=bottleneck / amount))
        for arc in arcs_on_path:
            remaining[arc] -= bottleneck
            if remaining[arc] <= FLOW_EPSILON:
                del remaining[arc]

    return assignments


def _find_path(remaining: Dict[ArcKey, float], source: str, target: str) -> Optional[List[str]]:
    """BFS through arcs with remaining positive flow only, visiting
    neighbors in sorted order — deterministic, so the same LP solution
    always decomposes into the same path list regardless of dict iteration
    order.
    """
    adjacency: Dict[str, List[str]] = {}
    for (u, v) in remaining:
        adjacency.setdefault(u, []).append(v)
    for neighbors in adjacency.values():
        neighbors.sort()

    queue = deque([(source, [source])])
    visited = {source}
    while queue:
        node, path = queue.popleft()
        if node == target:
            return path
        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))
    return None
