"""Tests for Segment Routing V1 (waypoint-based routing).

Covers the engine (`SegmentRoutingAlgorithm.run`) directly plus one
end-to-end smoke test through the real `/simulate` endpoint. ECMP and
Distance Vector are exercised unmodified in `test_simulation.py` — this file
does not touch that file or its fixtures.
"""
import pytest
from fastapi.testclient import TestClient

from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.main import app
from app.models import (
    AlgorithmConfig,
    LinkInput,
    NetworkInput,
    NodeInput,
    SegmentRoutingPolicy,
    TrafficDemandInput,
)
from app.services.simulation_service import SimulationService

client = TestClient(app)


def config(threshold=1.0, policies=None):
    return AlgorithmConfig(
        selectedAlgorithm="SEGMENT_ROUTING",
        algorithmType="real_world_heuristic",
        objective="minimize_max_utilization",
        congestionThreshold=threshold,
        segmentRoutingPolicies=policies or [],
    )


def line_network():
    """a-b-c, weight 1 each — unique shortest path, no ambiguity."""
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
        demands=[TrafficDemandInput(id="d1", source="a", target="c", amount=3.0)],
        topologyType="custom",
        isDirected=False,
    )


def diamond_network(capacity=10.0, amount=4.0):
    """A-B-D and A-C-D, both cost 2 (tie) — the waypoint decides which path is used."""
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


