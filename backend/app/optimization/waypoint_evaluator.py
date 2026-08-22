"""Shared, pure routing evaluator for waypoint-based optimization.

Computes the network-wide link loads/utilizations/MLU that would result from
a given full waypoint assignment, using EXACTLY the routing semantics
Segment Routing itself implements post-PR0 ("ECMP-within-segments"): for a
demand with waypoints `[source] + segments + [target]`, every consecutive
pair is resolved via `compute_ecmp_leg_distribution` (all equal-cost shortest
paths, split evenly), and each leg's own per-link load contribution is summed
directly into the running totals — the same "aggregate re-mixes fully at
every waypoint" semantics documented in `segment_routing.py`'s module
docstring, since summing each leg's `link_loads` dict *is* what
`SegmentRoutingAlgorithm._route_demand` itself does (see its
`for link_id, leg_amount in dist.link_loads.items(): link_loads[link_id] +=
leg_amount` line).

Deliberately does not import `segment_routing.py` or build any `PathShare`/
`SimulationTraceEvent` — a waypoint search evaluates many candidate
assignments (up to `max_exact_combinations`, see `waypoint_optimizer.py`),
and materializing a full UI-oriented trace or Cartesian-product path list for
every candidate would be pure waste. `test_waypoint_optimization.py`'s
`test_m_*` cross-validates that this produces link loads byte-identical to
running the equivalent `SegmentRoutingPolicy` through the real
`SegmentRoutingAlgorithm`, so this shortcut is provably safe, not just
assumed to be.

Reusable by a future Joint-optimization PR exactly as documented in PR1's
own `docs/research/sprint2-mip-architecture-analysis.md` §8 plan — nothing
here is WPO-search-specific, only "given these waypoints, what loads
result?".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import networkx as nx

from app.models import LinkInput, NetworkInput, TrafficDemandInput
from app.utils.routing_helpers import compute_ecmp_leg_distribution

LinkMap = Dict[Tuple[str, str], LinkInput]

# demandId -> the one additional waypoint node id the optimizer is
# considering for it, or None ("no additional waypoint"). V1 only ever
# assigns at most one entry per demand — see waypoint_optimizer.py.
WaypointAssignment = Dict[str, Optional[str]]


@dataclass
class WaypointEvaluationResult:
    link_loads: Dict[str, float]
    link_utilizations: Dict[str, float]
    mlu: float
    # Demands that could not be routed at all under this assignment (a leg
    # between two consecutive waypoints had no path) — contribute zero load,
    # exactly like SegmentRoutingAlgorithm's own "unreachable demand delivers
    # zero traffic" convention. Not a search failure; the search still
    # returns a well-defined MLU for the reachable remainder.
    unreachable_demand_ids: List[str] = field(default_factory=list)


def evaluate_waypoint_assignment(
    network: NetworkInput,
    demands: List[TrafficDemandInput],
    demand_graphs: Dict[str, "nx.Graph"],
    demand_required_waypoints: Dict[str, List[str]],
    link_map: LinkMap,
    assignment: WaypointAssignment,
) -> WaypointEvaluationResult:
    """Routes every demand in `demands` under `assignment`, using PR0's
    ECMP-within-segments semantics, and returns the resulting network-wide
    link loads/utilizations/MLU.

    `demand_graphs` (demandId -> TE-policy-adjusted graph: FORBID_LINK edges
    already removed, AVOID_LINK/PREFER_LINK weights already adjusted) and
    `demand_required_waypoints` (demandId -> hard REQUIRE_WAYPOINT node ids,
    already sanitized) are precomputed once per optimization run by the
    caller (`waypoint_optimizer.py`) — TE-policy application is static across
    every candidate this evaluator is asked about, so it is deliberately not
    redone here per call.

    A demand's final segment list is `required_waypoints + ([assignment's
    extra waypoint] if any)` — the optimizer's own recommendation is always
    additive on top of any hard REQUIRE_WAYPOINT, never a replacement for it
    (see waypoint_optimizer.py's REQUIRE_WAYPOINT interaction rule).
    """
    link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
    unreachable: List[str] = []

    for demand in demands:
        graph = demand_graphs[demand.id]
        required = demand_required_waypoints.get(demand.id, [])
        extra = assignment.get(demand.id)
        segments = list(required) + ([extra] if extra else [])
        waypoints = [demand.source] + segments + [demand.target]

        demand_loads: Dict[str, float] = {}
        reachable = True
        for i in range(len(waypoints) - 1):
            try:
                leg = compute_ecmp_leg_distribution(
                    graph, link_map, waypoints[i], waypoints[i + 1], demand.amount
                )
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                reachable = False
                break
            for link_id, amount in leg.link_loads.items():
                demand_loads[link_id] = demand_loads.get(link_id, 0.0) + amount

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
    return WaypointEvaluationResult(
        link_loads=link_loads,
        link_utilizations=link_utilizations,
        mlu=mlu,
        unreachable_demand_ids=unreachable,
    )
