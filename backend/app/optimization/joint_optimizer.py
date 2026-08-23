"""Sprint 2 PR4 — Joint Optimization.

Simultaneously recommends a link-weight assignment (PR3's domain) and a
per-demand additional-waypoint assignment (PR2's domain) minimizing
network-wide Maximum Link Utilization (MLU) — under the exact same
ECMP-within-segments routing model WPO already uses (see
`joint_evaluator.py`), never a fourth, separately implemented routing
engine.

**This module does not reimplement WPO or LWO's search algorithms.** It
reuses `waypoint_optimizer._exact_enumeration`/`_greedy_wpo` and
`lwo_optimizer._exact_enumeration`/`_heuristic_lwo` directly — both were
given an injectable `evaluate_fn` parameter in this PR specifically so Joint
could call the *exact same* brute-force/hill-climbing/greedy code, just
evaluated against `joint_evaluator.evaluate_joint_assignment` (which holds
the *other* dimension fixed) instead of each optimizer's own single-
dimension evaluator. See each of those functions' updated docstrings.

Two search strategies, chosen automatically by combined candidate-space size
(mirroring WPO's/LWO's own dispatch pattern):

- `EXACT_JOINT_ENUMERATION`: brute-force over `weight_combinations x
  waypoint_combinations` simultaneously — genuinely exhaustive within that
  declared combined space (`provenOptimal=True`), but this space is the
  *product* of two already-nontrivial spaces, so it is realistically
  teaching-scale-only (a handful of edges and demands) — never called
  "MILP": [Parham21]/[Fortz00] together establish that no exact MILP for the
  Joint problem is available in our sources at all (see
  docs/research/sprint2-mip-architecture-analysis.md §5), so this brute-
  force enumeration is explicitly *not* presented as filling that gap —
  it is a plain, bounded, exhaustive search, nothing more.
- `JOINT_ALTERNATING` (the default for any realistic network): iterates
  "optimize weights holding waypoints fixed, then optimize waypoints holding
  weights fixed" until MLU improvement drops below `epsilon` or
  `max_iterations` is reached. This generalizes [Parham21]'s own
  `JOINT-Heur` (Algorithm 2: run `HeurOSPF`, run `GreedyWPO` under the
  resulting weights, re-split demands at the chosen waypoints, re-run
  `HeurOSPF` — a *fixed* 3-step composition) into an iterate-to-convergence
  loop, per this PR's own explicit stop-condition requirement — a documented
  generalization, not a literal reproduction of Algorithm 2's fixed step
  count. `provenOptimal=False`, always — alternating/coordinate-descent-
  style optimization of a jointly non-convex problem is never provably
  jointly optimal, even when an individual round's own LWO or WPO step
  happens to run in its own exact sub-mode.

A note on routing-model fidelity (read alongside PR2's own note): because
PR0 chose Parham-style ECMP-within-segments for Segment Routing (not
[Le21]'s unsplittable model), and PR2's WPO followed suit, this Joint
implementation composes LWO(ECMP) with WPO(ECMP) — the *same* routing model
throughout — which means, unlike what
docs/research/sprint2-mip-architecture-analysis.md §8/§9 anticipated before
PR0 was actually built, this Joint mode *is* faithful to [Parham21]'s own
Joint definition (both dimensions under even-split ECMP), not a mismatched
ECMP+single-path hybrid. See this PR's own architecture-doc addendum for the
full, explicit record of this correction.
"""
from __future__ import annotations

import itertools
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.models import AlgorithmConfig, NetworkInput, TrafficDemandInput
from app.optimization.deadline import compute_deadline, deadline_passed
from app.optimization.joint_evaluator import JointEvaluationResult, evaluate_joint_assignment
from app.optimization.lwo_evaluator import WeightAssignment
from app.optimization.lwo_optimizer import (
    DEFAULT_MAX_WEIGHT,
    DEFAULT_MIN_WEIGHT,
    _exact_enumeration as _lwo_exact_enumeration,
    _heuristic_lwo,
    estimate_link_weight_search_space,
)
from app.optimization.models import OptimizationResult, WaypointAssignmentEntry
from app.optimization.waypoint_evaluator import WaypointAssignment
from app.optimization.waypoint_optimizer import (
    _candidate_waypoints_for_demand,
    _exact_enumeration as _wpo_exact_enumeration,
    _greedy_wpo,
    estimate_waypoint_search_space,
)
from app.utils.graph_builder import GraphBuilder
from app.utils.routing_helpers import sanitize_segments
from app.utils.te_policy import build_demand_policy_graph