def ordered_waypoint_network():
    """A-B-C-D chain plus an A-C shortcut, so the unconstrained shortest path
    (A-C-D, cost 2) differs from the [B, C]-waypoint-forced route (A-B-C-D,
    cost 3) — proves waypoint order actually changes routing, not just labels
    a path that would have been taken anyway."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=0),
            NodeInput(id="C", label="C", x=2, y=0),
            NodeInput(id="D", label="D", x=3, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),  # shortcut
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=2.0)],
        topologyType="custom",
        isDirected=False,
    )


# ── A. No waypoint ──────────────────────────────────────────────────────────

def test_no_waypoint_matches_shortest_path():
    network = line_network()
    result = SegmentRoutingAlgorithm.run(network, config())

    assert result.pathResults[0].paths[0].nodes == ["a", "b", "c"]
    assert result.pathResults[0].paths[0].cost == 2.0
    assert result.totalDeliveredTraffic == 3.0


# ── B. One waypoint ──────────────────────────────────────────────────────────

def test_one_waypoint_forces_route_through_it():
    network = diamond_network(capacity=10.0, amount=4.0)
    policy = SegmentRoutingPolicy(demandId="d1", segments=["C"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]

    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AC"] == 4.0
    assert loads["CD"] == 4.0
    assert loads["AB"] == 0.0
    assert loads["BD"] == 0.0


# ── C. Multiple waypoints — order respected ──────────────────────────────────

def test_multiple_waypoints_respect_order():
    network = ordered_waypoint_network()
    policy = SegmentRoutingPolicy(demandId="d1", segments=["B", "C"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    path = result.pathResults[0].paths[0]
    assert path.nodes == ["A", "B", "C", "D"]
    assert path.cost == 3.0  # forced off the A-C shortcut (cost-2 unconstrained path)


# ── D. Multiple demands, independent policies, accumulated loads ────────────

def test_multiple_demands_independent_policies_accumulate_loads():
    network = diamond_network(capacity=10.0, amount=4.0)
    network.demands.append(TrafficDemandInput(id="d2", source="B", target="D", amount=3.0))
    policies = [SegmentRoutingPolicy(demandId="d1", segments=["C"])]  # d2 has no policy -> plain shortest path
    result = SegmentRoutingAlgorithm.run(network, config(policies=policies))

    d1_paths = next(p for p in result.pathResults if p.demandId == "d1").paths
    d2_paths = next(p for p in result.pathResults if p.demandId == "d2").paths
    assert d1_paths[0].nodes == ["A", "C", "D"]
    assert d2_paths[0].nodes == ["B", "D"]

    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AC"] == 4.0
    assert loads["CD"] == 4.0
    assert loads["BD"] == 3.0
    assert loads["AB"] == 0.0
    assert result.totalDeliveredTraffic == 7.0


# ── E. Nonexistent waypoint ───────────────────────────────────────────────────

def test_nonexistent_waypoint_fails_gracefully():
    network = diamond_network()
    policy = SegmentRoutingPolicy(demandId="d1", segments=["Z"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    assert result.pathResults[0].paths == []
    assert any("Z" in msg and "d1" in msg for msg in result.debugInfo)
    assert result.totalDeliveredTraffic == 0.0


# ── F. Unreachable waypoint — no crash ───────────────────────────────────────

def test_unreachable_waypoint_no_crash():
    network = diamond_network()
    network.nodes.append(NodeInput(id="X", label="X", x=5, y=5))  # isolated node
    policy = SegmentRoutingPolicy(demandId="d1", segments=["X"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    assert result.pathResults[0].paths == []
    assert any("d1" in msg for msg in result.debugInfo)
    assert result.totalDeliveredTraffic == 0.0


# ── G. Utilization ────────────────────────────────────────────────────────────

def test_utilization_calculation():
    network = diamond_network(capacity=5.0, amount=4.0)
    policy = SegmentRoutingPolicy(demandId="d1", segments=["C"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    lr = {r.linkId: r for r in result.linkResults}
    assert lr["AC"].utilization == pytest.approx(0.8)
    assert lr["CD"].utilization == pytest.approx(0.8)
    assert lr["AB"].utilization == 0.0


# ── H. Congestion ──────────────────────────────────────────────────────────

def test_congestion_detection():
    network = diamond_network(capacity=2.0, amount=4.0)
    policy = SegmentRoutingPolicy(demandId="d1", segments=["C"])
    result = SegmentRoutingAlgorithm.run(network, config(threshold=1.0, policies=[policy]))

    lr = {r.linkId: r for r in result.linkResults}
    assert lr["AC"].isCongested is True
    assert lr["CD"].isCongested is True
    assert lr["AB"].isCongested is False
    assert result.congestedLinkCount == 2
    assert result.maxUtilization == pytest.approx(2.0)


# ── I. Trace events — non-empty, correct logical order ───────────────────────

def test_trace_events_present_and_ordered():
    network = diamond_network(capacity=10.0, amount=4.0)
    policy = SegmentRoutingPolicy(demandId="d1", segments=["C"])
    result = SegmentRoutingAlgorithm.run(network, config(policies=[policy]))

    assert result.traceEvents
    step_types = [e.stepType for e in result.traceEvents]

    expected_order = [
        "START_DEMAND",
        "LOAD_SEGMENT_LIST",
        "SELECT_ACTIVE_SEGMENT",
        "COMPUTE_SEGMENT_PATH",
        "FINAL_ROUTE_RESOLVED",
        "ADD_TRAFFIC_TO_LINK",
        "COMPLETE_DEMAND",
        "COMPUTE_LINK_UTILIZATION",
        "DETECT_CONGESTION",
        "FINAL_SUMMARY",
    ]
    indices = [step_types.index(t) for t in expected_order]
    assert indices == sorted(indices), f"trace events out of logical order: {step_types}"

    # Segment-list metadata is actually populated, not just present as a key.
    load_event = next(e for e in result.traceEvents if e.stepType == "LOAD_SEGMENT_LIST")
    assert load_event.segmentList == ["C", "D"]
    select_event = next(e for e in result.traceEvents if e.stepType == "SELECT_ACTIVE_SEGMENT")
    assert select_event.activeSegmentIndex == 0


def test_empty_segments_still_produce_full_trace():
    """No waypoints is a legal, fully-traced run — not a degraded path."""
    network = line_network()
    result = SegmentRoutingAlgorithm.run(network, config())
    step_types = {e.stepType for e in result.traceEvents}
    assert "COMPUTE_SEGMENT_PATH" in step_types
    assert "ADVANCE_TO_NEXT_SEGMENT" not in step_types  # only one leg — nothing to advance past


# ── J / K. Existing ECMP / Distance Vector regression guard ─────────────────
# (Full coverage lives in test_simulation.py; this just double-checks the new
# SegmentRoutingPolicy field doesn't leak into or break unrelated algorithms.)

def test_ecmp_and_dv_ignore_segment_routing_field_by_default():
    from app.algorithms.distance_vector import DistanceVectorAlgorithm
    from app.algorithms.ecmp import ECMPAlgorithm

    network = line_network()
    ecmp_cfg = AlgorithmConfig(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    dv_cfg = AlgorithmConfig(
        selectedAlgorithm="DISTANCE_VECTOR", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    assert ecmp_cfg.segmentRoutingPolicies == []
    assert dv_cfg.segmentRoutingPolicies == []

    ecmp_result = ECMPAlgorithm.run(network, ecmp_cfg)
    dv_result = DistanceVectorAlgorithm.run(network, dv_cfg)
    assert ecmp_result.pathResults[0].paths[0].nodes == ["a", "b", "c"]
    assert dv_result.pathResults[0].paths[0].nodes == ["a", "b", "c"]


# ── End-to-end smoke test through the real /simulate endpoint ───────────────

def test_smoke_via_simulate_endpoint():
    network = {
        "nodes": [
            {"id": "A", "label": "A", "x": 0, "y": 0},
            {"id": "B", "label": "B", "x": 1, "y": -1},
            {"id": "C", "label": "C", "x": 1, "y": 1},
            {"id": "D", "label": "D", "x": 2, "y": 0},
        ],
        "links": [
            {"id": "AB", "source": "A", "target": "B", "capacity": 10, "weight": 1},
            {"id": "BD", "source": "B", "target": "D", "capacity": 10, "weight": 1},
            {"id": "AC", "source": "A", "target": "C", "capacity": 10, "weight": 1},
            {"id": "CD", "source": "C", "target": "D", "capacity": 10, "weight": 1},
        ],
        "demands": [{"id": "d1", "source": "A", "target": "D", "amount": 4}],
        "topologyType": "custom",
        "isDirected": False,
    }
    request_body = {
        "network": network,
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
    assert body["algorithm"] == "SEGMENT_ROUTING"
    assert body["pathResults"][0]["paths"][0]["nodes"] == ["A", "C", "D"]
    loads = {lr["linkId"]: lr["load"] for lr in body["linkResults"]}
    assert loads["AC"] == 4.0
    assert loads["CD"] == 4.0
    assert loads["AB"] == 0.0
    assert loads["BD"] == 0.0

    # Now the same endpoint with segments=[] — plain shortest-path fallback.
    request_body["algorithmConfig"]["segmentRoutingPolicies"] = []
    response2 = client.post("/simulate", json=request_body)
    assert response2.status_code == 200
    body2 = response2.json()
    loads2 = {lr["linkId"]: lr["load"] for lr in body2["linkResults"]}
    # One of the two equal-cost paths was taken; exactly one pair carries the load.
    assert (loads2["AB"] == 4.0 and loads2["BD"] == 4.0 and loads2["AC"] == 0.0 and loads2["CD"] == 0.0) or \
           (loads2["AC"] == 4.0 and loads2["CD"] == 4.0 and loads2["AB"] == 0.0 and loads2["BD"] == 0.0)


def test_service_dispatch_still_routes_to_segment_routing():
    """SimulationService's existing dispatch branch (unmodified) reaches the
    new engine correctly."""
    service = SimulationService()
    network = diamond_network(capacity=10.0, amount=4.0)
    from app.models import SimulationRequest
    req = SimulationRequest(
        network=network,
        algorithmConfig=config(policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]),
    )
    result = service.simulate(req)
    assert result.algorithm == "SEGMENT_ROUTING"
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
