"""The Demo Scenario Pack — a curated, MongoDB-backed set of Assignment
documents that showcase Sprint 1 and Sprint 2's most important behavior
without requiring a presenter to rebuild topologies by hand.

Every topology/demand/config below mirrors a mathematically verified
backend test fixture byte-for-byte (same node ids, same capacities/
weights, same demands) — the docstring on each builder function cites the
exact test file and function it reproduces. Nothing here is invented by
hand; `backend/tests/test_demo_scenarios.py` re-derives every teaching
claim from these SAME functions by calling the real simulate/optimize
code paths, so the numbers can never silently drift from what the app
actually computes.

Each scenario is a plain `Assignment` (mode="lecture", no
`expectedSolution`, no `challengeConfig`) with `demoScenario` set — reusing
the existing classroom model rather than inventing a parallel one. See
`app/models.py`'s `DemoScenarioMeta` docstring for why any
optimization-related fields on it are UI hints only, never a stored
"answer".
"""
from __future__ import annotations

from typing import List

from app.models import (
    AlgorithmConfig,
    Assignment,
    DemoScenarioMeta,
    GradingRules,
    LinkInput,
    LockedFields,
    NetworkInput,
    NodeInput,
    SegmentRoutingPolicy,
    SimulationFailureEvent,
    StudentTask,
    TrafficDemandInput,
    TrafficEngineeringPolicy,
)

# ── Small shared builders (mirrors the `network()`/`config()` helpers every
#    backend test file already defines for itself) ──────────────────────────


def _net(node_ids, links, demands, topology_type="custom", is_directed=False) -> NetworkInput:
    return NetworkInput(
        nodes=[NodeInput(id=n, label=n, x=0, y=0) for n in node_ids],
        links=links,
        demands=demands,
        topologyType=topology_type,
        isDirected=is_directed,
    )


def _task(prompt: str) -> StudentTask:
    # Demo scenarios are presenter-driven walkthroughs, not graded tasks —
    # no submission is ever created for them, so `taskType` is never read by
    # any grading path. A concrete value is still required by the schema;
    # the prompt text is what a presenter actually sees.
    return StudentTask(
        taskType="REDUCE_MAX_UTILIZATION",
        prompt=prompt,
        instructions="Pre-loaded demo scenario — explore freely, no submission required.",
        answerFormatDescription="",
    )


def _demo_assignment(
    *,
    assignment_id: str,
    title: str,
    topic: str,
    network: NetworkInput,
    algorithm_config: AlgorithmConfig,
    prompt: str,
    meta: DemoScenarioMeta,
) -> Assignment:
    return Assignment(
        assignmentId=assignment_id,
        title=title,
        description=meta.shortDescription,
        course="Demo Scenario Pack",
        topic=topic,
        mode="lecture",
        starterNetwork=network,
        lockedFields=LockedFields(
            canEditNodes=False, canEditLinks=False, canEditWeights=True,
            canEditCapacities=False, canEditDemands=False, canChooseAlgorithm=True,
        ),
        allowedAlgorithms=[algorithm_config.selectedAlgorithm],
        studentTask=_task(prompt),
        expectedSolution=None,
        gradingRules=GradingRules(),
        challengeConfig=None,
        starterAlgorithmConfig=algorithm_config,
        demoScenario=meta,
    )


# ── Canonical topologies (each cites its verified source) ──────────────────


