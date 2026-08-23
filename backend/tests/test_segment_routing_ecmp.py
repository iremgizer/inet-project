"""Tests for Segment Routing's ECMP-within-segments upgrade (PR0, Sprint 2
preparation — see docs/research/sprint2-mip-architecture-analysis.md).

Every leg (source->first waypoint, waypoint->waypoint, last waypoint->
destination) now discovers ALL equal-cost shortest paths and splits the
traffic arriving at that leg's source evenly across them — the same
equal-cost-path-discovery and equal-split primitives ECMP itself uses (see
`app/utils/routing_helpers.py`: `resolve_equal_cost_paths`,
`compute_equal_split_path_shares`, `compute_ecmp_leg_distribution`). A leg
with only one shortest path behaves exactly as before PR0.

This file focuses on the NEW behavior (ties, multi-waypoint splitting,
conservation, TE-policy/failure interaction with a tie, deterministic
ordering). Regression coverage for the pre-PR0, no-tie case lives in
`test_segment_routing.py`, which is unmodified except for two assertions
that had to change because the semantics they exercised (trace event order;
"segments=[] with a tie" behavior) were deliberately upgraded by this PR —
see that file's own comments at those two spots.
"""
import pytest
from fastapi.testclient import TestClient

from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.algorithms.ecmp import ECMPAlgorithm
from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.main import app
from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    SegmentRoutingPolicy,
    SimulationFailureEvent,
    TrafficDemandInput,
    TrafficEngineeringPolicy,
)

client = TestClient(app)


def config(policies=None, failure_schedule=None, threshold=1.0):
    return AlgorithmConfig(
        selectedAlgorithm="SEGMENT_ROUTING",
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=threshold,
        segmentRoutingPolicies=policies or [],
        failureSchedule=failure_schedule or [],
    )


def policy(demand_id, segments):
    return SegmentRoutingPolicy(demandId=demand_id, segments=segments)


# ── Fixtures ─────────────────────────────────────────────────────────────────

