"""Tests for ECMP's configurable traffic distribution (equal / custom split).

This extends the existing ECMP implementation — it is not a second ECMP and
not a new algorithm. Distance Vector and Segment Routing are untouched by
this PR; regression coverage for them lives in test_simulation.py and
test_segment_routing.py, both left unmodified.
"""
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.algorithms.ecmp import ECMPAlgorithm
from app.main import app
from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    PathDistribution,
    TrafficDemandInput,
    TrafficDistribution,
)

client = TestClient(app)


def config(threshold=1.0, distributions=None):
    return AlgorithmConfig(
        selectedAlgorithm="ECMP",
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=threshold,
        trafficDistributions=distributions or [],
    )


def diamond_network(capacity=10.0, amount=10.0):
    """A-B-D and A-C-D, both cost 2 — sorted order is deterministic:
    path-1 = A-B-D, path-2 = A-C-D ('B' < 'C' lexicographically)."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="C", label="C", x=1, y=1),
            NodeInput(id="D", label="D", x=2, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=capacity, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=capacity, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=capacity, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom",
        isDirected=False,
    )


def diamond_network_reordered_links(capacity=10.0, amount=10.0):
    """Same topology/identity as diamond_network, but with the links array
    listed in a different order — used to prove path-id assignment doesn't
    depend on link/edge insertion order."""
    net = diamond_network(capacity, amount)
    net.links = list(reversed(net.links))
    return net


def three_path_network(amount=10.0):
    """A connects to B, C, D (weight 1 each); B, C, D each connect to E
    (weight 1 each) — three equal-cost (cost 2) A->E paths. Sorted order:
    path-1 = A-B-E, path-2 = A-C-E, path-3 = A-D-E."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-2),
            NodeInput(id="C", label="C", x=1, y=0),
            NodeInput(id="D", label="D", x=1, y=2),
            NodeInput(id="E", label="E", x=2, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BE", source="B", target="E", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CE", source="C", target="E", capacity=10, weight=1),
            LinkInput(id="AD", source="A", target="D", capacity=10, weight=1),
            LinkInput(id="DE", source="D", target="E", capacity=10, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="E", amount=amount)],
        topologyType="custom",
        isDirected=False,
    )


# ── Equal split unchanged (regression) ───────────────────────────────────────

def test_equal_split_unchanged_no_distribution_config():
    network = diamond_network(capacity=10.0, amount=10.0)
    result = ECMPAlgorithm.run(network, config())

    paths = result.pathResults[0].paths
    assert len(paths) == 2
    assert sorted(p.trafficShare for p in paths) == [5.0, 5.0]
    assert result.totalDeliveredTraffic == 10.0
    # Path ids are now populated but nothing else about equal-split behavior changed.
    assert {p.pathId for p in paths} == {"path-1", "path-2"}


def test_equal_split_unchanged_with_explicit_equal_mode():
    network = diamond_network(capacity=10.0, amount=10.0)
    dist = TrafficDistribution(demandId="d1", mode="EQUAL")
    result = ECMPAlgorithm.run(network, config(distributions=[dist]))
    paths = result.pathResults[0].paths
    assert sorted(p.trafficShare for p in paths) == [5.0, 5.0]


def test_ecmp_regression_triangle_and_congestion():
    """Same assertions as the original ECMP tests in test_simulation.py —
    confirms this rewrite is numerically byte-identical for the default path."""
    from app.services.topology_service import TopologyService

    network = TopologyService.build_topology("triangle")
    result = ECMPAlgorithm.run(network, config())
    paths = result.pathResults[0].paths
    assert len(paths) == 2
    assert sorted(path.trafficShare for path in paths) == [0.75, 0.75]
    assert result.totalDeliveredTraffic == 1.5
    assert any("Equal-cost" in event.title for event in result.traceEvents)

    network2 = TopologyService.build_topology("triangle")
    network2.demands = [TrafficDemandInput(id="d-heavy", source="u", target="t", amount=3.0)]
    result2 = ECMPAlgorithm.run(network2, config())
    assert result2.congestedLinkCount == 3
    assert result2.maxUtilization == 1.5
    assert all(link.isCongested for link in result2.linkResults)


# ── Path id stability ─────────────────────────────────────────────────────────

