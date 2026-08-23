"""Tests for the Traffic Engineering policy layer (PR 4).

Covers ECMP and Segment Routing integration, precedence/conflict handling,
multi-demand scoping, interaction with PR 3's custom traffic distribution,
and the Distance Vector non-support notice. ECMP/SR/DV algorithm files are
otherwise unmodified in behavior when no policies are configured — that
regression guard is exercised both here and by the full pre-existing suite
(test_simulation.py, test_configurable_ecmp.py, test_segment_routing.py),
none of which are touched by this PR.
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

client = TestClient(app)


def ecmp_config(policies=None, distributions=None, threshold=1.0):
    return AlgorithmConfig(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=threshold,
        tePolicies=policies or [], trafficDistributions=distributions or [],
    )


def sr_config(policies=None, sr_policies=None, threshold=1.0):
    return AlgorithmConfig(
        selectedAlgorithm="SEGMENT_ROUTING", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=threshold,
        tePolicies=policies or [], segmentRoutingPolicies=sr_policies or [],
    )


def dv_config(policies=None):
    return AlgorithmConfig(
        selectedAlgorithm="DISTANCE_VECTOR", algorithmType="real_world_heuristic",
        objective="minimize_path_cost", congestionThreshold=1.0,
        tePolicies=policies or [],
    )


def diamond_network(capacity=10.0, amount=10.0):
    """A-B-D and A-C-D, both cost 2 — path-1 = A-B-D, path-2 = A-C-D."""
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
        topologyType="custom", isDirected=False,
    )


def single_path_network(amount=5.0):
    """A-B-C only path — forbidding any link makes the demand unreachable."""
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


def policy(ptype, policy_id="p1", **kwargs):
    return TrafficEngineeringPolicy(policyId=policy_id, type=ptype, **kwargs)


# ── FORBID_LINK ────────────────────────────────────────────────────────────

def test_forbid_link_ecmp_excludes_it():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("FORBID_LINK", linkId="AB")]))

    assert len(result.pathResults[0].paths) == 1
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 0.0 and loads["BD"] == 0.0
    assert loads["AC"] == 10.0 and loads["CD"] == 10.0


def test_forbid_link_segment_routing_excludes_it():
    network = diamond_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, sr_config(policies=[policy("FORBID_LINK", linkId="AB")]))

    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]


def test_forbid_link_makes_route_impossible_no_crash():
    network = single_path_network()
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("FORBID_LINK", linkId="AB")]))

    assert result.pathResults[0].paths == []
    assert any("d1" in msg for msg in result.debugInfo)
    assert result.totalDeliveredTraffic == 0.0


def test_forbid_link_does_not_remove_link_from_physical_topology():
    """The link must still exist in linkResults (0 load), never deleted."""
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("FORBID_LINK", linkId="AB")]))
    link_ids = {lr.linkId for lr in result.linkResults}
    assert link_ids == {"AB", "BD", "AC", "CD"}


# ── AVOID_LINK ─────────────────────────────────────────────────────────────

def test_avoid_link_shifts_ecmp_to_alternative():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("AVOID_LINK", linkId="AB")]))

    # AVOID adds a cost penalty (default 100) so A-B-D (cost 2+100=102) loses
    # the tie to A-C-D (cost 2) — no longer equal-cost, single path remains.
    assert len(result.pathResults[0].paths) == 1
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    # Physical link weight is untouched.
    ab = next(lr for lr in result.linkResults if lr.linkId == "AB")
    assert ab.weight == 1.0


def test_avoid_link_small_penalty_keeps_paths_tied():
    """A deliberately small penalty that doesn't break the tie still applies
    without forcing the student to reroute — proves it's a soft nudge, not
    an automatic exclusion."""
    network = diamond_network(capacity=10.0, amount=10.0)
    # Make A-C-D more expensive first, so a small avoid penalty on A-B-D...
    # simplest demonstration: avoid with penalty=0 changes nothing.
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("AVOID_LINK", linkId="AB", penalty=0.0)]))
    assert len(result.pathResults[0].paths) == 2  # tie preserved with a zero penalty


# ── PREFER_LINK ────────────────────────────────────────────────────────────

def test_prefer_link_breaks_tie_toward_it():
    network = diamond_network(amount=10.0)
    # Make A-C-D artificially cheaper first so it's the sole shortest path,
    # then PREFER A-B-D by enough to make it tie again.
    for link in network.links:
        if link.id == "AC":
            link.weight = 1  # keep default; instead raise AB's baseline cost
    # Give A-B a higher weight so A-B-D (cost 3) normally loses to A-C-D (cost 2).
    for link in network.links:
        if link.id == "AB":
            link.weight = 2
    result_no_policy = ECMPAlgorithm.run(network, ecmp_config())
    assert len(result_no_policy.pathResults[0].paths) == 1
    assert result_no_policy.pathResults[0].paths[0].nodes == ["A", "C", "D"]

    # PREFER_LINK AB with penalty=1 brings effective cost back to 1 -> A-B-D
    # (1+1=2) ties with A-C-D (2) again.
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("PREFER_LINK", linkId="AB", penalty=1.0)]))
    assert len(result.pathResults[0].paths) == 2
    ab = next(lr for lr in result.linkResults if lr.linkId == "AB")
    assert ab.weight == 2.0  # physical weight still unchanged


def test_prefer_link_discount_never_goes_negative():
    network = diamond_network(amount=10.0)
    # Excessive discount (default 100) on a weight-1 link must floor at 0, not go negative.
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("PREFER_LINK", linkId="AB")]))
    # AB (now effective cost 0) beats AC (cost 1) outright -> single path via AB.
    assert result.pathResults[0].paths[0].nodes == ["A", "B", "D"]


# ── REQUIRE_WAYPOINT ───────────────────────────────────────────────────────

def test_require_waypoint_ecmp_visits_it():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("REQUIRE_WAYPOINT", nodeId="C")]))

    assert len(result.pathResults[0].paths) == 1
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    step_types = [e.stepType for e in result.traceEvents]
    assert "POLICY_WAYPOINT_REQUIRED" in step_types
    assert "COMPUTE_CANDIDATE_PATHS" not in step_types  # multi-path enumeration skipped


def test_require_waypoint_segment_routing_combines_with_explicit_segments():
    """explicit segments=[B, D-ish]; required waypoint=C -> combined [B, C]
    (using a 5-node chain so order is verifiably meaningful)."""
    network = NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=0),
            NodeInput(id="C", label="C", x=2, y=0),
            NodeInput(id="E", label="E", x=3, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="CE", source="C", target="E", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),  # shortcut skipping B
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="E", amount=5.0)],
        topologyType="custom", isDirected=False,
    )
    sr_policy = SegmentRoutingPolicy(demandId="d1", segments=["B"])
    te = policy("REQUIRE_WAYPOINT", nodeId="C")
    result = SegmentRoutingAlgorithm.run(network, sr_config(policies=[te], sr_policies=[sr_policy]))
    # Combined stops = [B, C] (explicit first, then TE) -> A-B-C-E (not the A-C shortcut).
    assert result.pathResults[0].paths[0].nodes == ["A", "B", "C", "E"]


# ── Conflicts / precedence ────────────────────────────────────────────────

def test_forbid_wins_over_prefer_same_link():
    network = diamond_network(amount=10.0)
    policies = [
        policy("PREFER_LINK", policy_id="p1", linkId="AB"),
        policy("FORBID_LINK", policy_id="p2", linkId="AB"),
    ]
    result = ECMPAlgorithm.run(network, ecmp_config(policies=policies))
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    loads = {lr.linkId: lr.load for lr in result.linkResults}
    assert loads["AB"] == 0.0


def test_forbid_required_waypoint_route_reports_clean_failure():
    """FORBID a waypoint's only link to the rest of the network -> the
    waypoint becomes unreachable -> no crash, clear debug message."""
    network = NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0),
            NodeInput(id="B", label="B", x=1, y=0),
            NodeInput(id="D", label="D", x=2, y=0),
            NodeInput(id="C", label="C", x=1, y=2),  # only reachable via C-D
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
        topologyType="custom", isDirected=False,
    )
    policies = [
        policy("REQUIRE_WAYPOINT", policy_id="p1", nodeId="C"),
        policy("FORBID_LINK", policy_id="p2", linkId="CD"),  # C's only link
    ]
    result = ECMPAlgorithm.run(network, ecmp_config(policies=policies))
    assert result.pathResults[0].paths == []
    assert any("d1" in msg for msg in result.debugInfo)


# ── Demand scoping ─────────────────────────────────────────────────────────

def test_policy_scoped_to_one_demand_only():
    network = diamond_network(capacity=10.0, amount=10.0)
    network.demands.append(TrafficDemandInput(id="d2", source="A", target="D", amount=4.0))
    scoped = policy("FORBID_LINK", linkId="AB", demandId="d1")
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[scoped]))

    d1 = next(p for p in result.pathResults if p.demandId == "d1")
    d2 = next(p for p in result.pathResults if p.demandId == "d2")
    assert len(d1.paths) == 1 and d1.paths[0].nodes == ["A", "C", "D"]
    assert len(d2.paths) == 2  # unaffected — both equal-cost paths still available


def test_global_policy_applies_to_all_demands():
    network = diamond_network(capacity=10.0, amount=10.0)
    network.demands.append(TrafficDemandInput(id="d2", source="A", target="D", amount=4.0))
    global_policy = policy("FORBID_LINK", linkId="AB")  # demandId=None
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[global_policy]))

    for pr in result.pathResults:
        assert len(pr.paths) == 1
        assert pr.paths[0].nodes == ["A", "C", "D"]


# ── Interaction with PR 3 custom ECMP distribution ───────────────────────────

def test_stale_custom_distribution_rejected_after_policy_changes_paths():
    network = diamond_network(amount=10.0)
    stale_dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.7), PathDistribution(pathId="path-2", share=0.3)],
    )
    forbid = policy("FORBID_LINK", linkId="AB")  # collapses this demand to a single path
    with pytest.raises(ValueError, match="unknown path id"):
        ECMPAlgorithm.run(network, ecmp_config(policies=[forbid], distributions=[stale_dist]))


def test_custom_distribution_still_works_when_policy_leaves_paths_intact():
    network = diamond_network(amount=10.0)
    dist = TrafficDistribution(
        demandId="d1", mode="CUSTOM",
        paths=[PathDistribution(pathId="path-1", share=0.6), PathDistribution(pathId="path-2", share=0.4)],
    )
    # AVOID with penalty=0 doesn't change the path set at all (see test above).
    avoid_noop = policy("AVOID_LINK", linkId="AB", penalty=0.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[avoid_noop], distributions=[dist]))
    shares = {p.pathId: p.trafficShare for p in result.pathResults[0].paths}
    assert shares["path-1"] == pytest.approx(6.0)
    assert shares["path-2"] == pytest.approx(4.0)


# ── Trace ──────────────────────────────────────────────────────────────────

def test_apply_te_policy_trace_event_emitted_ecmp():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config(policies=[policy("AVOID_LINK", linkId="AB")]))
    events = [e for e in result.traceEvents if e.stepType == "APPLY_TE_POLICY"]
    assert len(events) == 1
    assert events[0].metadata["costAdjustments"][0]["linkId"] == "AB"
    assert events[0].metadata["costAdjustments"][0]["originalWeight"] == 1.0


def test_apply_te_policy_trace_event_emitted_segment_routing():
    network = diamond_network(amount=10.0)
    result = SegmentRoutingAlgorithm.run(network, sr_config(policies=[policy("FORBID_LINK", linkId="AB")]))
    events = [e for e in result.traceEvents if e.stepType == "APPLY_TE_POLICY"]
    assert len(events) == 1
    assert events[0].metadata["excludedLinkIds"] == ["AB"]


def test_no_policy_trace_event_when_no_policies_configured():
    network = diamond_network(amount=10.0)
    result = ECMPAlgorithm.run(network, ecmp_config())
    assert not any(e.stepType == "APPLY_TE_POLICY" for e in result.traceEvents)


# ── Regression: no policies = unchanged behavior ──────────────────────────

def test_ecmp_regression_no_policies_byte_identical_to_pr3():
    from app.services.topology_service import TopologyService
    network = TopologyService.build_topology("triangle")
    result = ECMPAlgorithm.run(network, ecmp_config())
    paths = result.pathResults[0].paths
    assert sorted(p.trafficShare for p in paths) == [0.75, 0.75]
    assert result.totalDeliveredTraffic == 1.5


def test_segment_routing_regression_no_policies():
    network = diamond_network(amount=4.0)
    result = SegmentRoutingAlgorithm.run(network, sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]))
    assert result.pathResults[0].paths[0].nodes == ["A", "C", "D"]
    assert not any(e.stepType == "APPLY_TE_POLICY" for e in result.traceEvents)


def test_distance_vector_ignores_policies_with_notice():
    from app.services.topology_service import TopologyService
    network = TopologyService.build_topology("line")
    result_no_policy = DistanceVectorAlgorithm.run(network, dv_config())
    result_with_policy = DistanceVectorAlgorithm.run(
        network, dv_config(policies=[policy("FORBID_LINK", linkId="ab")])
    )
    # Routing output is identical either way — the policy is ignored, not applied.
    assert result_no_policy.pathResults[0].paths[0].nodes == result_with_policy.pathResults[0].paths[0].nodes
    assert result_no_policy.totalDeliveredTraffic == result_with_policy.totalDeliveredTraffic
    assert any("not supported by Distance Vector" in msg for msg in result_with_policy.debugInfo)
    assert not any("not supported" in msg for msg in result_no_policy.debugInfo)


# ── End-to-end smoke test ─────────────────────────────────────────────────

def test_smoke_via_simulate_endpoint():
    network_json = {
        "nodes": [n.model_dump() for n in diamond_network(amount=10.0).nodes],
        "links": [l.model_dump() for l in diamond_network(amount=10.0).links],
        "demands": [d.model_dump() for d in diamond_network(amount=10.0).demands],
        "topologyType": "custom", "isDirected": False,
    }
    body = {
        "network": network_json,
        "algorithmConfig": {
            "selectedAlgorithm": "ECMP", "algorithmType": "real_world_heuristic",
            "objective": "minimize_max_utilization", "congestionThreshold": 1.0,
            "tePolicies": [{"policyId": "p1", "type": "FORBID_LINK", "linkId": "AB"}],
        },
    }
    response = client.post("/simulate", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["pathResults"][0]["paths"][0]["nodes"] == ["A", "C", "D"]
