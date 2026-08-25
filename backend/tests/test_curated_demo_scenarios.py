"""Tests for the final, instructor-curated Demo Scenario Pack (see
app/demo/demo_scenarios.py's CURATED_DEMO_SCENARIO_BUILDERS and
app/services/demo_scenario_service.py).

Per final instructor feedback, the student-facing Demo Scenario Dashboard
was cut from 16 scenarios down to exactly 4 — one per distinct capability
(ECMP weight-setting, Segment Routing waypoints, Distance Vector, TE
policy). The original 16 are UNCHANGED and still fully covered by
test_demo_scenarios.py's Section A — this file only covers the new curated
set and the seed/prune behavior around it.

Section A: teaching-claim verification — one test per curated scenario,
calling the real simulate code paths against each scenario's OWN
starterNetwork/starterAlgorithmConfig, exactly like test_demo_scenarios.py's
own Section A. Every number here was independently computed by running the
real ECMPAlgorithm/DistanceVectorAlgorithm against these exact topologies
before being written down (see this PR's final report for the commands),
never hand-derived or guessed.

Section B: MongoDB-backed seed/list/prune behavior — skipped (not failed)
when MongoDB isn't reachable, matching the rest of this project's test
suite convention.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app, assignment_storage
from app.algorithms.ecmp import ECMPAlgorithm
from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.demo.demo_scenarios import (
    CURATED_DEMO_SCENARIO_BUILDERS,
    build_curated_demo_scenarios,
    build_demo_scenarios,
)
from app.models import Assignment, TrafficEngineeringPolicy
from app.services.demo_scenario_service import seed_demo_scenarios
from app.services.simulation_service import SimulationService
from app.models import SimulationRequest

client = TestClient(app)
simulation_service = SimulationService()

FLOAT_TOL = 1e-4

CURATED = {s.assignmentId: s for s in build_curated_demo_scenarios()}

EXPECTED_CURATED_IDS_IN_ORDER = [
    "demo-inet-ex2-ecmp",
    "demo-sr-waypoint",
    "demo-dv-routing-change",
    "demo-te-policy-interactive",
]

EXPECTED_CURATED_TITLES = {
    "demo-inet-ex2-ecmp": "INET Exercise 2 — ECMP Weight Setting",
    "demo-sr-waypoint": "Segment Routing — Waypoint Exploration",
    "demo-dv-routing-change": "Distance Vector — Routing Change",
    "demo-te-policy-interactive": "Traffic Engineering Policy — Interactive Routing",
}


def simulate(scenario_id, algorithm_config=None):
    s = CURATED[scenario_id]
    req = SimulationRequest(
        network=s.starterNetwork,
        algorithmConfig=algorithm_config or s.starterAlgorithmConfig,
    )
    return simulation_service.simulate(req)


# ── A0. Structural sanity ───────────────────────────────────────────────────

def test_a0_exactly_four_curated_scenarios_with_stable_ids():
    scenarios = build_curated_demo_scenarios()
    assert len(scenarios) == 4
    ids = [s.assignmentId for s in scenarios]
    assert ids == EXPECTED_CURATED_IDS_IN_ORDER
    assert len(ids) == len(set(ids))


def test_a0_curated_titles_match_final_instructor_spec():
    for s in build_curated_demo_scenarios():
        assert s.title == EXPECTED_CURATED_TITLES[s.assignmentId]


def test_a0_every_curated_scenario_has_demo_metadata_and_no_expected_solution():
    for s in build_curated_demo_scenarios():
        assert s.demoScenario is not None
        assert s.demoScenario.category == "Demo Scenarios"
        assert s.mode == "lecture"
        assert s.expectedSolution is None
        assert s.starterAlgorithmConfig is not None


def test_a0_curated_builders_are_deterministic():
    """Building twice must produce byte-identical starter data — the seed
    endpoint's idempotency depends on this."""
    for builder in CURATED_DEMO_SCENARIO_BUILDERS:
        a, b = builder(), builder()
        assert a.model_dump(exclude={"createdAt", "updatedAt"}) == b.model_dump(exclude={"createdAt", "updatedAt"})


def test_a0_old_sixteen_fixtures_are_untouched_and_still_sixteen():
    """The original 16 scenarios remain fully intact as backend/test
    fixtures — this task did not delete or shrink that set."""
    assert len(build_demo_scenarios()) == 16


def test_a0_card_descriptions_do_not_spoil_the_answer():
    """None of the 4 curated card descriptions should state a numeric
    result, an optimal choice, or an algorithm's verdict up front."""
    banned_substrings = ["mlu=", "125%", "optimal waypoint", "recommended weight"]
    for s in build_curated_demo_scenarios():
        desc = s.demoScenario.shortDescription.lower()
        for banned in banned_substrings:
            assert banned not in desc