def clos_fat_tree_network() -> NetworkInput:
    """2-spine/4-leaf/8-host Clos fat-tree — identical to
    `frontend/src/utils/lectureExamples.ts`'s `closFatTreeNetwork` /
    `sample-json/clos_fat_tree_small.json`. All weights 1, all capacities
    10; demand H1->H8 = 1. Two equal-cost 3-hop paths (via S1 and via S2)
    give a clean, non-congested ECMP split — no bottleneck anywhere.
    """
    hosts = [f"h{i}" for i in range(1, 9)]
    leaves = [f"l{i}" for i in range(1, 5)]
    spines = ["s1", "s2"]
    links: List[LinkInput] = []
    for i, h in enumerate(hosts):
        leaf = leaves[i // 2]
        links.append(LinkInput(id=f"{h}-{leaf}", source=h, target=leaf, capacity=10, weight=1))
    for leaf in leaves:
        for spine in spines:
            links.append(LinkInput(id=f"{leaf}-{spine}", source=leaf, target=spine, capacity=10, weight=1))
    return _net(
        hosts + leaves + spines, links,
        [TrafficDemandInput(id="d1", source="h1", target="h8", amount=1.0)],
        topology_type="fat-tree",
    )


def ecmp_triangle_network() -> NetworkInput:
    """u/v/t triangle — identical to `sample-json/triangle_ecmp.json` and
    `lectureExamples.ts`'s `ecmpTriangleNetwork`. u->t (cost 2 direct) ties
    with u->v->t (cost 1+1=2); ECMP splits the 1.5-unit u->t demand 0.75/
    0.75, and v->t's own 0.5-unit demand adds onto the shared v-t link ->
    v-t carries 0.75+0.5=1.25 against capacity 1 (125% utilization,
    congested). Hand-verified in the lecture example's own comments.
    """
    return _net(
        ["u", "v", "t"],
        [
            LinkInput(id="u-t", source="u", target="t", capacity=1.0, weight=2.0),
            LinkInput(id="u-v", source="u", target="v", capacity=1.0, weight=1.0),
            LinkInput(id="v-t", source="v", target="t", capacity=1.0, weight=1.0),
        ],
        [
            TrafficDemandInput(id="d-ut", source="u", target="t", amount=1.5),
            TrafficDemandInput(id="d-vt", source="v", target="t", amount=0.5),
        ],
        topology_type="triangle",
    )


def ecmp_distribution_network() -> NetworkInput:
    """A/B/C/D diamond with asymmetric capacity — identical to
    `lectureExamples.ts`'s `ecmpDistributionNetwork`. A-B-D (capacity 4 per
    leg) and A-C-D (capacity 12 per leg) are equal-cost (both cost 2).
    Equal ECMP split of the 10-unit A->D demand sends 5 down each path,
    overloading A-B-D to 125%. A custom 20/80 split (2 units via A-B-D, 8
    via A-C-D) drops A-B-D to 50% and A-C-D to 67% — congestion-free.
    """
    return _net(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=4, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=4, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=12, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=12, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def sr_waypoint_ecmp_network() -> NetworkInput:
    """A->D via required waypoint C, both legs tied — identical to
    `backend/tests/test_segment_routing_ecmp.py`'s `both_sides_tie_network()`
    (test_f_ecmp_both_sides_conservation), "the worked example from the PR0
    spec". A->C has two equal-cost 2-hop paths (via B and via E); C->D has
    two equal-cost 2-hop paths (via F and via G). Every link capacity 10,
    demand A->D=10 -> ECMP splits 5/5 on both segments, zero congestion.
    """
    return _net(
        ["A", "B", "E", "C", "F", "G", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="AE", source="A", target="E", capacity=10, weight=1),
            LinkInput(id="EC", source="E", target="C", capacity=10, weight=1),
            LinkInput(id="CF", source="C", target="F", capacity=10, weight=1),
            LinkInput(id="FD", source="F", target="D", capacity=10, weight=1),
            LinkInput(id="CG", source="C", target="G", capacity=10, weight=1),
            LinkInput(id="GD", source="G", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def te_diamond_network() -> NetworkInput:
    """A/B/C/D diamond, both legs cost 2, capacity 10 — identical to
    `backend/tests/test_te_policies.py` and `test_link_failure.py`'s shared
    `diamond_network()`. Baseline ECMP ties A-B-D and A-C-D 5/5. Used for
    FORBID_LINK (E), link failure (G), and mid-simulation failure (H).
    """
    return _net(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def te_prefer_diamond_network() -> NetworkInput:
    """Same diamond, but A-B weighted 2 (so A-C-D alone is cheapest at
    baseline) — identical to `test_te_policies.py`'s
    `test_prefer_link_breaks_tie_toward_it`. Baseline: single path A-C-D
    (cost 2) since A-B-D costs 3. PREFER_LINK(AB, penalty=1) discounts AB
    back to effective cost 1, retying A-B-D (1+1=2) with A-C-D (2) -> both
    paths carry traffic again.
    """
    return _net(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=2),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def detour_topology() -> NetworkInput:
    """A/B/D — identical to `test_waypoint_optimization.py`'s
    `test_b_single_demand_beneficial_waypoint` network AND
    `test_lwo_optimization.py`'s `_direct_vs_detour_topology()` (the same
    topology, defined independently in both files). A-D direct (capacity 5,
    weight 1) is the unique shortest path and congests at demand=8 (MLU
    1.6). The A-B-D detour (capacity 10 per leg, weight 5 per leg) is
    unused by default routing but has plenty of spare capacity: OPT's
    unrestricted split reaches MLU~=0.533; WPO recommends waypoint B for
    MLU 0.8; LWO's in-domain weight retune also reaches MLU 0.8.
    """
    return _net(
        ["A", "B", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=5, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=5),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=8.0)],
    )


def unavoidable_congestion_network() -> NetworkInput:
    """Single link A-B, capacity 5, demand 8 — identical to
    `test_unrestricted_optimizer.py`'s
    `test_k_known_congestion_example_opt_above_one`. No routing at all
    (not even the unrestricted optimum) can avoid MLU=1.6>1: congestion is
    structurally unavoidable here, not an artifact of any one algorithm.
    """
    return _net(
        ["A", "B"],
        [LinkInput(id="AB", source="A", target="B", capacity=5, weight=1)],
        [TrafficDemandInput(id="d1", source="A", target="B", amount=8.0)],
    )


def wpo_limited_topology() -> NetworkInput:
    """A/X1/X2/W/D (directed) — identical to
    `test_joint_optimization.py`'s `_wpo_limited_topology()`. A single
    demand (A->D, 20 units) whose true optimum needs two coupled routing
    decisions at once; WPO's one-waypoint-per-demand limit caps it at MLU
    3.333, while LWO/Joint reach MLU 1.0. Combined Joint search space is
    312,500 (weight 78,125 x waypoint 4) — comfortably above the default
    50,000 budget (JOINT_ALTERNATING) but still solvable exactly in a few
    seconds at a raised budget (EXACT_JOINT_ENUMERATION), used for both the
    Joint-improvement scenario (M) and the Joint search-budget scenario (P).
    """
    return _net(
        ["A", "X1", "X2", "W", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AX1", source="A", target="X1", capacity=20, weight=2),
            LinkInput(id="X1W", source="X1", target="W", capacity=20, weight=2),
            LinkInput(id="AX2", source="A", target="X2", capacity=3, weight=2),
            LinkInput(id="X2W", source="X2", target="W", capacity=3, weight=2),
            LinkInput(id="WD", source="W", target="D", capacity=25, weight=1),
            LinkInput(id="X1D", source="X1", target="D", capacity=2, weight=3),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=20.0)],
        is_directed=True,
    )


def wpo_order_dependent_topology() -> NetworkInput:
    """A/B/C/D — identical to `test_waypoint_optimization.py`'s
    `_order_dependent_topology()`. Two same-OD-pair demands (big=20,
    small=2) share a tiny-capacity direct link (AD, capacity 3) and two
    equal, huge-capacity detours (via B, via C). Search space = 3 waypoint
    candidates x 2 demands... evaluated jointly = 9 combinations — small
    enough to demonstrate the EXACT_ENUMERATION/GREEDY_WPO budget threshold
    directly (`test_r_search_space_guard_triggers_greedy_fallback`).
    """
    return _net(
        ["A", "B", "C", "D"],
        [
            LinkInput(id="AD", source="A", target="D", capacity=3, weight=1),
            LinkInput(id="AB", source="A", target="B", capacity=100, weight=5),
            LinkInput(id="BD", source="B", target="D", capacity=100, weight=5),
            LinkInput(id="AC", source="A", target="C", capacity=100, weight=5),
            LinkInput(id="CD", source="C", target="D", capacity=100, weight=5),
        ],
        [
            TrafficDemandInput(id="big", source="A", target="D", amount=20.0),
            TrafficDemandInput(id="small", source="A", target="D", amount=2.0),
        ],
    )


# ── AlgorithmConfig helpers ─────────────────────────────────────────────────


def _ecmp_config(**overrides) -> AlgorithmConfig:
    base = dict(
        selectedAlgorithm="ECMP", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    base.update(overrides)
    return AlgorithmConfig(**base)


def _sr_config(**overrides) -> AlgorithmConfig:
    base = dict(
        selectedAlgorithm="SEGMENT_ROUTING", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    base.update(overrides)
    return AlgorithmConfig(**base)


# ── The 16 scenarios ─────────────────────────────────────────────────────────


def _scenario_a() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-ecmp-basic",
        title="ECMP Basic: Clean Equal-Cost Split",
        topic="ECMP",
        network=clos_fat_tree_network(),
        algorithm_config=_ecmp_config(),
        prompt="Run ECMP. Two equal-cost 3-hop paths (via S1 and via S2) split the H1->H8 demand evenly, with no congestion anywhere.",
        meta=DemoScenarioMeta(
            category="Routing Basics", order=1,
            shortDescription="A small data-center fabric where ECMP finds two equal-cost paths and splits traffic evenly — no congestion.",
            complexity="Beginner", recommended=True,
            tags=["ecmp", "fat-tree"],
        ),
    )


def _scenario_b() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-ecmp-congestion",
        title="ECMP Congestion: Equal Split Isn't Always Enough",
        topic="ECMP",
        network=ecmp_triangle_network(),
        algorithm_config=_ecmp_config(),
        prompt="Run ECMP. u->t splits evenly across two equal-cost paths, but v-t also carries v->t's own demand — the shared link ends up at 125% utilization.",
        meta=DemoScenarioMeta(
            category="Routing Basics", order=2,
            shortDescription="The classic ECMP Triangle: two equal-cost paths still congest a shared downstream link.",
            complexity="Beginner", recommended=True,
            tags=["ecmp", "congestion"],
        ),
    )


def _scenario_c() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-ecmp-custom-distribution",
        title="Custom ECMP Distribution: Reshaping the Split",
        topic="ECMP",
        network=ecmp_distribution_network(),
        algorithm_config=_ecmp_config(),
        prompt="Run ECMP with the default equal split first (125% on A-B-D). Then open Traffic Distribution and set a custom 20/80 split to relieve it.",
        meta=DemoScenarioMeta(
            category="Traffic Engineering", order=1,
            shortDescription="Equal ECMP split overloads a low-capacity path; a custom 20/80 split fixes it without touching link cost.",
            complexity="Intermediate", recommended=True,
            tags=["ecmp", "custom-distribution"],
        ),
    )


def _scenario_d() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-sr-waypoint",
        title="Segment Routing: Waypoint with ECMP-Within-Segments",
        topic="SEGMENT_ROUTING",
        network=sr_waypoint_ecmp_network(),
        algorithm_config=_sr_config(
            segmentRoutingPolicies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]
        ),
        prompt="Run Segment Routing. The demand is steered through waypoint C; both the A->C and C->D segments independently discover a 2-path ECMP tie and split evenly.",
        meta=DemoScenarioMeta(
            category="Routing Basics", order=3,
            shortDescription="A single demand routed through one required waypoint, with ECMP splitting traffic on both segments around it.",
            complexity="Intermediate", recommended=True,
            tags=["segment-routing", "waypoint", "ecmp"],
        ),
    )


