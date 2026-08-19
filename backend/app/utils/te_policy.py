"""Traffic Engineering policy application layer — PR 4.

Converts a demand-scoped list of `TrafficEngineeringPolicy` objects into a
policy-aware VIEW of the routing graph: a *copy*, never a mutation of the
original graph, NetworkInput, or link weights — so each demand can see the
graph exactly as its own policies require, and a request with no policies at
all pays zero cost (callers skip this module entirely in that case).

Precedence (FORBID_LINK > REQUIRE_WAYPOINT > AVOID_LINK/PREFER_LINK) falls
out of the order operations run in, not from separate conflict-detection
code: forbidden edges are removed *before* any cost adjustment is computed,
so a link that is both AVOID/PREFER-marked and FORBID-marked simply no
longer exists by the time cost adjustments run. REQUIRE_WAYPOINT is a
routing-structure decision resolved by the caller (via
`resolve_segment_route`, reused from Segment Routing) against this same
adjusted graph, so it automatically respects both the removed edges and the
adjusted costs too.

This module is deliberately algorithm-agnostic — ECMP and Segment Routing
both call the exact same `build_demand_policy_graph`, and a future
MIP-based optimizer would consume `TrafficEngineeringPolicy` the same way:
FORBID_LINK as a hard x_e=0 constraint, AVOID_LINK/PREFER_LINK as an
objective-penalty term, REQUIRE_WAYPOINT as a routing constraint.
"""
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx

from app.models import LinkInput, TrafficEngineeringPolicy

LinkMap = Dict[Tuple[str, str], LinkInput]

DEFAULT_AVOID_PENALTY = 100.0
DEFAULT_PREFER_DISCOUNT = 100.0


class PolicyApplicationResult:
    """Everything a caller needs to both route on the adjusted graph and
    explain what happened in a trace event."""

    def __init__(self, graph: "nx.Graph"):
        self.graph = graph
        self.excluded_link_ids: List[str] = []
        self.cost_adjustments: List[Dict[str, Any]] = []  # {linkId, policyType, originalWeight, effectiveWeight}
        self.required_waypoint_node_ids: List[str] = []
        self.ignored_policy_ids: List[str] = []  # referenced an unknown link/node id

    @property
    def has_effect(self) -> bool:
        return bool(self.excluded_link_ids or self.cost_adjustments or self.required_waypoint_node_ids)

    def describe(self) -> str:
        """One-line human summary for a trace event description."""
        parts: List[str] = []
        if self.excluded_link_ids:
            parts.append(f"{len(self.excluded_link_ids)} link(s) forbidden: {', '.join(self.excluded_link_ids)}")
        if self.cost_adjustments:
            adj = "; ".join(
                f"{a['linkId']} {a['originalWeight']:g} -> {a['effectiveWeight']:g}"
                for a in self.cost_adjustments
            )
            parts.append(f"cost adjusted on {len(self.cost_adjustments)} link(s): {adj}")
        if self.required_waypoint_node_ids:
            parts.append(f"must visit: {' -> '.join(self.required_waypoint_node_ids)}")
        return "; ".join(parts) if parts else "No policies apply to this demand."


def policies_for_demand(
    policies: List[TrafficEngineeringPolicy], demand_id: str
) -> List[TrafficEngineeringPolicy]:
    """Policies that apply to this demand: globally-scoped (demandId=None) or
    explicitly scoped to it, ordered by `priority` (insertion order breaks
    ties, since Python's sort is stable)."""
    applicable = [p for p in policies if p.demandId is None or p.demandId == demand_id]
    return sorted(applicable, key=lambda p: p.priority)