# Same default as WPO's/LWO's own guard, applied here to the *combined*
# (weight x waypoint) search space — since that combined space is a
# product of two already-nontrivial spaces, this ceiling realistically
# limits EXACT_JOINT_ENUMERATION to very small networks (e.g. 2-3 edges and
# 1-2 demands at the default weight/candidate domains), with
# JOINT_ALTERNATING handling everything else automatically.
DEFAULT_MAX_EXACT_COMBINATIONS = 50_000

DEFAULT_MAX_ITERATIONS = 10
# Stop alternating once one full LWO+WPO round improves MLU by less than
# this. Distinct from the internal per-step strict-improvement tolerance
# (1e-9, inherited from the reused WPO/LWO search functions) — this is the
# user-facing, configurable convergence threshold the task calls for.
DEFAULT_EPSILON = 1e-6

_MLU_IMPROVEMENT_EPSILON = 1e-9


@dataclass
class JointSearchSpaceEstimate:
    """PR6 — a preview of what a real `optimize_joint` call would search,
    without actually running it: `weightSearchSpace x waypointSearchSpace`,
    computed via the exact same `estimate_link_weight_search_space`/
    `estimate_waypoint_search_space` functions the individual LWO/WPO modes
    use for their own previews — so Joint's own preview can never drift from
    either half's real computation, and a student can directly see *why*
    Joint's combined space grows faster than either alone.
    """
    searchSpaceSize: int
    weightSearchSpace: int
    waypointSearchSpace: int
    error: Optional[str] = None


def estimate_joint_search_space(
    network: NetworkInput,
    config: AlgorithmConfig,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    max_weight: int = DEFAULT_MAX_WEIGHT,
) -> JointSearchSpaceEstimate:
    weight_estimate = estimate_link_weight_search_space(network, min_weight, max_weight)
    if weight_estimate.error:
        return JointSearchSpaceEstimate(searchSpaceSize=0, weightSearchSpace=0, waypointSearchSpace=0, error=weight_estimate.error)
    waypoint_estimate = estimate_waypoint_search_space(network, config)
    if waypoint_estimate.error:
        return JointSearchSpaceEstimate(searchSpaceSize=0, weightSearchSpace=0, waypointSearchSpace=0, error=waypoint_estimate.error)
    return JointSearchSpaceEstimate(
        searchSpaceSize=weight_estimate.searchSpaceSize * waypoint_estimate.searchSpaceSize,
        weightSearchSpace=weight_estimate.searchSpaceSize,
        waypointSearchSpace=waypoint_estimate.searchSpaceSize,
    )