def _scenario_e() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-forbid-link",
        title="TE Policy: FORBID_LINK",
        topic="TRAFFIC_ENGINEERING",
        network=te_diamond_network(),
        algorithm_config=_ecmp_config(
            tePolicies=[TrafficEngineeringPolicy(policyId="p1", type="FORBID_LINK", linkId="AB")]
        ),
        prompt="Run ECMP. Compare against the baseline (no policy) 50/50 tie: with AB forbidden, all traffic moves to A-C-D. AB stays visible on the canvas with zero load.",
        meta=DemoScenarioMeta(
            category="Traffic Engineering", order=2,
            shortDescription="A hard FORBID_LINK constraint removes a link from routing while keeping it physically visible on the canvas.",
            complexity="Intermediate", recommended=True,
            tags=["te-policy", "forbid-link"],
        ),
    )


def _scenario_f() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-avoid-prefer-link",
        title="TE Policy: PREFER_LINK Breaks a Tie",
        topic="TRAFFIC_ENGINEERING",
        network=te_prefer_diamond_network(),
        algorithm_config=_ecmp_config(
            tePolicies=[TrafficEngineeringPolicy(policyId="p1", type="PREFER_LINK", linkId="AB", penalty=1.0)]
        ),
        prompt="Run ECMP first with no policy (single path A-C-D, since A-B-D costs more). Then apply PREFER_LINK on AB — it discounts AB's cost enough to retie both paths.",
        meta=DemoScenarioMeta(
            category="Traffic Engineering", order=3,
            shortDescription="A soft PREFER_LINK preference discounts a link's cost just enough to bring it back into the equal-cost set.",
            complexity="Intermediate",
            tags=["te-policy", "prefer-link"],
        ),
    )


