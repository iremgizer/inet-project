"""Sprint 2 PR2 — Waypoint Optimization (WPO). Extended in PR6 with a
search-space preview (`estimate_waypoint_search_space`) and an optional
wall-clock deadline (`time_limit_s`) — both additive, safety/UX-only; the
routing/optimization semantics documented below are unchanged since PR2.

Finds, for each demand, at most one additional waypoint node to route
through such that the resulting network-wide Maximum Link Utilization (MLU)
is minimized — under EXACTLY the same routing semantics Segment Routing
itself uses after PR0 ("ECMP-within-segments"): waypoint constraints, plain
shortest-path routing between consecutive stops, and ECMP equal splitting
whenever a leg has more than one equal-cost path.

Routing-model provenance (read this before touching this file):
[Parham21] (Parham, Fenz, Süss, Foerster, Schmid, "Traffic Engineering with
Joint Link Weight and Segment Optimization," ACM CoNEXT 2021) defines WPO
over even-split ECMP routing between waypoints — this is the model PR0
deliberately chose for Sprint 1's Segment Routing simulator (see
`segment_routing.py`'s module docstring and
docs/research/sprint2-mip-architecture-analysis.md §11's addendum), so this
is the model implemented here. [Le21] (Van An Le et al., "Multi-time-step
Segment Routing based Traffic Engineering Leveraging Traffic Prediction,"
IFIP/IEEE IM 2021) also studies single-waypoint optimization and supplies a
complete, exact MILP (`P0`) — but its routing model is single-shortest-path,
UNSPLITTABLE, which is a different, incompatible semantics from what PR0's
simulator actually does. This file does not implement [Le21]'s `P0` and does
not claim to; see §18 of PR2's own spec and the architecture-doc addendum
for the explicit, permanent record of this choice. A future
`UNSPLITTABLE_SR_MILP` mode remains a documented possibility, not code.

Two search strategies, chosen automatically by the size of the candidate
space (see `_search_space_size`/`max_exact_combinations`):

- `EXACT_ENUMERATION`: the Cartesian product of every demand's own candidate
  waypoint list (built from scratch here — not Parham's or Le's own search
  procedure, both of which are approximate/greedy; this is a plain
  brute-force search over an explicitly bounded space) is evaluated in full,
  and the best-MLU assignment is kept. Genuinely exhaustive within that
  declared space — `provenOptimal=True` — but never called "MILP": no
  integer program is built or solved here, only direct enumeration + the
  same routing evaluator every candidate shares. If a PR6 `time_limit_s`
  deadline is reached before enumeration finishes, the search stops with
  whatever best candidate it has found so far and the result is reported as
  `TIME_LIMIT`, never `OPTIMAL` — see `optimize_waypoints`'s own docstring.
- `GREEDY_WPO`: [Parham21]'s Algorithm 3, used automatically once the exact
  search space exceeds `max_exact_combinations` (default 50,000, see that
  constant's own docstring for the reasoning). A polynomial heuristic with
  no optimality guarantee — `provenOptimal=False`, always.
"""
from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import networkx as nx

from app.models import AlgorithmConfig, NetworkInput, TrafficDemandInput
from app.optimization.deadline import compute_deadline, deadline_passed
from app.optimization.models import OptimizationResult, WaypointAssignmentEntry
from app.optimization.waypoint_evaluator import (
    WaypointAssignment,
    WaypointEvaluationResult,
    evaluate_waypoint_assignment,
)
from app.utils.graph_builder import GraphBuilder
from app.utils.routing_helpers import sanitize_segments
from app.utils.te_policy import build_demand_policy_graph

# A brute-force exhaustive search grows as the product of every demand's own
# candidate-waypoint-list size. 50,000 total (demand, candidate-combination)
# evaluations is the default ceiling — chosen so a handful of demands over a
# teaching-scale topology (a few dozen nodes at most; this project's own
# largest shipped topologies are far smaller) always resolves near-instantly
# (each evaluation is a handful of Dijkstra calls), while a pathological
# input (many demands, each with a large usable-node candidate set) falls
# back to the scalable GreedyWPO heuristic instead of hanging.
DEFAULT_MAX_EXACT_COMBINATIONS = 50_000