def single_path_network(amount=3.0):
    """a-b-c, one link each way — no ambiguity anywhere. Test A."""
    return NetworkInput(
        nodes=[
            NodeInput(id="a", label="A", x=0, y=0),
            NodeInput(id="b", label="B", x=1, y=0),
            NodeInput(id="c", label="C", x=2, y=0),
        ],
        links=[
            LinkInput(id="ab", source="a", target="b", capacity=10, weight=1),
            LinkInput(id="bc", source="b", target="c", capacity=10, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="a", target="c", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def three_path_network(amount=9.0, capacity=10.0):
    """A -> D via exactly 3 disjoint equal-cost (cost 2) 2-hop paths. Test C."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="X1", label="X1", x=1, y=-2),
            NodeInput(id="X2", label="X2", x=1, y=0),
            NodeInput(id="X3", label="X3", x=1, y=2),
            NodeInput(id="D", label="D", x=2, y=0),
        ],
        links=[
            LinkInput(id="AX1", source="A", target="X1", capacity=capacity, weight=1),
            LinkInput(id="X1D", source="X1", target="D", capacity=capacity, weight=1),
            LinkInput(id="AX2", source="A", target="X2", capacity=capacity, weight=1),
            LinkInput(id="X2D", source="X2", target="D", capacity=capacity, weight=1),
            LinkInput(id="AX3", source="A", target="X3", capacity=capacity, weight=1),
            LinkInput(id="X3D", source="X3", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def both_sides_tie_network(amount=10.0, capacity=10.0, extra_demands=None):
    """A -> D through waypoint C; BOTH legs (A->C and C->D) have exactly 2
    equal-cost (cost 2) paths each. This is the worked example from the PR0
    spec: A-B-C / A-E-C before the waypoint, C-F-D / C-G-D after it. Tests
    B, D-ish, F, H, J, K, L, M, O, P, Q all build on this one topology."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="E", label="E", x=1, y=1),
            NodeInput(id="C", label="C", x=2, y=0),
            NodeInput(id="F", label="F", x=3, y=-1),
            NodeInput(id="G", label="G", x=3, y=1),
            NodeInput(id="D", label="D", x=4, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=capacity, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=capacity, weight=1),
            LinkInput(id="AE", source="A", target="E", capacity=capacity, weight=1),
            LinkInput(id="EC", source="E", target="C", capacity=capacity, weight=1),
            LinkInput(id="CF", source="C", target="F", capacity=capacity, weight=1),
            LinkInput(id="FD", source="F", target="D", capacity=capacity, weight=1),
            LinkInput(id="CG", source="C", target="G", capacity=capacity, weight=1),
            LinkInput(id="GD", source="G", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)] + (extra_demands or []),
        topologyType="custom", isDirected=False,
    )


def before_waypoint_tie_network(amount=10.0, capacity=10.0):
    """A -> D through waypoint C; only the A->C leg has a tie (2 paths).
    C->D is a single direct link. Test D."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="E", label="E", x=1, y=1),
            NodeInput(id="C", label="C", x=2, y=0),
            NodeInput(id="D", label="D", x=3, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=capacity, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=capacity, weight=1),
            LinkInput(id="AE", source="A", target="E", capacity=capacity, weight=1),
            LinkInput(id="EC", source="E", target="C", capacity=capacity, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def after_waypoint_tie_network(amount=10.0, capacity=10.0):
    """A -> D through waypoint C; only the C->D leg has a tie (2 paths).
    A->C is a single direct link. Test E."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="C", label="C", x=1, y=0),
            NodeInput(id="F", label="F", x=2, y=-1),
            NodeInput(id="G", label="G", x=2, y=1),
            NodeInput(id="D", label="D", x=3, y=0),
        ],
        links=[
            LinkInput(id="AC", source="A", target="C", capacity=capacity, weight=1),
            LinkInput(id="CF", source="C", target="F", capacity=capacity, weight=1),
            LinkInput(id="FD", source="F", target="D", capacity=capacity, weight=1),
            LinkInput(id="CG", source="C", target="G", capacity=capacity, weight=1),
            LinkInput(id="GD", source="G", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def tie_leg_links(left, right, prefix, weight=1, capacity=10.0):
    """Two parallel 2-hop equal-cost links between `left` and `right`,
    named via unique per-leg midpoint ids `{prefix}1`/`{prefix}2`."""
    m1, m2 = f"{prefix}1", f"{prefix}2"
    return (
        [NodeInput(id=m1, label=m1, x=0, y=0), NodeInput(id=m2, label=m2, x=0, y=0)],
        [
            LinkInput(id=f"{left}{m1}", source=left, target=m1, capacity=capacity, weight=weight),
            LinkInput(id=f"{m1}{right}", source=m1, target=right, capacity=capacity, weight=weight),
            LinkInput(id=f"{left}{m2}", source=left, target=m2, capacity=capacity, weight=weight),
            LinkInput(id=f"{m2}{right}", source=m2, target=right, capacity=capacity, weight=weight),
        ],
    )


def two_waypoint_network(amount=8.0, capacity=10.0):
    """A -> D through TWO waypoints (W1, W2); all three legs (A->W1,
    W1->W2, W2->D) independently have a 2-path tie. Test G."""
    nodes = [NodeInput(id=n, label=n, x=i, y=0) for i, n in enumerate(["A", "W1", "W2", "D"])]
    leg1_nodes, leg1_links = tie_leg_links("A", "W1", "p", capacity=capacity)
    leg2_nodes, leg2_links = tie_leg_links("W1", "W2", "q", capacity=capacity)
    leg3_nodes, leg3_links = tie_leg_links("W2", "D", "r", capacity=capacity)
    return NetworkInput(
        nodes=nodes + leg1_nodes + leg2_nodes + leg3_nodes,
        links=leg1_links + leg2_links + leg3_links,
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom", isDirected=False,
    )


# ── A. One leg, one shortest path — unchanged result ─────────────────────────

def test_a_single_path_leg_unchanged():
    network = single_path_network(amount=3.0)
    result = SegmentRoutingAlgorithm.run(network, config())
    paths = result.pathResults[0].paths
    assert len(paths) == 1
    assert paths[0].nodes == ["a", "b", "c"]
    assert paths[0].trafficShare == 3.0
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["ab"] == 3.0 and loads["bc"] == 3.0


# ── B. One leg, 2 equal-cost paths — 50/50 ────────────────────────────────────

def test_b_two_equal_cost_paths_split_evenly():
    network = before_waypoint_tie_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 5.0 and loads["AE"] == 5.0
    assert loads["BC"] == 5.0 and loads["EC"] == 5.0
    assert loads["CD"] == 10.0
    paths = result.pathResults[0].paths
    assert len(paths) == 2
    assert {p.trafficShare for p in paths} == {5.0}
    assert sorted(p.nodes for p in paths) == [["A", "B", "C", "D"], ["A", "E", "C", "D"]]


# ── C. One leg, 3 equal-cost paths — equal thirds ────────────────────────────

def test_c_three_equal_cost_paths_split_evenly():
    network = three_path_network(amount=9.0)
    result = SegmentRoutingAlgorithm.run(network, config())
    paths = result.pathResults[0].paths
    assert len(paths) == 3
    assert {round(p.trafficShare, 6) for p in paths} == {3.0}
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    for prefix in ("X1", "X2", "X3"):
        assert loads[f"A{prefix}"] == 3.0
        assert loads[f"{prefix}D"] == 3.0


# ── D. One waypoint, ECMP before it only ─────────────────────────────────────

def test_d_ecmp_before_waypoint_only():
    network = before_waypoint_tie_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 5.0 and loads["AE"] == 5.0
    assert loads["CD"] == 10.0  # single path after the waypoint, full amount


# ── E. One waypoint, ECMP after it only ──────────────────────────────────────

def test_e_ecmp_after_waypoint_only():
    network = after_waypoint_tie_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AC"] == 10.0  # single path before the waypoint, full amount
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0


# ── F. ECMP both before and after waypoint — conservation ───────────────────

def test_f_ecmp_both_sides_conservation():
    network = both_sides_tie_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    assert loads["AB"] == 5.0 and loads["AE"] == 5.0
    assert loads["BC"] == 5.0 and loads["EC"] == 5.0
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0
    assert loads["FD"] == 5.0 and loads["GD"] == 5.0

    # Conservation: what enters C equals what leaves C equals the full demand.
    assert loads["BC"] + loads["EC"] == 10.0
    assert loads["CF"] + loads["CG"] == 10.0
    assert result.totalDeliveredTraffic == 10.0

    # 4 end-to-end combinations (2 legs x 2 paths), each carrying 2.5 —
    # exactly the PR0 spec's worked example, materialized as PathShares.
    paths = result.pathResults[0].paths
    assert len(paths) == 4
    assert {round(p.trafficShare, 6) for p in paths} == {2.5}
    assert sum(p.trafficShare for p in paths) == 10.0
    expected_combos = [
        ["A", "B", "C", "F", "D"], ["A", "B", "C", "G", "D"],
        ["A", "E", "C", "F", "D"], ["A", "E", "C", "G", "D"],
    ]
    assert sorted(p.nodes for p in paths) == sorted(expected_combos)


# ── G. Two waypoints — each segment independently splits ────────────────────

def test_g_two_waypoints_independent_splits():
    network = two_waypoint_network(amount=8.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["W1", "W2"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    # Each leg's two branch links both carry exactly half the demand (4.0).
    assert loads["Ap1"] == 4.0 and loads["Ap2"] == 4.0
    assert loads["p1W1"] == 4.0 and loads["p2W1"] == 4.0
    assert loads["W1q1"] == 4.0 and loads["W1q2"] == 4.0
    assert loads["q1W2"] == 4.0 and loads["q2W2"] == 4.0
    assert loads["W2r1"] == 4.0 and loads["W2r2"] == 4.0
    assert loads["r1D"] == 4.0 and loads["r2D"] == 4.0

    # 2 x 2 x 2 = 8 end-to-end combinations, each carrying 1.0.
    paths = result.pathResults[0].paths
    assert len(paths) == 8
    assert {round(p.trafficShare, 6) for p in paths} == {1.0}
    assert sum(p.trafficShare for p in paths) == 8.0


# ── H. Multiple demands accumulate loads correctly ───────────────────────────

def test_h_multiple_demands_accumulate_loads():
    network = both_sides_tie_network(
        amount=10.0,
        extra_demands=[TrafficDemandInput(id="d2", source="C", target="D", amount=6.0)],
    )
    # d1 (A->D via waypoint C) and d2 (C->D, no waypoint) both use the CF/CG tie.
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    assert loads["CF"] == 8.0 and loads["CG"] == 8.0  # 5 (d1) + 3 (d2) each
    assert loads["AB"] == 5.0 and loads["AE"] == 5.0  # only d1 uses these
    assert result.totalDeliveredTraffic == 16.0


# ── I. No waypoint — direct SR uses ECMP ─────────────────────────────────────

def test_i_no_waypoint_uses_ecmp():
    network = both_sides_tie_network(amount=8.0)
    result = SegmentRoutingAlgorithm.run(network, config())  # segments=[] (default)
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    # One leg, A->D directly: 4 equal-cost paths (A-B-C-F-D, A-B-C-G-D,
    # A-E-C-F-D, A-E-C-G-D), each cost 4. ECMP splits evenly at every
    # bifurcation: A splits 50/50 into B/E, and C (where all 4 paths
    # reconverge) splits 50/50 into F/G.
    assert loads["AB"] == 4.0 and loads["AE"] == 4.0
    assert loads["CF"] == 4.0 and loads["CG"] == 4.0
    paths = result.pathResults[0].paths
    assert len(paths) == 4
    assert {round(p.trafficShare, 6) for p in paths} == {2.0}


# ── J. TE FORBID_LINK removes one ECMP member ────────────────────────────────

def test_j_forbid_link_removes_ecmp_member():
    network = both_sides_tie_network(amount=10.0)
    policies = [TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", linkId="BC", demandId=None, priority=0)]
    result = SegmentRoutingAlgorithm.run(
        network, config(policies=[policy("d1", ["C"])])
    )
    # Sanity: without the policy, BC does carry load.
    loads_before = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads_before["BC"] == 5.0

    cfg = config(policies=[policy("d1", ["C"])])
    cfg.tePolicies = policies
    result2 = SegmentRoutingAlgorithm.run(network, cfg)
    loads = {lr.linkId: lr.load for lr in result2.linkResults}
    assert loads["BC"] == 0.0
    assert loads["AB"] == 0.0  # B is now a dead end for this demand
    assert loads["AE"] == 10.0 and loads["EC"] == 10.0  # sole survivor carries everything
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0  # second leg unaffected


# ── K. TE AVOID_LINK changes the equal-cost set ──────────────────────────────

def test_k_avoid_link_breaks_tie():
    network = both_sides_tie_network(amount=10.0)
    cfg = config(policies=[policy("d1", ["C"])])
    # Default AVOID penalty (100.0) makes A-B-C's cost 102 vs A-E-C's 2 —
    # the tie is broken, not just re-weighted.
    cfg.tePolicies = [TrafficEngineeringPolicy(policyId="p1", type="AVOID_LINK", linkId="BC", demandId=None, priority=0)]
    result = SegmentRoutingAlgorithm.run(network, cfg)
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["BC"] == 0.0 and loads["AB"] == 0.0
    assert loads["AE"] == 10.0 and loads["EC"] == 10.0
    paths = result.pathResults[0].paths
    assert len(paths) == 2  # only the (still-tied) second leg contributes 2 combinations
    assert all("B" not in p.nodes for p in paths)


# ── L. A DOWN link removes one ECMP member (PR5 compatibility) ──────────────

def test_l_down_link_removes_ecmp_member():
    network = both_sides_tie_network(amount=10.0)
    network.links = [
        l.model_copy(update={"operationalStatus": "DOWN"}) if l.id == "BC" else l
        for l in network.links
    ]
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 0.0 and loads["BC"] == 0.0
    assert loads["AE"] == 10.0 and loads["EC"] == 10.0
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0
    # The DOWN link stays part of the physical topology (PR5 semantics) —
    # still present in linkResults, just unused.
    assert any(lr.linkId == "BC" for lr in result.linkResults)


# ── M. Scheduled mid-simulation failure recomputes SR's ECMP set (PR6) ──────

def test_m_scheduled_failure_recomputes_ecmp_set():
    network = both_sides_tie_network(amount=10.0)
    cfg = config(
        policies=[policy("d1", ["C"])],
        failure_schedule=[SimulationFailureEvent(eventId="f1", linkId="BC", triggerType="TRACE_STEP", triggerValue=1)],
    )
    result = SegmentRoutingAlgorithm.run(network, cfg)
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    # After the scheduled failure, the A->C leg's ECMP set collapses to the
    # sole survivor, exactly like the persistent-DOWN case (test L) — but
    # reached via PR6's mid-simulation recompute path instead.
    assert loads["AB"] == 0.0 and loads["BC"] == 0.0
    assert loads["AE"] == 10.0 and loads["EC"] == 10.0
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0
    assert any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)
    assert any(e.stepType == "ROUTE_INVALIDATED" for e in result.traceEvents)
    assert any(e.stepType == "NEW_ROUTE_SELECTED" for e in result.traceEvents)


# ── N. Deterministic ordering, independent of link insertion order ──────────

def test_n_deterministic_ordering_under_edge_reordering():
    network = both_sides_tie_network(amount=10.0)
    reordered = network.model_copy(update={"links": list(reversed(network.links))})

    result_a = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
    result_b = SegmentRoutingAlgorithm.run(reordered, config(policies=[policy("d1", ["C"])]))

    paths_a = [(p.nodes, p.trafficShare, p.pathId) for p in result_a.pathResults[0].paths]
    paths_b = [(p.nodes, p.trafficShare, p.pathId) for p in result_b.pathResults[0].paths]
    assert paths_a == paths_b


# ── O. Path shares sum to the demand amount ──────────────────────────────────

def test_o_path_shares_sum_to_demand_amount():
    for amount in (10.0, 8.0, 9.0, 3.0):
        network = both_sides_tie_network(amount=amount)
        result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])]))
        total = sum(p.trafficShare for p in result.pathResults[0].paths)
        assert total == pytest.approx(amount)


