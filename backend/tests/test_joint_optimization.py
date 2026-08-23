"""Tests for Sprint 2 PR4 — Joint Optimization.

Covers `optimize_joint` directly (no HTTP layer — PR4 adds no REST
endpoint). Every topology here is small and its expected MLU/assignment is
either hand-derived or was verified against `solve_unrestricted_optimum`/
`optimize_waypoints`/`optimize_link_weights` directly before being written
into an assertion — the same discipline PR1-3's own test suites apply.

Per [Parham21] Eq. 2.1, `OPT <= Joint <= min(LWO, WPO)` is a *weak*
inequality — nothing in the literature claims Joint is always *strictly*
better than both single-dimension optimizers on every instance (sometimes
it exactly matches one of them, when that dimension alone already reaches
the jointly-best achievable point). This suite includes both a case where
Joint substantially beats WPO alone (recovering from WPO's real single-
waypoint-per-demand V1 limitation via a weight adjustment) and a case where
it substantially beats LWO alone (recovering from LWO's inability to route
same-origin-destination demands differently) — together demonstrating both
of Joint's two reuse dimensions are load-bearing, without requiring one
single scenario to dominate both at once.
"""
import pytest

from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    TrafficDemandInput,
    TrafficEngineeringPolicy,
)
from app.optimization.joint_optimizer import DEFAULT_MAX_EXACT_COMBINATIONS, optimize_joint
from app.optimization.lwo_optimizer import optimize_link_weights
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


def _diamond_topology():
    """Classic small diamond: A-B-D (cap10) and A-C-D (cap5), one demand of
    12. Only 4 links and 1 demand -> combined search space (5^4 weight
    combos x 3 waypoint combos = 1875) comfortably fits under the default
    exact-mode threshold, so this is the suite's EXACT_JOINT_ENUMERATION
    fixture.
    """
    return network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=5, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=5, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=12.0)],
    )


def _wpo_limited_topology():
    """A single demand where the truly best route requires effectively two
    routing decisions — "definitely reach W" and "definitely get there via
    the high-capacity X1 leg, not the tied but tiny-capacity X2 leg" — but
    V1's WPO only ever assigns *one* additional waypoint per demand, so
    naming W alone leaves the X1/X2 tie unresolved (a real bottleneck),
    and naming X1 alone reopens a *different* tie at X1's own downstream
    fork (a direct, tiny-capacity bypass to D). LWO alone has no such
    per-waypoint-count limit for a *single* demand — the same optimal route
    is just "the one weight setting where this path is uniquely cheapest,"
    which pure weight search can always find here. Joint reaches the same
    optimum LWO does, verified computationally (baseline 6.667, WPO best
    3.333, LWO/Joint 1.0).
    """
    return network(
        ["A", "X1", "X2", "W", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AX1", source="A", target="X1", capacity=20, weight=2),
            LinkInput(id="X1W", source="X1", target="W", capacity=20, weight=2),
            LinkInput(id="AX2", source="A", target="X2", capacity=3, weight=2),
            LinkInput(id="X2W", source="X2", target="W", capacity=3, weight=2),
            LinkInput(id="WD", source="W", target="D", capacity=25, weight=1),
            LinkInput(id="X1D", source="X1", target="D", capacity=2, weight=3),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=20.0)],
        is_directed=True,
    )


def _asymmetric_multi_demand_topology():
    """Two demands sharing one A->D pair (big=20, small=4) with asymmetric
    detour capacities (B: cap30, C: cap8) — LWO alone must apply the *same*
    weight setting (and therefore the same routing) to both demands, so it
    cannot split them across the two detours differently; WPO can, and
    substantially outperforms LWO alone here (verified: baseline 8.0, LWO
    best 0.8, WPO/Joint 0.667).
    """
    return network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=30, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=30, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=8, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=8, weight=5),
        ],
        [
            TrafficDemandInput(id="big", source="A", target="D", amount=20.0),
            TrafficDemandInput(id="small", source="A", target="D", amount=4.0),
        ],
    )


# ── A. Single demand ─────────────────────────────────────────────────────

