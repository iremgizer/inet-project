"""Tests for Sprint 2 PR1 — the unrestricted optimal flow (OPT) optimizer.

Covers `solve_unrestricted_optimum` directly (no HTTP layer — PR1 adds no
REST endpoint). Each network is a small, hand-computable topology so the
expected MLU/flow split is verified against a known analytical optimum, not
just "the solver returned something" — see each test's docstring for the
by-hand derivation.

Does not touch ECMP/Segment Routing/Distance Vector or any existing test
file; this optimizer never simulates any of them.
"""
import time

import pytest

from app.models import LinkInput, NetworkInput, NodeInput, TrafficDemandInput
from app.optimization.models import OptimizationResult
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum

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


def total_flow_assignment_share(result: OptimizationResult, demand_id: str) -> float:
    return sum(fa.share for fa in result.flowAssignments if fa.demandId == demand_id)


# ── A. Single commodity — triangle ─────────────────────────────────────────

def test_a_single_commodity_triangle():
    """Triangle A-B-C, one demand A->C=4, direct edge A-C (cap 5) and the
    two-hop A-B-C path (bottleneck cap 3). Arbitrary splitting lets OPT use
    both routes to equalize utilization: with x direct and y=4-x via B,
    x/5 = y/3 solves to x=2.5, y=1.5, both at utilization 0.5 — strictly
    better than sending everything direct (4/5=0.8). This is the point of
    the test: OPT is not "always take the biggest single link", it balances
    across every available path.
    """
    net = network(
        ["A", "B", "C"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=3, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=3, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=5, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="C", amount=4.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(0.5, abs=FLOAT_TOL)
    assert result.linkLoads["AC"] == pytest.approx(2.5, abs=FLOAT_TOL)
    assert result.linkLoads["AB"] == pytest.approx(1.5, abs=FLOAT_TOL)
    assert total_flow_assignment_share(result, "d1") == pytest.approx(1.0, abs=FLOAT_TOL)


# ── B. Multiple commodities sharing links ──────────────────────────────────

def test_b_multiple_commodities_share_capacity():
    """Square A-B-D and A-C-D (cap 10 each leg), two demands both A->D of
    6 units each (12 total) sharing the same two parallel paths. By
    symmetry, OPT's best split sends 6 down each path: utilization 0.6 on
    every link, MLU=0.6 — better than forcing both demands onto one path
    (would be 1.2).
    """
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
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(0.6, abs=FLOAT_TOL)
    for link_id in ("AB", "BD", "AC", "CD"):
        assert result.linkUtilizations[link_id] == pytest.approx(0.6, abs=FLOAT_TOL)
    assert total_flow_assignment_share(result, "d1") == pytest.approx(1.0, abs=FLOAT_TOL)
    assert total_flow_assignment_share(result, "d2") == pytest.approx(1.0, abs=FLOAT_TOL)


# ── C. Flow conservation ────────────────────────────────────────────────────

def test_c_flow_conservation_at_intermediate_node():
    """Line A-B-C-D, single demand A->D. Whatever arrives at B must leave B
    towards C, and whatever arrives at C must leave C towards D — there is
    only one route, so flow conservation forces the full demand through
    every link with zero loss, and the FlowAssignment must be exactly one
    path covering all four nodes with share 1.0.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=7.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    for link_id in ("AB", "BC", "CD"):
        assert result.linkLoads[link_id] == pytest.approx(7.0, abs=FLOAT_TOL)
    assert len(result.flowAssignments) == 1
    assert result.flowAssignments[0].nodes == ["A", "B", "C", "D"]
    assert result.flowAssignments[0].share == pytest.approx(1.0, abs=FLOAT_TOL)


# ── D. Capacity constraints respected ──────────────────────────────────────

def test_d_capacity_constraints_never_exceeded():
    """A demand far exceeding total capacity (single link cap 5, demand 50)
    must still respect the capacity constraint in the LP's own load/util
    accounting: MLU is simply whatever it needs to be (10.0 here — the
    model does not cap demand, it reports how bad utilization must get),
    but the reported *load* uses all of the offered demand (nothing is
    silently dropped) and utilization is exactly load/capacity.
    """
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=5, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=50.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.linkLoads["AB"] == pytest.approx(50.0, abs=FLOAT_TOL)
    assert result.linkUtilizations["AB"] == pytest.approx(10.0, abs=FLOAT_TOL)
    assert result.mlu == pytest.approx(10.0, abs=FLOAT_TOL)


# ── E. Objective correctness (objectiveValue == mlu for OPT) ───────────────

def test_e_objective_value_matches_mlu():
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
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.objectiveValue == pytest.approx(result.mlu, abs=FLOAT_TOL)


# ── F. Known optimum — OPT beats an equal split by proportional splitting ──

def test_f_known_optimum_proportional_split_beats_equal_split():
    """A->D via B (cap 10 both legs) and via C (cap 5 both legs), demand=12.
    A forced 6/6 equal split (what ECMP would do) gives utilizations
    6/10=0.6 and 6/5=1.2 -> MLU 1.2 (congested). OPT is not required to
    split equally: routing 8 via B and 4 via C (proportional to capacity)
    equalizes both legs' utilization at 8/10=4/5=0.8 — provably the best
    possible for two disjoint capacity-limited channels totalling more
    capacity (15) than demand (12): MLU = demand/(C1+C2) = 12/15 = 0.8.
    This is the headline case proving OPT actually optimizes rather than
    reproducing ECMP-style equal splitting.
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
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(0.8, abs=FLOAT_TOL)
    assert result.linkLoads["AB"] == pytest.approx(8.0, abs=FLOAT_TOL)
    assert result.linkLoads["AC"] == pytest.approx(4.0, abs=FLOAT_TOL)
    # Not a 6/6 (equal) split — this is the point of the test.
    assert result.linkLoads["AB"] != pytest.approx(6.0, abs=FLOAT_TOL)


# ── G. Infeasible: fully disconnected graph ────────────────────────────────

def test_g_infeasible_disconnected_graph():
    """No links at all between two nodes with a demand between them — flow
    conservation can never be satisfied at either endpoint. Must be
    INFEASIBLE, never conflated with "a routing exists but is congested".
    """
    net = network(
        ["A", "E"],
        [],
        [TrafficDemandInput(id="d1", source="A", target="E", amount=1.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "INFEASIBLE"
    assert result.message == "No valid routing exists for this configuration."


def test_g2_infeasible_separate_components():
    """A-B and C-D are two separate connected components; a demand from A
    (component 1) to C (component 2) has no possible route between them.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="C", amount=1.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "INFEASIBLE"


# ── H. Multiple (tied) equal-capacity shortest paths ───────────────────────

def test_h_multiple_equal_capacity_paths_split_evenly():
    """Diamond with both legs at equal capacity (10): OPT's optimal split
    for two identical-capacity disjoint channels is the equal 50/50 split —
    the same answer ECMP would give here, but arrived at by the LP finding
    it optimal, not by a hard-coded equal-split rule.
    """
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=12.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(0.6, abs=FLOAT_TOL)
    assert result.linkLoads["AB"] == pytest.approx(6.0, abs=FLOAT_TOL)
    assert result.linkLoads["AC"] == pytest.approx(6.0, abs=FLOAT_TOL)
    assert len(result.flowAssignments) == 2
    shares = sorted(fa.share for fa in result.flowAssignments)
    assert shares == [pytest.approx(0.5, abs=FLOAT_TOL), pytest.approx(0.5, abs=FLOAT_TOL)]


# ── I. Runtime smoke test ──────────────────────────────────────────────────

def test_i_runtime_smoke_test():
    """A modest topology (small mesh) should solve well within a few
    seconds — not a strict performance benchmark, just a guard against a
    gross regression (e.g. an accidental infinite loop in flow
    decomposition, or a solver call that hangs).
    """
    nodes = ["A", "B", "C", "D", "E", "F"]
    links = [
        LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
        LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
        LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        LinkInput(id="DE", source="D", target="E", capacity=10, weight=1),
        LinkInput(id="EF", source="E", target="F", capacity=10, weight=1),
        LinkInput(id="AF", source="A", target="F", capacity=10, weight=1),
        LinkInput(id="BE", source="B", target="E", capacity=10, weight=1),
        LinkInput(id="CF", source="C", target="F", capacity=10, weight=1),
    ]
    demands = [
        TrafficDemandInput(id="d1", source="A", target="D", amount=5.0),
        TrafficDemandInput(id="d2", source="B", target="F", amount=3.0),
        TrafficDemandInput(id="d3", source="A", target="E", amount=4.0),
    ]
    net = network(nodes, links, demands)

    started = time.time()
    result = solve_unrestricted_optimum(net)
    elapsed_s = time.time() - started

    assert result.status == "OPTIMAL"
    assert elapsed_s < 10.0
    assert result.solverRuntime >= 0.0
    assert result.solverRuntime < 10000.0


# ── J. Square topology validation network ──────────────────────────────────

def test_j_square_topology_single_demand():
    net = network(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
            LinkInput(id="DA", source="D", target="A", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="C", amount=8.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    # Two disjoint equal-capacity 2-hop paths (A-B-C and A-D-C) -> 4/4 split.
    assert result.mlu == pytest.approx(0.4, abs=FLOAT_TOL)


# ── K. Known congestion example (OPT itself congested: OPT(I) > 1) ────────

def test_k_known_congestion_example_opt_above_one():
    """Single link, capacity 5, demand 8: no routing whatsoever (not even
    the unrestricted optimum) can avoid congestion — OPT(I) > 1 is the
    strongest possible statement the system can make about this topology
    (Part K: congestion is structurally unavoidable, not an ECMP/SR
    limitation). Status must still be OPTIMAL (a routing exists and is
    provably the best possible), never INFEASIBLE.
    """
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=5, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=8.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(1.6, abs=FLOAT_TOL)


# ── L. Undirected shared-capacity pool (opposing demands) ─────────────────

def test_l_undirected_link_shares_one_capacity_pool_both_directions():
    """One undirected link (capacity 10) with two opposing demands, 6 units
    each direction. Verified empirically against GraphBuilder/ECMPAlgorithm
    directly (see docs/research/sprint2-mip-architecture-analysis.md's PR1
    addendum): both directions' loads sum into ONE shared capacity pool, not
    two independent per-direction constraints — so combined load is 12 and
    utilization 1.2, not 0.6 each.
    """
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [
            TrafficDemandInput(id="d1", source="A", target="B", amount=6.0),
            TrafficDemandInput(id="d2", source="B", target="A", amount=6.0),
        ],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.linkLoads["AB"] == pytest.approx(12.0, abs=FLOAT_TOL)
    assert result.mlu == pytest.approx(1.2, abs=FLOAT_TOL)


# ── M. Directed network only allows the declared direction ────────────────

def test_m_directed_link_blocks_reverse_traversal():
    """A directed A->B link carries no traffic for a B->A demand — no
    reverse arc exists, so this must be INFEASIBLE, distinguishing directed
    networks correctly from undirected ones (test L above).
    """
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [TrafficDemandInput(id="d1", source="B", target="A", amount=5.0)],
        is_directed=True,
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "INFEASIBLE"


# ── N. Malformed request: demand references unknown node ──────────────────

def test_n_demand_references_unknown_node_is_error_not_infeasible():
    """Distinct from INFEASIBLE (Part K): an unknown node id is a malformed
    request, not a topology fact about a well-formed network.
    """
    net = network(
        ["A"],
        [],
        [TrafficDemandInput(id="d1", source="A", target="ZZZ", amount=1.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "ERROR"
    assert "d1" in result.message


# ── O. No demands at all ───────────────────────────────────────────────────

def test_o_no_demands_returns_zero_mlu_without_solver_call():
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == 0.0
    assert result.objectiveValue == 0.0
    assert result.flowAssignments == []


# ── P. Self-loop demand (source == target) is excluded, not an error ──────

def test_p_self_loop_demand_excluded_not_erroring():
    net = network(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=10, weight=1)],
        [
            TrafficDemandInput(id="d1", source="A", target="A", amount=5.0),
            TrafficDemandInput(id="d2", source="A", target="B", amount=3.0),
        ],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert result.mlu == pytest.approx(0.3, abs=FLOAT_TOL)
    assert any("d1" in msg for msg in result.debugInfo)
    assert all(fa.demandId != "d1" for fa in result.flowAssignments)


# ── Q. DOWN link is excluded exactly like every other algorithm ───────────

def test_q_down_link_excluded_from_optimization():
    """A DOWN link must be excluded from the LP's topology exactly as
    GraphBuilder already excludes it for ECMP/SR/DV — forcing all traffic
    onto the remaining path.
    """
    net = network(
        ["A", "B", "C"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1, operationalStatus="DOWN"),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CB", source="C", target="B", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=5.0)],
    )
    result = solve_unrestricted_optimum(net)
    assert result.status == "OPTIMAL"
    assert "AB" not in result.linkLoads
    assert result.linkLoads["AC"] == pytest.approx(5.0, abs=FLOAT_TOL)
    assert result.linkLoads["CB"] == pytest.approx(5.0, abs=FLOAT_TOL)
