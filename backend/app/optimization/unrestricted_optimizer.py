"""PR1 — Sprint 2's first optimization mode: OPT, the unrestricted optimal
flow.

Implements the model documented in
docs/research/sprint2-mip-architecture-analysis-v1.md Part C1 (unaffected by
Revision 2, reconfirmed at the top of this PR): a standard multi-commodity
flow LP minimizing the maximum link utilization (MLU), with NO waypoint,
ECMP, or shortest-path restriction — traffic may split arbitrarily, across
any number of paths, at any node. This is *not* a simulation of ECMP,
Segment Routing, or OSPF; it is the theoretical best-possible-MLU baseline
every routing algorithm (today's ECMP/SR/DV, and later WPO/LWO/JOINT) will
be compared against.

Pure function of a `NetworkInput`: no trace events, no I/O, no dependency on
any simulation algorithm — safe to call directly from a test or a future
service layer. No REST endpoint is added in this PR (see PR1's own scope).
"""
from __future__ import annotations

import time
from typing import Dict, List, Optional

import pulp

from app.models import NetworkInput, TrafficDemandInput
from app.optimization.constraints import add_capacity_constraints, add_flow_conservation_constraints
from app.optimization.models import FlowAssignment, OptimizationResult
from app.optimization.objective import add_mlu_objective
from app.optimization.solver_adapter import PulpCbcAdapter, SolverAdapter
from app.optimization.utils import ArcKey, build_optimization_topology, decompose_flow_to_paths


def solve_unrestricted_optimum(
    network: NetworkInput,
    time_limit_s: Optional[float] = None,
    solver: Optional[SolverAdapter] = None,
) -> OptimizationResult:
    """Computes OPT: the minimum possible maximum link utilization for
    `network`'s current topology, capacities, and demands, over every
    conceivable routing (arbitrary splitting, no waypoint/ECMP/OSPF
    restriction).

    `solver` defaults to this project's only supported backend
    (`PulpCbcAdapter`) and exists mainly as a constructor seam for tests.
    `time_limit_s` is forwarded to the solver; this LP is small enough on
    every topology this project simulates that it should not be needed in
    practice.
    """
    start = time.time()
    active_solver = solver or PulpCbcAdapter()

    node_ids = {node.id for node in network.nodes}
    for demand in network.demands:
        if demand.source not in node_ids or demand.target not in node_ids:
            # A malformed request, not a routing/topology fact — distinct
            # from INFEASIBLE (Part K), which only ever describes a
            # well-formed model with no feasible routing.
            return OptimizationResult(
                status="ERROR",
                objectiveValue=0.0,
                mlu=0.0,
                solverRuntime=round((time.time() - start) * 1000.0, 2),
                solverName="CBC",
                message=f"Demand {demand.id} references a node that does not exist in this network.",
            )

    # Demands with source == target carry no net flow anywhere and are
    # excluded from the LP entirely — mirrors ECMP's/Segment Routing's own
    # "skip and note in debug" convention for this same edge case (see
    # ecmp.py's _route_demand) rather than adding a degenerate,
    # always-satisfied constraint for them.
    debug: List[str] = []
    routable_demands: List[TrafficDemandInput] = []
    for demand in network.demands:
        if demand.source == demand.target:
            debug.append(f"Demand {demand.id} source equals target; excluded from optimization")
            continue
        routable_demands.append(demand)

    topology = build_optimization_topology(network)

    if not routable_demands:
        # Nothing to route — MLU is trivially 0. A well-defined, correct OPT
        # answer (an empty/self-loop-only demand set is not an error), and
        # cheap enough to shortcut without invoking the solver at all.
        debug.append("No routable demands; MLU is trivially 0.")
        zero_loads = {group.link_id: 0.0 for group in topology.capacity_groups}
        return OptimizationResult(
            status="OPTIMAL",
            objectiveValue=0.0,
            mlu=0.0,
            linkLoads=zero_loads,
            linkUtilizations={link_id: 0.0 for link_id in zero_loads},
            flowAssignments=[],
            solverRuntime=round((time.time() - start) * 1000.0, 2),
            optimalityGap=0.0,
            solverName="CBC",
            message="Optimal solution found.",
            lowerBound=0.0,
            debugInfo=debug,
        )

    problem = pulp.LpProblem("unrestricted_optimal_flow", pulp.LpMinimize)
    theta = add_mlu_objective(problem)

    flow_vars: Dict[tuple, "pulp.LpVariable"] = {}
    for group in topology.capacity_groups:
        for (u, v) in group.arcs:
            for demand in routable_demands:
                flow_vars[(u, v, demand.id)] = pulp.LpVariable(f"f_{u}_{v}_{demand.id}", lowBound=0)

    add_flow_conservation_constraints(
        problem, network, routable_demands, flow_vars, topology.out_arcs, topology.in_arcs
    )
    add_capacity_constraints(problem, topology.capacity_groups, routable_demands, flow_vars, theta)

    outcome = active_solver.solve(problem, time_limit_s=time_limit_s)
    runtime_ms = round((time.time() - start) * 1000.0, 2)

    if outcome.status not in ("OPTIMAL", "FEASIBLE", "TIME_LIMIT"):
        return OptimizationResult(
            status=outcome.status,
            objectiveValue=0.0,
            mlu=0.0,
            solverRuntime=runtime_ms,
            solverName=outcome.solverName,
            message=outcome.message,
            debugInfo=debug,
        )

    objective_value = outcome.objectiveValue if outcome.objectiveValue is not None else 0.0

    link_loads: Dict[str, float] = {}
    for group in topology.capacity_groups:
        total = 0.0
        for (u, v) in group.arcs:
            for demand in routable_demands:
                var = flow_vars[(u, v, demand.id)]
                total += var.varValue or 0.0
        link_loads[group.link_id] = round(total, 6)

    link_utilizations = {
        group.link_id: (round(link_loads[group.link_id] / group.capacity, 6) if group.capacity > 0 else 0.0)
        for group in topology.capacity_groups
    }
    mlu = max(link_utilizations.values(), default=0.0)

    flow_assignments: List[FlowAssignment] = []
    for demand in routable_demands:
        arc_flows: Dict[ArcKey, float] = {}
        for group in topology.capacity_groups:
            for (u, v) in group.arcs:
                var = flow_vars.get((u, v, demand.id))
                if var is not None and var.varValue:
                    arc_flows[(u, v)] = arc_flows.get((u, v), 0.0) + var.varValue
        flow_assignments.extend(
            decompose_flow_to_paths(demand.id, demand.source, demand.target, demand.amount, arc_flows)
        )

    lower_bound = objective_value if outcome.status == "OPTIMAL" else None
    optimality_gap = 0.0 if outcome.status == "OPTIMAL" else None

    return OptimizationResult(
        status=outcome.status,
        objectiveValue=round(objective_value, 6),
        mlu=round(mlu, 6),
        linkLoads=link_loads,
        linkUtilizations=link_utilizations,
        flowAssignments=flow_assignments,
        solverRuntime=runtime_ms,
        optimalityGap=optimality_gap,
        solverName=outcome.solverName,
        message=outcome.message,
        lowerBound=lower_bound,
        debugInfo=debug,
    )
