"""Sprint 2 PR3 — Link Weight Optimization (LWO). Extended in PR6 with a
search-space preview (`estimate_link_weight_search_space`) and an optional
wall-clock deadline (`time_limit_s`) — both additive, safety/UX-only; the
routing/optimization semantics documented below are unchanged since PR3.

Finds a link-weight assignment (drawn from a configurable, bounded integer
domain) minimizing network-wide Maximum Link Utilization (MLU), under
EXACTLY the routing semantics `ECMPAlgorithm` itself implements: shortest-
path routing under the candidate weight setting, ECMP equal splitting over
every tied shortest path, and the same FORBID_LINK/AVOID_LINK/PREFER_LINK/
REQUIRE_WAYPOINT TE-policy handling `ecmp.py` already has. See
`lwo_evaluator.py` for the shared, pure evaluator that guarantees this.

NP-hardness (read this before "improving" the search): [Fortz00] §II.B
proves that finding an optimal OSPF/ECMP weight setting is NP-hard — the
even-split-under-variable-weights condition is not linear, and shortest-path
membership is itself a function of the weight variables being solved for
(see docs/research/sprint2-mip-architecture-analysis.md §6.2/§7.2 and
...-v1.md Part C4 for the full argument, reconfirmed unchanged by this PR).
**This module never claims an exact solution for arbitrary topologies.**
`EXACT_ENUMERATION` is a genuinely exhaustive brute-force search, but only
ever over an explicitly bounded, small candidate space (few links, a small
integer weight domain) — "optimal within the configured weight range and
edge set actually searched," never "the NP-hard problem, solved exactly, in
general." `HEURISTIC_LWO` is the practical fallback for anything larger,
exactly as [Fortz00]'s own `HeurOSPF` is the literature's answer to the same
intractability, though this PR's version is a simplified, deterministic
hill-climb (no randomized restarts or tabu search — "no randomness in V1" is
this PR's own explicit constraint) rather than a reproduction of
`HeurOSPF` itself.

If a PR6 `time_limit_s` deadline is reached before `EXACT_ENUMERATION`
finishes evaluating every combination (or before `HEURISTIC_LWO` converges
on its own), the search stops with whatever best candidate it has found so
far and the result is reported as `TIME_LIMIT` — never `OPTIMAL` for an
interrupted exact search; see `optimize_link_weights`'s own docstring.
"""
from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from app.models import AlgorithmConfig, NetworkInput, TrafficDemandInput
from app.optimization.deadline import compute_deadline, deadline_passed
from app.optimization.lwo_evaluator import (
    LwoEvaluationResult,
    WeightAssignment,
    evaluate_link_weights,
)
from app.optimization.models import OptimizationResult
from app.utils.graph_builder import GraphBuilder

# A brute-force exhaustive search grows as (weight domain size) ^ (optimizable
# edge count) — far steeper than PR2's per-demand candidate product, since
# every edge (not every demand) is its own search dimension. 50,000 total
# weight-assignment evaluations is the default ceiling — chosen for
# consistency with PR2's own default and because it keeps exact search
# practical up to roughly 6 edges at the default 1..5 domain (5^6=15,625;
# 5^7=78,125 already exceeds it) — comfortably covering the small teaching
# topologies this project ships, while a larger topology automatically and
# safely falls back to HEURISTIC_LWO instead of hanging.
DEFAULT_MAX_EXACT_COMBINATIONS = 50_000

DEFAULT_MIN_WEIGHT = 1
DEFAULT_MAX_WEIGHT = 5

# Strict-improvement tolerance for MLU comparisons, matching PR1/PR2's own
# floating-point noise guard.
_MLU_IMPROVEMENT_EPSILON = 1e-9


@dataclass
class LwoSearchContext:
    """Everything about an LWO run that does not depend on which search
    strategy is chosen — shared, unchanged, by `optimize_link_weights`
    (which actually searches) and `estimate_link_weight_search_space` (PR6,
    which only reports the candidate-space size a real run would search).
    """
    routable_demands: List[TrafficDemandInput]
    base_graph: object
    link_map: dict
    baseline_weights: WeightAssignment
    optimizable_link_ids: List[str]
    weight_domain: List[int]
    search_space_size: int
    debug: List[str]
    unknown_node_demand_id: Optional[str] = None