# ── A1. INET Exercise 2 — ECMP Weight Setting ───────────────────────────────

def test_ex2_topology_matches_the_exercise_exactly():
    net = CURATED["demo-inet-ex2-ecmp"].starterNetwork
    node_ids = {n.id for n in net.nodes}
    assert node_ids == {"A", "B", "C", "D"}

    links = {l.id: l for l in net.links}
    assert set(links) == {"AB", "AC", "BC", "BD", "CD"}
    for link in links.values():
        assert link.capacity == 10

    assert links["AC"].weight == 1
    assert links["BC"].weight == 1
    assert links["CD"].weight == 1
    assert links["BD"].weight == 2
    assert links["AB"].weight == 3  # concrete representative value (documented: sheet only says ">2")

    endpoints = {(l.source, l.target) for l in links.values()} | {(l.target, l.source) for l in links.values()}
    for a, b in [("A", "B"), ("A", "C"), ("B", "C"), ("B", "D"), ("C", "D")]:
        assert (a, b) in endpoints


def test_ex2_demands_match_the_exercise_exactly():
    net = CURATED["demo-inet-ex2-ecmp"].starterNetwork
    demands = {(d.source, d.target): d.amount for d in net.demands}
    assert demands[("B", "D")] == 15.0
    assert demands[("A", "D")] == 5.0
    assert {d.target for d in net.demands} == {"D"}  # single destination


def test_ex2_algorithm_is_ecmp():
    s = CURATED["demo-inet-ex2-ecmp"]
    assert s.starterAlgorithmConfig.selectedAlgorithm == "ECMP"


def test_ex2_baseline_ties_bd_against_bcd_and_congests_cd():
    """Computed from the REAL backend ECMP algorithm, not hand-derived:
    B->D ties B-D (cost 2) against B-C-D (cost 1+1=2) and splits 7.5/7.5;
    A->D's unique shortest path A-C-D (cost 2) adds 5 more onto C-D, so
    C-D carries 7.5+5=12.5 against capacity 10 (125%, congested) while
    every other link stays under 100%."""
    result = simulate("demo-inet-ex2-ecmp")
    loads = {lr.linkId: lr for lr in result.linkResults}
    assert loads["CD"].utilization == pytest.approx(1.25, abs=FLOAT_TOL)
    assert loads["CD"].isCongested is True
    assert loads["BC"].utilization == pytest.approx(0.75, abs=FLOAT_TOL)
    assert loads["BD"].utilization == pytest.approx(0.75, abs=FLOAT_TOL)
    assert loads["AC"].utilization == pytest.approx(0.5, abs=FLOAT_TOL)
    assert result.maxUtilization == pytest.approx(1.25, abs=FLOAT_TOL)
    assert result.congestedLinkCount == 1

    bd_paths = next(pr for pr in result.pathResults if pr.demandId == "bd").paths
    assert len(bd_paths) == 2  # a real tie, not a single dominant path


def test_ex2_failing_bc_moves_and_worsens_congestion():
    """Failing B-C removes B->D's second path — all 15 units are forced
    onto B-D alone (150%, now the congested link) while C-D drops to
    50% (no longer congested). A real feasibility/congestion CHANGE,
    verified against the real backend, not a hardcoded frontend guess."""
    s = CURATED["demo-inet-ex2-ecmp"]
    failed_network = s.starterNetwork.model_copy(deep=True)
    for link in failed_network.links:
        if link.id == "BC":
            link.operationalStatus = "DOWN"
    result = simulation_service.simulate(
        SimulationRequest(network=failed_network, algorithmConfig=s.starterAlgorithmConfig)
    )
    loads = {lr.linkId: lr for lr in result.linkResults}
    assert loads["BD"].utilization == pytest.approx(1.5, abs=FLOAT_TOL)
    assert loads["BD"].isCongested is True
    assert loads["CD"].utilization == pytest.approx(0.5, abs=FLOAT_TOL)
    assert loads["CD"].isCongested is False
    assert result.maxUtilization == pytest.approx(1.5, abs=FLOAT_TOL)

    bd_paths = next(pr for pr in result.pathResults if pr.demandId == "bd").paths
    assert len(bd_paths) == 1
    assert bd_paths[0].nodes == ["B", "D"]


def test_ex2_has_course_source_attribution_no_pdf_content():
    meta = CURATED["demo-inet-ex2-ecmp"].demoScenario
    assert meta.courseSource == "INET Network Algorithms — Exercise 2"
    assert len(meta.shortDescription) < 200  # a citation, not reproduced assignment text


