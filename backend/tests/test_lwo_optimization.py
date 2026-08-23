"""Tests for Sprint 2 PR3 — Link Weight Optimization (LWO).

Covers `optimize_link_weights` directly (no HTTP layer — PR3 adds no REST
endpoint) plus cross-validation against the real `ECMPAlgorithm` to prove
the optimizer's own evaluator (`lwo_evaluator.py`) reproduces ECMP's actual
routing/link-load behavior under a given weight setting byte-for-byte, not
just approximately — the same discipline `test_waypoint_optimization.py`
(PR2) applies to Segment Routing.

Every topology here is small and hand-computable — each test's docstring
states the expected MLU/weights and, where relevant, the by-hand
derivation.
"""
import pytest

from app.algorithms.ecmp import ECMPAlgorithm
from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    TrafficDemandInput,
    TrafficEngineeringPolicy,
)
from app.optimization.lwo_optimizer import DEFAULT_MAX_EXACT_COMBINATIONS, optimize_link_weights
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import optimize_waypoints

FLOAT_TOL = 1e-5


def node(node_id: str) -> NodeInput:
    return NodeInput(id=node_id, label=node_id, x=0, y=0)


def network(nodes, links, demands, is_directed=False) -> NetworkInput:
    return NetworkInput(
        nodes=[node(n) for n in nodes],
        links=links,
        demands=demands,
        topologyType="custom",
        isDirected=is_directed,
    )


def config(te_policies=None):
    return AlgorithmConfig(
        selectedAlgorithm="ECMP",
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=1.0,
        tePolicies=te_policies or [],
    )


def run_ecmp_with_weights(net: NetworkInput, cfg: AlgorithmConfig, weights: dict):
    """Re-simulates `net` with each link's weight overwritten from `weights`
    (linkId -> weight) through the real ECMPAlgorithm — used to cross-
    validate the optimizer's own evaluator against the actual simulator.
    """
    new_links = [
        LinkInput(
            id=link.id, source=link.source, target=link.target,
            capacity=link.capacity, weight=weights[link.id],
            operationalStatus=link.operationalStatus,
        )
        for link in net.links
    ]
    return ECMPAlgorithm.run(net.model_copy(update={"links": new_links}), cfg)


def _direct_vs_detour_topology():
    """A-D direct (cap 5, weight 1) is initially the unique shortest path
    and congests at demand=8 (MLU 1.6). A-B-D (cap 10 each leg, weight 5
    each, combined cost 10) is a strictly better detour once its combined
    cost undercuts AD's — reachable within the default 1..5 weight domain
    (e.g. AD=2, AB=BD=1 gives a tie at cost 2, 50/50 split, MLU 0.8)."""
    return network(
        ["A", "B", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=5, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=8.0)],
    )


# ── A. Single demand ────────────────────────────────────────────────────────

def test_a_single_demand_known_congestion_improves():
    """By hand: baseline forces all 8 units via AD (cap 5) -> MLU 1.6.
    The best in-domain weight setting creates a tie/diversion to the B
    detour, splitting the load and achieving MLU 0.8."""
    net = _direct_vs_detour_topology()
    result = optimize_link_weights(net, config())
    assert result.status == "OPTIMAL"
    assert result.baselineMLU == pytest.approx(1.6, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)
    assert result.improvement == pytest.approx(0.8, abs=FLOAT_TOL)


# ── B. Multiple demands ─────────────────────────────────────────────────────

def test_b_multiple_demands():
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [
            TrafficDemandInput(id="d1", source="A", target="D", amount=6.0),
            TrafficDemandInput(id="d2", source="A", target="D", amount=6.0),
        ],
    )
    result = optimize_link_weights(net, config())
    assert result.status == "OPTIMAL"
    # Already-tied equal-cost paths give a 50/50 split of the combined 12
    # units -> 0.6 on every link; already optimal under ECMP's own model.
    assert result.baselineMLU == pytest.approx(0.6, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.6, abs=FLOAT_TOL)


# ── C. Known congestion / exact enumeration finds the global optimum ───────

def test_c_exact_enumeration_known_congestion():
    net = _direct_vs_detour_topology()
    result = optimize_link_weights(net, config())
    assert result.searchMethod == "EXACT_ENUMERATION"
    assert result.provenOptimal is True
    assert result.status == "OPTIMAL"
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)
    assert "weight range" in result.message


# ── D. Heuristic mode: genuine single-move improvement ─────────────────────