def _prepare_lwo_search(
    network: NetworkInput, min_weight: int, max_weight: int,
) -> LwoSearchContext:
    node_ids = {n.id for n in network.nodes}
    debug: List[str] = []

    for demand in network.demands:
        if demand.source not in node_ids or demand.target not in node_ids:
            return LwoSearchContext(
                routable_demands=[], base_graph=None, link_map={}, baseline_weights={},
                optimizable_link_ids=[], weight_domain=[], search_space_size=0, debug=debug,
                unknown_node_demand_id=demand.id,
            )

    routable_demands: List[TrafficDemandInput] = []
    for demand in network.demands:
        if demand.source == demand.target:
            debug.append(f"Demand {demand.id} source equals target; excluded from optimization")
            continue
        routable_demands.append(demand)

    base_graph, link_map = GraphBuilder.build_graph(network)
    baseline_weights: WeightAssignment = {link.id: link.weight for link in network.links}
    # Only links currently UP appear as edges — these are the only ones a
    # candidate weight change can ever affect routing through.
    optimizable_link_ids = sorted({data["linkId"] for _u, _v, data in base_graph.edges(data=True)})
    weight_domain = list(range(min_weight, max_weight + 1))
    search_space_size = len(weight_domain) ** len(optimizable_link_ids)

    return LwoSearchContext(
        routable_demands=routable_demands,
        base_graph=base_graph,
        link_map=link_map,
        baseline_weights=baseline_weights,
        optimizable_link_ids=optimizable_link_ids,
        weight_domain=weight_domain,
        search_space_size=search_space_size,
        debug=debug,
    )


@dataclass
class LwoSearchSpaceEstimate:
    """PR6 — a preview of what a real `optimize_link_weights` call would
    search, without actually running it. `searchSpaceSize` is exactly
    `len(weight_domain) ** optimizableLinkCount`, computed via the identical
    code `optimize_link_weights` itself uses, so it can never drift from
    what a real run actually searches.
    """
    searchSpaceSize: int
    optimizableLinkCount: int
    weightDomainSize: int
    minWeight: int
    maxWeight: int
    error: Optional[str] = None


def estimate_link_weight_search_space(
    network: NetworkInput,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    max_weight: int = DEFAULT_MAX_WEIGHT,
) -> LwoSearchSpaceEstimate:
    """Computes LWO's candidate-space size without running any search — the
    Optimization Lab's "search-space preview" (PR6 §3) calls this before a
    student commits to running LWO/Joint, including immediately after they
    change the weight range slider (PR6 §7), so the size updates live.
    """
    if min_weight > max_weight:
        return LwoSearchSpaceEstimate(
            searchSpaceSize=0, optimizableLinkCount=0, weightDomainSize=0,
            minWeight=min_weight, maxWeight=max_weight,
            error=f"min_weight ({min_weight}) must be <= max_weight ({max_weight})",
        )
    context = _prepare_lwo_search(network, min_weight, max_weight)
    if context.unknown_node_demand_id is not None:
        return LwoSearchSpaceEstimate(
            searchSpaceSize=0, optimizableLinkCount=0, weightDomainSize=0,
            minWeight=min_weight, maxWeight=max_weight,
            error=f"Demand {context.unknown_node_demand_id} references a node that does not exist in this network.",
        )
    return LwoSearchSpaceEstimate(
        searchSpaceSize=context.search_space_size,
        optimizableLinkCount=len(context.optimizable_link_ids),
        weightDomainSize=len(context.weight_domain),
        minWeight=min_weight,
        maxWeight=max_weight,
    )


