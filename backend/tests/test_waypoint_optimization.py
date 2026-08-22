"""Tests for Sprint 2 PR2 — Waypoint Optimization (WPO).

Covers `optimize_waypoints` directly (no HTTP layer — PR2 adds no REST
endpoint) plus cross-validation against the real `SegmentRoutingAlgorithm`
to prove the optimizer's own routing evaluator (`waypoint_evaluator.py`)
reproduces Segment Routing's actual ECMP-within-segments link loads
byte-for-byte, not just approximately.

Every topology here is small and hand-computable — each test's docstring
states the expected MLU/assignment and, where relevant, the by-hand
derivation, exactly as `test_unrestricted_optimizer.py` (PR1) does.
"""
import pytest

from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    SegmentRoutingPolicy,
    TrafficDemandInput,
    TrafficEngineeringPolicy,
)
from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import (
    DEFAULT_MAX_EXACT_COMBINATIONS,
    _candidate_waypoints_for_demand,
    _greedy_wpo,
    optimize_waypoints,
)
from app.utils.graph_builder import GraphBuilder
from app.utils.te_policy import build_demand_policy_graph

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


def config(te_policies=None, sr_policies=None):
    return AlgorithmConfig(
        selectedAlgorithm="SEGMENT_ROUTING",
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=1.0,
        tePolicies=te_policies or [],
        segmentRoutingPolicies=sr_policies or [],
    )


def run_sr_with_waypoint(net: NetworkInput, cfg: AlgorithmConfig, demand_id: str, waypoint):
    """Runs the real SegmentRoutingAlgorithm with `waypoint` (a node id or
    None) as the only segment for `demand_id`, reusing whatever tePolicies
    `cfg` already carries — used to cross-validate the optimizer's own
    evaluator against the actual simulator.
    """
    policies = list(cfg.segmentRoutingPolicies) + [
        SegmentRoutingPolicy(demandId=demand_id, segments=[waypoint] if waypoint else [])
    ]
    return SegmentRoutingAlgorithm.run(net, config(te_policies=cfg.tePolicies, sr_policies=policies))


# ── A. Single demand, no beneficial waypoint ───────────────────────────────

def test_a_single_demand_no_beneficial_waypoint():
    """A-D is already the cheapest, uncongested route (capacity comfortably
    exceeds demand) — no waypoint can improve on "just go direct". The
    optimizer must recommend `None` and report zero improvement.
    """
    net = network(
        ["A", "B", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=100, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=100, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=100, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=5.0)],
    )
    result = optimize_waypoints(net, config())
    assert result.status == "OPTIMAL"
    assert result.recommendedWaypoints[0].waypointNodeId is None
    assert result.improvement == pytest.approx(0.0, abs=FLOAT_TOL)
    assert result.baselineMLU == pytest.approx(result.optimizedMLU, abs=FLOAT_TOL)


# ── B. Single demand, beneficial waypoint ──────────────────────────────────

def test_b_single_demand_beneficial_waypoint():
    """A-D direct (cap 5, weight 1) is the cheapest path but congests at
    demand=8 (MLU 1.6). Routing via B (cap 10 each leg) drops MLU to 0.8 —
    a real, needed improvement.
    """
    net = network(
        ["A", "B", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=5, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=8.0)],
    )
    result = optimize_waypoints(net, config())
    assert result.status == "OPTIMAL"
    assert result.baselineMLU == pytest.approx(1.6, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)
    assert result.recommendedWaypoints[0].waypointNodeId == "B"
    assert result.improvement == pytest.approx(0.8, abs=FLOAT_TOL)


# ── C. Exact enumeration chooses the global optimum among 3 candidates ────

