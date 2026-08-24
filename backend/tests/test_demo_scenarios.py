"""Tests for the Demo Scenario Pack (see app/demo/demo_scenarios.py).

Section A: teaching-claim verification (§10) — one test per scenario,
calling the real simulate/optimize code paths against each scenario's OWN
starterNetwork/starterAlgorithmConfig from build_demo_scenarios(). These are
pure function calls against in-memory data — no MongoDB involved — and
always run, in any environment. Every number asserted here was independently
cross-checked against the verified test fixture each scenario's own
docstring cites (see app/demo/demo_scenarios.py) before being written here.

Section B: MongoDB-backed seed/list/get behavior (§11) — uses the live
AssignmentStorageService the app itself instantiates. Skipped (not failed)
when MongoDB isn't reachable in this environment, exactly matching this
project's existing test_assignments.py convention ("tests exercise the API
routes... in no-MongoDB mode (graceful degradation)"). A live manual
MongoDB smoke check (seed, re-seed idempotency, list, get, student-safe
stripping) was additionally performed against a real MongoDB instance
before release — see this PR's final report for the exact commands/output.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app, assignment_storage
from app.demo.demo_scenarios import DEMO_SCENARIO_BUILDERS, build_demo_scenarios
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import optimize_waypoints
from app.optimization.lwo_optimizer import optimize_link_weights
from app.optimization.joint_optimizer import optimize_joint
from app.services.simulation_service import SimulationService
from app.models import SimulationRequest

client = TestClient(app)
simulation_service = SimulationService()

FLOAT_TOL = 1e-4

SCENARIOS = {s.assignmentId: s for s in build_demo_scenarios()}


def simulate(scenario_id, algorithm_config=None):
    s = SCENARIOS[scenario_id]
    req = SimulationRequest(
        network=s.starterNetwork,
        algorithmConfig=algorithm_config or s.starterAlgorithmConfig,
    )
    return simulation_service.simulate(req)


# ── A0. Structural sanity ───────────────────────────────────────────────────

def test_a0_exactly_sixteen_scenarios_with_unique_ids():
    scenarios = build_demo_scenarios()
    assert len(scenarios) == 16
    ids = [s.assignmentId for s in scenarios]
    assert len(ids) == len(set(ids))


def test_a0_every_scenario_has_demo_metadata_and_no_expected_solution():
    for s in build_demo_scenarios():
        assert s.demoScenario is not None
        assert s.mode == "lecture"
        assert s.expectedSolution is None
        assert s.starterAlgorithmConfig is not None


def test_a0_every_scenario_builder_is_deterministic():
    """Building twice must produce byte-identical starter data — the seed
    endpoint's idempotency depends on this."""
    for builder in DEMO_SCENARIO_BUILDERS:
        a, b = builder(), builder()
        assert a.model_dump(exclude={"createdAt", "updatedAt"}) == b.model_dump(exclude={"createdAt", "updatedAt"})


# ── A. ECMP Basic — clean split, no congestion ──────────────────────────────

def test_a_ecmp_basic_no_congestion():
    result = simulate("demo-ecmp-basic")
    assert result.maxUtilization < 1.0
    assert result.congestedLinkCount == 0
    assert len(result.pathResults[0].paths) == 2  # two equal-cost paths via S1/S2


# ── B. ECMP Congestion — the classic ECMP Triangle ──────────────────────────

def test_b_ecmp_congestion_triangle():
    result = simulate("demo-ecmp-congestion")
    assert result.maxUtilization == pytest.approx(1.25, abs=FLOAT_TOL)
    assert result.congestedLinkCount == 1


# ── C. Custom ECMP Distribution — 20/80 split relieves congestion ──────────

def test_c_custom_distribution_relieves_congestion():
    from app.models import TrafficDistribution, PathDistribution

    baseline = simulate("demo-ecmp-custom-distribution")
    assert baseline.maxUtilization == pytest.approx(1.25, abs=FLOAT_TOL)

    s = SCENARIOS["demo-ecmp-custom-distribution"]
    paths = baseline.pathResults[0].paths
    low_cap_path = next(p for p in paths if "B" in p.nodes)
    high_cap_path = next(p for p in paths if "C" in p.nodes)
    custom_config = s.starterAlgorithmConfig.model_copy(update={
        "trafficDistributions": [
            TrafficDistribution(demandId="d1", mode="CUSTOM", paths=[
                PathDistribution(pathId=low_cap_path.pathId, share=0.2),
                PathDistribution(pathId=high_cap_path.pathId, share=0.8),
            ])
        ]
    })
    custom = simulate("demo-ecmp-custom-distribution", algorithm_config=custom_config)
    assert custom.maxUtilization < baseline.maxUtilization
    assert custom.maxUtilization == pytest.approx(0.666667, abs=1e-3)


# ── D. Segment Routing waypoint + ECMP-within-segments ──────────────────────