def _scenario_g() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-link-failure",
        title="Link Failure: Automatic Rerouting",
        topic="TRAFFIC_ENGINEERING",
        network=te_diamond_network(),
        algorithm_config=_ecmp_config(),
        prompt="Run ECMP with the baseline topology (both paths tied, 5/5 split). Then mark link AB DOWN and re-run — see all 10 units move to A-C-D automatically. Use Before/After comparison to see both at once.",
        meta=DemoScenarioMeta(
            category="Failures", order=1,
            shortDescription="Taking a link down forces ECMP to reroute the full demand onto the surviving path.",
            complexity="Beginner", recommended=True,
            tags=["failure", "rerouting"],
        ),
    )


def _scenario_h() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-mid-sim-failure",
        title="Mid-Simulation Failure: Watch It Happen Live",
        topic="TRAFFIC_ENGINEERING",
        network=te_diamond_network(),
        algorithm_config=_ecmp_config(
            failureSchedule=[SimulationFailureEvent(eventId="f1", linkId="BD", triggerType="TRACE_STEP", triggerValue=6)]
        ),
        prompt="Run ECMP and open Replay. The baseline route is established first; at trace step 6, BD fails mid-run — watch ROUTE_INVALIDATED, recomputation, and the new route/utilization appear live.",
        meta=DemoScenarioMeta(
            category="Failures", order=2,
            shortDescription="A link fails partway through the trace replay — watch routing invalidate, recompute, and settle on a new route live.",
            complexity="Intermediate", recommended=True,
            tags=["failure", "scheduled", "replay"],
        ),
    )


def _scenario_i() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-opt-unavoidable",
        title="OPT: Structurally Unavoidable Congestion",
        topic="TRAFFIC_ENGINEERING",
        network=unavoidable_congestion_network(),
        algorithm_config=_ecmp_config(),
        prompt="Open the Optimization Lab and run OPT. Even the unrestricted theoretical optimum reaches MLU=1.6>1 — no routing algorithm, however clever, could do better than the capacity allows.",
        meta=DemoScenarioMeta(
            category="Optimization", order=1,
            shortDescription="A single link, undersized for the demand: even OPT's unrestricted optimum can't avoid congestion (MLU=1.6). Not the same as solver INFEASIBLE.",
            complexity="Beginner", recommended=True,
            tags=["optimization", "opt", "congestion"],
            optimizationMode="OPT",
        ),
    )