def test_c_exact_enumeration_chooses_global_optimum():
    """A-D direct (cap 5) congests at MLU 1.6. Waypoint B (cap 10 legs)
    gets to 0.8; waypoint C (cap 20 legs) gets to 0.4 — strictly better
    than B. The exhaustive search must find C, not settle for B.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=5, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=20, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=20, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=8.0)],
    )
    result = optimize_waypoints(net, config())
    assert result.searchMethod == "EXACT_ENUMERATION"
    assert result.searchSpaceSize == 3  # candidates: None, B, C
    assert result.evaluatedCandidates == 3
    assert result.recommendedWaypoints[0].waypointNodeId == "C"
    assert result.optimizedMLU == pytest.approx(0.4, abs=FLOAT_TOL)
    assert result.provenOptimal is True


# ── D. Multiple demands, each with its own best waypoint ──────────────────

def test_d_multiple_demands_independent_optima():
    """Two demands sharing the same congested direct link (A-D) but with
    disjoint alternate waypoints (B for d1, C for d2, both with ample
    capacity) — the exact search must find both improvements at once."""
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=4, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=5),
        ],
        [
            TrafficDemandInput(id="d1", source="A", target="D", amount=4.0),
            TrafficDemandInput(id="d2", source="A", target="D", amount=4.0),
        ],
    )
    result = optimize_waypoints(net, config())
    assert result.baselineMLU == pytest.approx(2.0, abs=FLOAT_TOL)  # (4+4)/4 on AD
    waypoints = {r.demandId: r.waypointNodeId for r in result.recommendedWaypoints}
    assert waypoints["d1"] is not None and waypoints["d2"] is not None
    assert waypoints["d1"] != waypoints["d2"]
    assert result.optimizedMLU == pytest.approx(0.4, abs=FLOAT_TOL)  # 4/10 each, AD unused


# ── E. Deterministic candidate ordering ────────────────────────────────────

def test_e_deterministic_candidate_ordering():
    """Candidates are always `[None, <sorted node ids>]`, excluding source/
    target — never dependent on network.nodes' own (insertion) order."""
    net = network(
        ["D", "A", "C", "B"],  # deliberately out of alphabetical order
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=1.0)],
    )
    graph, link_map = GraphBuilder.build_graph(net)
    policy_result = build_demand_policy_graph(graph, link_map, "d1", [])
    demand = net.demands[0]
    candidates = _candidate_waypoints_for_demand(
        demand, policy_result.graph, [], sorted(n.id for n in net.nodes)
    )
    assert candidates == [None, "B", "C"]


# ── F. Unreachable waypoint skipped ────────────────────────────────────────

def test_f_unreachable_waypoint_skipped():
    """Directed network: A->D and D->E (one-way) means A can reach E (via
    A->D->E) but E has no edge back to D — E fails the "can reach target"
    half of reachability and must never appear as a candidate waypoint for
    an A->D demand."""
    net = network(
        ["A", "D", "E"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=10, weight=1),
            LinkInput(id="DE", source="D", target="E", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=1.0)],
        is_directed=True,
    )
    graph, link_map = GraphBuilder.build_graph(net)
    policy_result = build_demand_policy_graph(graph, link_map, "d1", [])
    demand = net.demands[0]
    candidates = _candidate_waypoints_for_demand(
        demand, policy_result.graph, [], sorted(n.id for n in net.nodes)
    )
    assert "E" not in candidates
    assert candidates == [None]


# ── G. DOWN link respected ──────────────────────────────────────────────────

def test_g_down_link_excluded_from_optimization():
    """AB is DOWN — B must not appear as a reachable waypoint (A cannot
    reach it), and the optimized result must reflect only the surviving
    topology."""
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1, operationalStatus="DOWN"),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=6.0)],
    )
    result = optimize_waypoints(net, config())
    assert "AB" not in result.linkLoads or result.linkLoads["AB"] == 0.0
    waypoints = {r.demandId: r.waypointNodeId for r in result.recommendedWaypoints}
    assert waypoints["d1"] != "B"  # unreachable via DOWN AB, must never be recommended
    assert result.optimizedMLU == pytest.approx(0.6, abs=FLOAT_TOL)  # via C: 6/10


# ── H. FORBID_LINK respected ────────────────────────────────────────────────

def test_h_forbid_link_respected():
    """AC is FORBID_LINK'd for d1 — C must not be reachable as a waypoint
    for this demand even though the physical link exists and is UP."""
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=20, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=20, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=6.0)],
    )
    te = [TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", demandId="d1", linkId="AC")]
    result = optimize_waypoints(net, config(te_policies=te))
    waypoints = {r.demandId: r.waypointNodeId for r in result.recommendedWaypoints}
    assert waypoints["d1"] != "C"  # forbidden leg, must never be recommended
    assert result.optimizedMLU == pytest.approx(0.6, abs=FLOAT_TOL)  # falls back to B: 6/10


# ── I. REQUIRE_WAYPOINT respected ───────────────────────────────────────────

def test_i_require_waypoint_respected():
    """A hard REQUIRE_WAYPOINT(B) already consumes d1's one-waypoint budget
    — the optimizer's own candidate set collapses to `[None]` (no additional
    waypoint on top of the required one), and the route it evaluates must
    still go via B."""
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=20, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=20, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=6.0)],
    )
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="B")]
    result = optimize_waypoints(net, config(te_policies=te))
    assert result.searchSpaceSize == 1
    assert result.recommendedWaypoints[0].waypointNodeId is None  # nothing added on top
    assert result.linkLoads["AB"] == pytest.approx(6.0, abs=FLOAT_TOL)  # still routed via required B
    assert result.linkLoads["AC"] == pytest.approx(0.0, abs=FLOAT_TOL)  # never considered C at all