def test_path_ids_stable_regardless_of_link_order():
    r1 = ECMPAlgorithm.run(diamond_network(), config())
    r2 = ECMPAlgorithm.run(diamond_network_reordered_links(), config())

    def route_by_path_id(result):
        return {p.pathId: p.nodes for p in result.pathResults[0].paths}

    assert route_by_path_id(r1) == route_by_path_id(r2)
    assert route_by_path_id(r1)["path-1"] == ["A", "B", "D"]
    assert route_by_path_id(r1)["path-2"] == ["A", "C", "D"]


# ── 70/30 split ────────────────────────────────────────────────────────────────

def test_custom_70_30_split():
    network = diamond_network(capacity=10.0, amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    result = ECMPAlgorithm.run(network, config(distributions=[dist]))

    shares = {p.pathId: p.trafficShare for p in result.pathResults[0].paths}
    assert shares["path-1"] == pytest.approx(7.0)
    assert shares["path-2"] == pytest.approx(3.0)

    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == pytest.approx(7.0)
    assert loads["BD"] == pytest.approx(7.0)
    assert loads["AC"] == pytest.approx(3.0)
    assert loads["CD"] == pytest.approx(3.0)
    assert result.totalDeliveredTraffic == pytest.approx(10.0)


# ── 20/30/50 three-way split ─────────────────────────────────────────────────

def test_custom_three_way_split_20_30_50():
    network = three_path_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[
            PathDistribution(pathId="path-1", share=0.2),
            PathDistribution(pathId="path-2", share=0.3),
            PathDistribution(pathId="path-3", share=0.5),
        ],
    )
    result = ECMPAlgorithm.run(network, config(distributions=[dist]))

    shares = {p.pathId: p.trafficShare for p in result.pathResults[0].paths}
    assert shares["path-1"] == pytest.approx(2.0)
    assert shares["path-2"] == pytest.approx(3.0)
    assert shares["path-3"] == pytest.approx(5.0)
    assert result.totalDeliveredTraffic == pytest.approx(10.0)


# ── Validation: invalid total ─────────────────────────────────────────────────

def test_custom_split_invalid_total_rejected():
    network = diamond_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.5), PathDistribution(pathId="path-2", share=0.4)],
    )
    with pytest.raises(ValueError, match="sum to"):
        ECMPAlgorithm.run(network, config(distributions=[dist]))


def test_custom_split_missing_path_share_rejected():
    network = diamond_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=1.0)],  # path-2 never mentioned
    )
    with pytest.raises(ValueError, match="missing a share"):
        ECMPAlgorithm.run(network, config(distributions=[dist]))


def test_custom_split_unknown_path_id_rejected():
    network = diamond_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[
            PathDistribution(pathId="path-1", share=0.5),
            PathDistribution(pathId="path-2", share=0.3),
            PathDistribution(pathId="path-99", share=0.2),  # doesn't exist
        ],
    )
    with pytest.raises(ValueError, match="unknown path id"):
        ECMPAlgorithm.run(network, config(distributions=[dist]))


# ── Validation: negative share / share > 100% (Pydantic-level) ──────────────

def test_negative_share_rejected_at_model_level():
    with pytest.raises(ValidationError):
        PathDistribution(pathId="path-1", share=-0.1)


def test_share_over_100_percent_rejected_at_model_level():
    with pytest.raises(ValidationError):
        PathDistribution(pathId="path-1", share=1.5)


def test_negative_share_rejected_via_simulate_endpoint():
    network_json = _network_json(diamond_network(amount=10.0))
    body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
            "trafficDistributions": [{
                "demandId": "d1", "mode": "CUSTOM",
                "paths": [{"pathId": "path-1", "share": -0.2}, {"pathId": "path-2", "share": 1.2}],
            }],
        },
    }
    response = client.post("/simulate", json=body)
    assert response.status_code == 422


def test_invalid_total_rejected_via_simulate_endpoint_with_400():
    network_json = _network_json(diamond_network(amount=10.0))
    body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
            "trafficDistributions": [{
                "demandId": "d1", "mode": "CUSTOM",
                "paths": [{"pathId": "path-1", "share": 0.5}, {"pathId": "path-2", "share": 0.4}],
            }],
        },
    }
    response = client.post("/simulate", json=body)
    assert response.status_code == 400
    assert "sum to" in response.json()["detail"]


# ── Multiple demands, independent distributions ──────────────────────────────