def _scenario_j() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-ecmp-vs-opt",
        title="Current Routing vs. OPT: An Optimality Gap",
        topic="TRAFFIC_ENGINEERING",
        network=detour_topology(),
        algorithm_config=_ecmp_config(),
        prompt="Run ECMP first (MLU=1.6 — all traffic forced onto the direct link). Then open the Optimization Lab and run OPT (MLU~=0.533). The network has enough capacity; the current routing just isn't using it.",
        meta=DemoScenarioMeta(
            category="Optimization", order=2,
            shortDescription="Current routing congests (MLU=1.6) while OPT proves the network could stay well under capacity (MLU~=0.53) — a real algorithmic gap, not a capacity problem.",
            complexity="Intermediate", recommended=True,
            tags=["optimization", "opt", "gap"],
            optimizationMode="OPT",
        ),
    )


def _scenario_k() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-wpo",
        title="Waypoint Optimization Improves Routing",
        topic="TRAFFIC_ENGINEERING",
        network=detour_topology(),
        algorithm_config=_ecmp_config(),
        prompt="Run the baseline (MLU=1.6). Open the Optimization Lab, select Waypoint Optimization, and Run — it recommends waypoint B, dropping MLU to 0.8.",
        meta=DemoScenarioMeta(
            category="Optimization", order=3,
            shortDescription="WPO finds a single beneficial waypoint that halves the maximum link utilization (1.6 -> 0.8).",
            complexity="Intermediate", recommended=True,
            tags=["optimization", "wpo"],
            optimizationMode="WPO", recommendedBudget=50000,
        ),
    )


def _scenario_l() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-lwo",
        title="Link Weight Optimization Improves Routing",
        topic="TRAFFIC_ENGINEERING",
        network=detour_topology(),
        algorithm_config=_ecmp_config(),
        prompt="Run the baseline (MLU=1.6). Open the Optimization Lab, select Link Weight Optimization, and Run — the recommended weights retie the detour, dropping MLU to 0.8.",
        meta=DemoScenarioMeta(
            category="Optimization", order=4,
            shortDescription="LWO retunes link weights within the allowed range to split traffic onto an unused detour (1.6 -> 0.8).",
            complexity="Intermediate", recommended=True,
            tags=["optimization", "lwo"],
            optimizationMode="LWO", recommendedBudget=50000,
            recommendedMinWeight=1, recommendedMaxWeight=5,
        ),
    )


def _scenario_m() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-joint",
        title="Joint Optimization Beats Either Dimension Alone",
        topic="TRAFFIC_ENGINEERING",
        network=wpo_limited_topology(),
        algorithm_config=_sr_config(),
        prompt="Open the Optimization Lab. Run WPO alone (MLU=3.333 — a real single-waypoint limit). Then run Joint (MLU=1.0) — optimizing weights and waypoints together escapes WPO's own structural limit.",
        meta=DemoScenarioMeta(
            category="Optimization", order=5,
            shortDescription="WPO alone caps out at MLU=3.333 due to its one-waypoint-per-demand limit; Joint optimization reaches MLU=1.0.",
            complexity="Advanced", recommended=True,
            tags=["optimization", "joint"],
            optimizationMode="JOINT", recommendedBudget=50000,
        ),
    )


def _scenario_n() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-exact-vs-heuristic-wpo",
        title="WPO: Exact vs. Heuristic Search",
        topic="TRAFFIC_ENGINEERING",
        network=wpo_order_dependent_topology(),
        algorithm_config=_sr_config(),
        prompt="Open the Optimization Lab, select Waypoint Optimization. First set the search budget to 1 (below the 9-combination search space) and Run — GREEDY_WPO, not proven optimal. Then raise the budget above 9 and Run again — EXACT_ENUMERATION, proven optimal.",
        meta=DemoScenarioMeta(
            category="Optimization Complexity", order=1,
            shortDescription="A 9-combination search space: below-threshold budget forces GREEDY_WPO, above-threshold restores EXACT_ENUMERATION with a proof.",
            complexity="Advanced",
            tags=["optimization", "wpo", "exact-vs-heuristic"],
            optimizationMode="WPO", recommendedBudget=1, alternateBudget=50000,
        ),
    )


