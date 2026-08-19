"""Tests for scheduled mid-simulation link failures (PR 6, Part 1).

Unlike PR 5's `operationalStatus="DOWN"` (a link that is down for the whole
run), a `SimulationFailureEvent` describes a link that starts UP and
transitions to DOWN partway through the run, at a given trace step — see
`app/utils/failure_schedule.py` for the exact timing model. This file
exercises that mid-run transition: the effective graph is mutated in place,
already-routed demands crossing the failed link are recomputed, and the
LINK_FAILURE / ROUTE_INVALIDATED / ROUTING_RECOMPUTATION / NEW_ROUTE_SELECTED
/ ROUTE_UNREACHABLE / UTILIZATION_RECOMPUTED / CONGESTION_CHANGED trace
events tell that story. ecmp.py / segment_routing.py / distance_vector.py's
PR1-5 routing logic is otherwise unmodified — regression coverage for the
no-schedule case lives in the existing PR1-5 test files, none of which are
touched by this PR.
"""
from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.algorithms.ecmp import ECMPAlgorithm
from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.models import (
    LinkInput,
    NetworkInput,
    NodeInput,
    PathDistribution,
    SegmentRoutingPolicy,
    SimulationFailureEvent,
    TrafficDemandInput,
    TrafficDistribution,
)

from tests.test_link_failure import (
    diamond_network,
    dv_config,
    ecmp_config,
    single_path_network,
    sr_config,
    sr_waypoint_network,
)


def failure(link_id, trigger_value, event_id="f1"):
    return SimulationFailureEvent(eventId=event_id, linkId=link_id, triggerType="TRACE_STEP", triggerValue=trigger_value)


# ── A. Single scheduled failure (ECMP) ───────────────────────────────────────

def test_a_single_scheduled_failure_reroutes_ecmp():
    network = diamond_network()
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 6)]
    result = ECMPAlgorithm.run(network, config)

    pr = result.pathResults[0]
    # All traffic ends up on the surviving path only.
    assert len(pr.paths) == 1
    assert pr.paths[0].nodes == ["A", "C", "D"]
    assert pr.paths[0].trafficShare == 10.0

    link_failure_events = [e for e in result.traceEvents if e.stepType == "LINK_FAILURE"]
    assert len(link_failure_events) == 1
    assert link_failure_events[0].highlightedLinks == ["BD"]

    bd_result = next(l for l in result.linkResults if l.linkId == "BD")
    assert bd_result.load == 0.0


# ── B. Two scheduled failures ────────────────────────────────────────────────

def test_b_two_scheduled_failures_independent_demands():
    """Two independent diamonds, each with its own scheduled failure at a
    different step — both must reroute correctly and not interfere."""
    network = NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0), NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="C", label="C", x=1, y=1), NodeInput(id="D", label="D", x=2, y=0),
            NodeInput(id="P", label="P", x=0, y=3), NodeInput(id="Q", label="Q", x=1, y=2),
            NodeInput(id="R", label="R", x=1, y=4), NodeInput(id="S", label="S", x=2, y=3),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
            LinkInput(id="PQ", source="P", target="Q", capacity=10, weight=1),
            LinkInput(id="QS", source="Q", target="S", capacity=10, weight=1),
            LinkInput(id="PR", source="P", target="R", capacity=10, weight=1),
            LinkInput(id="RS", source="R", target="S", capacity=10, weight=1),
        ],
        demands=[
            TrafficDemandInput(id="d1", source="A", target="D", amount=10.0),
            TrafficDemandInput(id="d2", source="P", target="S", amount=8.0),
        ],
        topologyType="custom", isDirected=False,
    )
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 6, "f1"), failure("QS", 14, "f2")]
    result = ECMPAlgorithm.run(network, config)

    pr1 = next(p for p in result.pathResults if p.demandId == "d1")
    pr2 = next(p for p in result.pathResults if p.demandId == "d2")
    assert [s.nodes for s in pr1.paths] == [["A", "C", "D"]]
    assert [s.nodes for s in pr2.paths] == [["P", "R", "S"]]

    failure_events = [e for e in result.traceEvents if e.stepType == "LINK_FAILURE"]
    assert len(failure_events) == 2
    assert failure_events[0].highlightedLinks == ["BD"]
    assert failure_events[1].highlightedLinks == ["QS"]