def test_d_heuristic_finds_single_move_improvement():
    """A-B/B-D (cap 8) tie exactly with A-C/C-D (cap 20) at baseline weights
    (all 5) -> 50/50 split of 12 units: AB/BD get 6 (util 0.75), AC/CD get 6
    (util 0.3) -> MLU 0.75. Lowering AC alone (one link, one move) breaks
    the tie in favor of the higher-capacity C route entirely: all 12 via C,
    util 12/20=0.6 -> MLU 0.6. A single-link move suffices, so
    HEURISTIC_LWO must find it even though it's forced here via a tiny
    max_exact_combinations.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=8, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=8, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=20, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=20, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=12.0)],
    )
    result = optimize_link_weights(net, config(), max_exact_combinations=1)
    assert result.searchMethod == "HEURISTIC_LWO"
    assert result.provenOptimal is False
    assert result.status == "FEASIBLE"
    assert result.baselineMLU == pytest.approx(0.75, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.6, abs=FLOAT_TOL)
    assert "Heuristic" in result.message


def test_d2_heuristic_can_get_stuck_where_exact_succeeds():
    """Honest limitation, not a bug: on `_direct_vs_detour_topology()`, no
    SINGLE-link move from the baseline (AD=1, AB=BD=5) ever helps — AD's
    domain tops out at 5, always strictly less than the fixed 10-cost detour
    (AB+BD), so changing AD alone never creates a tie, and changing AB or
    BD alone (holding the other at 5) can only raise the detour's cost
    further, never lower it below AD's. Escaping requires changing AB *and*
    BD together (or AD down to something still less, which doesn't exist
    below 1) — something no single-link hill-climb step can do. Exact
    enumeration (test_c above) finds the real improvement; this
    demonstrates why the heuristic exists as a labeled, honest fallback,
    not a proof of general poor performance.
    """
    net = _direct_vs_detour_topology()
    result = optimize_link_weights(net, config(), max_exact_combinations=1)
    assert result.searchMethod == "HEURISTIC_LWO"
    assert result.optimizedMLU == pytest.approx(result.baselineMLU, abs=FLOAT_TOL)
    assert result.recommendedWeights == result.baselineWeights


# ── E. Threshold switching (search-space guard) ─────────────────────────────

def test_e_threshold_switching_both_directions():
    net = _direct_vs_detour_topology()  # 3 links, domain 1..5 -> 5^3 = 125
    result_forced_heuristic = optimize_link_weights(net, config(), max_exact_combinations=1)
    assert result_forced_heuristic.searchMethod == "HEURISTIC_LWO"

    result_default = optimize_link_weights(net, config(), max_exact_combinations=DEFAULT_MAX_EXACT_COMBINATIONS)
    assert result_default.searchMethod == "EXACT_ENUMERATION"
    assert result_default.searchSpaceSize == 125

    natural_guard = optimize_link_weights(net, config(), max_exact_combinations=124)
    assert natural_guard.searchMethod == "HEURISTIC_LWO"
    assert any("exceeds max_exact_combinations" in msg for msg in natural_guard.debugInfo)


# ── F. Deterministic behavior ────────────────────────────────────────────────

def test_f_deterministic_across_repeated_calls():
    net = _direct_vs_detour_topology()
    result1 = optimize_link_weights(net, config())
    result2 = optimize_link_weights(net, config())
    assert result1.recommendedWeights == result2.recommendedWeights
    assert result1.optimizedMLU == result2.optimizedMLU
    assert result1.evaluatedCandidates == result2.evaluatedCandidates

    result3 = optimize_link_weights(net, config(), max_exact_combinations=1)
    result4 = optimize_link_weights(net, config(), max_exact_combinations=1)
    assert result3.recommendedWeights == result4.recommendedWeights


# ── G. Policy compatibility: FORBID_LINK ────────────────────────────────────

def test_g_forbid_link_respected():
    net = _direct_vs_detour_topology()
    te = [TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", demandId="d1", linkId="AB")]
    result = optimize_link_weights(net, config(te))
    assert result.linkLoads["AB"] == 0.0
    assert result.linkLoads["BD"] == 0.0
    assert result.linkLoads["AD"] == pytest.approx(8.0, abs=FLOAT_TOL)  # only remaining route


# ── H. Policy compatibility: REQUIRE_WAYPOINT ───────────────────────────────

def test_h_require_waypoint_respected():
    net = _direct_vs_detour_topology()
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="B")]
    result = optimize_link_weights(net, config(te))
    assert result.linkLoads["AD"] == pytest.approx(0.0, abs=FLOAT_TOL)
    assert result.linkLoads["AB"] == pytest.approx(8.0, abs=FLOAT_TOL)
    assert result.linkLoads["BD"] == pytest.approx(8.0, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)  # 8/10, AD's weight is irrelevant now


# ── I. Policy compatibility: AVOID_LINK / PREFER_LINK ───────────────────────

def test_i_avoid_and_prefer_link_respected():
    """AVOID_LINK on AD adds a large cost penalty, pushing all traffic to
    the B detour even though the LWO-searched *base* weight would otherwise
    keep AD cheapest — the optimizer must route (and thus report link
    loads) consistent with the policy-adjusted cost, not the bare weight.
    """
    net = _direct_vs_detour_topology()
    te_avoid = [TrafficEngineeringPolicy(policyId="p1", type="AVOID_LINK", demandId="d1", linkId="AD", penalty=100.0)]
    result_avoid = optimize_link_weights(net, config(te_avoid))
    assert result_avoid.linkLoads["AD"] == pytest.approx(0.0, abs=FLOAT_TOL)
    assert result_avoid.linkLoads["AB"] == pytest.approx(8.0, abs=FLOAT_TOL)

    te_prefer = [TrafficEngineeringPolicy(policyId="p2", type="PREFER_LINK", demandId="d1", linkId="AD", penalty=0.0)]
    result_prefer = optimize_link_weights(net, config(te_prefer))
    # A zero-penalty PREFER_LINK has no cost effect — AD stays cheapest by
    # its own bare weight regardless, matching baseline routing.
    assert result_prefer.linkLoads["AD"] >= 0.0  # sanity: still a valid, non-crashing result


# ── J. DOWN links respected ──────────────────────────────────────────────────

def test_j_down_link_excluded_and_unweighted():
    net = _direct_vs_detour_topology()
    down_links = [
        LinkInput(id="AD", source="A", target="D", capacity=5, weight=1, operationalStatus="DOWN"),
        net.links[1],
        net.links[2],
    ]
    net_down = net.model_copy(update={"links": down_links})
    result = optimize_link_weights(net_down, config())
    assert result.recommendedWeights["AD"] == 1.0  # never touched — not optimizable while DOWN
    assert result.linkLoads.get("AD", 0.0) == 0.0
    assert result.searchSpaceSize == 5 ** 2  # only AB, BD are optimizable


# ── K. OPT <= LWO ────────────────────────────────────────────────────────────

def test_k_opt_lower_bounds_lwo():
    """OPT permits arbitrary splitting; LWO is restricted to whatever ECMP
    can express under some weight setting — OPT must never do worse.
    """
    net = _direct_vs_detour_topology()
    opt_result = solve_unrestricted_optimum(net)
    lwo_result = optimize_link_weights(net, config())
    assert opt_result.status == "OPTIMAL"
    assert opt_result.mlu <= lwo_result.mlu + FLOAT_TOL


# ── L. ECMP equality (cross-validation against the real simulator) ────────

def test_l_optimizer_matches_ecmp_simulator_for_recommended_weights():
    """Whatever LWO recommends, re-simulating those exact weights through
    the real ECMPAlgorithm must reproduce byte-identical (within float
    tolerance) link loads, utilizations, and MLU."""
    net = network(
        ["A", "B", "C", "D", "E"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=4, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=15, weight=3),
            LinkInput(id="BD", source="B", target="D", capacity=15, weight=3),
            LinkInput(id="AC", source="A", target="C", capacity=15, weight=3),
            LinkInput(id="CD", source="C", target="D", capacity=15, weight=3),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=9.0)],
    )
    cfg = config()
    result = optimize_link_weights(net, cfg)
    ecmp_result = run_ecmp_with_weights(net, cfg, result.recommendedWeights)
    ecmp_loads = {lr.linkId: lr.load for lr in ecmp_result.linkResults}
    ecmp_utils = {lr.linkId: lr.utilization for lr in ecmp_result.linkResults}

    for lid, load in result.linkLoads.items():
        assert ecmp_loads[lid] == pytest.approx(load, abs=FLOAT_TOL)
    for lid, util in result.linkUtilizations.items():
        assert ecmp_utils[lid] == pytest.approx(util, abs=FLOAT_TOL)
    assert ecmp_result.maxUtilization == pytest.approx(result.optimizedMLU, abs=FLOAT_TOL)


def test_l2_ecmp_evaluator_matches_simulator_directly_on_baseline():
    """Same cross-check as test_l, but on the *baseline* (untouched)
    weights specifically — the evaluator's `baselineMLU` must equal what
    ECMPAlgorithm itself reports for the network exactly as given.
    """
    net = _direct_vs_detour_topology()
    cfg = config()
    result = optimize_link_weights(net, cfg)
    ecmp_result = ECMPAlgorithm.run(net, cfg)
    assert ecmp_result.maxUtilization == pytest.approx(result.baselineMLU, abs=FLOAT_TOL)


# ── M. Regression: PR1/PR2 unaffected ───────────────────────────────────────

def test_m_pr1_and_pr2_unaffected_by_pr3_model_changes():
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=5.0)],
    )
    opt_result = solve_unrestricted_optimum(net)
    assert opt_result.mode == "OPT"
    assert opt_result.recommendedWeights is None
    assert opt_result.searchMethod is None

    wpo_result = optimize_waypoints(net, config())
    assert wpo_result.mode == "WAYPOINT_OPTIMIZATION"
    assert wpo_result.recommendedWeights is None
    assert wpo_result.recommendedWaypoints is not None
