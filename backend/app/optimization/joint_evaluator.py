"""Shared, pure routing evaluator for Joint (weights + waypoints) Optimization.

Composes three already-existing, independently-tested pieces — no routing
logic is duplicated a third time:

1. `lwo_evaluator.apply_weights` — turns a candidate global link-weight
   assignment into a weighted graph (PR3).
2. `te_policy.build_demand_policy_graph` — applies each demand's own
   FORBID_LINK/AVOID_LINK/PREFER_LINK/REQUIRE_WAYPOINT on top of that
   weighted graph (shared by ECMP, Segment Routing, WPO, and LWO already).
3. `waypoint_evaluator.route_demand_with_waypoints` — routes one demand
   through its required + optimizer-chosen waypoints using PR0's
   ECMP-within-segments semantics (PR2).

Joint's routing model is therefore identical to WPO's (waypoints + ECMP
between them), with the one addition that the underlying weights are
*also* a candidate dimension being searched — never a fourth, separately
implemented routing engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from app.models import LinkInput, NetworkInput, TrafficDemandInput
from app.optimization.lwo_evaluator import WeightAssignment, apply_weights
from app.optimization.waypoint_evaluator import WaypointAssignment, route_demand_with_waypoints
from app.utils.routing_helpers import sanitize_segments
from app.utils.te_policy import build_demand_policy_graph

LinkMap = Dict[Tuple[str, str], LinkInput]


@dataclass
class JointEvaluationResult:
    link_loads: Dict[str, float]
    link_utilizations: Dict[str, float]
    mlu: float
    unreachable_demand_ids: List[str] = field(default_factory=list)


def evaluate_joint_assignment(
    network: NetworkInput,
    demands: List[TrafficDemandInput],
    base_graph,
    link_map: LinkMap,
    te_policies,
    weights: WeightAssignment,
    waypoint_assignment: WaypointAssignment,
) -> JointEvaluationResult:
    """Routes every demand in `demands` under both a candidate weight
    setting and a candidate waypoint assignment, and returns the resulting
    network-wide link loads/utilizations/MLU.

    Unlike `lwo_evaluator.evaluate_link_weights` (which only ever routes a
    REQUIRE_WAYPOINT demand via a single unsplittable path, matching
    `ecmp.py`'s own behavior) and `waypoint_evaluator.evaluate_waypoint_
    assignment` (which never varies weights), this function does both at
    once — every demand, required-or-optimizer-chosen waypoint alike, is
    always routed via ECMP-within-segments (`route_demand_with_waypoints`),
    because Joint's own routing model *is* WPO's model, just with weights
    also free to vary. TE policies are re-applied per call (unlike WPO/LWO's
    own "precompute once" optimization) because, unlike either single-
    dimension optimizer, the weighted graph a policy is applied on top of
    changes on every candidate here.
    """
    weighted_graph = apply_weights(base_graph, weights)

    link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
    unreachable: List[str] = []

    for demand in demands:
        policy_result = build_demand_policy_graph(weighted_graph, link_map, demand.id, te_policies)
        required = sanitize_segments(
            list(policy_result.required_waypoint_node_ids), demand.source, demand.target
        )
        extra = waypoint_assignment.get(demand.id)

        demand_loads, reachable = route_demand_with_waypoints(
            demand, policy_result.graph, link_map, required, extra
        )

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
    return JointEvaluationResult(
        link_loads=link_loads,
        link_utilizations=link_utilizations,
        mlu=mlu,
        unreachable_demand_ids=unreachable,
    )
