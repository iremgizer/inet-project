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
    """Construct all 16 demo scenarios fresh. Pure — no I/O, no MongoDB."""
    return [builder() for builder in DEMO_SCENARIO_BUILDERS]