def optimize_link_weights(
    network: NetworkInput,
    config: AlgorithmConfig,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    max_weight: int = DEFAULT_MAX_WEIGHT,
    max_exact_combinations: int = DEFAULT_MAX_EXACT_COMBINATIONS,
    time_limit_s: Optional[float] = None,
) -> OptimizationResult:
    """Recommends a link-weight assignment (drawn from
    `range(min_weight, max_weight + 1)`) minimizing network-wide MLU. Pure
    function of `network`/`config`: no trace events, no dependency on
    `ECMPAlgorithm`, safe to call directly.

    Only links currently UP (per `GraphBuilder`'s existing DOWN exclusion)
    are ever candidates for a weight change — a DOWN link carries no
    traffic regardless of its weight, so both `baselineWeights` and
    `recommendedWeights` simply carry its existing weight through unchanged.

    `time_limit_s` (PR6, additive, default `None` = unlimited): see
    `waypoint_optimizer.optimize_waypoints`'s docstring for the exact
    contract — identical here. An interrupted `EXACT_ENUMERATION` or
    `HEURISTIC_LWO` run is reported as `status="TIME_LIMIT"`, never
    `"OPTIMAL"`/plain `"FEASIBLE"`. Every existing caller (all of PR1-5's
    test suite) omits this parameter and is completely unaffected.

    Never regresses: the best candidate found by whichever search runs is
    always compared against the untouched current (baseline) weight setting,
    and the better of the two is what's actually recommended — `EXACT_
    ENUMERATION` only ever searches within the declared domain, which may
    not even contain the network's actual current weights, so without this
    check a domain-bounded search could otherwise recommend a regression.
    `HEURISTIC_LWO` starts from baseline and only ever accepts strict
    improvements, so it never needs this safety net, but the check is
    applied uniformly for both search methods for one clear guarantee.
    """
    start = time.time()
    if min_weight > max_weight:
        raise ValueError(f"min_weight ({min_weight}) must be <= max_weight ({max_weight})")

    context = _prepare_lwo_search(network, min_weight, max_weight)
    debug = context.debug

    if context.unknown_node_demand_id is not None:
        return OptimizationResult(
            mode="LINK_WEIGHT_OPTIMIZATION",
            status="ERROR",
            objectiveValue=0.0,
            mlu=0.0,
            solverRuntime=round((time.time() - start) * 1000.0, 2),
            solverName="LINK_WEIGHT_OPTIMIZATION",
            message=f"Demand {context.unknown_node_demand_id} references a node that does not exist in this network.",
            debugInfo=debug,
        )

    routable_demands = context.routable_demands
    base_graph = context.base_graph
    link_map = context.link_map
    baseline_weights = context.baseline_weights
    optimizable_link_ids = context.optimizable_link_ids
    weight_domain = context.weight_domain
    search_space_size = context.search_space_size

    if not routable_demands:
        runtime_ms = round((time.time() - start) * 1000.0, 2)
        zero_loads = {link.id: 0.0 for link in network.links}
        debug.append("No routable demands; MLU is trivially 0.")
        return OptimizationResult(
            mode="LINK_WEIGHT_OPTIMIZATION",
            status="OPTIMAL",
            objectiveValue=0.0,
            mlu=0.0,
            linkLoads=zero_loads,
            linkUtilizations={link_id: 0.0 for link_id in zero_loads},
            solverRuntime=runtime_ms,
            solverName="EXACT_ENUMERATION",
            message="Optimal weight assignment within the configured weight range.",
            recommendedWeights=dict(baseline_weights),
            baselineWeights=dict(baseline_weights),
            baselineMLU=0.0,
            optimizedMLU=0.0,
            improvement=0.0,
            searchMethod="EXACT_ENUMERATION",
            searchSpaceSize=1,
            evaluatedCandidates=1,
            provenOptimal=True,
            debugInfo=debug,
        )

    baseline_eval = evaluate_link_weights(
        network, routable_demands, base_graph, link_map, config.tePolicies, baseline_weights,
    )
    if baseline_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable under the current weight setting (before optimization): "
            + ", ".join(sorted(baseline_eval.unreachable_demand_ids))
        )

    deadline = compute_deadline(time_limit_s)
    deadline_hit: List[bool] = []

    if search_space_size <= max_exact_combinations:
        search_method = "EXACT_ENUMERATION"
        found_weights, found_eval, evaluated = _exact_enumeration(
            routable_demands, base_graph, link_map, config.tePolicies, network,
            optimizable_link_ids, baseline_weights, weight_domain,
            deadline=deadline, deadline_hit=deadline_hit,
        )
    else:
        search_method = "HEURISTIC_LWO"
        debug.append(
            f"Exact search space ({search_space_size} combinations) exceeds max_exact_combinations "
            f"({max_exact_combinations}); falling back to HEURISTIC_LWO (deterministic hill-climbing) — "
            "this result is a heuristic, not a proven optimum."
        )
        found_weights, found_eval, evaluated = _heuristic_lwo(
            routable_demands, base_graph, link_map, config.tePolicies, network,
            optimizable_link_ids, baseline_weights, baseline_eval, weight_domain,
            deadline=deadline, deadline_hit=deadline_hit,
        )

    hit_deadline = bool(deadline_hit)

    # Never regress — see docstring. HEURISTIC_LWO already can't (it starts
    # from baseline and only accepts strict improvements); EXACT_ENUMERATION
    # can, since its domain may not contain the current weights at all.
    if baseline_eval.mlu < found_eval.mlu - _MLU_IMPROVEMENT_EPSILON:
        best_weights, best_eval = dict(baseline_weights), baseline_eval
        debug.append(
            "The best in-domain weight assignment found did not beat the network's current weight "
            "setting; recommending no change."
        )
    else:
        best_weights, best_eval = found_weights, found_eval

    if best_eval.unreachable_demand_ids:
        debug.append(
            "Demand(s) unreachable under the recommended weight assignment: "
            + ", ".join(sorted(best_eval.unreachable_demand_ids))
        )

    if hit_deadline:
        status = "TIME_LIMIT"
        proven_optimal = False
        debug.append(
            f"Optimization stopped at the {time_limit_s:g}s time limit — reporting the best weight assignment found so far."
        )
        message = "Time limit reached — best weight assignment found so far. Not proven optimal."
    elif search_method == "EXACT_ENUMERATION":
        status = "OPTIMAL"
        proven_optimal = True
        message = "Optimal weight assignment within the configured weight range."
    else:
        status = "FEASIBLE"
        proven_optimal = False
        message = "Heuristic weight assignment (deterministic hill-climbing) — not proven optimal."

    runtime_ms = round((time.time() - start) * 1000.0, 2)

    return OptimizationResult(
        mode="LINK_WEIGHT_OPTIMIZATION",
        status=status,
        objectiveValue=round(best_eval.mlu, 6),
        mlu=round(best_eval.mlu, 6),
        linkLoads={k: round(v, 6) for k, v in best_eval.link_loads.items()},
        linkUtilizations={k: round(v, 6) for k, v in best_eval.link_utilizations.items()},
        solverRuntime=runtime_ms,
        solverName=search_method,
        message=message,
        recommendedWeights={k: float(v) for k, v in best_weights.items()},
        baselineWeights=dict(baseline_weights),
        baselineMLU=round(baseline_eval.mlu, 6),
        optimizedMLU=round(best_eval.mlu, 6),
        improvement=round(baseline_eval.mlu - best_eval.mlu, 6),
        searchMethod=search_method,
        searchSpaceSize=search_space_size,
        evaluatedCandidates=evaluated,
        provenOptimal=proven_optimal,
        debugInfo=debug,
    )