def test_multiple_demands_independent_distributions():
    network = diamond_network(capacity=10.0, amount=10.0)
    network.demands.append(TrafficDemandInput(id="d2", source="A", target="D", amount=6.0))
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    # d2 has no distribution entry -> plain equal split.
    result = ECMPAlgorithm.run(network, config(distributions=[dist]))

    d1_shares = {p.pathId: p.trafficShare for p in result.pathResults[0].paths}
    d2_shares = {p.pathId: p.trafficShare for p in result.pathResults[1].paths}
    assert d1_shares == {"path-1": pytest.approx(7.0), "path-2": pytest.approx(3.0)}
    assert d2_shares == {"path-1": pytest.approx(3.0), "path-2": pytest.approx(3.0)}

    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == pytest.approx(10.0)  # 7 (d1) + 3 (d2)
    assert loads["BD"] == pytest.approx(10.0)
    assert loads["AC"] == pytest.approx(6.0)   # 3 (d1) + 3 (d2)
    assert loads["CD"] == pytest.approx(6.0)


# ── Utilization correctness ───────────────────────────────────────────────────

def test_custom_split_utilization_correctness():
    network = diamond_network(capacity=5.0, amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    result = ECMPAlgorithm.run(network, config(threshold=1.0, distributions=[dist]))
    lr = {r.linkId: r for r in result.linkResults}
    assert lr["AB"].utilization == pytest.approx(1.4)  # 7 / 5
    assert lr["AC"].utilization == pytest.approx(0.6)  # 3 / 5
    assert lr["AB"].isCongested is True
    assert lr["AC"].isCongested is False
    assert result.congestedLinkCount == 2  # AB and BD


# ── Trace correctness ─────────────────────────────────────────────────────────

def test_trace_step_types_in_order_custom_mode():
    network = diamond_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    result = ECMPAlgorithm.run(network, config(distributions=[dist]))
    step_types = [e.stepType for e in result.traceEvents if e.stepType]

    expected = ["COMPUTE_CANDIDATE_PATHS", "FOUND_EQUAL_COST_PATHS", "PATH_DISTRIBUTION",
                "ADD_TRAFFIC", "ADD_TRAFFIC", "LINK_UTILIZATION", "LINK_UTILIZATION",
                "LINK_UTILIZATION", "LINK_UTILIZATION", "DETECT_CONGESTION", "FINAL_SUMMARY"]
    assert step_types == expected

    dist_event = next(e for e in result.traceEvents if e.stepType == "PATH_DISTRIBUTION")
    assert dist_event.title == "Apply custom traffic distribution"
    assert dist_event.metadata["mode"] == "CUSTOM"
    assert "70%" in dist_event.description and "30%" in dist_event.description


def test_trace_step_types_equal_mode_title_unchanged():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, config())  # no distribution -> EQUAL
    dist_event = next(e for e in result.traceEvents if e.stepType == "PATH_DISTRIBUTION")
    assert dist_event.title == "Split demand equally"
    assert dist_event.metadata["mode"] == "EQUAL"


# ── End-to-end smoke test ─────────────────────────────────────────────────────

def test_smoke_via_simulate_endpoint_equal_vs_custom():
    network_json = _network_json(diamond_network(amount=10.0))

    equal_body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
        },
    }
    r_equal = client.post("/simulate", json=equal_body)
    assert r_equal.status_code == 200
    equal_loads = {lr["linkId"]: lr["load"] for lr in r_equal.json()["linkResults"]}
    assert equal_loads == {"AB": 5.0, "BD": 5.0, "AC": 5.0, "CD": 5.0}

    custom_body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
            "trafficDistributions": [{
                "demandId": "d1", "mode": "CUSTOM",
                "paths": [{"pathId": "path-1", "share": 0.9}, {"pathId": "path-2", "share": 0.1}],
            }],
        },
    }
    r_custom = client.post("/simulate", json=custom_body)
    assert r_custom.status_code == 200
    custom_loads = {lr["linkId"]: lr["load"] for lr in r_custom.json()["linkResults"]}
    assert custom_loads == {"AB": 9.0, "BD": 9.0, "AC": 1.0, "CD": 1.0}
    # Custom (unbalanced) distribution produces a materially different — here
    # higher — max utilization than equal split on the same topology/demand.
    assert r_custom.json()["maxUtilization"] > r_equal.json()["maxUtilization"]


def _network_json(network: NetworkInput):
    return {
        "nodes": [n.model_dump() for n in network.nodes],
        "links": [l.model_dump() for l in network.links],
        "demands": [d.model_dump() for d in network.demands],
        "topologyType": network.topologyType,
        "isDirected": network.isDirected,
    }