def build_demand_policy_graph(
    base_graph: "nx.Graph",
    link_map: LinkMap,
    demand_id: str,
    policies: List[TrafficEngineeringPolicy],
) -> PolicyApplicationResult:
    """Returns a policy-adjusted COPY of `base_graph` for one demand. The
    original graph is never mutated — safe to call once per demand even
    though demands may carry different (or conflicting) policies.

    Policies referencing an unknown link id are skipped (recorded in
    `ignored_policy_ids`) rather than raising — the frontend only lets
    students pick real links/nodes via dropdowns or graph clicks, so this is
    a defense-in-depth backstop, not the primary validation path.
    """
    applicable = policies_for_demand(policies, demand_id)
    if not applicable:
        return PolicyApplicationResult(graph=base_graph)

    known_link_ids: Set[str] = {link.id for link in link_map.values()}
    result = PolicyApplicationResult(graph=base_graph.copy())

    # ── Hard: FORBID_LINK — remove edges before any cost adjustment runs. ──
    forbidden_link_ids: Set[str] = set()
    for p in applicable:
        if p.type != "FORBID_LINK":
            continue
        if not p.linkId or p.linkId not in known_link_ids:
            result.ignored_policy_ids.append(p.policyId)
            continue
        forbidden_link_ids.add(p.linkId)

    if forbidden_link_ids:
        edges_to_remove = [
            (u, v) for u, v, data in result.graph.edges(data=True)
            if data.get("linkId") in forbidden_link_ids
        ]
        result.graph.remove_edges_from(edges_to_remove)
        result.excluded_link_ids = sorted(forbidden_link_ids)

    # ── Hard: REQUIRE_WAYPOINT — recorded for the caller to resolve (segment
    #    concatenation already respects whatever edges/weights survive above). ──
    for p in applicable:
        if p.type != "REQUIRE_WAYPOINT":
            continue
        if not p.nodeId or p.nodeId not in base_graph.nodes:
            result.ignored_policy_ids.append(p.policyId)
            continue
        result.required_waypoint_node_ids.append(p.nodeId)

    # ── Soft: AVOID_LINK / PREFER_LINK — cost adjustment on surviving edges. ─
    avoid_penalty: Dict[str, float] = {}
    prefer_discount: Dict[str, float] = {}
    for p in applicable:
        if p.type == "AVOID_LINK":
            if not p.linkId or p.linkId not in known_link_ids:
                result.ignored_policy_ids.append(p.policyId)
                continue
            avoid_penalty[p.linkId] = p.penalty if p.penalty is not None else DEFAULT_AVOID_PENALTY
        elif p.type == "PREFER_LINK":
            if not p.linkId or p.linkId not in known_link_ids:
                result.ignored_policy_ids.append(p.policyId)
                continue
            prefer_discount[p.linkId] = p.penalty if p.penalty is not None else DEFAULT_PREFER_DISCOUNT

    touched_link_ids = set(avoid_penalty) | set(prefer_discount)
    if touched_link_ids:
        for u, v, data in result.graph.edges(data=True):
            link_id = data.get("linkId")
            if link_id not in touched_link_ids:
                continue
            original = data.get("weight", 0.0)
            effective = max(0.0, original + avoid_penalty.get(link_id, 0.0) - prefer_discount.get(link_id, 0.0))
            if effective == original:
                continue
            data["weight"] = effective
            if link_id in avoid_penalty and link_id in prefer_discount:
                policy_type = "MIXED"
            elif link_id in avoid_penalty:
                policy_type = "AVOID_LINK"
            else:
                policy_type = "PREFER_LINK"
            result.cost_adjustments.append({
                "linkId": link_id, "policyType": policy_type,
                "originalWeight": original, "effectiveWeight": effective,
            })

    return result


def combined_waypoints_for_demand(
    explicit_segments: Optional[List[str]],
    policy_result: PolicyApplicationResult,
) -> List[str]:
    """Deterministic combination rule for Segment Routing: explicit
    `SegmentRoutingPolicy.segments` (in their existing order) come first,
    followed by any REQUIRE_WAYPOINT policy waypoints (in priority order,
    already sorted onto `policy_result.required_waypoint_node_ids`).

    Example: explicit segments=[B, D], required waypoint=C -> [B, D, C].
    Chosen for predictability over trying to infer a "better" ordering by
    graph distance — the student's explicit segment order always wins.
    """
    return list(explicit_segments or []) + list(policy_result.required_waypoint_node_ids)