def test_d_sr_waypoint_ecmp_both_segments():
    result = simulate("demo-sr-waypoint")
    assert result.maxUtilization == pytest.approx(0.5, abs=FLOAT_TOL)
    assert result.congestedLinkCount == 0
    paths = result.pathResults[0].paths
    assert len(paths) == 4  # 2 legs x 2 paths each, per the PR0 worked example
    assert {round(p.trafficShare, 6) for p in paths} == {2.5}


# ── E. FORBID_LINK — hard exclusion, link stays visible ────────────────────

def test_e_forbid_link_excludes_but_keeps_visible():
    result = simulate("demo-forbid-link")
    ab = next(lr for lr in result.linkResults if lr.linkId == "AB")
    assert ab.load == 0.0
    link_ids = {lr.linkId for lr in result.linkResults}
    assert "AB" in link_ids  # still physically present
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]


# ── F. PREFER_LINK — soft preference retie s a broken tie ──────────────────

def test_f_prefer_link_reties_paths():
    s = SCENARIOS["demo-avoid-prefer-link"]
    baseline_config = s.starterAlgorithmConfig.model_copy(update={"tePolicies": []})
    baseline = simulate("demo-avoid-prefer-link", algorithm_config=baseline_config)
    assert len(baseline.pathResults[0].paths) == 1  # single path at baseline (AB weighted higher)

    with_policy = simulate("demo-avoid-prefer-link")  # starter config already has PREFER_LINK
    assert len(with_policy.pathResults[0].paths) == 2  # retied


# ── G. Link failure — automatic rerouting ───────────────────────────────────

def test_g_link_failure_reroutes():
    s = SCENARIOS["demo-link-failure"]
    baseline = simulate("demo-link-failure")
    assert len(baseline.pathResults[0].paths) == 2  # tie at baseline (both links UP)

    failed_network = s.starterNetwork.model_copy(deep=True)
    for link in failed_network.links:
        if link.id == "AB":
            link.operationalStatus = "DOWN"
    after = simulation_service.simulate(
        SimulationRequest(network=failed_network, algorithmConfig=s.starterAlgorithmConfig)
    )
    assert len(after.pathResults[0].paths) == 1
    assert after.pathResults[0].paths[0].nodes == ["A", "C", "D"]


# ── H. Mid-simulation scheduled failure — route changes live ───────────────

def test_h_mid_sim_failure_route_changes():
    result = simulate("demo-mid-sim-failure")
    link_failure_events = [e for e in result.traceEvents if e.stepType == "LINK_FAILURE"]
    assert len(link_failure_events) == 1
    # Final state: all traffic rerouted onto the surviving path.
    assert len(result.pathResults[0].paths) == 1
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert result.maxUtilization == pytest.approx(1.0, abs=FLOAT_TOL)


# ── I. OPT — structurally unavoidable congestion ────────────────────────────

def test_i_opt_unavoidable_congestion():
    s = SCENARIOS["demo-opt-unavoidable"]
    result = solve_unrestricted_optimum(s.starterNetwork)
    assert result.status == "OPTIMAL"  # a routing exists and is provably best — not INFEASIBLE
    assert result.mlu > 1.0
    assert result.mlu == pytest.approx(1.6, abs=FLOAT_TOL)


# ── J. Current routing vs. OPT — a real optimality gap ──────────────────────

def test_j_ecmp_vs_opt_gap():
    s = SCENARIOS["demo-ecmp-vs-opt"]
    ecmp = simulate("demo-ecmp-vs-opt")
    opt = solve_unrestricted_optimum(s.starterNetwork)
    assert ecmp.maxUtilization > 1.0
    assert opt.mlu < 1.0
    assert ecmp.maxUtilization == pytest.approx(1.6, abs=FLOAT_TOL)
    assert opt.mlu == pytest.approx(0.533333, abs=1e-3)


# ── K. WPO improves routing ──────────────────────────────────────────────────

def test_k_wpo_improves():
    s = SCENARIOS["demo-wpo"]
    result = optimize_waypoints(s.starterNetwork, s.starterAlgorithmConfig)
    assert result.status == "OPTIMAL"
    assert result.optimizedMLU < result.baselineMLU
    assert result.baselineMLU == pytest.approx(1.6, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)
    assert result.recommendedWaypoints[0].waypointNodeId == "B"


# ── L. LWO improves routing ──────────────────────────────────────────────────

def test_l_lwo_improves():
    s = SCENARIOS["demo-lwo"]
    result = optimize_link_weights(s.starterNetwork, s.starterAlgorithmConfig)
    assert result.status == "OPTIMAL"
    assert result.optimizedMLU < result.baselineMLU
    assert result.baselineMLU == pytest.approx(1.6, abs=FLOAT_TOL)
    assert result.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)


# ── M. Joint beats WPO alone ─────────────────────────────────────────────────

def test_m_joint_le_wpo_strict():
    s = SCENARIOS["demo-joint"]
    wpo = optimize_waypoints(s.starterNetwork, s.starterAlgorithmConfig)
    joint = optimize_joint(s.starterNetwork, s.starterAlgorithmConfig)
    assert wpo.optimizedMLU == pytest.approx(3.333333, abs=1e-3)
    assert joint.mlu <= wpo.optimizedMLU + FLOAT_TOL
    assert joint.mlu < wpo.optimizedMLU
    assert joint.mlu == pytest.approx(1.0, abs=FLOAT_TOL)