def optimize_joint(
    network: NetworkInput,
    config: AlgorithmConfig,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    max_weight: int = DEFAULT_MAX_WEIGHT,
    max_exact_combinations: int = DEFAULT_MAX_EXACT_COMBINATIONS,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    epsilon: float = DEFAULT_EPSILON,
    time_limit_s: Optional[float] = None,
) -> OptimizationResult:
    """Recommends a joint (link-weight, waypoint) assignment minimizing
    network-wide MLU. Pure function of `network`/`config`: no trace events,
    no dependency on any simulation algorithm, safe to call directly.

    Initialization (per this PR's own requirement): starts from the
    network's actual current link weights and no additional waypoints
    (`None` per demand — the same "current configuration" WPO/LWO
    individually start from) — never a random start.

    `time_limit_s` (PR6, additive, default `None` = unlimited): applies to
    the *entire* search — both `EXACT_JOINT_ENUMERATION`'s own loop and, for
    `JOINT_ALTERNATING`, checked once per round in addition to each round's
    own LWO/WPO sub-search independently honoring it (see
    `waypoint_optimizer`/`lwo_optimizer`'s own docstrings for that per-step
    contract). An interrupted search — exact or alternating — is reported as
    `status="TIME_LIMIT"`, never `"OPTIMAL"`/plain `"FEASIBLE"`. Every
    existing caller (all of PR1-5's test suite) omits this parameter and is
    completely unaffected.

    Never regresses: the best assignment found by whichever search runs is
    always compared against this same starting configuration, and the
    better of the two is what's actually recommended (mirrors LWO's own
    safety net, extended here to the combined (weights, waypoints) state).
    """
    start = time.time()

    node_ids = {n.id for n in network.nodes}
    debug: List[str] = []

    for demand in network.demands:
        if demand.source in node_ids and demand.target in node_ids:
            continue
        return OptimizationResult(
            mode="JOINT_OPTIMIZATION",
            status="ERROR",
            objectiveValue=0.0,
            mlu=0.0,
            solverRuntime=round((time.time() - start) * 1000.0, 2),
            solverName="JOINT_OPTIMIZATION",
            message=f"Demand {demand.id} references a node that does not exist in this network.",
            debugInfo=debug,
        )

    routable_demands: List[TrafficDemandInput] = []
    for demand in network.demands:
        if demand.source == demand.target:
            debug.append(f"Demand {demand.id} source equals target; excluded from optimization")
            continue
        routable_demands.append(demand)

    base_graph, link_map = GraphBuilder.build_graph(network)
    node_ids_sorted = sorted(node_ids)
    baseline_weights: WeightAssignment = {link.id: link.weight for link in network.links}
    optimizable_link_ids = sorted({data["linkId"] for _u, _v, data in base_graph.edges(data=True)})
    weight_domain = list(range(min_weight, max_weight + 1))

    if not routable_demands:
        runtime_ms = round((time.time() - start) * 1000.0, 2)
        zero_loads = {link.id: 0.0 for link in network.links}
        debug.append("No routable demands; MLU is trivially 0.")
        return OptimizationResult(
            mode="JOINT_OPTIMIZATION",
            status="OPTIMAL",
            objectiveValue=0.0,
            mlu=0.0,
            linkLoads=zero_loads,
            linkUtilizations={link_id: 0.0 for link_id in zero_loads},
            solverRuntime=runtime_ms,
            solverName="EXACT_JOINT_ENUMERATION",
            message="Optimal joint assignment within the configured weight range and candidate space.",
            recommendedWeights=dict(baseline_weights),
            recommendedWaypoints=[],
            baselineMLU=0.0,
            optimizedMLU=0.0,
            improvement=0.0,
            searchMethod="EXACT_JOINT_ENUMERATION",
            searchSpaceSize=1,
            evaluatedCandidates=1,
            provenOptimal=True,
            iterations=0,
            convergenceReason="No routable demands; nothing to optimize.",
            debugInfo=debug,
        )

    # ── Per-demand TE-policy application (required waypoints, FORBID/AVOID/
    #    PREFER) is recomputed against the *candidate* weighted graph inside
    #    `evaluate_joint_assignment` on every call (weights vary per
    #    candidate here, unlike WPO's/LWO's own single-dimension search) —
    #    but reachability for candidate-waypoint generation below never
    #    depends on link weight, so it is safe and cheaper to compute the
    #    required-waypoint list and candidate node lists once, up front,
    #    against the network's own original weights. ──────────────────────
    demand_graphs = {}
    demand_required_waypoints: Dict[str, List[str]] = {}
    for demand in routable_demands:
        policy_result = build_demand_policy_graph(base_graph, link_map, demand.id, config.tePolicies)
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

    baseline_waypoints: WaypointAssignment = {d.id: None for d in routable_demands}
    baseline_eval = evaluate_joint_assignment(
        network, routable_demands, base_graph, link_map, config.tePolicies, baseline_weights, baseline_waypoints,
    )
    if baseline_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable under the current weights/no additional waypoint (before optimization): "
            + ", ".join(sorted(baseline_eval.unreachable_demand_ids))
        )

    weight_search_space = len(weight_domain) ** len(optimizable_link_ids)
    waypoint_search_space = 1
    for demand in routable_demands:
        waypoint_search_space *= len(candidate_lists[demand.id])
    joint_search_space_size = weight_search_space * waypoint_search_space

    deadline = compute_deadline(time_limit_s)
    deadline_hit: List[bool] = []

    iterations: Optional[int] = None
    if joint_search_space_size <= max_exact_combinations:
        search_method = "EXACT_JOINT_ENUMERATION"
        found_weights, found_waypoints, found_eval, evaluated = _exact_joint_enumeration(
            routable_demands, base_graph, link_map, config.tePolicies, network,
            optimizable_link_ids, baseline_weights, weight_domain, candidate_lists,
            deadline=deadline, deadline_hit=deadline_hit,
        )
        convergence_reason = (
            "Time limit reached before the combined candidate space was fully searched."
            if deadline_hit else
            "Exhaustive search over the combined candidate space completed."
        )
    else:
        search_method = "JOINT_ALTERNATING"
        debug.append(
            f"Combined search space ({joint_search_space_size} = {weight_search_space} weight "
            f"combinations x {waypoint_search_space} waypoint combinations) exceeds "
            f"max_exact_combinations ({max_exact_combinations}); using alternating LWO/WPO "
            "optimization (generalizes [Parham21]'s JOINT-Heur) — this result is a heuristic, "
            "not a proven optimum."
        )
        (
            found_weights, found_waypoints, found_eval, evaluated, iterations, convergence_reason,
        ) = _joint_alternating(
            routable_demands, base_graph, link_map, config.tePolicies, network,
            optimizable_link_ids, baseline_weights, weight_domain, candidate_lists,
            demand_graphs, demand_required_waypoints, baseline_eval,
            max_iterations, epsilon, max_exact_combinations,
            deadline=deadline, deadline_hit=deadline_hit,
        )

    hit_deadline = bool(deadline_hit)
    proven_optimal = (search_method == "EXACT_JOINT_ENUMERATION") and not hit_deadline

    if found_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable in the recommended assignment: "
            + ", ".join(sorted(found_eval.unreachable_demand_ids))
        )

    # Never regress — see docstring.
    if baseline_eval.mlu < found_eval.mlu - _MLU_IMPROVEMENT_EPSILON:
        best_weights, best_waypoints, best_eval = dict(baseline_weights), dict(baseline_waypoints), baseline_eval
        debug.append(
            "The best joint assignment found did not beat the network's current weights/no-waypoint "
            "configuration; recommending no change."
        )
    else:
        best_weights, best_waypoints, best_eval = found_weights, found_waypoints, found_eval

    recommended_waypoints = [
        WaypointAssignmentEntry(demandId=demand.id, waypointNodeId=best_waypoints.get(demand.id))
        for demand in routable_demands
    ]

    if hit_deadline:
        status = "TIME_LIMIT"
        debug.append(
            f"Optimization stopped at the {time_limit_s:g}s time limit — reporting the best joint "
            "assignment found so far."
        )
        message = "Time limit reached — best joint assignment found so far. Not proven optimal."
    elif proven_optimal:
        status = "OPTIMAL"
        message = "Optimal joint assignment within the configured weight range and candidate space."
    else:
        status = "FEASIBLE"
        message = "Heuristic joint assignment (alternating LWO/WPO) — not proven optimal."

    runtime_ms = round((time.time() - start) * 1000.0, 2)

    return OptimizationResult(
        mode="JOINT_OPTIMIZATION",
        status=status,
        objectiveValue=round(best_eval.mlu, 6),
        mlu=round(best_eval.mlu, 6),
        linkLoads={k: round(v, 6) for k, v in best_eval.link_loads.items()},
        linkUtilizations={k: round(v, 6) for k, v in best_eval.link_utilizations.items()},
        solverRuntime=runtime_ms,
        solverName=search_method,
        message=message,
        recommendedWeights={k: float(v) for k, v in best_weights.items()},
        recommendedWaypoints=recommended_waypoints,
        baselineMLU=round(baseline_eval.mlu, 6),
        optimizedMLU=round(best_eval.mlu, 6),
        improvement=round(baseline_eval.mlu - best_eval.mlu, 6),
        searchMethod=search_method,
        searchSpaceSize=joint_search_space_size,
        evaluatedCandidates=evaluated,
        provenOptimal=proven_optimal,
        iterations=iterations,
        convergenceReason=convergence_reason,
        debugInfo=debug,
    )


