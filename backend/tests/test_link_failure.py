"""Tests for link failure + automatic rerouting (PR 5).

Link failure is global topology state (not demand-scoped), applied entirely
inside GraphBuilder.build_graph — a DOWN link is simply never added as an
edge to the routing graph. ECMP, Segment Routing, and Distance Vector all
inherit failure-awareness for free; none of their routing logic changes.
This file focuses on that behavior plus its interaction with PR 4's TE
policies and PR 3's custom ECMP distribution. ecmp.py / segment_routing.py /
distance_vector.py / te_policy.py routing logic is otherwise unmodified —
regression coverage for the no-failure case lives in the existing PR1-4 test
files, none of which are touched by this PR.
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
    PathDistribution,
    SegmentRoutingPolicy,
    TrafficDemandInput,
    TrafficDistribution,
    TrafficEngineeringPolicy,
)
from app.utils.graph_builder import GraphBuilder

client = TestClient(app)


def ecmp_config(policies=None, distributions=None, threshold=1.0):
    return AlgorithmConfig(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=threshold,
        tePolicies=policies or [], trafficDistributions=distributions or [],
    )


def sr_config(policies=None, sr_policies=None):
    return AlgorithmConfig(
        selectedAlgorithm="SEGMENT_ROUTING", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
        tePolicies=policies or [], segmentRoutingPolicies=sr_policies or [],
    )


def dv_config():
    return AlgorithmConfig(
        selectedAlgorithm="DISTANCE_VECTOR", algorithmType="real_world_heuristic",
        objective="minimize_path_cost", congestionThreshold=1.0,
    )


def policy(ptype, policy_id="p1", **kwargs):
    return TrafficEngineeringPolicy(policyId=policy_id, type=ptype, **kwargs)


def diamond_network(capacity=10.0, amount=10.0, ab_status="UP"):
    """A-B-D and A-C-D, both cost 2 — path-1 = A-B-D, path-2 = A-C-D."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="C", label="C", x=1, y=1),
            NodeInput(id="D", label="D", x=2, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=capacity, weight=1, operationalStatus=ab_status),
            LinkInput(id="BD", source="B", target="D", capacity=capacity, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=capacity, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=capacity, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def single_path_network(amount=5.0):
    """A-B-C only path — failing either link makes the demand unreachable."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=0),
            NodeInput(id="C", label="C", x=2, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="C", amount=amount)],
        topologyType="custom", isDirected=False,
    )


def sr_waypoint_network(bc_status="UP", ec_status="UP"):
    """A-B-C-D (cheap route to C via B) plus A-E-C (expensive alternate).
    Baseline SR(segments=[C]) resolves A-B-C-D; failing BC forces A-E-C-D;
    failing both BC and EC makes C totally unreachable."""
    return NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="C", label="C", x=2, y=0),
            NodeInput(id="D", label="D", x=3, y=0),
            NodeInput(id="E", label="E", x=1, y=1),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1, operationalStatus="UP"),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1, operationalStatus=bc_status),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
            LinkInput(id="AE", source="A", target="E", capacity=10, weight=1),
            LinkInput(id="EC", source="E", target="C", capacity=10, weight=3, operationalStatus=ec_status),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=5.0)],
        topologyType="custom", isDirected=False,
    )


# ── GraphBuilder unit checks ─────────────────────────────────────────────────

def test_graph_builder_excludes_down_link_but_keeps_it_in_link_map():
    network = diamond_network(ab_status="DOWN")
    graph, link_map = GraphBuilder.build_graph(network)
    assert not graph.has_edge("A", "B")
    assert ("A", "B") in link_map and link_map[("A", "B")].id == "AB"


def test_graph_builder_up_link_present_as_before():
    network = diamond_network(ab_status="UP")
    graph, link_map = GraphBuilder.build_graph(network)
    assert graph.has_edge("A", "B")


def test_down_link_ids_helper():
    network = diamond_network(ab_status="DOWN")
    assert GraphBuilder.down_link_ids(network) == ["AB"]
    assert GraphBuilder.down_link_ids(diamond_network()) == []


# ── ECMP: baseline / fail / reroute / no-route / restore ────────────────────

def test_ecmp_baseline_equal_routes():
    result = ECMPAlgorithm.run(diamond_network(amount=10.0), ecmp_config())
    assert len(result.pathResults[0].paths) == 2


def test_ecmp_fail_one_route_traffic_reroutes():
    network = diamond_network(amount=10.0, ab_status="DOWN")
    result = ECMPAlgorithm.run(network, ecmp_config())

    assert len(result.pathResults[0].paths) == 1
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 0.0 and loads["BD"] == 0.0
    assert loads["AC"] == 10.0 and loads["CD"] == 10.0


def test_ecmp_utilization_recalculates_after_failure():
    network = diamond_network(capacity=5.0, amount=10.0, ab_status="DOWN")
    result = ECMPAlgorithm.run(network, ecmp_config(threshold=1.0))
    lr = {r.linkId: r for r in result.linkResults}
    assert lr["AC"].utilization == pytest.approx(2.0)
    assert lr["AC"].isCongested is True
    assert lr["AB"].utilization == 0.0
    assert lr["AB"].isCongested is False


def test_ecmp_no_route_remains_after_failure():
    network = single_path_network()
    network.links[0].operationalStatus = "DOWN"  # AB down -> A isolated from C
    result = ECMPAlgorithm.run(network, ecmp_config())
    assert result.pathResults[0].paths == []
    assert any("d1" in msg for msg in result.debugInfo)
    assert result.totalDeliveredTraffic == 0.0


def test_ecmp_restore_reverts_to_baseline():
    down = ECMPAlgorithm.run(diamond_network(amount=10.0, ab_status="DOWN"), ecmp_config())
    assert len(down.pathResults[0].paths) == 1

    restored = ECMPAlgorithm.run(diamond_network(amount=10.0, ab_status="UP"), ecmp_config())
    assert len(restored.pathResults[0].paths) == 2
    assert sorted(p.trafficShare for p in restored.pathResults[0].paths) == [5.0, 5.0]


# ── Segment Routing: reroute between waypoints / unreachable waypoint ──────

def test_sr_reroutes_around_failed_edge_on_current_segment_path():
    baseline = SegmentRoutingAlgorithm.run(
        sr_waypoint_network(), sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    )
    assert baseline.pathResults[0].paths[0].nodes == ["A", "B", "C", "D"]

    failed = SegmentRoutingAlgorithm.run(
        sr_waypoint_network(bc_status="DOWN"),
        sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]),
    )
    # Old route A-B-C-D is no longer available; SR finds the alternate A-E-C-D
    # to the *same* waypoint C — the segment list itself never changes.
    assert failed.pathResults[0].paths[0].nodes == ["A", "E", "C", "D"]


def test_sr_waypoint_becomes_unreachable_after_failure():
    network = sr_waypoint_network(bc_status="DOWN", ec_status="DOWN")  # C fully isolated
    result = SegmentRoutingAlgorithm.run(
        network, sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    )
    assert result.pathResults[0].paths == []
    assert any("d1" in msg for msg in result.debugInfo)


# ── TE policy + failure precedence ───────────────────────────────────────────

def test_prefer_link_has_no_effect_while_down():
    network = diamond_network(amount=10.0, ab_status="DOWN")
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("PREFER_LINK", linkId="AB")]))
    # Same as plain failure — a discount on a nonexistent edge does nothing.
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert len(result.pathResults[0].paths) == 1


def test_forbid_link_plus_down_is_safe_no_crash():
    network = diamond_network(amount=10.0, ab_status="DOWN")
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("FORBID_LINK", linkId="AB")]))
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]


def test_avoid_policy_resumes_effect_after_restore():
    avoid = policy("AVOID_LINK", linkId="AB")

    # While AB is down, AVOID has nothing to act on -> same as failure alone.
    down_result = ECMPAlgorithm.run(diamond_network(amount=10.0, ab_status="DOWN"), ecmp_config(policies=[avoid]))
    assert down_result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert not any(e.stepType == "APPLY_TE_POLICY" for e in down_result.traceEvents)

    # Restored: AVOID applies again (default penalty 100 breaks the tie).
    up_result = ECMPAlgorithm.run(diamond_network(amount=10.0, ab_status="UP"), ecmp_config(policies=[avoid]))
    assert up_result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert len(up_result.pathResults[0].paths) == 1
    assert any(e.stepType == "APPLY_TE_POLICY" for e in up_result.traceEvents)


# ── Custom ECMP distribution + failure ───────────────────────────────────────

def test_failure_invalidates_stale_custom_distribution():
    network = diamond_network(amount=10.0, ab_status="DOWN")
    stale_dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    with pytest.raises(ValueError, match="unknown path id"):
        ECMPAlgorithm.run(network, ecmp_config(distributions=[stale_dist]))


# ── Multiple demands ──────────────────────────────────────────────────────

def test_only_affected_demand_reroutes():
    network = diamond_network(capacity=10.0, amount=10.0, ab_status="DOWN")
    network.demands.append(TrafficDemandInput(id="d2", source="C", target="D", amount=3.0))  # doesn't use AB/BD at all
    result = ECMPAlgorithm.run(network, ecmp_config())

    d1 = next(p for p in result.pathResults if p.demandId == "d1")
    d2 = next(p for p in result.pathResults if p.demandId == "d2")
    assert d1.paths[0].nodes == ["A", "C", "D"]  # rerouted off the failed link
    assert d2.paths[0].nodes == ["C", "D"]        # unaffected, always used this link


def test_shared_loads_recalculate_correctly_after_failure():
    network = diamond_network(capacity=10.0, amount=10.0, ab_status="DOWN")
    network.demands.append(TrafficDemandInput(id="d2", source="A", target="D", amount=4.0))
    result = ECMPAlgorithm.run(network, ecmp_config())

    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AC"] == pytest.approx(14.0)  # both demands now share A-C-D
    assert loads["CD"] == pytest.approx(14.0)
    assert loads["AB"] == 0.0 and loads["BD"] == 0.0


# ── Trace ──────────────────────────────────────────────────────────────────

def test_link_failure_trace_event_sequence():
    network = diamond_network(amount=10.0, ab_status="DOWN")
    result = ECMPAlgorithm.run(network, ecmp_config())
    step_types = [e.stepType for e in result.traceEvents if e.stepType]

    assert step_types[0] == "LINK_FAILURE"  # emitted before any per-demand event
    failure_event = result.traceEvents[0]
    assert failure_event.highlightedLinks == ["AB"]
    assert "AB" in failure_event.description


def test_no_link_failure_trace_event_when_all_up():
    result = ECMPAlgorithm.run(diamond_network(amount=10.0), ecmp_config())
    assert not any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)


def test_sr_link_failure_trace_event():
    result = SegmentRoutingAlgorithm.run(
        sr_waypoint_network(bc_status="DOWN"),
        sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]),
    )
    assert result.traceEvents[0].stepType == "LINK_FAILURE"
    assert result.traceEvents[0].highlightedLinks == ["BC"]


# ── Distance Vector ───────────────────────────────────────────────────────

def test_dv_recomputes_around_failure():
    baseline = DistanceVectorAlgorithm.run(diamond_network(amount=10.0), dv_config())
    entry = next(e for e in baseline.distanceVectorTable if e.nodeId == "A" and e.destinationId == "D")
    assert entry.cost == 2.0  # A-B-D or A-C-D, both cost 2

    failed = DistanceVectorAlgorithm.run(diamond_network(amount=10.0, ab_status="DOWN"), dv_config())
    entry2 = next(e for e in failed.distanceVectorTable if e.nodeId == "A" and e.destinationId == "D")
    assert entry2.cost == 2.0  # A-C-D still cost 2 -- but must not route via B
    assert entry2.nextHop == "C"
    assert failed.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert failed.traceEvents[0].stepType == "LINK_FAILURE"


def test_dv_reports_unreachable_after_total_failure():
    network = single_path_network()
    network.links[0].operationalStatus = "DOWN"
    result = DistanceVectorAlgorithm.run(network, dv_config())
    entry = next(e for e in result.distanceVectorTable if e.nodeId == "A" and e.destinationId == "C")
    assert entry.cost == -1.0
    assert entry.nextHop is None


def test_dv_baseline_unchanged_when_no_failures():
    from app.services.topology_service import TopologyService
    network = TopologyService.build_topology("path")
    result = DistanceVectorAlgorithm.run(network, dv_config())
    path = result.pathResults[0].paths[0]
    assert path.nodes == ["n1", "n2", "n3", "n4"]
    assert path.cost == 30.0
    assert not any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)


# ── Regression: all links UP = identical behavior ─────────────────────────

def test_ecmp_regression_all_up_identical_to_pr4():
    from app.services.topology_service import TopologyService
    network = TopologyService.build_topology("triangle")
    result = ECMPAlgorithm.run(network, ecmp_config())
    paths = result.pathResults[0].paths
    assert sorted(p.trafficShare for p in paths) == [0.75, 0.75]
    assert result.totalDeliveredTraffic == 1.5


def test_sr_regression_all_up_identical_to_pr4():
    network = diamond_network(amount=4.0)
    result = SegmentRoutingAlgorithm.run(
        network, sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    )
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert not any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)


# ── End-to-end smoke test ─────────────────────────────────────────────────

def test_smoke_via_simulate_endpoint():
    network_json = {
        "nodes": [n.model_dump() for n in diamond_network(amount=10.0).nodes],
        "links": [
            {**l.model_dump(), "operationalStatus": "DOWN" if l.id == "AB" else "UP"}
            for l in diamond_network(amount=10.0).links
        ],
        "demands": [d.model_dump() for d in diamond_network(amount=10.0).demands],
        "topologyType": "custom", "isDirected": False,
    }
    body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
        },
    }
    response = client.post("/simulate", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["pathResults"][0]["paths"][0]["nodes"] == ["A", "C", "D"]
    # Old JSON without operationalStatus at all should still default to UP.
    network_json_old = {
        "nodes": network_json["nodes"],
        "links": [{k: v for k, v in l.items() if k != "operationalStatus"} for l in network_json["links"]],
        "demands": network_json["demands"],
        "topologyType": "custom", "isDirected": False,
    }
    response2 = client.post("/simulate", json={"network": network_json_old, "algorithmConfig": body["algorithmConfig"]})
    assert response2.status_code == 200
    result2 = response2.json()
    assert len(result2["pathResults"][0]["paths"]) == 2  # both paths available -- AB defaulted to UP