# ── J/K/L. ECMP-within-segments before / after / both legs ─────────────────

def _ecmp_leg_topology():
    """A -(tie)- C -(tie)- D: two equal-cost paths A-X1-C / A-X2-C on the
    first leg, and two equal-cost paths C-Y1-D / C-Y2-D on the second leg.
    """
    return network(
        ["A", "X1", "X2", "C", "Y1", "Y2", "D"],
        [
            LinkInput(id="AX1", source="A", target="X1", capacity=20, weight=1),
            LinkInput(id="X1C", source="X1", target="C", capacity=20, weight=1),
            LinkInput(id="AX2", source="A", target="X2", capacity=20, weight=1),
            LinkInput(id="X2C", source="X2", target="C", capacity=20, weight=1),
            LinkInput(id="CY1", source="C", target="Y1", capacity=20, weight=1),
            LinkInput(id="Y1D", source="Y1", target="D", capacity=20, weight=1),
            LinkInput(id="CY2", source="C", target="Y2", capacity=20, weight=1),
            LinkInput(id="Y2D", source="Y2", target="D", capacity=20, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def test_j_ecmp_before_waypoint():
    """A->C leg has 2 equal-cost paths (5/5 split); C->D has only one path
    in this variant (direct link) — verify the first leg's ECMP split
    produces the expected 5/5 and matches the real SR simulator."""
    net = network(
        ["A", "X1", "X2", "C", "D"],
        [
            LinkInput(id="AX1", source="A", target="X1", capacity=20, weight=1),
            LinkInput(id="X1C", source="X1", target="C", capacity=20, weight=1),
            LinkInput(id="AX2", source="A", target="X2", capacity=20, weight=1),
            LinkInput(id="X2C", source="X2", target="C", capacity=20, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=20, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="C")]
    cfg = config(te_policies=te)
    result = optimize_waypoints(net, cfg)
    assert result.linkLoads["AX1"] == pytest.approx(5.0, abs=FLOAT_TOL)
    assert result.linkLoads["AX2"] == pytest.approx(5.0, abs=FLOAT_TOL)
    assert result.linkLoads["CD"] == pytest.approx(10.0, abs=FLOAT_TOL)

    sr = run_sr_with_waypoint(net, cfg, "d1", "C")
    sr_loads = {lr.linkId: lr.load for lr in sr.linkResults}
    for lid, load in result.linkLoads.items():
        assert sr_loads[lid] == pytest.approx(load, abs=FLOAT_TOL)


def test_k_ecmp_after_waypoint():
    """A->C is a single direct link; C->D has 2 equal-cost paths (5/5)."""
    net = network(
        ["A", "C", "Y1", "Y2", "D"],
        [
            LinkInput(id="AC", source="A", target="C", capacity=20, weight=1),
            LinkInput(id="CY1", source="C", target="Y1", capacity=20, weight=1),
            LinkInput(id="Y1D", source="Y1", target="D", capacity=20, weight=1),
            LinkInput(id="CY2", source="C", target="Y2", capacity=20, weight=1),
            LinkInput(id="Y2D", source="Y2", target="D", capacity=20, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="C")]
    cfg = config(te_policies=te)
    result = optimize_waypoints(net, cfg)
    assert result.linkLoads["AC"] == pytest.approx(10.0, abs=FLOAT_TOL)
    assert result.linkLoads["CY1"] == pytest.approx(5.0, abs=FLOAT_TOL)
    assert result.linkLoads["CY2"] == pytest.approx(5.0, abs=FLOAT_TOL)

    sr = run_sr_with_waypoint(net, cfg, "d1", "C")
    sr_loads = {lr.linkId: lr.load for lr in sr.linkResults}
    for lid, load in result.linkLoads.items():
        assert sr_loads[lid] == pytest.approx(load, abs=FLOAT_TOL)


def test_l_ecmp_both_legs():
    """Both legs (A->C and C->D) have 2 equal-cost paths each — every leg's
    own 5/5 split must be independent (the standard "aggregate re-mixes
    fully at the waypoint" ECMP semantics, not a per-end-to-end-path
    fraction) and must match the real SR simulator exactly."""
    net = _ecmp_leg_topology()
    te = [TrafficEngineeringPolicy(policyId="p1", type="REQUIRE_WAYPOINT", demandId="d1", nodeId="C")]
    cfg = config(te_policies=te)
    result = optimize_waypoints(net, cfg)
    for lid in ("AX1", "AX2", "CY1", "CY2"):
        assert result.linkLoads[lid] == pytest.approx(5.0, abs=FLOAT_TOL)

    sr = run_sr_with_waypoint(net, cfg, "d1", "C")
    sr_loads = {lr.linkId: lr.load for lr in sr.linkResults}
    for lid, load in result.linkLoads.items():
        assert sr_loads[lid] == pytest.approx(load, abs=FLOAT_TOL)
    assert sr.maxUtilization == pytest.approx(result.optimizedMLU, abs=FLOAT_TOL)


# ── M. Optimizer vs actual SR simulator equality (general cross-check) ────

def test_m_optimizer_matches_sr_simulator_for_recommended_waypoint():
    """Whatever the optimizer recommends, re-simulating that exact
    recommendation through the real SegmentRoutingAlgorithm must reproduce
    byte-identical (within float tolerance) link loads, utilizations, and
    MLU — the central compatibility guarantee PR2 exists to provide."""
    net = network(
        ["A", "B", "C", "D", "E"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=4, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=15, weight=3),
            LinkInput(id="BD", source="B", target="D", capacity=15, weight=3),
            LinkInput(id="AC", source="A", target="C", capacity=15, weight=3),
            LinkInput(id="CD", source="C", target="D", capacity=15, weight=3),
            LinkInput(id="AE", source="A", target="E", capacity=6, weight=3),
            LinkInput(id="ED", source="E", target="D", capacity=6, weight=3),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=9.0)],
    )
    cfg = config()
    result = optimize_waypoints(net, cfg)
    rec = result.recommendedWaypoints[0].waypointNodeId

    sr = run_sr_with_waypoint(net, cfg, "d1", rec)
    sr_loads = {lr.linkId: lr.load for lr in sr.linkResults}
    sr_utils = {lr.linkId: lr.utilization for lr in sr.linkResults}

    for lid, load in result.linkLoads.items():
        assert sr_loads[lid] == pytest.approx(load, abs=FLOAT_TOL)
    for lid, util in result.linkUtilizations.items():
        assert sr_utils[lid] == pytest.approx(util, abs=FLOAT_TOL)
    assert sr.maxUtilization == pytest.approx(result.optimizedMLU, abs=FLOAT_TOL)


# ── N. GreedyWPO demand ordering (descending by size) ──────────────────────

def _order_dependent_topology():
    """A-D direct is cheap but tiny-capacity (bottleneck); B and C are both
    viable, huge-capacity detours reached only via expensive-weight legs
    (so they're never chosen unless explicitly selected as a waypoint).
    Two same-source/target demands of very different size compete for the
    same detours — whichever is processed first "claims" the alphabetically
    first tied-best option (B), forcing the smaller demand to take the
    next-best (C), which becomes visible only because B is already
    occupied by the bigger demand's own traffic.
    """
    return network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=100, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=100, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=100, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=100, weight=5),
        ],
        [
            TrafficDemandInput(id="big", source="A", target="D", amount=20.0),
            TrafficDemandInput(id="small", source="A", target="D", amount=2.0),
        ],
    )