# A "no strict improvement, no change" tolerance for MLU comparisons —
# guards against switching away from `None` (or a previously-kept waypoint)
# due to floating-point noise rather than a genuine improvement. Matches
# [Parham21] Algorithm 3's own "only update `U_min` on strict improvement"
# rule (see this module's GreedyWPO implementation below).
_MLU_IMPROVEMENT_EPSILON = 1e-9


@dataclass
class WpoSearchContext:
    """Everything about a WPO run that does not depend on which search
    strategy is chosen — shared, unchanged, by `optimize_waypoints` (which
    actually searches) and `estimate_waypoint_search_space` (PR6, which only
    reports the candidate-space size a real run would search). Computed
    once so the estimate can never drift from what a real run would do.
    """
    routable_demands: List[TrafficDemandInput]
    demand_graphs: Dict[str, "nx.Graph"]
    demand_required_waypoints: Dict[str, List[str]]
    candidate_lists: Dict[str, List[Optional[str]]]
    search_space_size: int
    debug: List[str]
    link_map: dict = field(default_factory=dict)
    unknown_node_demand_id: Optional[str] = None


def _prepare_wpo_search(network: NetworkInput, config: AlgorithmConfig) -> WpoSearchContext:
    graph, link_map = GraphBuilder.build_graph(network)
    node_ids_sorted = sorted(node.id for node in network.nodes)
    node_id_set = set(node_ids_sorted)
    debug: List[str] = []

    for demand in network.demands:
        if demand.source not in node_id_set or demand.target not in node_id_set:
            return WpoSearchContext(
                routable_demands=[], demand_graphs={}, demand_required_waypoints={},
                candidate_lists={}, search_space_size=0, debug=debug, link_map=link_map,
                unknown_node_demand_id=demand.id,
            )

    routable_demands: List[TrafficDemandInput] = []
    for demand in network.demands:
        if demand.source == demand.target:
            debug.append(f"Demand {demand.id} source equals target; excluded from optimization")
            continue
        routable_demands.append(demand)

    demand_graphs: Dict[str, "nx.Graph"] = {}
    demand_required_waypoints: Dict[str, List[str]] = {}
    for demand in routable_demands:
        policy_result = build_demand_policy_graph(graph, link_map, demand.id, config.tePolicies)
        demand_graphs[demand.id] = policy_result.graph
        demand_required_waypoints[demand.id] = sanitize_segments(
            list(policy_result.required_waypoint_node_ids), demand.source, demand.target
        )

    candidate_lists: Dict[str, List[Optional[str]]] = {
        demand.id: _candidate_waypoints_for_demand(
            demand, demand_graphs[demand.id], demand_required_waypoints[demand.id], node_ids_sorted,
        )
        for demand in routable_demands
    }

    search_space_size = 1
    for demand in routable_demands:
        search_space_size *= len(candidate_lists[demand.id])

    return WpoSearchContext(
        routable_demands=routable_demands,
        demand_graphs=demand_graphs,
        demand_required_waypoints=demand_required_waypoints,
        candidate_lists=candidate_lists,
        search_space_size=search_space_size,
        debug=debug,
        link_map=link_map,
    )


@dataclass
class WpoSearchSpaceEstimate:
    """PR6 — a preview of what a real `optimize_waypoints` call would
    search, without actually running it. `searchSpaceSize` is exactly the
    number `optimize_waypoints` itself would compute and compare against
    `max_exact_combinations` to choose EXACT_ENUMERATION vs GREEDY_WPO —
    computed via the identical candidate-generation code (`_prepare_wpo_search`),
    so this estimate can never drift from what a real run actually does.
    """
    searchSpaceSize: int
    routableDemandCount: int
    candidateCountByDemand: Dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None