def test_a_single_demand():
    net = _wpo_limited_topology()
    result = optimize_joint(net, config())
    assert result.status in ("OPTIMAL", "FEASIBLE")
    assert result.optimizedMLU == pytest.approx(1.0, abs=FLOAT_TOL)


# ── B. Multiple demands ──────────────────────────────────────────────────

def test_b_multiple_demands():
    net = _asymmetric_multi_demand_topology()
    result = optimize_joint(net, config())
    assert len(result.recommendedWaypoints) == 2
    assert result.optimizedMLU == pytest.approx(0.666667, abs=1e-4)


# ── C. Joint strictly better than baseline ──────────────────────────────

def test_c_joint_better_than_baseline():
    net = _wpo_limited_topology()
    result = optimize_joint(net, config())
    assert result.baselineMLU == pytest.approx(6.666667, abs=1e-4)
    assert result.optimizedMLU < result.baselineMLU
    assert result.improvement > 0


# ── D. Joint >= OPT (OPT is the unrestricted lower bound) ───────────────

def test_d_joint_ge_opt():
    for net in (_diamond_topology(), _wpo_limited_topology(), _asymmetric_multi_demand_topology()):
        opt_result = solve_unrestricted_optimum(net)
        joint_result = optimize_joint(net, config())
        assert opt_result.status == "OPTIMAL"
        assert opt_result.mlu <= joint_result.mlu + FLOAT_TOL


# ── E. Joint <= WPO ───────────────────────────────────────────────────────

def test_e_joint_le_wpo():
    """The WPO-limited topology is the sharpest illustration: Joint's added
    weight dimension recovers from WPO's real single-waypoint-per-demand
    limit (3.333 -> 1.0)."""
    net = _wpo_limited_topology()
    wpo_result = optimize_waypoints(net, config())
    joint_result = optimize_joint(net, config())
    assert wpo_result.optimizedMLU == pytest.approx(3.333333, abs=1e-4)
    assert joint_result.mlu <= wpo_result.optimizedMLU + FLOAT_TOL
    assert joint_result.mlu < wpo_result.optimizedMLU  # strict improvement here


# ── F. Joint <= LWO ───────────────────────────────────────────────────────

def test_f_joint_le_lwo():
    """The asymmetric multi-demand topology is the sharpest illustration:
    Joint's added waypoint dimension recovers from LWO's inability to route
    two same-OD-pair demands differently (0.8 -> 0.667)."""
    net = _asymmetric_multi_demand_topology()
    lwo_result = optimize_link_weights(net, config())
    joint_result = optimize_joint(net, config())
    assert lwo_result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)
    assert joint_result.mlu <= lwo_result.optimizedMLU + FLOAT_TOL
    assert joint_result.mlu < lwo_result.optimizedMLU  # strict improvement here


# ── G. Exact joint mode ──────────────────────────────────────────────────

def test_g_exact_joint_enumeration():
    net = _diamond_topology()
    result = optimize_joint(net, config())
    assert result.searchMethod == "EXACT_JOINT_ENUMERATION"
    assert result.provenOptimal is True
    assert result.status == "OPTIMAL"
    assert result.searchSpaceSize == 5 ** 4 * 3  # 4 links x domain 1..5, 3 waypoint candidates (None,B,C)
    assert "candidate space" in result.message


# ── H. Heuristic (alternating) joint mode ───────────────────────────────

def test_h_heuristic_joint_alternating():
    net = _wpo_limited_topology()  # combined space naturally exceeds the default threshold
    result = optimize_joint(net, config())
    assert result.searchMethod == "JOINT_ALTERNATING"
    assert result.provenOptimal is False
    assert result.status == "FEASIBLE"
    assert "Heuristic" in result.message
    assert result.iterations is not None and result.iterations >= 1
    assert result.convergenceReason is not None


# ── I. Threshold switching ───────────────────────────────────────────────

def test_i_threshold_switching_both_directions():
    net = _diamond_topology()  # small enough to be exact by default
    forced_heuristic = optimize_joint(net, config(), max_exact_combinations=1)
    assert forced_heuristic.searchMethod == "JOINT_ALTERNATING"
    assert forced_heuristic.provenOptimal is False

    back_to_exact = optimize_joint(net, config(), max_exact_combinations=DEFAULT_MAX_EXACT_COMBINATIONS)
    assert back_to_exact.searchMethod == "EXACT_JOINT_ENUMERATION"