def _exact_enumeration(
    demands: List[TrafficDemandInput],
    base_graph,
    link_map,
    te_policies,
    network: NetworkInput,
    optimizable_link_ids: List[str],
    baseline_weights: WeightAssignment,
    weight_domain: List[int],
    evaluate_fn: Optional[Callable[[WeightAssignment], LwoEvaluationResult]] = None,
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WeightAssignment, LwoEvaluationResult, int]:
    """Genuinely exhaustive search over every weight assignment in
    `weight_domain ^ optimizable_link_ids` — links outside
    `optimizable_link_ids` (DOWN links) always keep their existing weight.
    Deterministic: `itertools.product` iterates in a fixed order
    (`optimizable_link_ids` is pre-sorted; `weight_domain` is
    `range(min, max+1)`, already ascending), and only a strictly better MLU
    displaces the current best — "first encountered wins" on ties.

    `evaluate_fn`, if given, replaces the default
    `evaluate_link_weights(network, demands, base_graph, link_map,
    te_policies, candidate)` call — the seam PR4's Joint optimizer uses to
    reuse this exact search algorithm while evaluating against a *fixed*
    waypoint assignment instead of ECMP's plain (REQUIRE_WAYPOINT-only)
    routing model (see `joint_optimizer.py`). Every existing caller omits it
    and gets byte-identical behavior to before this parameter existed.

    `deadline`/`deadline_hit` (PR6): same contract as
    `waypoint_optimizer._exact_enumeration` — checked once per candidate, at
    least one candidate always evaluated first regardless of the deadline.
    """
    if evaluate_fn is None:
        def evaluate_fn(candidate: WeightAssignment) -> LwoEvaluationResult:
            return evaluate_link_weights(network, demands, base_graph, link_map, te_policies, candidate)

    best_weights: Optional[WeightAssignment] = None
    best_eval: Optional[LwoEvaluationResult] = None
    evaluated = 0

    for combo in itertools.product(weight_domain, repeat=len(optimizable_link_ids)):
        if evaluated > 0 and deadline_passed(deadline):
            if deadline_hit is not None:
                deadline_hit.append(True)
            break
        candidate: WeightAssignment = dict(baseline_weights)
        candidate.update(zip(optimizable_link_ids, combo))
        result = evaluate_fn(candidate)
        evaluated += 1
        if best_eval is None or result.mlu < best_eval.mlu - _MLU_IMPROVEMENT_EPSILON:
            best_eval = result
            best_weights = candidate

    assert best_weights is not None and best_eval is not None  # non-empty by construction (repeat=0 yields 1 combo)
    return best_weights, best_eval, evaluated