def estimate_waypoint_search_space(network: NetworkInput, config: AlgorithmConfig) -> WpoSearchSpaceEstimate:
    """Computes WPO's candidate-space size without running any search — the
    Optimization Lab's "search-space preview" (PR6 §3) calls this before a
    student commits to running WPO/Joint, so they can see whether their
    current search budget will permit exact enumeration before waiting on a
    real solve.
    """
    context = _prepare_wpo_search(network, config)
    if context.unknown_node_demand_id is not None:
        return WpoSearchSpaceEstimate(
            searchSpaceSize=0, routableDemandCount=0,
            error=f"Demand {context.unknown_node_demand_id} references a node that does not exist in this network.",
        )
    return WpoSearchSpaceEstimate(
        searchSpaceSize=context.search_space_size,
        routableDemandCount=len(context.routable_demands),
        candidateCountByDemand={
            demand_id: len(candidates) for demand_id, candidates in context.candidate_lists.items()
        },
    )


def optimize_waypoints(
    network: NetworkInput,
    config: AlgorithmConfig,
    max_waypoints_per_demand: int = 1,
    max_exact_combinations: int = DEFAULT_MAX_EXACT_COMBINATIONS,
    time_limit_s: Optional[float] = None,
) -> OptimizationResult:
    """Recommends a waypoint assignment (at most one extra waypoint per
    demand) minimizing network-wide MLU, computed from scratch (ignoring any
    student-authored `SegmentRoutingPolicy.segments`) while always respecting
    hard `REQUIRE_WAYPOINT` TE policies — see the REQUIRE_WAYPOINT
    interaction rule below. Pure function of `network`/`config`: no trace
    events, no dependency on `SegmentRoutingAlgorithm`, safe to call directly.

    `max_waypoints_per_demand` only supports `1` in this PR (V1's declared
    scope) — kept as an explicit parameter, not a hidden constant, so a
    future PR widening this doesn't need to change this function's
    signature, only its body.

    `time_limit_s` (PR6, additive, default `None` = unlimited): a wall-clock
    budget applied to whichever search strategy is chosen. If reached before
    `EXACT_ENUMERATION` finishes evaluating every combination, the search
    stops with the best candidate found so far and `status` is reported as
    `"TIME_LIMIT"`, never `"OPTIMAL"` — an interrupted exact search has not
    actually proven anything (Part K's own status/wording table). If reached
    during `GREEDY_WPO` (already a heuristic with no optimality claim), the
    result is still reported as `"TIME_LIMIT"` rather than the usual
    `"FEASIBLE"`, so a caller can distinguish "the heuristic ran to its own
    natural completion" from "it was cut off before that." Every existing
    caller (all of PR1-5's test suite) omits this parameter and is
    completely unaffected.

    REQUIRE_WAYPOINT interaction rule (deliberately the simplest option of
    the two considered): a demand with an active hard `REQUIRE_WAYPOINT`
    policy already has its one-waypoint budget consumed by that requirement
    — the optimizer never adds a second waypoint on top of it, and never
    recommends a route that would bypass the required stop. Concretely,
    such a demand's only candidate is "no additional waypoint" (`None`);
    its required waypoint is still always applied, from
    `demand_required_waypoints`, independent of `assignment`. See
    `_candidate_waypoints_for_demand`.
    """
    start = time.time()
    if max_waypoints_per_demand != 1:
        raise ValueError(
            "optimize_waypoints only supports max_waypoints_per_demand=1 in this PR "
            "(Sprint 2 PR2's declared V1 scope)"
        )

    context = _prepare_wpo_search(network, config)
    debug = context.debug

    if context.unknown_node_demand_id is not None:
        return OptimizationResult(
            mode="WAYPOINT_OPTIMIZATION",
            status="ERROR",
            objectiveValue=0.0,
            mlu=0.0,
            solverRuntime=round((time.time() - start) * 1000.0, 2),
            solverName="WAYPOINT_OPTIMIZATION",
            message=f"Demand {context.unknown_node_demand_id} references a node that does not exist in this network.",
            debugInfo=debug,
        )

    routable_demands = context.routable_demands
    demand_graphs = context.demand_graphs
    demand_required_waypoints = context.demand_required_waypoints
    candidate_lists = context.candidate_lists
    search_space_size = context.search_space_size
    link_map = context.link_map

    if not routable_demands:
        runtime_ms = round((time.time() - start) * 1000.0, 2)
        zero_loads = {link.id: 0.0 for link in network.links}
        debug.append("No routable demands; MLU is trivially 0.")
        return OptimizationResult(
            mode="WAYPOINT_OPTIMIZATION",
            status="OPTIMAL",
            objectiveValue=0.0,
            mlu=0.0,
            linkLoads=zero_loads,
            linkUtilizations={link_id: 0.0 for link_id in zero_loads},
            solverRuntime=runtime_ms,
            solverName="EXACT_ENUMERATION",
            message="Optimal waypoint assignment within the configured candidate space.",
            recommendedWaypoints=[],
            baselineMLU=0.0,
            optimizedMLU=0.0,
            improvement=0.0,
            searchMethod="EXACT_ENUMERATION",
            searchSpaceSize=1,
            evaluatedCandidates=1,
            provenOptimal=True,
            debugInfo=debug,
        )

    baseline_assignment: WaypointAssignment = {d.id: None for d in routable_demands}
    baseline_eval = evaluate_waypoint_assignment(
        network, routable_demands, demand_graphs, demand_required_waypoints, link_map, baseline_assignment,
    )
    if baseline_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable even with no additional waypoint (before optimization): "
            + ", ".join(sorted(baseline_eval.unreachable_demand_ids))
        )

    deadline = compute_deadline(time_limit_s)
    deadline_hit: List[bool] = []

    if search_space_size <= max_exact_combinations:
        search_method = "EXACT_ENUMERATION"
        best_assignment, best_eval, evaluated = _exact_enumeration(
            routable_demands, demand_graphs, demand_required_waypoints, link_map, candidate_lists, network,
            deadline=deadline, deadline_hit=deadline_hit,
        )
    else:
        search_method = "GREEDY_WPO"
        debug.append(
            f"Exact search space ({search_space_size} combinations) exceeds max_exact_combinations "
            f"({max_exact_combinations}); falling back to GreedyWPO (Parham et al., Algorithm 3) — "
            "this result is a heuristic, not a proven optimum."
        )
        best_assignment, best_eval, evaluated = _greedy_wpo(
            routable_demands, demand_graphs, demand_required_waypoints, link_map, candidate_lists, network,
            baseline_eval, deadline=deadline, deadline_hit=deadline_hit,
        )

    hit_deadline = bool(deadline_hit)
    if hit_deadline:
        status = "TIME_LIMIT"
        proven_optimal = False
        debug.append(
            f"Optimization stopped at the {time_limit_s:g}s time limit — reporting the best assignment found so far."
        )
    elif search_method == "EXACT_ENUMERATION":
        status = "OPTIMAL"
        proven_optimal = True
    else:
        status = "FEASIBLE"
        proven_optimal = False

    if best_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable in the recommended assignment: "
            + ", ".join(sorted(best_eval.unreachable_demand_ids))
        )

    recommended = [
        WaypointAssignmentEntry(demandId=demand.id, waypointNodeId=best_assignment.get(demand.id))
        for demand in routable_demands
    ]

    runtime_ms = round((time.time() - start) * 1000.0, 2)
    if hit_deadline:
        message = "Time limit reached — best waypoint assignment found so far. Not proven optimal."
    elif proven_optimal:
        message = "Optimal waypoint assignment within the configured candidate space."
    else:
        message = "Heuristic waypoint assignment (GreedyWPO) — not proven optimal."

    return OptimizationResult(
        mode="WAYPOINT_OPTIMIZATION",
        status=status,
        objectiveValue=round(best_eval.mlu, 6),
        mlu=round(best_eval.mlu, 6),
        linkLoads={k: round(v, 6) for k, v in best_eval.link_loads.items()},
        linkUtilizations={k: round(v, 6) for k, v in best_eval.link_utilizations.items()},
        solverRuntime=runtime_ms,
        solverName=search_method,
        message=message,
        recommendedWaypoints=recommended,
        baselineMLU=round(baseline_eval.mlu, 6),
        optimizedMLU=round(best_eval.mlu, 6),
        improvement=round(baseline_eval.mlu - best_eval.mlu, 6),
        searchMethod=search_method,
        searchSpaceSize=search_space_size,
        evaluatedCandidates=evaluated,
        provenOptimal=proven_optimal,
        debugInfo=debug,
    )