def _scenario_o() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-exact-vs-heuristic-lwo",
        title="LWO: Where the Heuristic Gets Stuck",
        topic="TRAFFIC_ENGINEERING",
        network=detour_topology(),
        algorithm_config=_ecmp_config(),
        prompt="Open the Optimization Lab, select Link Weight Optimization. First set the search budget to 1 and Run — HEURISTIC_LWO gets stuck at the baseline (MLU=1.6, no improvement found). Then raise the budget above 25 and Run again — EXACT_ENUMERATION finds MLU=0.8.",
        meta=DemoScenarioMeta(
            category="Optimization Complexity", order=2,
            shortDescription="A genuine local optimum: the single-move heuristic gets stuck at the baseline while exact search finds a real improvement (1.6 -> 0.8).",
            complexity="Advanced", recommended=True,
            tags=["optimization", "lwo", "exact-vs-heuristic", "local-optimum"],
            optimizationMode="LWO", recommendedBudget=1, alternateBudget=50000,
            recommendedMinWeight=1, recommendedMaxWeight=5,
        ),
    )


def _scenario_p() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-joint-search-budget",
        title="Joint Search Budget: Why It Grows Fast",
        topic="TRAFFIC_ENGINEERING",
        network=wpo_limited_topology(),
        algorithm_config=_sr_config(),
        prompt="Open the Optimization Lab, select Joint Optimization. The search-space preview shows 312,500 combinations. At the default 50,000 budget it predicts HEURISTIC (JOINT_ALTERNATING). Raise the budget to 350,000 (still well under the safety cap) — the preview flips to EXACT SEARCH AVAILABLE (EXACT_JOINT_ENUMERATION, a few seconds).",
        meta=DemoScenarioMeta(
            category="Optimization Complexity", order=3,
            shortDescription="Combined waypoint x weight search space (312,500) exceeds the default budget; raising it (still safely under the cap) unlocks an exact, provably-optimal search.",
            complexity="Advanced",
            tags=["optimization", "joint", "search-budget"],
            optimizationMode="JOINT", recommendedBudget=50000, alternateBudget=350000,
        ),
    )


DEMO_SCENARIO_BUILDERS = [
    _scenario_a, _scenario_b, _scenario_c, _scenario_d,
    _scenario_e, _scenario_f, _scenario_g, _scenario_h,
    _scenario_i, _scenario_j, _scenario_k, _scenario_l,
    _scenario_m, _scenario_n, _scenario_o, _scenario_p,
]


def build_demo_scenarios() -> List[Assignment]:
    """Construct all 16 demo scenarios fresh. Pure — no I/O, no MongoDB.

    These are the ORIGINAL Sprint 1/2 scenarios — kept exactly as-is and
    still exercised directly by test_demo_scenarios.py's Section A (one
    verified teaching-claim test per scenario). Per instructor feedback,
    none of these are shown on the student-facing Demo Scenario Dashboard
    any more (see CURATED_DEMO_SCENARIO_BUILDERS below) — they remain here
    purely as validated backend/test fixtures, not dead code.
    """
    return [builder() for builder in DEMO_SCENARIO_BUILDERS]


# ── The curated, course-aligned Demo Scenario Pack ──────────────────────────
#
# Per final instructor feedback, the student-facing Demo Student dashboard
# was cut from the 16 scenarios above down to exactly these 4 — one per
# distinct capability (ECMP weight-setting, Segment Routing waypoints,
# Distance Vector, TE policy), each mapping directly to a step in the
# course/tutorial workflow. This is a SEPARATE builder list, not a filter
# over DEMO_SCENARIO_BUILDERS: the 16 above stay fully intact as backend/
# test fixtures (per instruction, "do NOT delete backend test fixtures or
# teaching examples"); only what MongoDB seeds for GET /demo-scenarios
# changed. See demo_scenario_service.seed_demo_scenarios() for how a reseed
# also prunes any stale demoScenario-tagged document left over from the old
# 16-scenario pack.


def _positioned_net(node_positions, links, demands, topology_type="custom", is_directed=False) -> NetworkInput:
    """Like `_net()`, but with explicit, hand-placed (x, y) coordinates
    instead of the shared (0, 0) placeholder. Used only where the on-screen
    layout is itself part of the teaching content (see
    `inet_exercise2_network()`'s diamond, matching the exercise sheet's own
    figure) — this bypasses the frontend's circular auto-layout fallback
    (`generatedTopologies.ts`'s `applyAutoLayout`/`ensureUsableNodeLayout`)
    entirely, rather than depending on node array order coincidentally
    producing the right shape.
    """
    return NetworkInput(
        nodes=[NodeInput(id=n, label=n, x=x, y=y) for n, x, y in node_positions],
        links=links,
        demands=demands,
        topologyType=topology_type,
        isDirected=is_directed,
    )


def _dv_config(**overrides) -> AlgorithmConfig:
    base = dict(
        selectedAlgorithm="DISTANCE_VECTOR", algorithmType="real_world_heuristic",
        objective="minimize_max_utilization", congestionThreshold=1.0,
    )
    base.update(overrides)
    return AlgorithmConfig(**base)