# ── N. WPO exact vs. heuristic — budget threshold mechanism ────────────────

def test_n_wpo_exact_vs_heuristic_budget_threshold():
    s = SCENARIOS["demo-exact-vs-heuristic-wpo"]
    low = optimize_waypoints(s.starterNetwork, s.starterAlgorithmConfig, max_exact_combinations=1)
    high = optimize_waypoints(s.starterNetwork, s.starterAlgorithmConfig, max_exact_combinations=50000)
    assert low.searchMethod == "GREEDY_WPO"
    assert low.provenOptimal is False
    assert high.searchMethod == "EXACT_ENUMERATION"
    assert high.provenOptimal is True
    # Exact can never be worse than heuristic (it searches a superset).
    assert high.optimizedMLU <= low.optimizedMLU + FLOAT_TOL


# ── O. LWO exact vs. heuristic — genuine local-optimum gap ─────────────────

def test_o_lwo_exact_beats_stuck_heuristic():
    s = SCENARIOS["demo-exact-vs-heuristic-lwo"]
    low = optimize_link_weights(s.starterNetwork, s.starterAlgorithmConfig, max_exact_combinations=1)
    high = optimize_link_weights(s.starterNetwork, s.starterAlgorithmConfig, max_exact_combinations=50000)
    assert low.searchMethod == "HEURISTIC_LWO"
    assert low.provenOptimal is False
    assert low.optimizedMLU == pytest.approx(low.baselineMLU, abs=FLOAT_TOL)  # genuinely stuck
    assert high.searchMethod == "EXACT_ENUMERATION"
    assert high.provenOptimal is True
    assert high.optimizedMLU < low.optimizedMLU
    assert high.optimizedMLU == pytest.approx(0.8, abs=FLOAT_TOL)


# ── P. Joint search budget — combined space exceeds default, safe to raise ──

def test_p_joint_search_budget_crosses_threshold():
    s = SCENARIOS["demo-joint-search-budget"]
    low = optimize_joint(s.starterNetwork, s.starterAlgorithmConfig, max_exact_combinations=50000)
    assert low.searchMethod == "JOINT_ALTERNATING"
    assert low.provenOptimal is False

    high = optimize_joint(
        s.starterNetwork, s.starterAlgorithmConfig,
        max_exact_combinations=350000, time_limit_s=30,
    )
    assert high.searchMethod == "EXACT_JOINT_ENUMERATION"
    assert high.provenOptimal is True
    assert high.status == "OPTIMAL"
    # Well under the backend safety cap (default 2,000,000) and the default
    # 30s timeout — never a "huge/slow" demo, per this scenario's own design.


# ── B (MongoDB) — seed / list / get, skipped gracefully if unavailable ─────

pytestmark_mongo = pytest.mark.skipif(
    not assignment_storage.available, reason="MongoDB not available in this environment"
)


@pytestmark_mongo
def test_seed_endpoint_persists_all_sixteen():
    r = client.post("/seed-demo-scenarios")
    assert r.status_code == 200
    body = r.json()
    assert body["seeded"] == 16
    assert len(body["scenarioIds"]) == 16


@pytestmark_mongo
def test_seed_endpoint_idempotent_no_duplicates():
    r1 = client.post("/seed-demo-scenarios")
    r2 = client.post("/seed-demo-scenarios")
    assert r1.json()["seeded"] == r2.json()["seeded"] == 16
    listed = client.get("/demo-scenarios").json()
    ids = [s["assignmentId"] for s in listed]
    assert len(ids) == len(set(ids)) == 16


@pytestmark_mongo
def test_list_demo_scenarios_grouped_and_sorted():
    client.post("/seed-demo-scenarios")
    r = client.get("/demo-scenarios")
    assert r.status_code == 200
    listed = r.json()
    assert len(listed) == 16
    categories = {s["demoScenario"]["category"] for s in listed}
    assert categories == {
        "Routing Basics", "Traffic Engineering", "Failures",
        "Optimization", "Optimization Complexity",
    }


@pytestmark_mongo
def test_demo_scenario_student_payload_has_no_expected_solution():
    client.post("/seed-demo-scenarios")
    r = client.get("/assignments/demo-wpo/student")
    assert r.status_code == 200
    body = r.json()
    assert "expectedSolution" not in body
    assert body["starterAlgorithmConfig"]["selectedAlgorithm"] == "ECMP"
    assert body["demoScenario"]["optimizationMode"] == "WPO"


@pytestmark_mongo
def test_list_demo_scenarios_summary_omits_heavy_and_secret_fields():
    client.post("/seed-demo-scenarios")
    r = client.get("/demo-scenarios")
    for s in r.json():
        assert "starterNetwork" not in s
        assert "starterAlgorithmConfig" not in s
        assert "expectedSolution" not in s
        assert "lockedFields" not in s
