"""Shared, pure routing evaluator for Link Weight Optimization (LWO).

Computes the network-wide link loads/utilizations/MLU that would result from
a candidate global link-weight assignment, using EXACTLY the routing
semantics `ECMPAlgorithm` itself implements: for each demand, a hard
`REQUIRE_WAYPOINT` TE policy forces a single concatenated route (via
`resolve_segment_route`, matching `ecmp.py`'s own required-waypoint special
case); otherwise, every equal-cost shortest path is discovered
(`resolve_equal_cost_paths`) and the demand's traffic is split evenly across
all of them (`compute_ecmp_leg_distribution` — a demand with no waypoint is
exactly one leg from source to target). `FORBID_LINK`/`AVOID_LINK`/
`PREFER_LINK` are applied identically to `ecmp.py`, via the same
`build_demand_policy_graph`.

Deliberately does not call `ECMPAlgorithm.run()` — a weight search evaluates
many candidate weight assignments (up to `max_exact_combinations`, see
`lwo_optimizer.py`), and building a full `SimulationResult` with trace events
per candidate would be pure waste. `test_lwo_optimization.py`'s
`test_*_matches_ecmp_simulator` tests cross-validate that this evaluator
reproduces `ECMPAlgorithm`'s real link loads byte-for-byte under a given
weight setting, so this shortcut is proven safe, not just assumed to be.

Ignores per-demand `TrafficDistribution` (custom, non-equal ECMP path
shares) — LWO evaluates "what would plain, equal-split ECMP do under this
weight setting", the same question `Metrics`/`OptimizationResult` is
answering elsewhere; a student's custom split override is a simulation-time
visualization refinement, not a property of the network LWO is choosing
weights to optimize. Documented as a known limitation, not silently ignored.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import networkx as nx

from app.models import LinkInput, NetworkInput, TrafficDemandInput
from app.utils.routing_helpers import compute_ecmp_leg_distribution, resolve_segment_route
from app.utils.te_policy import build_demand_policy_graph

LinkMap = Dict[Tuple[str, str], LinkInput]

# linkId -> candidate weight for this evaluation.
WeightAssignment = Dict[str, float]


@dataclass
class LwoEvaluationResult:
    link_loads: Dict[str, float]
    link_utilizations: Dict[str, float]
    mlu: float
    # Demands that could not be routed at all under this weight setting (a
    # required waypoint or the destination itself became unreachable — this
    # can only happen via a FORBID_LINK policy, since a candidate weight
    # change alone never removes an edge). Contributes zero load, exactly
    # like ECMPAlgorithm's own "unreachable demand delivers zero traffic"
    # convention.
    unreachable_demand_ids: List[str] = field(default_factory=list)


def apply_weights(base_graph: "nx.Graph", weights: WeightAssignment) -> "nx.Graph":
    """Returns a copy of `base_graph` with every edge's `weight` attribute
    overwritten from `weights` (keyed by `linkId`, matching the `linkId` edge
    attribute `GraphBuilder` already sets) — topology/capacity/DOWN-exclusion
    are all inherited unchanged from `base_graph`, only routing cost changes.
    Edges whose link id has no entry in `weights` keep their original weight
    (defensive default; every candidate this module builds always covers
    every link, so this only matters if a caller passes a partial mapping).
    """
    graph = base_graph.copy()
    for _u, _v, data in graph.edges(data=True):
        link_id = data.get("linkId")
        if link_id in weights:
            data["weight"] = weights[link_id]
    return graph


def evaluate_link_weights(
    network: NetworkInput,
    demands: List[TrafficDemandInput],
    base_graph: "nx.Graph",
    link_map: LinkMap,
    te_policies,
    weights: WeightAssignment,
) -> LwoEvaluationResult:
    """Routes every demand in `demands` under `weights` (a candidate global
    link-weight setting), applying each demand's own TE policies exactly as
    `ECMPAlgorithm` does, and returns the resulting network-wide link loads/
    utilizations/MLU.

    `base_graph` already has DOWN links excluded (from `GraphBuilder`) but
    still carries the network's *original* weights — `apply_weights` is
    called once here to produce the weighted graph this candidate actually
    routes over, then `build_demand_policy_graph` layers each demand's own
    FORBID_LINK/AVOID_LINK/PREFER_LINK/REQUIRE_WAYPOINT on top — identical
    order of operations to `ecmp.py`'s own `_route_demand`.
    """
    weighted_graph = apply_weights(base_graph, weights)

    link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
    unreachable: List[str] = []

    for demand in demands:
        policy_result = build_demand_policy_graph(weighted_graph, link_map, demand.id, te_policies)
        demand_graph = policy_result.graph
        required_waypoints = policy_result.required_waypoint_node_ids

        demand_loads: Dict[str, float] = {}
        reachable = True

        if required_waypoints:
            try:
                full_path, _leg_paths = resolve_segment_route(
                    demand_graph, demand.source, demand.target, required_waypoints
                )
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                reachable = False
            else:
                for u, v in zip(full_path, full_path[1:]):
                    link = link_map.get((u, v))
                    if link:
                        demand_loads[link.id] = demand_loads.get(link.id, 0.0) + demand.amount
        else:
            try:
                leg = compute_ecmp_leg_distribution(
                    demand_graph, link_map, demand.source, demand.target, demand.amount
                )
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                reachable = False
            else:
                demand_loads = dict(leg.link_loads)

        if not reachable:
            unreachable.append(demand.id)
            continue

        for link_id, amount in demand_loads.items():
            link_loads[link_id] = link_loads.get(link_id, 0.0) + amount

    link_utilizations: Dict[str, float] = {}
    for link in network.links:
        load = link_loads.get(link.id, 0.0)
        link_utilizations[link.id] = (load / link.capacity) if link.capacity > 0 else 0.0

    mlu = max(link_utilizations.values(), default=0.0)
    return LwoEvaluationResult(
        link_loads=link_loads,
        link_utilizations=link_utilizations,
        mlu=mlu,
        unreachable_demand_ids=unreachable,
    )