# ── 1. INET Exercise 2 — ECMP Weight Setting ────────────────────────────────


def inet_exercise2_network() -> NetworkInput:
    """The A/B/C/D diamond-with-diagonal from "INET Network Algorithms —
    Exercise 2" (ECMP weight setting). Node positions are hand-placed to
    match the exercise sheet's own figure (B top, A left, D right, C
    bottom, with B-C as the vertical diagonal) rather than relying on the
    frontend's circular auto-layout fallback, so the on-screen shape stays
    recognizable regardless of node array order.

    Weights A-C=1, B-C=1, C-D=1, B-D=2 are exactly the exercise sheet's own
    values. The sheet only constrains A-B to "greater than 2" (so it never
    competes with the B-C-D detour) without giving one single canonical
    number in the source material available here; 3 is used as the
    concrete representative value — documented here rather than silently
    invented as if it were the one true number from the sheet.

    All capacities are 10, per the exercise. Demands: B->D=15, A->D=5 —
    single destination D. Verified live against the real ECMPAlgorithm
    (see test_curated_demo_scenarios.py's Exercise 2 section): baseline
    ties B-D against B-C-D (both cost 2), congesting C-D at 125%; taking
    B-C down removes that tie, forcing all of B->D onto B-D alone and
    moving/worsening the congestion (150%) instead of relieving it — a
    genuine, backend-verified feasibility/congestion change, not a
    hardcoded frontend guess.
    """
    return _positioned_net(
        [("B", 350, 150), ("A", 240, 260), ("D", 460, 260), ("C", 350, 370)],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=3),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=2),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [
            TrafficDemandInput(id="bd", source="B", target="D", amount=15.0),
            TrafficDemandInput(id="ad", source="A", target="D", amount=5.0),
        ],
    )


def _curated_inet_exercise2() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-inet-ex2-ecmp",
        title="INET Exercise 2 — ECMP Weight Setting",
        topic="ECMP",
        network=inet_exercise2_network(),
        algorithm_config=_ecmp_config(),
        prompt=(
            "Run ECMP with the exercise's own starting weights. Try changing link weights and "
            "rerunning to see how utilization responds. Then take link B-C down and rerun to see "
            "how losing that path changes congestion. When ready, open the Optimization Lab and "
            "try OPT, Waypoint, Link Weight, or Joint optimization on the same network."
        ),
        meta=DemoScenarioMeta(
            category="Demo Scenarios", order=1,
            shortDescription="Explore the ECMP weight-setting exercise from the course sheet and see how weight choices affect congestion.",
            complexity="Intermediate",
            tags=["ecmp", "inet-exercise", "weight-setting"],
            courseSource="INET Network Algorithms — Exercise 2",
        ),
    )


# ── 2. Segment Routing — Waypoint Exploration ───────────────────────────────


def sr_waypoint_exploration_network() -> NetworkInput:
    """Same verified topology/weights/capacities as `sr_waypoint_ecmp_network()`
    (A->D via required waypoint C, both legs tied — see that function's own
    docstring for the source citation), laid out explicitly as an hourglass
    (A on the left, two parallel first-hop routers, C as the waypoint in
    the middle, two parallel second-hop routers, D on the right) instead of
    the frontend's circular fallback.
    """
    return _positioned_net(
        [
            ("A", 120, 260), ("B", 260, 150), ("E", 260, 370),
            ("C", 380, 260),
            ("F", 500, 150), ("G", 500, 370), ("D", 640, 260),
        ],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=1),
            LinkInput(id="BC", source="B", target="C", capacity=10, weight=1),
            LinkInput(id="AE", source="A", target="E", capacity=10, weight=1),
            LinkInput(id="EC", source="E", target="C", capacity=10, weight=1),
            LinkInput(id="CF", source="C", target="F", capacity=10, weight=1),
            LinkInput(id="FD", source="F", target="D", capacity=10, weight=1),
            LinkInput(id="CG", source="C", target="G", capacity=10, weight=1),
            LinkInput(id="GD", source="G", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def _curated_sr_waypoint_exploration() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-sr-waypoint",
        title="Segment Routing — Waypoint Exploration",
        topic="SEGMENT_ROUTING",
        network=sr_waypoint_exploration_network(),
        algorithm_config=_sr_config(
            segmentRoutingPolicies=[SegmentRoutingPolicy(demandId="d1", segments=["C"])]
        ),
        prompt="Run Segment Routing. Then choose a different waypoint and rerun to see how the path and its ECMP split change.",
        meta=DemoScenarioMeta(
            category="Demo Scenarios", order=2,
            shortDescription="Explore how waypoint choices steer traffic through the network.",
            complexity="Intermediate",
            tags=["segment-routing", "waypoint"],
        ),
    )


# ── 3. Distance Vector — Routing Change ─────────────────────────────────────