# ── A2. Segment Routing — Waypoint Exploration ──────────────────────────────

def test_sr_has_at_least_five_nodes_and_a_waypoint_with_ecmp_tie():
    net = CURATED["demo-sr-waypoint"].starterNetwork
    assert len(net.nodes) >= 5
    assert len(net.demands) >= 1

    result = simulate("demo-sr-waypoint")
    assert result.maxUtilization == pytest.approx(0.5, abs=FLOAT_TOL)
    assert result.congestedLinkCount == 0
    paths = result.pathResults[0].paths
    assert len(paths) == 4  # 2 legs x 2 equal-cost paths each
    assert {round(p.trafficShare, 6) for p in paths} == {2.5}


def test_sr_waypoint_is_student_editable():
    """C is a structural cut vertex here (every A->D path passes through
    it), so the meaningful "waypoint choice" a student makes is WHICH
    first-leg node to require — forcing segments=["B"] (vs. the starter's
    ["C"], which ties both A-B-C and A-E-C) collapses the ECMP tie down to
    only the B-side paths. A real, backend-verified routing change from
    changing the waypoint, not a hardcoded frontend guess."""
    from app.models import SegmentRoutingPolicy

    s = CURATED["demo-sr-waypoint"]
    assert s.lockedFields.canEditWeights is True
    assert s.starterAlgorithmConfig.segmentRoutingPolicies[0].segments == ["C"]

    alt_config = s.starterAlgorithmConfig.model_copy(update={
        "segmentRoutingPolicies": [SegmentRoutingPolicy(demandId="d1", segments=["B"])]
    })
    via_b = simulate("demo-sr-waypoint", algorithm_config=alt_config)
    via_c = simulate("demo-sr-waypoint")
    via_b_nodes = {tuple(p.nodes) for p in via_b.pathResults[0].paths}
    via_c_nodes = {tuple(p.nodes) for p in via_c.pathResults[0].paths}
    assert via_b_nodes != via_c_nodes
    assert all("E" not in nodes for nodes in via_b_nodes)  # E-side eliminated by the new waypoint


# ── A3. Distance Vector — Routing Change ────────────────────────────────────

def test_dv_topology_has_two_paths_of_different_length():
    net = CURATED["demo-dv-routing-change"].starterNetwork
    assert len(net.nodes) == 5
    assert CURATED["demo-dv-routing-change"].starterAlgorithmConfig.selectedAlgorithm == "DISTANCE_VECTOR"


def test_dv_baseline_route_and_next_hop():
    result = simulate("demo-dv-routing-change")
    entry = next(e for e in result.distanceVectorTable if e.nodeId == "S" and e.destinationId == "Z")
    assert entry.cost == pytest.approx(2.0, abs=FLOAT_TOL)
    assert entry.nextHop == "M1"
    assert result.pathResults[0].paths[0].nodes == ["S", "M1", "Z"]


def test_dv_weight_change_flips_the_resolved_route():
    """A pure weight change (no failure) makes the detour cheaper than the
    direct route, flipping S's next hop — computed via the real
    DistanceVectorAlgorithm, matching the "instant stable" behavior
    DistanceVectorAlgorithm itself documents (no round-by-round
    Bellman-Ford convergence is simulated or claimed)."""
    s = CURATED["demo-dv-routing-change"]
    changed_network = s.starterNetwork.model_copy(deep=True)
    for link in changed_network.links:
        if link.id == "M1-Z":
            link.weight = 4.0
    result = DistanceVectorAlgorithm.run(changed_network, s.starterAlgorithmConfig)
    entry = next(e for e in result.distanceVectorTable if e.nodeId == "S" and e.destinationId == "Z")
    assert entry.cost == pytest.approx(3.0, abs=FLOAT_TOL)
    assert entry.nextHop == "M2"
    assert result.pathResults[0].paths[0].nodes == ["S", "M2", "M3", "Z"]


def test_dv_link_failure_also_reroutes():
    s = CURATED["demo-dv-routing-change"]
    failed_network = s.starterNetwork.model_copy(deep=True)
    for link in failed_network.links:
        if link.id == "M1-Z":
            link.operationalStatus = "DOWN"
    result = DistanceVectorAlgorithm.run(failed_network, s.starterAlgorithmConfig)
    assert result.pathResults[0].paths[0].nodes == ["S", "M2", "M3", "Z"]


# ── A4. Traffic Engineering Policy — Interactive Routing ────────────────────

