"""Sprint 2 PR3 — Link Weight Optimization (LWO).

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
"""
from __future__ import annotations

import itertools
import time
from typing import Dict, List, Optional, Tuple

from app.models import AlgorithmConfig, NetworkInput, TrafficDemandInput
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


def optimize_link_weights(
    network: NetworkInput,
    config: AlgorithmConfig,
    min_weight: int = DEFAULT_MIN_WEIGHT,
    max_weight: int = DEFAULT_MAX_WEIGHT,
    max_exact_combinations: int = DEFAULT_MAX_EXACT_COMBINATIONS,
) -> OptimizationResult:
    """Recommends a link-weight assignment (drawn from
    `range(min_weight, max_weight + 1)`) minimizing network-wide MLU. Pure
    function of `network`/`config`: no trace events, no dependency on
    `ECMPAlgorithm`, safe to call directly.

    Only links currently UP (per `GraphBuilder`'s existing DOWN exclusion)
    are ever candidates for a weight change — a DOWN link carries no
    traffic regardless of its weight, so both `baselineWeights` and
    `recommendedWeights` simply carry its existing weight through unchanged.

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

    node_ids = {n.id for n in network.nodes}
    debug: List[str] = []

    for demand in network.demands:
        if demand.source in node_ids and demand.target in node_ids:
            continue
        return OptimizationResult(
            mode="LINK_WEIGHT_OPTIMIZATION",
            status="ERROR",
            objectiveValue=0.0,
            mlu=0.0,
            solverRuntime=round((time.time() - start) * 1000.0, 2),
            solverName="LINK_WEIGHT_OPTIMIZATION",
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
    baseline_weights: WeightAssignment = {link.id: link.weight for link in network.links}
    # Only links currently UP appear as edges — these are the only ones a
    # candidate weight change can ever affect routing through.
    optimizable_link_ids = sorted({data["linkId"] for _u, _v, data in base_graph.edges(data=True)})
    weight_domain = list(range(min_weight, max_weight + 1))

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

    search_space_size = len(weight_domain) ** len(optimizable_link_ids)

    if search_space_size <= max_exact_combinations:
        search_method = "EXACT_ENUMERATION"
        found_weights, found_eval, evaluated = _exact_enumeration(
            routable_demands, base_graph, link_map, config.tePolicies, network,
            optimizable_link_ids, baseline_weights, weight_domain,
        )
        proven_optimal = True
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
        )
        proven_optimal = False

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

    runtime_ms = round((time.time() - start) * 1000.0, 2)
    message = (
        "Optimal weight assignment within the configured weight range."
        if proven_optimal else
        "Heuristic weight assignment (deterministic hill-climbing) — not proven optimal."
    )

    return OptimizationResult(
        mode="LINK_WEIGHT_OPTIMIZATION",
        status="OPTIMAL" if proven_optimal else "FEASIBLE",
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
) -> Tuple[WeightAssignment, LwoEvaluationResult, int]:
    """Genuinely exhaustive search over every weight assignment in
    `weight_domain ^ optimizable_link_ids` — links outside
    `optimizable_link_ids` (DOWN links) always keep their existing weight.
    Deterministic: `itertools.product` iterates in a fixed order
    (`optimizable_link_ids` is pre-sorted; `weight_domain` is
    `range(min, max+1)`, already ascending), and only a strictly better MLU
    displaces the current best — "first encountered wins" on ties.
    """
    best_weights: Optional[WeightAssignment] = None
    best_eval: Optional[LwoEvaluationResult] = None
    evaluated = 0

    for combo in itertools.product(weight_domain, repeat=len(optimizable_link_ids)):
        candidate: WeightAssignment = dict(baseline_weights)
        candidate.update(zip(optimizable_link_ids, combo))
        result = evaluate_link_weights(network, demands, base_graph, link_map, te_policies, candidate)
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
    """
    current_weights: WeightAssignment = dict(baseline_weights)
    current_eval = baseline_eval
    evaluated = 1  # the baseline evaluation the caller already computed

    # A single-link move that doesn't strictly improve MLU is never taken,
    # so this can only run for as many rounds as there are (link, value)
    # pairs before guaranteed convergence — a defensive cap, not a normal
    # stopping condition (see the loop's own `break` below).
    max_rounds = max(1, len(optimizable_link_ids) * len(weight_domain))

    for _ in range(max_rounds):
        best_link: Optional[str] = None
        best_value: Optional[int] = None
        best_mlu = current_eval.mlu
        best_eval_this_round: Optional[LwoEvaluationResult] = None

        for link_id in optimizable_link_ids:
            for value in weight_domain:
                if value == current_weights.get(link_id):
                    continue
                trial: WeightAssignment = dict(current_weights)
                trial[link_id] = value
                trial_eval = evaluate_link_weights(network, demands, base_graph, link_map, te_policies, trial)
                evaluated += 1
                if trial_eval.mlu < best_mlu - _MLU_IMPROVEMENT_EPSILON:
                    best_mlu = trial_eval.mlu
                    best_link, best_value = link_id, value
                    best_eval_this_round = trial_eval

        if best_link is None:
            break  # local optimum under single-link moves

        current_weights[best_link] = best_value
        current_eval = best_eval_this_round

    return current_weights, current_eval, evaluated