# ── P. Total demand conserved at every waypoint ──────────────────────────────

def test_p_conservation_at_every_waypoint():
    network = two_waypoint_network(amount=8.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["W1", "W2"])]))
    loads = {lr.linkId: lr.load for lr in result.linkResults}

    # Incoming == outgoing == demand.amount at every waypoint junction.
    assert loads["p1W1"] + loads["p2W1"] == 8.0
    assert loads["W1q1"] + loads["W1q2"] == 8.0
    assert loads["q1W2"] + loads["q2W2"] == 8.0
    assert loads["W2r1"] + loads["W2r2"] == 8.0


# ── Q. Congestion / utilization correct under ECMP-within-segments ─────────

def test_q_congestion_and_utilization_correct():
    network = both_sides_tie_network(amount=10.0, capacity=4.0)
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy("d1", ["C"])], threshold=1.0))
    lr = {r.linkId: r for r in result.linkResults}

    # Each branch link carries 5.0 units over capacity 4.0 -> 125%, congested.
    for link_id in ("AB", "AE", "BC", "EC", "CF", "CG", "FD", "GD"):
        assert lr[link_id].utilization == pytest.approx(1.25)
        assert lr[link_id].isCongested is True
    assert result.congestedLinkCount == 8
    assert result.maxUtilization == pytest.approx(1.25)