def _candidate_waypoints_for_demand(
    demand: TrafficDemandInput,
    demand_graph: "nx.Graph",
    required_waypoints: List[str],
    node_ids_sorted: List[str],
) -> List[Optional[str]]:
    """This demand's candidate waypoint list: `None` ("no additional
    waypoint") always first, followed by every other network node — sorted
    alphabetically for deterministic ordering — that is both reachable from
    `demand.source` and can itself reach `demand.target` on this demand's
    own (TE-policy-adjusted) graph. The demand's own source/target are never
    themselves candidates. A demand with an active hard REQUIRE_WAYPOINT
    only ever gets `[None]` — see this module's REQUIRE_WAYPOINT interaction
    rule in `optimize_waypoints`'s docstring.
    """
    if required_waypoints:
        return [None]

    candidates: List[Optional[str]] = [None]
    for node_id in node_ids_sorted:
        if node_id in (demand.source, demand.target):
            continue
        if node_id not in demand_graph:
            continue
        if not nx.has_path(demand_graph, demand.source, node_id):
            continue
        if not nx.has_path(demand_graph, node_id, demand.target):
            continue
        candidates.append(node_id)
    return candidates


def _exact_enumeration(
    demands: List[TrafficDemandInput],
    demand_graphs: Dict[str, "nx.Graph"],
    demand_required_waypoints: Dict[str, List[str]],
    link_map,
    candidate_lists: Dict[str, List[Optional[str]]],
    network: NetworkInput,
    evaluate_fn: Optional[Callable[[WaypointAssignment], WaypointEvaluationResult]] = None,
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WaypointAssignment, WaypointEvaluationResult, int]:
    """Genuinely exhaustive search over the Cartesian product of every
    demand's own candidate list. Deterministic: `itertools.product` iterates
    in a fixed order (demands in `demands`' own order, each demand's
    candidates in `candidate_lists`' own — already sorted — order), and ties
    are broken by "first encountered wins" (no `<=`), which means an
    all-`None` assignment (always the first combination `itertools.product`
    yields, since `None` is always each candidate list's first entry) is
    preferred whenever it already achieves the best MLU — a reasonable,
    documented simplicity bias, not an arbitrary one.

    `evaluate_fn`, if given, replaces the default
    `evaluate_waypoint_assignment(network, demands, demand_graphs,
    demand_required_waypoints, link_map, assignment)` call — this is the seam
    PR4's Joint optimizer uses to reuse this exact search algorithm while
    evaluating against a *fixed* candidate link-weight setting instead of the
    network's own original weights (see `joint_optimizer.py`). Every existing
    caller omits it and gets byte-identical behavior to before this
    parameter existed.

    `deadline`/`deadline_hit` (PR6, both optional, default `None`): if
    `deadline` is given and is reached, the loop stops after whichever
    candidate was in flight and appends `True` to `deadline_hit` (a mutable
    out-parameter, so this function's own return signature — depended on by
    existing callers, including a test that imports and calls this function
    directly — never changes). At least one candidate is always evaluated
    first, regardless of the deadline, so `best_assignment`/`best_eval` are
    never `None` here even under a already-elapsed deadline.
    """
    if evaluate_fn is None:
        def evaluate_fn(assignment: WaypointAssignment) -> WaypointEvaluationResult:
            return evaluate_waypoint_assignment(
                network, demands, demand_graphs, demand_required_waypoints, link_map, assignment,
            )

    demand_ids = [d.id for d in demands]
    candidate_sequences = [candidate_lists[did] for did in demand_ids]

    best_assignment: Optional[WaypointAssignment] = None
    best_eval: Optional[WaypointEvaluationResult] = None
    evaluated = 0

    for combo in itertools.product(*candidate_sequences):
        if evaluated > 0 and deadline_passed(deadline):
            if deadline_hit is not None:
                deadline_hit.append(True)
            break
        assignment: WaypointAssignment = dict(zip(demand_ids, combo))
        result = evaluate_fn(assignment)
        evaluated += 1
        if best_eval is None or result.mlu < best_eval.mlu - _MLU_IMPROVEMENT_EPSILON:
            best_eval = result
            best_assignment = assignment

    assert best_assignment is not None and best_eval is not None  # demands is non-empty by caller contract
    return best_assignment, best_eval, evaluated