# ── J. Determinism ───────────────────────────────────────────────────────

def test_j_deterministic_across_repeated_calls():
    for net in (_diamond_topology(), _wpo_limited_topology()):
        result1 = optimize_joint(net, config())
        result2 = optimize_joint(net, config())
        assert result1.recommendedWeights == result2.recommendedWeights
        assert result1.recommendedWaypoints == result2.recommendedWaypoints
        assert result1.optimizedMLU == result2.optimizedMLU
        assert result1.evaluatedCandidates == result2.evaluatedCandidates


# ── K. Policy compatibility: FORBID_LINK ────────────────────────────────

def test_k_forbid_link_respected():
    net = _diamond_topology()
    te = [TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", demandId="d1", linkId="AB")]
    result = optimize_joint(net, config(te))
    assert result.linkLoads["AB"] == 0.0
    assert result.linkLoads["BD"] == 0.0
    assert result.linkLoads["AC"] == pytest.approx(12.0, abs=FLOAT_TOL)


# ── L. Policy compatibility: REQUIRE_WAYPOINT ───────────────────────────

def test_l_require_waypoint_respected():
    """A hard REQUIRE_WAYPOINT already consumes d1's one-waypoint budget —
    Joint's own waypoint search collapses to [None] for this demand (same
    rule as WPO's), but LWO's weight dimension can still be searched
    freely underneath the required route."""
    net = _diamond_topology()
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="B")]
    result = optimize_joint(net, config(te))
    assert result.recommendedWaypoints[0].waypointNodeId is None
    assert result.linkLoads["AB"] == pytest.approx(12.0, abs=FLOAT_TOL)
    assert result.linkLoads["AC"] == 0.0


# ── M. DOWN links respected ──────────────────────────────────────────────

def test_m_down_link_excluded():
    net = _diamond_topology()
    down_links = [
        LinkInput(id="AB", source="A", target="B", capacity=10, weight=1, operationalStatus="DOWN"),
        net.links[1], net.links[2], net.links[3],
    ]
    net_down = net.model_copy(update={"links": down_links})
    result = optimize_joint(net_down, config())
    assert result.recommendedWeights["AB"] == 1.0  # never touched — not optimizable while DOWN
    assert result.linkLoads.get("AB", 0.0) == 0.0
    assert result.linkLoads["AC"] == pytest.approx(12.0, abs=FLOAT_TOL)


# ── N. Regressions: PR1/PR2/PR3 unaffected ──────────────────────────────

def test_n_pr1_pr2_pr3_unaffected_by_pr4_model_changes():
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=5.0)],
    )
    opt_result = solve_unrestricted_optimum(net)
    assert opt_result.mode == "OPT"
    assert opt_result.iterations is None
    assert opt_result.convergenceReason is None

    wpo_result = optimize_waypoints(net, config())
    assert wpo_result.mode == "WAYPOINT_OPTIMIZATION"
    assert wpo_result.iterations is None
    assert wpo_result.recommendedWeights is None

    lwo_result = optimize_link_weights(net, config())
    assert lwo_result.mode == "LINK_WEIGHT_OPTIMIZATION"
    assert lwo_result.iterations is None
    assert lwo_result.recommendedWaypoints is None


def test_n2_wpo_and_lwo_public_apis_unaffected_by_evaluate_fn_refactor():
    """PR4 added an optional `evaluate_fn` parameter to WPO's/LWO's private
    search functions to reuse them — this must not change either public
    function's own default (no-`evaluate_fn`) behavior at all."""
    net = _diamond_topology()
    wpo_result = optimize_waypoints(net, config())
    lwo_result = optimize_link_weights(net, config())
    assert wpo_result.searchMethod == "EXACT_ENUMERATION"
    assert lwo_result.searchMethod == "EXACT_ENUMERATION"
    assert wpo_result.optimizedMLU == pytest.approx(1.2, abs=FLOAT_TOL)
    assert lwo_result.optimizedMLU == pytest.approx(1.2, abs=FLOAT_TOL)
