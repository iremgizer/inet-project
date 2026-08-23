"""Tests for Sprint 2 PR5's `POST /optimize` route — the one HTTP-facing
entry point onto PR1-4's optimizers. This route is a thin dispatcher (see
`app/services/optimization_service.py`); these tests exist to confirm the
wiring (mode dispatch, request/response shape, error handling) is correct,
not to re-test the optimizers themselves — their own behavior is already
covered exhaustively in test_unrestricted_optimizer.py/
test_waypoint_optimization.py/test_lwo_optimization.py/
test_joint_optimization.py.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.optimization.lwo_optimizer import optimize_link_weights
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.models import AlgorithmConfig, LinkInput, NetworkInput, NodeInput, TrafficDemandInput

client = TestClient(app)

FLOAT_TOL = 1e-5


def _network() -> NetworkInput:
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=0),
            NodeInput(id="D", label="D", x=2, y=0),
        ],
        links=[
            LinkInput(id="AD", source="A", target="D", capacity=5, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=8.0)],
        topologyType="custom",
        isDirected=False,
    )


def _algorithm_config() -> dict:
    return {
        "selectedAlgorithm": "ECMP",
        "algorithmType": "real_world_heuristic",
        "objective": "minimize_max_utilization",
        "congestionThreshold": 1.0,
    }


def _request(mode: str, **overrides) -> dict:
    body = {
        "network": _network().model_dump(),
        "algorithmConfig": _algorithm_config(),
        "mode": mode,
    }
    body.update(overrides)
    return body


# ── A. OPT via HTTP matches calling the function directly ─────────────────

def test_a_opt_via_http_matches_direct_call():
    response = client.post("/optimize", json=_request("OPT"))
    assert response.status_code == 200
    body = response.json()
    direct = solve_unrestricted_optimum(_network())
    assert body["status"] == direct.status
    assert body["mlu"] == pytest.approx(direct.mlu, abs=FLOAT_TOL)
    assert body["mode"] == "OPT"


# ── B. WPO via HTTP ─────────────────────────────────────────────────────────

def test_b_wpo_via_http():
    response = client.post("/optimize", json=_request("WPO"))
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "WAYPOINT_OPTIMIZATION"
    assert body["status"] == "OPTIMAL"
    assert body["recommendedWaypoints"] is not None
    assert body["mlu"] == pytest.approx(0.8, abs=FLOAT_TOL)


# ── C. LWO via HTTP matches calling the function directly ─────────────────

def test_c_lwo_via_http_matches_direct_call():
    response = client.post("/optimize", json=_request("LWO"))
    assert response.status_code == 200
    body = response.json()
    direct = optimize_link_weights(_network(), AlgorithmConfig(**_algorithm_config()))
    assert body["mode"] == "LINK_WEIGHT_OPTIMIZATION"
    assert body["mlu"] == pytest.approx(direct.mlu, abs=FLOAT_TOL)
    assert body["recommendedWeights"] == pytest.approx(direct.recommendedWeights, abs=FLOAT_TOL)


# ── D. Joint via HTTP ───────────────────────────────────────────────────────

def test_d_joint_via_http():
    response = client.post("/optimize", json=_request("JOINT"))
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "JOINT_OPTIMIZATION"
    assert body["recommendedWeights"] is not None
    assert body["recommendedWaypoints"] is not None
    assert body["searchMethod"] in ("EXACT_JOINT_ENUMERATION", "JOINT_ALTERNATING")


# ── E. Per-mode tuning parameters are actually forwarded ──────────────────

def test_e_tuning_parameters_forwarded():
    # A tiny max_exact_combinations must force LWO's heuristic path, exactly
    # as it does when calling optimize_link_weights directly.
    response = client.post("/optimize", json=_request("LWO", maxExactCombinations=1))
    assert response.status_code == 200
    body = response.json()
    assert body["searchMethod"] == "HEURISTIC_LWO"
    assert body["provenOptimal"] is False

    response2 = client.post("/optimize", json=_request("JOINT", maxIterations=1, maxExactCombinations=1))
    assert response2.status_code == 200
    body2 = response2.json()
    assert body2["iterations"] == 1


# ── F. Invalid mode is rejected with 422 (Pydantic Literal validation) ────

def test_f_invalid_mode_rejected():
    response = client.post("/optimize", json=_request("NOT_A_MODE"))
    assert response.status_code == 422


# ── G. Malformed network (unknown node in a demand) surfaces as a clean error ─

def test_g_malformed_network_surfaces_as_error_not_crash():
    net = _network().model_dump()
    net["demands"] = [{"id": "d1", "source": "A", "target": "ZZZ", "amount": 1.0}]
    response = client.post("/optimize", json={
        "network": net, "algorithmConfig": _algorithm_config(), "mode": "OPT",
    })
    # OPT's own contract (PR1) returns a 200 with status="ERROR" for this
    # case, not an HTTP error — the route must not swallow or reshape that.
    assert response.status_code == 200
    assert response.json()["status"] == "ERROR"


# ── H. Missing required fields rejected with 422 ───────────────────────────

def test_h_missing_mode_rejected():
    response = client.post("/optimize", json={
        "network": _network().model_dump(), "algorithmConfig": _algorithm_config(),
    })
    assert response.status_code == 422


# ── I. Regression: /simulate and /health unaffected ────────────────────────

def test_i_existing_endpoints_unaffected():
    health = client.get("/health")
    assert health.status_code == 200

    sim_response = client.post("/simulate", json={
        "network": _network().model_dump(), "algorithmConfig": _algorithm_config(),
    })
    assert sim_response.status_code == 200
    assert sim_response.json()["algorithm"] == "ECMP"