# ── C. ECMP rerouting — full trace-story ordering ────────────────────────────

def test_c_ecmp_trace_story_ordering():
    network = diamond_network()
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 6)]
    result = ECMPAlgorithm.run(network, config)

    story_types = [
        e.stepType for e in result.traceEvents
        if e.stepType in {
            "LINK_FAILURE", "ROUTE_INVALIDATED", "ROUTING_RECOMPUTATION",
            "NEW_ROUTE_SELECTED", "UTILIZATION_RECOMPUTED",
        }
    ]
    assert story_types == [
        "LINK_FAILURE", "ROUTE_INVALIDATED", "ROUTING_RECOMPUTATION",
        "NEW_ROUTE_SELECTED", "UTILIZATION_RECOMPUTED",
    ]
    # stepIds strictly increase and are unique.
    step_ids = [int(e.stepId) for e in result.traceEvents]
    assert step_ids == sorted(set(step_ids))
    assert len(step_ids) == len(set(step_ids))


# ── D. SR waypoint preserved across a scheduled failure ──────────────────────

def test_d_sr_waypoint_preserved_after_scheduled_failure():
    network = sr_waypoint_network()
    config = sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    # BC (first leg of the baseline A-B-C-D route) fails after the baseline
    # route has already been placed.
    config.failureSchedule = [failure("BC", 8)]
    result = SegmentRoutingAlgorithm.run(network, config)

    pr = result.pathResults[0]
    assert len(pr.paths) == 1
    # Still visits C (the required waypoint) — just via E instead of B.
    assert pr.paths[0].nodes == ["A", "E", "C", "D"]
    assert "C" in pr.paths[0].nodes

    new_route_events = [e for e in result.traceEvents if e.stepType == "NEW_ROUTE_SELECTED"]
    assert len(new_route_events) == 1
    assert "C" in new_route_events[0].highlightedNodes


# ── E. Unreachable after failure ─────────────────────────────────────────────

def test_e_ecmp_demand_unreachable_after_scheduled_failure():
    network = single_path_network()
    config = ecmp_config()
    config.failureSchedule = [failure("AB", 4)]
    result = ECMPAlgorithm.run(network, config)

    pr = result.pathResults[0]
    assert pr.paths == []
    unreachable_events = [e for e in result.traceEvents if e.stepType == "ROUTE_UNREACHABLE"]
    assert len(unreachable_events) == 1
    assert result.totalDeliveredTraffic == 0.0


def test_e_sr_demand_unreachable_when_failure_disconnects_waypoint():
    network = sr_waypoint_network()
    config = sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    # Two failures: BC breaks the baseline route, then EC (the only
    # remaining way to reach waypoint C) fails too — C becomes unreachable.
    config.failureSchedule = [failure("BC", 8, "f1"), failure("EC", 12, "f2")]
    result = SegmentRoutingAlgorithm.run(network, config)

    pr = result.pathResults[0]
    assert pr.paths == []
    unreachable_events = [e for e in result.traceEvents if e.stepType == "ROUTE_UNREACHABLE"]
    assert len(unreachable_events) == 1


# ── F. Distance Vector safe behavior ─────────────────────────────────────────