def _exact_joint_enumeration(
    demands: List[TrafficDemandInput],
    base_graph,
    link_map,
    te_policies,
    network: NetworkInput,
    optimizable_link_ids: List[str],
    baseline_weights: WeightAssignment,
    weight_domain: List[int],
    candidate_lists: Dict[str, List[Optional[str]]],
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WeightAssignment, WaypointAssignment, JointEvaluationResult, int]:
    """Genuinely exhaustive search over `weight_combinations x
    waypoint_combinations` simultaneously — the one piece of new (but
    trivial: a nested Cartesian product, no new routing or search
    algorithm) orchestration code in this module. Deterministic: weight
    combinations iterate over sorted link ids/ascending domain values
    (matching LWO's own convention); waypoint combinations iterate over
    `demands`' own order and each demand's own sorted candidate list
    (matching WPO's own convention). "First encountered wins" on ties.

    `deadline`/`deadline_hit` (PR6): same contract as
    `waypoint_optimizer._exact_enumeration` — checked once per (weight,
    waypoint) combination, at least one always evaluated first.
    """
    demand_ids = [d.id for d in demands]
    waypoint_combos = list(itertools.product(*[candidate_lists[did] for did in demand_ids]))

    best_weights: Optional[WeightAssignment] = None
    best_waypoints: Optional[WaypointAssignment] = None
    best_eval: Optional[JointEvaluationResult] = None
    evaluated = 0
    stopped_early = False

    for w_combo in itertools.product(weight_domain, repeat=len(optimizable_link_ids)):
        if stopped_early:
            break
        weights: WeightAssignment = dict(baseline_weights)
        weights.update(zip(optimizable_link_ids, w_combo))

        for wp_combo in waypoint_combos:
            if evaluated > 0 and deadline_passed(deadline):
                stopped_early = True
                break
            waypoints: WaypointAssignment = dict(zip(demand_ids, wp_combo))
            result = evaluate_joint_assignment(network, demands, base_graph, link_map, te_policies, weights, waypoints)
            evaluated += 1
            if best_eval is None or result.mlu < best_eval.mlu - _MLU_IMPROVEMENT_EPSILON:
                best_eval = result
                best_weights = weights
                best_waypoints = waypoints

    if stopped_early and deadline_hit is not None:
        deadline_hit.append(True)

    assert best_weights is not None and best_waypoints is not None and best_eval is not None
    return best_weights, best_waypoints, best_eval, evaluated