# ── R. Existing ECMP behavior unaffected (regression guard) ─────────────────

def test_r_ecmp_unaffected_by_pr0():
    network = both_sides_tie_network(amount=8.0)
    ecmp_cfg = AlgorithmConfig(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    result = ECMPAlgorithm.run(network, ecmp_cfg)
    # ECMP (no waypoint concept) discovers all 4 equal-cost A->D paths itself,
    # via the same underlying `resolve_equal_cost_paths` SR now also uses —
    # byte-identical outcome to what ECMP has always computed.
    paths = result.pathResults[0].paths
    assert len(paths) == 4
    assert {p.trafficShare for p in paths} == {2.0}
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 4.0 and loads["AE"] == 4.0


# ── S. Existing Distance Vector behavior unaffected (regression guard) ──────

def test_s_distance_vector_unaffected_by_pr0():
    network = single_path_network(amount=3.0)
    dv_cfg = AlgorithmConfig(
        selectedAlgorithm="DISTANCE_VECTOR", algorithmType="real_world_heuristic",
        objective="minimize_path_cost", congestionThreshold=1.0,
    )
    result = DistanceVectorAlgorithm.run(network, dv_cfg)
    assert result.pathResults[0].paths[0].nodes == ["a", "b", "c"]
    assert result.pathResults[0].paths[0].trafficShare == 3.0


# ── End-to-end smoke test through the real /simulate endpoint ───────────────

def test_smoke_via_simulate_endpoint_ecmp_within_segments():
    network = both_sides_tie_network(amount=10.0)
    request_body = {
        "network": network.model_dump(),
        "algorithmConfig": {
            "selectedAlgorithm": "SEGMENT_ROUTING",
            "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization",
            "congestionThreshold": 1.0,
            "segmentRoutingPolicies": [{"demandId": "d1", "segments": ["C"]}],
        },
    }
    response = client.post("/simulate", json=request_body)
    assert response.status_code == 200
    body = response.json()
    loads = {lr["linkId"]: lr["load"] for lr in body["linkResults"]}
    assert loads["AB"] == 5.0 and loads["AE"] == 5.0
    assert loads["CF"] == 5.0 and loads["CG"] == 5.0
    assert len(body["pathResults"][0]["paths"]) == 4