def _heuristic_lwo(
    demands: List[TrafficDemandInput],
    base_graph,
    link_map,
    te_policies,
    network: NetworkInput,
    optimizable_link_ids: List[str],
    baseline_weights: WeightAssignment,
    baseline_eval: LwoEvaluationResult,
    weight_domain: List[int],
    evaluate_fn: Optional[Callable[[WeightAssignment], LwoEvaluationResult]] = None,
    deadline: Optional[float] = None,
    deadline_hit: Optional[List[bool]] = None,
) -> Tuple[WeightAssignment, LwoEvaluationResult, int]:
    """Deterministic hill-climbing / coordinate descent, inspired by
    [Fortz00]'s `HeurOSPF` local-search structure but simplified per this
    PR's own "no randomness in V1" constraint:

    1. Start from the network's actual current weights.
    2. Each round, scan every optimizable link (sorted order) and every
       domain value (ascending order) other than the link's current value,
       evaluating network-wide MLU with that one link changed and everything
       else held fixed.
    3. Keep only the single globally-best change this round — and only if
       it is a STRICT improvement over the current MLU (matches PR2's
       GreedyWPO's own "only update on improvement" rule) — apply it, and
       start a new round (a single change can open up further improvements
       elsewhere, so the scan restarts rather than continuing where it left
       off).
    4. Stop as soon as a full round finds no improving change at all (a
       local optimum under single-link moves).

    No additional heuristic behavior (randomized restarts, tabu list,
    simulated annealing) is added — this is deliberately the simplest
    reading of "iterative local search," not a reproduction of
    `HeurOSPF` itself.

    `evaluate_fn`: see `_exact_enumeration`'s docstring — the same reuse
    seam, used identically by `joint_optimizer.py`.

    `deadline`/`deadline_hit` (PR6): checked once per (link, value) trial;
    if reached, the round in progress is abandoned (its best-so-far trial,
    if any, is still applied — a partial round can only ever produce an
    improvement or no change, never a regression, so abandoning it early is
    always safe) and the search stops.
    """
    if evaluate_fn is None:
        def evaluate_fn(candidate: WeightAssignment) -> LwoEvaluationResult:
            return evaluate_link_weights(network, demands, base_graph, link_map, te_policies, candidate)

    current_weights: WeightAssignment = dict(baseline_weights)
    current_eval = baseline_eval
    evaluated = 1  # the baseline evaluation the caller already computed

    # A single-link move that doesn't strictly improve MLU is never taken,
    # so this can only run for as many rounds as there are (link, value)
    # pairs before guaranteed convergence — a defensive cap, not a normal
    # stopping condition (see the loop's own `break` below).
    max_rounds = max(1, len(optimizable_link_ids) * len(weight_domain))

    stopped_early = False
    for _ in range(max_rounds):
        if stopped_early:
            break
        best_link: Optional[str] = None
        best_value: Optional[int] = None
        best_mlu = current_eval.mlu
        best_eval_this_round: Optional[LwoEvaluationResult] = None

        for link_id in optimizable_link_ids:
            if stopped_early:
                break
            for value in weight_domain:
                if value == current_weights.get(link_id):
                    continue
                if deadline_passed(deadline):
                    stopped_early = True
                    break
                trial: WeightAssignment = dict(current_weights)
                trial[link_id] = value
                trial_eval = evaluate_fn(trial)
                evaluated += 1
                if trial_eval.mlu < best_mlu - _MLU_IMPROVEMENT_EPSILON:
                    best_mlu = trial_eval.mlu
                    best_link, best_value = link_id, value
                    best_eval_this_round = trial_eval

        if best_link is None:
            break  # local optimum under single-link moves

        current_weights[best_link] = best_value
        current_eval = best_eval_this_round

    if stopped_early and deadline_hit is not None:
        deadline_hit.append(True)

    return current_weights, current_eval, evaluated