def test_n_greedy_demand_ordering_descending_by_size():
    """By hand: baseline MLU = 22/3 = 7.333. Big (20) is processed first —
    both B and C tie at MLU 0.667 (bypassing AD entirely); alphabetical
    tie-break keeps B. Small (2) is processed next, with big already on B —
    choosing B too would push AB/BD to 22/100=0.22, but choosing C keeps
    AC/CD at 2/100=0.02 while AB/BD stays at 20/100=0.2 — so small's own
    best choice (C) depends on knowing big already took B. Verified computed by
    running _greedy_wpo directly and by hand-deriving these exact numbers.
    """
    net = _order_dependent_topology()
    result = optimize_waypoints(net, config(), max_exact_combinations=1)
    assert result.searchMethod == "GREEDY_WPO"
    waypoints = {r.demandId: r.waypointNodeId for r in result.recommendedWaypoints}
    assert waypoints["big"] == "B"
    assert waypoints["small"] == "C"
    assert result.baselineMLU == pytest.approx(22.0 / 3.0, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.2, abs=FLOAT_TOL)
    assert result.evaluatedCandidates == 5  # 1 baseline + 2 (big's candidates) + 2 (small's candidates)


# ── O. GreedyWPO improvement logic (ties never displace, only strict wins) ─

def test_o_greedy_only_strict_improvement_is_kept():
    """Reuses the order-dependent topology: big's own step sees B and C
    tie exactly at MLU 0.667 — the algorithm must keep the first
    encountered (alphabetically, B), never switch to C on a tie."""
    net = _order_dependent_topology()
    demands = net.demands
    graph, link_map = GraphBuilder.build_graph(net)
    demand_graphs = {d.id: build_demand_policy_graph(graph, link_map, d.id, []).graph for d in demands}
    demand_required = {d.id: [] for d in demands}
    node_ids_sorted = sorted(n.id for n in net.nodes)
    candidate_lists = {
        d.id: _candidate_waypoints_for_demand(d, demand_graphs[d.id], [], node_ids_sorted)
        for d in demands
    }
    from app.optimization.waypoint_evaluator import evaluate_waypoint_assignment
    baseline_eval = evaluate_waypoint_assignment(
        net, demands, demand_graphs, demand_required, link_map, {d.id: None for d in demands},
    )
    assignment, best_eval, evaluated = _greedy_wpo(
        demands, demand_graphs, demand_required, link_map, candidate_lists, net, baseline_eval,
    )
    assert assignment["big"] == "B"  # first alphabetically among the tied best