def test_f_dv_reroutes_after_scheduled_failure():
    """Asymmetric weights force a deterministic baseline route (A-B-D, cost
    2) over the alternate (A-C-D, cost 4) — failing A-B mid-run must force
    DV onto the alternate, not crash or silently keep routing over A-B."""
    network = NetworkInput(
        nodes=[
            NodeInput(id="A", label="A", x=0, y=0), NodeInput(id="B", label="B", x=1, y=-1),
            NodeInput(id="C", label="C", x=1, y=1), NodeInput(id="D", label="D", x=2, y=0),
        ],
        links=[
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=2),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=2),
        ],
        demands=[TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
        topologyType="custom", isDirected=False,
    )
    config = dv_config()
    config.failureSchedule = [failure("AB", 6)]
    result = DistanceVectorAlgorithm.run(network, config)

    pr = result.pathResults[0]
    assert len(pr.paths) == 1
    assert pr.paths[0].nodes == ["A", "C", "D"]

    recompute_events = [e for e in result.traceEvents if e.stepType == "ROUTING_RECOMPUTATION"]
    assert len(recompute_events) == 1
    # The recomputed dv_table reflects the post-failure graph (returned in
    # the final result, not the stale pre-failure one) — A no longer
    # reaches B in one hop, only the long way around via C-D.
    ab_entry = next(r for r in result.distanceVectorTable if r.nodeId == "A" and r.destinationId == "B")
    assert ab_entry.cost == 5.0  # A -> C -> D -> B, not the direct (now-failed) A -> B
    assert ab_entry.nextHop == "C"


def test_f_dv_unreachable_after_scheduled_failure():
    network = single_path_network()
    config = dv_config()
    config.failureSchedule = [failure("AB", 4)]
    result = DistanceVectorAlgorithm.run(network, config)

    pr = result.pathResults[0]
    assert pr.paths == []


def test_f_dv_baseline_unchanged_with_no_schedule():
    network = diamond_network()
    config = dv_config()
    result_a = DistanceVectorAlgorithm.run(network, config)
    result_b = DistanceVectorAlgorithm.run(network, dv_config())
    assert result_a.maxUtilization == result_b.maxUtilization
    assert len(result_a.traceEvents) == len(result_b.traceEvents)


# ── G. Failure trace ordering (generic, algorithm-agnostic check) ───────────

def test_g_failure_trace_ordering_sr():
    network = sr_waypoint_network()
    config = sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    config.failureSchedule = [failure("BC", 8)]
    result = SegmentRoutingAlgorithm.run(network, config)

    idx = {t: i for i, t in enumerate(e.stepType for e in result.traceEvents) if t}
    assert idx["LINK_FAILURE"] < idx["ROUTE_INVALIDATED"] < idx["ROUTING_RECOMPUTATION"] < idx["NEW_ROUTE_SELECTED"]


# ── H. Failures scheduled after route calculation still fire deterministically ──

def test_h_failure_scheduled_at_zero_demands_still_applies_via_catchall():
    """With no demands at all, the per-demand loop never runs and
    `.due()` is only ever called once — the post-loop catch-all. This is
    the one case where that catch-all (not the in-loop check) is what
    makes the schedule deterministic rather than silently skipped."""
    network = diamond_network()
    network = network.model_copy(update={"demands": []})
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 0)]
    result = ECMPAlgorithm.run(network, config)

    link_failure_events = [e for e in result.traceEvents if e.stepType == "LINK_FAILURE"]
    assert len(link_failure_events) == 1
    assert result.pathResults == []
    assert not any("never applied" in d for d in result.debugInfo)


def test_h_trigger_beyond_last_step_never_fires_and_is_reported():
    """A trigger step this run's trace never reaches is a deterministic
    no-op — not applied, not a crash — and is surfaced in debugInfo rather
    than silently dropped."""
    network = diamond_network()
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 9999)]
    result = ECMPAlgorithm.run(network, config)

    assert not any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)
    # Baseline (unaffected) routing: both paths still present.
    pr = result.pathResults[0]
    assert len(pr.paths) == 2
    assert any("never applied" in d for d in result.debugInfo)


