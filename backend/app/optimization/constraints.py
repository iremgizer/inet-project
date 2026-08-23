"""Flow-conservation and capacity constraint builders for a standard
multi-commodity flow LP.

This is the vocabulary every future optimization mode builds on top of, even
though a routing-restricted mode's own flow variables will be indexed
differently (by path/segment choice rather than by raw edge) — the
underlying conservation-at-every-node and capacity-shared-per-physical-link
rules are the same regardless of what restricts which flow variables are
allowed to be nonzero.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

import pulp

from app.models import NetworkInput, TrafficDemandInput
from app.optimization.utils import ArcKey, CapacityGroup

FlowVarKey = Tuple[str, str, str]  # (u, v, demandId)
FlowVars = Dict[FlowVarKey, "pulp.LpVariable"]


def add_flow_conservation_constraints(
    problem: "pulp.LpProblem",
    network: NetworkInput,
    demands: List[TrafficDemandInput],
    flow_vars: FlowVars,
    out_arcs: Dict[str, List[ArcKey]],
    in_arcs: Dict[str, List[ArcKey]],
) -> None:
    """One equality constraint per (demand, node): outgoing flow minus
    incoming flow equals `+amount` at the demand's source, `-amount` at its
    target, and `0` everywhere else — including a node with no incident arcs
    at all, which is exactly what makes a disconnected demand correctly
    INFEASIBLE rather than silently dropped (its source/target side of this
    equation can never be satisfied if `amount > 0`).
    """
    for demand in demands:
        for node in network.nodes:
            node_id = node.id
            outgoing = pulp.lpSum(flow_vars[(u, v, demand.id)] for (u, v) in out_arcs.get(node_id, []))
            incoming = pulp.lpSum(flow_vars[(u, v, demand.id)] for (u, v) in in_arcs.get(node_id, []))
            if node_id == demand.source:
                rhs = demand.amount
            elif node_id == demand.target:
                rhs = -demand.amount
            else:
                rhs = 0.0
            problem += (outgoing - incoming == rhs)


def add_capacity_constraints(
    problem: "pulp.LpProblem",
    capacity_groups: List[CapacityGroup],
    demands: List[TrafficDemandInput],
    flow_vars: FlowVars,
    theta: "pulp.LpVariable",
) -> None:
    """One inequality per physical link: the combined flow of every
    commodity, over every arc that draws from this link's single capacity
    pool (both directions, for an undirected link — see
    `CapacityGroup`'s docstring), must not exceed `theta * capacity`. This is
    the epigraph-form linearization of `utilization(link) <= theta` that
    avoids dividing by `capacity` in the constraint itself.
    """
    for group in capacity_groups:
        total = pulp.lpSum(
            flow_vars[(u, v, demand.id)]
            for (u, v) in group.arcs
            for demand in demands
        )
        problem += (total <= theta * group.capacity)