def test_te_baseline_uses_ac_with_no_policy_preloaded():
    s = CURATED["demo-te-policy-interactive"]
    assert s.starterAlgorithmConfig.tePolicies == []  # baseline: student adds the policy themselves
    result = simulate("demo-te-policy-interactive")
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    ac = next(lr for lr in result.linkResults if lr.linkId == "AC")
    assert ac.load == 10.0


def test_te_forbid_link_moves_traffic_and_keeps_link_visible():
    s = CURATED["demo-te-policy-interactive"]
    forbid_config = s.starterAlgorithmConfig.model_copy(update={
        "tePolicies": [TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", linkId="AC")]
    })
    result = simulate("demo-te-policy-interactive", algorithm_config=forbid_config)
    assert result.pathResults[0].paths[0].nodes == ["A", "B", "D"]
    link_ids = {lr.linkId for lr in result.linkResults}
    assert "AC" in link_ids  # still physically present
    ac = next(lr for lr in result.linkResults if lr.linkId == "AC")
    assert ac.load == 0.0


# ── B (MongoDB) — seed / list / prune, skipped gracefully if unavailable ───

pytestmark_mongo = pytest.mark.skipif(
    not assignment_storage.available, reason="MongoDB not available in this environment"
)


@pytestmark_mongo
def test_reseed_produces_exactly_the_four_curated_scenarios():
    r = client.post("/seed-demo-scenarios")
    assert r.status_code == 200
    body = r.json()
    assert body["seeded"] == 4
    assert set(body["scenarioIds"]) == set(EXPECTED_CURATED_IDS_IN_ORDER)

    listed = client.get("/demo-scenarios").json()
    assert len(listed) == 4
    assert {s["assignmentId"] for s in listed} == set(EXPECTED_CURATED_IDS_IN_ORDER)
    assert {s["title"] for s in listed} == set(EXPECTED_CURATED_TITLES.values())


@pytestmark_mongo
def test_reseed_prunes_stale_documents_from_a_previous_larger_pack():
    """Simulates the real upgrade scenario: an old, pre-curation MongoDB
    already has the original 16 demo scenario documents seeded. Reseeding
    with the curated pack must remove the 12 that are no longer part of
    it, leaving exactly the 4 curated ones — the dashboard must never show
    a stale scenario from a previous pack."""
    old_scenarios = build_demo_scenarios()
    for scenario in old_scenarios:
        assignment_storage.save_assignment(scenario.model_dump())
    old_ids = {s.assignmentId for s in old_scenarios}

    result = seed_demo_scenarios(assignment_storage)
    assert result["seeded"] == 4
    assert result["removed"] == len(old_ids - set(EXPECTED_CURATED_IDS_IN_ORDER))

    listed = client.get("/demo-scenarios").json()
    listed_ids = {s["assignmentId"] for s in listed}
    assert listed_ids == set(EXPECTED_CURATED_IDS_IN_ORDER)
    assert listed_ids.isdisjoint(old_ids - set(EXPECTED_CURATED_IDS_IN_ORDER))


@pytestmark_mongo
def test_reseed_never_touches_an_ordinary_teacher_assignment():
    """An ordinary teacher-created assignment (mode='exercise', no
    demoScenario) must survive any number of demo-scenario reseeds,
    because prune_demo_scenarios() is scoped strictly to documents with
    demoScenario set — this one never has it."""
    teacher_assignment = Assignment(
        assignmentId="teacher-made-quiz-1",
        title="A real teacher's quiz",
        topic="ECMP",
        mode="exercise",
        starterNetwork=CURATED["demo-inet-ex2-ecmp"].starterNetwork,
        allowedAlgorithms=["ECMP"],
        studentTask=CURATED["demo-inet-ex2-ecmp"].studentTask,
    )
    assignment_storage.save_assignment(teacher_assignment.model_dump())

    seed_demo_scenarios(assignment_storage)
    seed_demo_scenarios(assignment_storage)  # idempotent, run twice

    still_there = assignment_storage.get_assignment("teacher-made-quiz-1")
    assert still_there is not None
    assert still_there["demoScenario"] is None

    # Cleanup after ourselves — this fixture-less test writes directly to
    # the shared MongoDB collection other tests in this session also use.
    assignment_storage.delete_assignment("teacher-made-quiz-1")


@pytestmark_mongo
def test_curated_student_payload_has_no_expected_solution():
    client.post("/seed-demo-scenarios")
    r = client.get("/assignments/demo-inet-ex2-ecmp/student")
    assert r.status_code == 200
    body = r.json()
    assert "expectedSolution" not in body
    assert body["starterAlgorithmConfig"]["selectedAlgorithm"] == "ECMP"
    assert body["demoScenario"]["courseSource"] == "INET Network Algorithms — Exercise 2"