def _greedy_wpo(
    demands: List[TrafficDemandInput],
    demand_graphs: Dict[str, "nx.Graph"],
    demand_required_waypoints: Dict[str, List[str]],
    link_map,
    candidate_lists: Dict[str, List[Optional[str]]],
    network: NetworkInput,
    baseline_eval: WaypointEvaluationResult,
    evaluate_fn: Optional[Callable[[WaypointAssignment], WaypointEvaluationResult]] = None,
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WaypointAssignment, WaypointEvaluationResult, int]:
    """[Parham21] Algorithm 3 (`GreedyWPO`), followed as written:

    1. Start from the current (no-additional-waypoint) MLU.
    2. Sort demands in descending order of demand size (ties broken by
       demand id, for determinism).
    3. For each demand in that order, in turn: try every candidate waypoint
       node, recompute the network-wide MLU with every other demand's
       already-decided assignment held fixed, and keep whichever single
       candidate most reduces MLU — but only if it is a STRICT improvement
       over the best kept so far (matches the paper's own "`U_min` only
       updates on improvement" rule: a candidate that ties, or is worse,
       never displaces `None`/a previously-kept choice).
    4. Continue with the updated assignment; return the final result once
       every demand has been considered once.

    No additional heuristic behavior beyond the paper's own algorithm is
    added.

    `evaluate_fn`: see `_exact_enumeration`'s docstring — the same reuse
    seam, used identically by `joint_optimizer.py`.

    `deadline`/`deadline_hit` (PR6): same contract as `_exact_enumeration`
    — checked once per candidate waypoint tried; if reached, the current
    demand's already-best-found choice (if any) is kept and the remaining
    demands are left at their prior assignment (`None` unless already
    decided in an earlier round of this same call).
    """
    if evaluate_fn is None:
        def evaluate_fn(assignment: WaypointAssignment) -> WaypointEvaluationResult:
            return evaluate_waypoint_assignment(
                network, demands, demand_graphs, demand_required_waypoints, link_map, assignment,
            )

    demand_ids = [d.id for d in demands]
    assignment: WaypointAssignment = {did: None for did in demand_ids}
    evaluated = 1  # the baseline evaluation the caller already computed

    ordered_demands = sorted(demands, key=lambda d: (-d.amount, d.id))

    current_eval = baseline_eval
    stopped_early = False
    for demand in ordered_demands:
        if stopped_early:
            break
        best_choice: Optional[str] = None
        best_mlu = current_eval.mlu
        best_eval_for_step = current_eval

        for candidate in candidate_lists[demand.id]:
            if candidate is None:
                continue  # None is exactly the current baseline — already scored.
            if deadline_passed(deadline):
                stopped_early = True
                break
            trial: WaypointAssignment = dict(assignment)
            trial[demand.id] = candidate
            trial_eval = evaluate_fn(trial)
            evaluated += 1
            if trial_eval.mlu < best_mlu - _MLU_IMPROVEMENT_EPSILON:
                best_mlu = trial_eval.mlu
                best_choice = candidate
                best_eval_for_step = trial_eval

        assignment[demand.id] = best_choice
        current_eval = best_eval_for_step

    if stopped_early and deadline_hit is not None:
        deadline_hit.append(True)

    return assignment, current_eval, evaluated