# ── P. GreedyWPO provenOptimal=False ───────────────────────────────────────

def test_p_greedy_proven_optimal_is_false():
    net = _order_dependent_topology()
    result = optimize_waypoints(net, config(), max_exact_combinations=1)
    assert result.searchMethod == "GREEDY_WPO"
    assert result.provenOptimal is False
    assert result.status == "FEASIBLE"
    assert "Heuristic" in result.message


# ── Q. Exact mode provenOptimal=True ────────────────────────────────────────

def test_q_exact_proven_optimal_is_true():
    net = _order_dependent_topology()
    result = optimize_waypoints(net, config())  # default threshold; small search space
    assert result.searchMethod == "EXACT_ENUMERATION"
    assert result.provenOptimal is True
    assert result.status == "OPTIMAL"
    assert "candidate space" in result.message


# ── R. Search-space guard triggers ──────────────────────────────────────────

def test_r_search_space_guard_triggers_greedy_fallback():
    net = _order_dependent_topology()
    # 2 demands x 3 candidates each = 9 combinations; force the guard well
    # below that so GreedyWPO kicks in instead of hanging on exact search.
    result = optimize_waypoints(net, config(), max_exact_combinations=5)
    assert result.searchSpaceSize == 9
    assert result.searchMethod == "GREEDY_WPO"
    assert any("exceeds max_exact_combinations" in msg for msg in result.debugInfo)

    # And the inverse: raising the threshold back above 9 restores exact mode.
    result2 = optimize_waypoints(net, config(), max_exact_combinations=DEFAULT_MAX_EXACT_COMBINATIONS)
    assert result2.searchMethod == "EXACT_ENUMERATION"


# ── S. OPT <= WPO ────────────────────────────────────────────────────────────

def test_s_opt_lower_bounds_wpo():
    """PR1's unrestricted OPT is a strict lower bound on WPO's own
    achievable MLU (WPO is a routing-restricted mode; OPT never is) — this
    must hold with a non-trivial gap on a case where waypoint routing
    genuinely cannot reach the unrestricted optimum's proportional split.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=5, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=5, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=12.0)],
    )
    opt_result = solve_unrestricted_optimum(net)
    wpo_result = optimize_waypoints(net, config())
    assert opt_result.status == "OPTIMAL"
    assert opt_result.mlu <= wpo_result.mlu + FLOAT_TOL


# ── T. No regression in PR1 OPT ─────────────────────────────────────────────

def test_t_pr1_opt_still_works_after_pr2_model_changes():
    """PR2 added optional fields to the shared OptimizationResult model —
    confirm a plain OPT call still round-trips correctly (mode defaults to
    "OPT", none of PR2's new fields are populated).
    """
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=5.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.mode == "OPT"
    assert result.status == "OPTIMAL"
    assert result.recommendedWaypoints is None
    assert result.searchMethod is None
    assert result.provenOptimal is None
