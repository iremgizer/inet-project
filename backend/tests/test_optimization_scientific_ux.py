"""Tests for Sprint 2 PR6 — scientific optimization UX, scalability
controls, and safety (backend half): user-configurable exact-search budget,
wall-clock timeouts, the search-space-size preview, and the HTTP-level
safety cap/validation. No optimization algorithm's own semantics are tested
here beyond confirming PR6's additive parameters don't change default
behavior — OPT/WPO/LWO/Joint's own correctness is already covered
exhaustively by test_unrestricted_optimizer.py/test_waypoint_optimization.py/
test_lwo_optimization.py/test_joint_optimization.py.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import AlgorithmConfig, LinkInput, NetworkInput, NodeInput, TrafficDemandInput
from app.optimization.joint_optimizer import estimate_joint_search_space, optimize_joint
from app.optimization.lwo_optimizer import estimate_link_weight_search_space, optimize_link_weights
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import estimate_waypoint_search_space, optimize_waypoints
from app.services.optimization_service import DEFAULT_MAX_EXACT_COMBINATIONS_CAP

client = TestClient(app)
FLOAT_TOL = 1e-5


def _network() -> NetworkInput:
    return NetworkInput(
        nodes=[node(n) for n in ["A", "B", "C", "D"]],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=5, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=5, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=12.0)],
        topologyType="custom",
        isDirected=False,
    )


def node(node_id: str) -> NodeInput:
    return NodeInput(id=node_id, label=node_id, x=0, y=0)


def config() -> AlgorithmConfig:
    return AlgorithmConfig(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )


def algo_config_dict() -> dict:
    return {
        "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
        "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
    }


# ── A. Custom exact-search budget (direct calls) ────────────────────────────

def test_a_custom_budget_wpo():
    net = _network()
    r = optimize_waypoints(net, config(), max_exact_combinations=1)
    assert r.searchMethod == "GREEDY_WPO"
    r2 = optimize_waypoints(net, config(), max_exact_combinations=1_000)
    assert r2.searchMethod == "EXACT_ENUMERATION"


def test_a2_custom_budget_lwo():
    net = _network()
    r = optimize_link_weights(net, config(), max_exact_combinations=1)
    assert r.searchMethod == "HEURISTIC_LWO"
    r2 = optimize_link_weights(net, config(), max_exact_combinations=1_000_000)
    assert r2.searchMethod == "EXACT_ENUMERATION"


def test_a3_custom_budget_joint():
    net = _network()
    r = optimize_joint(net, config(), max_exact_combinations=1)
    assert r.searchMethod == "JOINT_ALTERNATING"
    r2 = optimize_joint(net, config(), max_exact_combinations=10_000)
    assert r2.searchMethod == "EXACT_JOINT_ENUMERATION"


# ── B. Default 50,000 behavior unchanged ─────────────────────────────────────

def test_b_default_budget_is_50000():
    net = _network()
    r_default = optimize_link_weights(net, config())
    r_explicit = optimize_link_weights(net, config(), max_exact_combinations=50_000)
    assert r_default.searchMethod == r_explicit.searchMethod == "EXACT_ENUMERATION"
    assert r_default.mlu == pytest.approx(r_explicit.mlu, abs=FLOAT_TOL)


# ── C. Budget below/above search space (HTTP layer) ─────────────────────────

def test_c_http_budget_below_search_space_uses_heuristic():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "LWO", "maxExactCombinations": 1,
    })
    assert r.status_code == 200
    assert r.json()["searchMethod"] == "HEURISTIC_LWO"


def test_c2_http_budget_above_search_space_uses_exact():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "LWO", "maxExactCombinations": 1_000_000,
    })
    assert r.status_code == 200
    assert r.json()["searchMethod"] == "EXACT_ENUMERATION"


# ── D. Safety cap rejection ──────────────────────────────────────────────────

def test_d_safety_cap_rejects_absurd_budget():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "WPO", "maxExactCombinations": DEFAULT_MAX_EXACT_COMBINATIONS_CAP + 1,
    })
    assert r.status_code == 400
    assert "safety cap" in r.json()["detail"]


def test_d2_safety_cap_boundary_is_accepted():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "WPO", "maxExactCombinations": DEFAULT_MAX_EXACT_COMBINATIONS_CAP,
    })
    assert r.status_code == 200


def test_d3_zero_or_negative_budget_rejected():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "WPO", "maxExactCombinations": 0,
    })
    assert r.status_code == 400


# ── E. Timeout behavior ──────────────────────────────────────────────────────

def test_e_timeout_wpo_reports_time_limit():
    net = _network()
    r = optimize_waypoints(net, config(), time_limit_s=0.0)
    assert r.status == "TIME_LIMIT"
    assert r.provenOptimal is False
    assert r.evaluatedCandidates >= 1
    assert "time limit" in r.message.lower()


def test_e2_timeout_lwo_reports_time_limit():
    net = _network()
    r = optimize_link_weights(net, config(), time_limit_s=0.0)
    assert r.status == "TIME_LIMIT"
    assert r.provenOptimal is False


def test_e3_timeout_joint_reports_time_limit():
    net = _network()
    r = optimize_joint(net, config(), time_limit_s=0.0)
    assert r.status == "TIME_LIMIT"
    assert r.provenOptimal is False
    assert r.convergenceReason is not None


def test_e4_generous_timeout_does_not_trigger():
    net = _network()
    r = optimize_waypoints(net, config(), time_limit_s=30.0)
    assert r.status == "OPTIMAL"


def test_e5_http_timeout_validation():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "WPO", "timeLimitSeconds": 1000,
    })
    assert r.status_code == 400
    r2 = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "WPO", "timeLimitSeconds": 0,
    })
    assert r2.status_code == 400


# ── F. Custom weight range ──────────────────────────────────────────────────

def test_f_custom_weight_range_changes_search_space():
    net = _network()
    r_default = optimize_link_weights(net, config(), min_weight=1, max_weight=5)
    r_wide = optimize_link_weights(net, config(), min_weight=1, max_weight=10)
    assert r_default.searchSpaceSize == 5 ** 4
    assert r_wide.searchSpaceSize == 10 ** 4
    assert r_wide.searchSpaceSize > r_default.searchSpaceSize


def test_f2_invalid_weight_range_rejected_http():
    r = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "LWO", "minWeight": 5, "maxWeight": 1,
    })
    assert r.status_code == 400
    r2 = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(),
        "mode": "LWO", "minWeight": 1, "maxWeight": 5000,
    })
    assert r2.status_code == 400


# ── G. Search-space calculation (preview matches a real run, always) ───────

def test_g_wpo_estimate_matches_real_run():
    net = _network()
    estimate = estimate_waypoint_search_space(net, config())
    real = optimize_waypoints(net, config())
    assert estimate.searchSpaceSize == real.searchSpaceSize


def test_g2_lwo_estimate_matches_real_run():
    net = _network()
    estimate = estimate_link_weight_search_space(net, min_weight=1, max_weight=7)
    real = optimize_link_weights(net, config(), min_weight=1, max_weight=7)
    assert estimate.searchSpaceSize == real.searchSpaceSize


def test_g3_joint_estimate_matches_real_run():
    net = _network()
    estimate = estimate_joint_search_space(net, config(), min_weight=1, max_weight=5)
    real = optimize_joint(net, config(), min_weight=1, max_weight=5)
    assert estimate.searchSpaceSize == real.searchSpaceSize


def test_g4_http_search_space_endpoint_opt_not_applicable():
    r = client.post("/optimize/search-space", json={
        "network": _network().model_dump(), "algorithmConfig": algo_config_dict(), "mode": "OPT",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["searchSpaceSize"] is None
    assert "linear programming" in body["error"].lower()


def test_g5_http_search_space_endpoint_wpo_lwo_joint():
    for mode in ("WPO", "LWO", "JOINT"):
        r = client.post("/optimize/search-space", json={
            "network": _network().model_dump(), "algorithmConfig": algo_config_dict(), "mode": mode,
        })
        assert r.status_code == 200
        assert r.json()["searchSpaceSize"] is not None
        assert r.json()["error"] is None


# ── H. Result metadata completeness ─────────────────────────────────────────

def test_h_wpo_result_metadata_present():
    net = _network()
    r = optimize_waypoints(net, config())
    assert r.searchMethod is not None
    assert r.searchSpaceSize is not None
    assert r.evaluatedCandidates is not None
    assert r.provenOptimal is not None
    assert r.solverRuntime >= 0
    assert r.solverName is not None


def test_h2_lwo_result_metadata_present():
    net = _network()
    r = optimize_link_weights(net, config())
    assert r.searchMethod is not None
    assert r.searchSpaceSize is not None
    assert r.evaluatedCandidates is not None
    assert r.provenOptimal is not None
    assert r.recommendedWeights is not None
    assert r.baselineWeights is not None


def test_h3_joint_result_metadata_present():
    net = _network()
    r = optimize_joint(net, config())
    assert r.searchMethod is not None
    assert r.searchSpaceSize is not None
    assert r.evaluatedCandidates is not None
    assert r.provenOptimal is not None
    assert r.iterations is not None or r.searchMethod == "EXACT_JOINT_ENUMERATION"
    assert r.convergenceReason is not None


def test_h4_opt_result_has_no_search_metadata():
    """OPT is an LP — it must never carry WPO/LWO/Joint-style search
    metadata (PR6 §4/§12: "do not show meaningless fields")."""
    net = _network()
    r = solve_unrestricted_optimum(net)
    assert r.searchMethod is None
    assert r.searchSpaceSize is None
    assert r.evaluatedCandidates is None
    assert r.provenOptimal is None
    assert r.recommendedWeights is None
    assert r.recommendedWaypoints is None


# ── I. No regression for default WPO/LWO/Joint/OPT ──────────────────────────

def test_i_no_regression_defaults():
    net = _network()
    opt = solve_unrestricted_optimum(net)
    wpo = optimize_waypoints(net, config())
    lwo = optimize_link_weights(net, config())
    joint = optimize_joint(net, config())
    assert opt.status == "OPTIMAL"
    assert wpo.status == "OPTIMAL"
    assert lwo.status == "OPTIMAL"
    assert joint.status in ("OPTIMAL", "FEASIBLE")
    assert opt.mlu <= wpo.mlu + FLOAT_TOL
    assert opt.mlu <= lwo.mlu + FLOAT_TOL
    assert opt.mlu <= joint.mlu + FLOAT_TOL