def _joint_alternating(
    demands: List[TrafficDemandInput],
    base_graph,
    link_map,
    te_policies,
    network: NetworkInput,
    optimizable_link_ids: List[str],
    baseline_weights: WeightAssignment,
    weight_domain: List[int],
    candidate_lists: Dict[str, List[Optional[str]]],
    demand_graphs,
    demand_required_waypoints: Dict[str, List[str]],
    baseline_eval: JointEvaluationResult,
    max_iterations: int,
    epsilon: float,
    max_exact_combinations: int,
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WeightAssignment, WaypointAssignment, JointEvaluationResult, int, int, str]:
    """Generalizes [Parham21]'s `JOINT-Heur` (Algorithm 2) into an iterate-
    to-convergence loop: each round, first re-optimize weights holding the
    current waypoint assignment fixed (reusing `lwo_optimizer`'s own exact/
    heuristic search, evaluated via `evaluate_joint_assignment` instead of
    `evaluate_link_weights` — see those functions' `evaluate_fn` parameter),
    then re-optimize waypoints holding the *new* weights fixed (reusing
    `waypoint_optimizer`'s own exact/greedy search the same way). Stops the
    first round whose combined MLU improvement drops below `epsilon`, or
    after `max_iterations` rounds, whichever comes first.

    Each round's own LWO/WPO step independently chooses exact vs. heuristic
    search by comparing *its own* sub-space size against
    `max_exact_combinations` — identical logic to `optimize_link_weights`/
    `optimize_waypoints` themselves, just parameterized per call.

    `deadline`/`deadline_hit` (PR6): checked once at the START of each round
    (coarse-grained — stop before beginning a new round at all once time is
    up) *and* forwarded into each round's own LWO/WPO sub-search (fine-
    grained — stop mid-round too). Either one setting `deadline_hit` is
    enough to report `TIME_LIMIT` to the caller; a round already in
    progress when the deadline hits still returns its own best-so-far
    weights/waypoints (never a regression — see each sub-search's own
    contract), which this loop then keeps as `current_weights`/
    `current_waypoints` before returning.
    """
    demand_ids = [d.id for d in demands]
    current_weights: WeightAssignment = dict(baseline_weights)
    current_waypoints: WaypointAssignment = {did: None for did in demand_ids}
    current_eval = baseline_eval
    evaluated_total = 0

    weight_search_space = len(weight_domain) ** len(optimizable_link_ids)
    waypoint_search_space = 1
    for demand in demands:
        waypoint_search_space *= len(candidate_lists[demand.id])

    iterations_done = 0
    convergence_reason = f"Maximum iterations ({max_iterations}) reached."

    for iteration in range(1, max_iterations + 1):
        if deadline_passed(deadline):
            convergence_reason = f"Time limit reached after {iteration - 1} completed iteration(s)."
            if deadline_hit is not None:
                deadline_hit.append(True)
            break
        iterations_done = iteration

        # ── Step 1: optimize weights, waypoints held fixed at current_waypoints. ──
        fixed_waypoints = dict(current_waypoints)

        def lwo_evaluate_fn(weights: WeightAssignment, _fixed=fixed_waypoints) -> JointEvaluationResult:
            return evaluate_joint_assignment(network, demands, base_graph, link_map, te_policies, weights, _fixed)

        step_deadline_hit: List[bool] = []
        if weight_search_space <= max_exact_combinations:
            new_weights, new_weights_eval, n1 = _lwo_exact_enumeration(
                demands, base_graph, link_map, te_policies, network,
                optimizable_link_ids, current_weights, weight_domain,
                evaluate_fn=lwo_evaluate_fn, deadline=deadline, deadline_hit=step_deadline_hit,
            )
        else:
            new_weights, new_weights_eval, n1 = _heuristic_lwo(
                demands, base_graph, link_map, te_policies, network,
                optimizable_link_ids, current_weights, current_eval, weight_domain,
                evaluate_fn=lwo_evaluate_fn, deadline=deadline, deadline_hit=step_deadline_hit,
            )
        evaluated_total += n1

        # ── Step 2: optimize waypoints, weights held fixed at new_weights. ──
        fixed_weights = dict(new_weights)

        def wpo_evaluate_fn(assignment: WaypointAssignment, _fixed=fixed_weights) -> JointEvaluationResult:
            return evaluate_joint_assignment(network, demands, base_graph, link_map, te_policies, _fixed, assignment)

        if waypoint_search_space <= max_exact_combinations:
            new_waypoints, new_waypoints_eval, n2 = _wpo_exact_enumeration(
                demands, demand_graphs, demand_required_waypoints, link_map, candidate_lists, network,
                evaluate_fn=wpo_evaluate_fn, deadline=deadline, deadline_hit=step_deadline_hit,
            )
        else:
            new_waypoints, new_waypoints_eval, n2 = _greedy_wpo(
                demands, demand_graphs, demand_required_waypoints, link_map, candidate_lists, network,
                new_weights_eval,
                evaluate_fn=wpo_evaluate_fn, deadline=deadline, deadline_hit=step_deadline_hit,
            )
        evaluated_total += n2

        improvement = current_eval.mlu - new_waypoints_eval.mlu
        current_weights, current_waypoints, current_eval = new_weights, new_waypoints, new_waypoints_eval

        if step_deadline_hit:
            convergence_reason = f"Time limit reached during iteration {iteration}."
            if deadline_hit is not None:
                deadline_hit.append(True)
            break

        if improvement < epsilon:
            convergence_reason = (
                f"MLU improvement below epsilon ({epsilon}) after {iteration} iteration(s)."
            )
            break

    return current_weights, current_waypoints, current_eval, evaluated_total, iterations_done, convergence_reason