def dv_routing_change_network() -> NetworkInput:
    """S/M1/M2/M3/Z: a 2-hop path (S-M1-Z, cost 2) that is strictly (not a
    tie) shorter than a 3-hop detour (S-M2-M3-Z, cost 3) — so Distance
    Vector's initial next hop from S is unambiguous (M1). Raising M1-Z's
    weight from 1 to 4 (student-editable — canEditWeights is always True
    for demo scenarios) makes the direct route cost 5, flipping the
    resolved shortest path — and S's next hop — onto the detour (cost 3,
    via M2); a link failure on S-M1 or M1-Z produces the same reroute by
    forcing the issue instead of costing it out. Verified live against the
    real DistanceVectorAlgorithm (see test_curated_demo_scenarios.py).

    Per DistanceVectorAlgorithm's own "instant stable" design (see its
    module docstring/first trace event), this models a single fresh
    recomputation after the change — not simulated round-by-round
    Bellman-Ford convergence, which this codebase does not implement.
    """
    return _positioned_net(
        [("S", 150, 260), ("M1", 320, 180), ("Z", 560, 260), ("M2", 320, 340), ("M3", 440, 340)],
        [
            LinkInput(id="S-M1", source="S", target="M1", capacity=10, weight=1),
            LinkInput(id="M1-Z", source="M1", target="Z", capacity=10, weight=1),
            LinkInput(id="S-M2", source="S", target="M2", capacity=10, weight=1),
            LinkInput(id="M2-M3", source="M2", target="M3", capacity=10, weight=1),
            LinkInput(id="M3-Z", source="M3", target="Z", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="S", target="Z", amount=6.0)],
    )


def _curated_dv_routing_change() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-dv-routing-change",
        title="Distance Vector — Routing Change",
        topic="DISTANCE_VECTOR",
        network=dv_routing_change_network(),
        algorithm_config=_dv_config(),
        prompt="Run Distance Vector to see the initial resolved route. Then raise a link's weight (or take a link down) and rerun to see the route — and next hop — change.",
        meta=DemoScenarioMeta(
            category="Demo Scenarios", order=3,
            shortDescription="See how routing changes when the network topology or link costs change.",
            complexity="Beginner",
            tags=["distance-vector", "routing-change"],
        ),
    )


# ── 4. Traffic Engineering Policy — Interactive Routing ─────────────────────


def te_policy_interactive_network() -> NetworkInput:
    """Same verified topology/weights/capacities as `te_prefer_diamond_network()`
    (A-B weighted 2, so A-C-D alone is the baseline shortest path — see that
    function's own docstring for its test-file source), laid out explicitly
    (A left, C top on the baseline path, D right, B bottom on the
    currently-unused alternate) instead of the frontend's circular
    fallback.
    """
    return _positioned_net(
        [("A", 240, 260), ("C", 350, 150), ("D", 460, 260), ("B", 350, 370)],
        [
            LinkInput(id="AB", source="A", target="B", capacity=10, weight=2),
            LinkInput(id="BD", source="B", target="D", capacity=10, weight=1),
            LinkInput(id="AC", source="A", target="C", capacity=10, weight=1),
            LinkInput(id="CD", source="C", target="D", capacity=10, weight=1),
        ],
        [TrafficDemandInput(id="d1", source="A", target="D", amount=10.0)],
    )


def _curated_te_policy_interactive() -> Assignment:
    return _demo_assignment(
        assignment_id="demo-te-policy-interactive",
        title="Traffic Engineering Policy — Interactive Routing",
        topic="TRAFFIC_ENGINEERING",
        network=te_policy_interactive_network(),
        algorithm_config=_ecmp_config(),
        prompt=(
            "Run ECMP to see the baseline route (A-C-D). Then add a FORBID_LINK policy on A-C "
            "from the graph — or try AVOID_LINK/PREFER_LINK — and rerun to see traffic move to "
            "the alternate route. The forbidden/avoided link stays visible on the canvas; this is "
            "not the same as a physical link failure."
        ),
        meta=DemoScenarioMeta(
            category="Demo Scenarios", order=4,
            shortDescription="Apply routing policies and observe how traffic moves without changing the physical topology.",
            complexity="Intermediate",
            tags=["te-policy", "forbid-link"],
        ),
    )


CURATED_DEMO_SCENARIO_BUILDERS = [
    _curated_inet_exercise2,
    _curated_sr_waypoint_exploration,
    _curated_dv_routing_change,
    _curated_te_policy_interactive,
]


def build_curated_demo_scenarios() -> List[Assignment]:
    """Construct the 4 curated, student-facing demo scenarios fresh. Pure —
    no I/O, no MongoDB. This is what `seed_demo_scenarios()` seeds and what
    GET /demo-scenarios ultimately reflects — the Demo Student dashboard's
    entire scenario list, not a subset of a larger visible set.
    """
    return [builder() for builder in CURATED_DEMO_SCENARIO_BUILDERS]