def test_h_two_failures_same_trigger_step_fire_in_deterministic_order():
    """Both of the diamond's two links fail at the exact same trace step —
    the scheduler must still resolve them one at a time, in a stable order
    (by triggerValue, then schedule list order), not crash or apply them
    simultaneously."""
    network = diamond_network()
    config = ecmp_config()
    config.failureSchedule = [failure("BD", 6, "f1"), failure("AC", 6, "f2")]
    result = ECMPAlgorithm.run(network, config)

    link_failure_events = [e for e in result.traceEvents if e.stepType == "LINK_FAILURE"]
    assert len(link_failure_events) == 2
    assert [e.highlightedLinks[0] for e in link_failure_events] == ["BD", "AC"]
    # Both of the demand's paths are gone — it's unreachable, and the
    # simulation still completes cleanly rather than crashing.
    assert result.pathResults[0].paths == []
    assert any(e.stepType == "ROUTE_UNREACHABLE" for e in result.traceEvents)


def test_h_unknown_link_id_in_schedule_is_ignored_safely():
    network = diamond_network()
    config = ecmp_config()
    config.failureSchedule = [failure("DOES-NOT-EXIST", 4)]
    result = ECMPAlgorithm.run(network, config)
    assert result.pathResults[0].paths  # still routed normally
    assert not any(e.stepType == "LINK_FAILURE" for e in result.traceEvents)


# ── I. No failure events = byte-identical baseline ───────────────────────────

def test_i_empty_schedule_byte_identical_to_no_schedule_field():
    network = diamond_network()
    config_a = ecmp_config()
    config_a.failureSchedule = []
    config_b = ecmp_config()  # default failureSchedule=[]
    result_a = ECMPAlgorithm.run(network, config_a)
    result_b = ECMPAlgorithm.run(network, config_b)
    assert result_a.model_dump(exclude={"runtimeMs", "simulationRunId"}) == result_b.model_dump(exclude={"runtimeMs", "simulationRunId"})


def test_i_empty_schedule_sr_byte_identical():
    network = sr_waypoint_network()
    config = sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])])
    config.failureSchedule = []
    result_a = SegmentRoutingAlgorithm.run(network, config)
    result_b = SegmentRoutingAlgorithm.run(network, sr_config(sr_policies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]))
    assert result_a.model_dump(exclude={"runtimeMs", "simulationRunId"}) == result_b.model_dump(exclude={"runtimeMs", "simulationRunId"})


def test_i_empty_schedule_dv_byte_identical():
    network = diamond_network()
    result_a = DistanceVectorAlgorithm.run(network, dv_config())
    result_b = DistanceVectorAlgorithm.run(network, dv_config())
    assert result_a.model_dump(exclude={"runtimeMs", "simulationRunId"}) == result_b.model_dump(exclude={"runtimeMs", "simulationRunId"})


# ── Custom ECMP distribution invalidation mid-run ────────────────────────────

def test_custom_distribution_falls_back_to_equal_when_paths_collapse():
    network = diamond_network()
    # Custom 70/30 split over the two original paths (path-1=A-B-D, path-2=A-C-D).
    config = ecmp_config(distributions=[
        TrafficDistribution(demandId="d1", mode="CUSTOM", paths=[
            PathDistribution(pathId="path-1", share=0.7),
            PathDistribution(pathId="path-2", share=0.3),
        ])
    ])
    config.failureSchedule = [failure("BD", 6)]
    result = ECMPAlgorithm.run(network, config)

    pr = result.pathResults[0]
    # Post-failure there's only one path — the stale 70/30 split against
    # path ids that no longer both exist safely falls back to 100% on the
    # sole surviving path instead of crashing the whole simulation.
    assert len(pr.paths) == 1
    assert pr.paths[0].trafficShare == 10.0
    assert any("falling back to an equal split" in d for d in result.debugInfo)


def test_custom_distribution_still_raises_for_invalid_original_route():
    """Sanity check that PR 6's is_reroute fallback did NOT loosen the
    original (first-route) validation — still raises exactly as before."""
    import pytest
    network = diamond_network()
    config = ecmp_config(distributions=[
        TrafficDistribution(demandId="d1", mode="CUSTOM", paths=[
            PathDistribution(pathId="path-1", share=0.9),
            PathDistribution(pathId="path-2", share=0.05),  # sums to 0.95, not 1.0
        ])
    ])
    with pytest.raises(ValueError, match="sum to"):
        ECMPAlgorithm.run(network, config)
