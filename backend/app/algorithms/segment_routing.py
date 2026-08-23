"""Segment Routing V1 — waypoint-based routing, ECMP-within-segments (PR0).

Educational abstraction, deliberately NOT modeling SR-MPLS control-plane
mechanics (no label stacks, no push/swap/pop, no LDP/RSVP-TE signaling).

Semantics: a demand may carry an ordered list of waypoint node ids
(`SegmentRoutingPolicy.segments`). The resolved route concatenates the legs
source → first waypoint, waypoint → next waypoint, ..., last waypoint →
destination — under the network's current link weights. A waypoint only
constrains *which* nodes are visited; the path *between* waypoints is still
ordinary shortest-path routing. An empty (or missing) segment list means
plain shortest-path routing between source and destination directly (one leg).

PR0 change (was: single arbitrary shortest path per leg): for every leg, ALL
equal-cost shortest paths are found and the traffic arriving at that leg's
source is split evenly across them (`app.utils.routing_helpers.
compute_ecmp_leg_distribution`) — the same equal-cost-path-discovery and
equal-split primitives ECMP itself uses. A leg with only one shortest path
behaves exactly as before (no observable change). This makes Segment
Routing's routing model "waypoint constraints + ECMP between consecutive
segment endpoints" — matching the routing model used by Parham, Fenz, Süss,
Foerster, Schmid, "Traffic Engineering with Joint Link Weight and Segment
Optimization" (ACM CoNEXT '21), see
`docs/research/sprint2-mip-architecture-analysis.md`.

Flow semantics (important, see the module's tests for worked examples): the
full demand amount is present at *every* waypoint — an earlier leg's ECMP
split among several paths does not reduce the total; those paths converge
back at the waypoint, and the *next* leg's ECMP split starts fresh from that
same full amount. This is NOT "split the original demand independently and
identically at every leg" — it is "the aggregate traffic re-mixes fully at
each waypoint" (the standard ECMP assumption: a split decision depends only
on the outgoing links available at that hop, never on which upstream path a
unit of flow arrived by). Concretely, for a demand of 10 units through one
waypoint C, with 2 equal-cost paths on each side: A-B and A-E each carry 5
(the A→C leg's split), and independently C-F and C-G each carry 5 (the C→D
leg's split) — never 2.5 unless you are looking at one specific *end-to-end*
path combination (see below).

`PathResult` representation: Sprint 1's existing `PathShare` model already
supports multiple entries per demand (ECMP has always used exactly this for
its own equal-cost splits), so this file materializes the full end-to-end
Cartesian product of leg paths as one `PathShare` per combination, each
carrying `nodes` as a complete source-to-destination sequence — this is what
lets every piece of *existing*, algorithm-agnostic code that walks
`pathResults[].paths[].nodes` (node-role bookkeeping, the link usage
inspector, Before/After route-change comparison, `path_uses_link` for
mid-simulation failure recompute) keep working unmodified. A combination's
`trafficShare` is the product of its constituent legs' fractional shares
times the demand amount — see `_materialize_path_shares` for the exact
computation and why it is conservative (sums to the demand amount) by
construction.

Custom/weighted splitting is deliberately NOT supported here yet (PR0 is
equal-split only, matching ECMP's own pre-PR3 baseline) — see
`app.models.TrafficDistribution` for that concept, not extended to Segment
Routing in this PR.
"""
import itertools
import time
from typing import Dict, List, Tuple

import networkx as nx

from app.models import (
    AlgorithmConfig,
    LinkResult,
    NetworkInput,
    PathResult,
    PathShare,
    SegmentRoutingPolicy,
    SimulationResult,
    SimulationTraceEvent,
    TrafficDemandInput,
)
from app.utils.failure_schedule import FailureScheduler
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics
from app.utils.routing_helpers import (
    EcmpLegDistribution,
    build_node_roles,
    cap_trace,
    compute_ecmp_leg_distribution,
    path_cost_calculation,
    path_link_ids,
    path_total_weight,
    path_uses_link,
    sanitize_segments,
)
from app.utils.te_policy import build_demand_policy_graph, combined_waypoints_for_demand

SR_PATH_COLOR = "#0d7d7a"


class SegmentRoutingAlgorithm:
    @staticmethod
    def run(network: NetworkInput, config: AlgorithmConfig) -> SimulationResult:
        start = time.time()
        graph, link_map = GraphBuilder.build_graph(network)
        node_ids = {node.id for node in network.nodes}

        policy_by_demand: Dict[str, SegmentRoutingPolicy] = {
            p.demandId: p for p in config.segmentRoutingPolicies
        }

        path_results: List[PathResult] = []
        link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
        trace_events: List[SimulationTraceEvent] = []
        debug: List[str] = []
        step = 1

        # ── Scheduled mid-simulation failures (PR 6) — see
        #    app/utils/failure_schedule.py for the full timing model. Empty
        #    schedule => scheduler.due() always returns [] => byte-identical
        #    to the PR 1-5 baseline below.
        scheduler = FailureScheduler(config.failureSchedule)

        # ── Link failure (PR 5) — global, not per-demand. GraphBuilder has
        #    already excluded any DOWN link from `graph` above, so every
        #    demand's segment resolution below automatically recomputes
        #    around it with no further changes; this is purely an
        #    explanatory trace note. ──────────────────────────────────────
        down_link_ids = GraphBuilder.down_link_ids(network)
        if down_link_ids:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="LINK_FAILURE",
                title="Link failure",
                description=f"{len(down_link_ids)} link(s) are down and excluded from routing: {', '.join(down_link_ids)}.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. Segment Routing resolves each leg as if the link were removed from the graph.",
                highlightedLinks=down_link_ids,
            ))
            step += 1

        for demand in network.demands:
            if demand.source == demand.target:
                debug.append(f"Demand {demand.id} source equals target; skipping")
                continue
            if demand.source not in graph or demand.target not in graph:
                debug.append(f"Demand {demand.id} references unknown endpoint")
                path_results.append(PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[]))
                continue

            step, path_shares, reachable = SegmentRoutingAlgorithm._route_demand(
                demand, graph, link_map, node_ids, policy_by_demand, config, link_loads, step, trace_events, debug,
            )
            path_results.append(PathResult(
                demandId=demand.id, source=demand.source, target=demand.target,
                paths=path_shares if reachable else [],
            ))
            if reachable:
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="COMPLETE_DEMAND",
                    title="Demand complete",
                    description=f"Demand {demand.id} routing complete.",
                    explanationText="All segments were resolved and traffic was placed on the final route.",
                    activeDemandId=demand.id,
                ))
                step += 1

            # ── Scheduled mid-simulation failures (PR 6) — checked once this
            #    demand's own trace steps have all been emitted. No-op when
            #    the schedule is empty. See app/utils/failure_schedule.py. ──
            step = SegmentRoutingAlgorithm._apply_due_failures(
                scheduler, step, graph, link_map, network, node_ids, policy_by_demand, config,
                path_results, link_loads, trace_events, debug,
            )

        # Catch a trigger step scheduled at/after the last demand's own
        # steps (or a schedule with zero demands) — see test H.
        step = SegmentRoutingAlgorithm._apply_due_failures(
            scheduler, step, graph, link_map, network, node_ids, policy_by_demand, config,
            path_results, link_loads, trace_events, debug,
        )
        if scheduler.has_pending:
            # Deterministic, not a bug: a trigger step beyond the last trace
            # step this run ever reaches simply never becomes due. Documented
            # rather than silent.
            debug.append(
                "One or more scheduled failures had a trigger step beyond this simulation's last trace "
                "step and were never applied."
            )

        link_results: List[LinkResult] = []
        for link in network.links:
            load = link_loads.get(link.id, 0.0)
            utilization = load / link.capacity if link.capacity > 0 else 0.0
            link_results.append(LinkResult(
                linkId=link.id,
                source=link.source,
                target=link.target,
                load=round(load, 6),
                capacity=link.capacity,
                utilization=round(utilization, 6),
                isCongested=utilization > config.congestionThreshold,
                weight=link.weight,
            ))
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="COMPUTE_LINK_UTILIZATION",
                title="Compute link utilization",
                description=f"Link {link.id} load {round(load, 6)} over capacity {link.capacity}.",
                explanationText="Utilization is continuous traffic load divided by link capacity.",
                highlightedNodes=[link.source, link.target],
                highlightedLinks=[link.id],
                currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                formulaText=f"utilization({link.id}) = {round(load, 6)} / {link.capacity} = {round(utilization, 6)}",
            ))
            step += 1

        node_roles = build_node_roles(network, path_results)
        metrics = Metrics.compute_summary(path_results, link_results)
        congested_links = [link.linkId for link in link_results if link.isCongested]

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="DETECT_CONGESTION",
            title="Detect congestion",
            description=f"{len(congested_links)} link(s) exceed threshold {config.congestionThreshold}.",
            explanationText="A link is congested when utilization exceeds the configured threshold.",
            highlightedLinks=congested_links,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            formulaText="isCongested = utilization > congestionThreshold",
        ))
        step += 1

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="FINAL_SUMMARY",
            title="Final summary",
            description="Segment Routing simulation complete.",
            explanationText="The final result aggregates resolved routes, link loads, utilizations, congestion, and summary metrics.",
            highlightedLinks=congested_links,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            metadata=metrics,
        ))

        runtime = (time.time() - start) * 1000.0
        return SimulationResult(
            algorithm="SEGMENT_ROUTING",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
            traceEvents=cap_trace(trace_events, config.maxTraceEvents),
            maxUtilization=metrics["maxUtilization"],
            totalDeliveredTraffic=metrics["totalDeliveredTraffic"],
            averagePathCost=metrics["averagePathCost"],
            congestedLinkCount=metrics["congestedLinkCount"],
            runtimeMs=round(runtime, 2),
            debugInfo=debug,
        )

    @staticmethod
    def _route_demand(
        demand: TrafficDemandInput,
        graph: "nx.Graph",
        link_map: Dict[tuple, object],
        node_ids: set,
        policy_by_demand: Dict[str, SegmentRoutingPolicy],
        config: AlgorithmConfig,
        link_loads: Dict[str, float],
        step: int,
        trace_events: List[SimulationTraceEvent],
        debug: List[str],
    ) -> Tuple[int, List[PathShare], bool]:
        """Resolves and places traffic for one demand's Segment Routing
        route — waypoint list, TE-policy application, per-leg ECMP-aware
        path resolution, and traffic placement — mutating `link_loads` in
        place exactly as the original inline loop body always did.

        Factored out of `run()` so the exact same logic can run twice for
        the same demand: once for its original route, and again (PR 6, see
        `_apply_due_failures` below) to recompute it after a scheduled
        mid-simulation failure, against the same `graph` object with the
        failed link's edge already removed. The waypoint list itself is
        never touched by a failure — only the ECMP path set *between*
        waypoints is recomputed (fewer/different equal-cost paths, or none —
        see PR0's ECMP-within-segments semantics in the module docstring),
        so a reroute still visits the same stops and only fails if a
        waypoint or the destination becomes genuinely unreachable. Returns
        `(next_step, path_shares, reachable)` — `path_shares` may contain
        more than one entry (see `_materialize_path_shares`).
        """
        policy = policy_by_demand.get(demand.id)
        raw_segments = policy.segments if policy else []
        explicit_segments = sanitize_segments(raw_segments, demand.source, demand.target)

        # ── Traffic Engineering policies — no-op (same graph object, zero
        #    cost) when config.tePolicies is empty or none apply to this
        #    demand. See app/utils/te_policy.py. ─────────────────────────
        policy_result = build_demand_policy_graph(graph, link_map, demand.id, config.tePolicies)
        demand_graph = policy_result.graph
        # Deterministic combination: explicit SegmentRoutingPolicy segments
        # first (in their existing order), then any REQUIRE_WAYPOINT policy
        # waypoints appended after them — see combined_waypoints_for_demand.
        segments = sanitize_segments(
            combined_waypoints_for_demand(explicit_segments, policy_result), demand.source, demand.target
        )
        stops = segments + [demand.target]

        # ── Nonexistent waypoint — clear, non-crashing per-demand failure ──
        unknown = [seg for seg in segments if seg not in node_ids]
        if unknown:
            debug.append(
                f"Demand {demand.id}: unknown waypoint node id(s) {unknown} — skipping demand"
            )
            return step, [], False

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="START_DEMAND",
            title="Start demand",
            description=f"Demand {demand.id}: {demand.source} to {demand.target}, amount {demand.amount}.",
            explanationText="Segment Routing steers traffic through an ordered list of waypoints. Between waypoints, traffic follows ECMP — all equal-cost shortest paths, split evenly — under the current link weights.",
            highlightedNodes=[demand.source, demand.target],
            activeDemandId=demand.id,
        ))
        step += 1

        if policy_result.has_effect:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="APPLY_TE_POLICY",
                title="Apply traffic engineering policies",
                description=policy_result.describe(),
                explanationText="Traffic engineering policies adjust which links Segment Routing may use between waypoints and their effective routing cost. The physical link cost shown elsewhere never changes.",
                highlightedNodes=[demand.source, demand.target],
                highlightedLinks=policy_result.excluded_link_ids + [a["linkId"] for a in policy_result.cost_adjustments],
                activeDemandId=demand.id,
                metadata={
                    "excludedLinkIds": policy_result.excluded_link_ids,
                    "costAdjustments": policy_result.cost_adjustments,
                    "requiredWaypointNodeIds": policy_result.required_waypoint_node_ids,
                    "ignoredPolicyIds": policy_result.ignored_policy_ids,
                },
            ))
            step += 1

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="LOAD_SEGMENT_LIST",
            title="Load segment list",
            description=(
                f"Segment list for {demand.id}: {' -> '.join(stops)}."
                if segments else
                f"Segment list for {demand.id}: (none) — direct ECMP routing to {demand.target}."
            ),
            explanationText="Each stop is a waypoint the route must pass through, in order, before reaching the final destination.",
            highlightedNodes=stops,
            activeDemandId=demand.id,
            segmentList=stops,
        ))
        step += 1

        # ── Resolve every leg's ECMP distribution BEFORE narrating or
        #    accounting for any of them: if any leg is unreachable, the whole
        #    demand is unreachable, and nothing partial (from legs that
        #    happened to resolve before the failing one) should be added to
        #    link_loads or shown in the trace — conservation requires a
        #    failed demand to deliver (and therefore add) exactly zero
        #    traffic, never a leftover partial amount. ────────────────────
        waypoints = [demand.source] + segments + [demand.target]
        leg_distributions: List[EcmpLegDistribution] = []
        for i in range(len(waypoints) - 1):
            try:
                leg_distributions.append(
                    compute_ecmp_leg_distribution(
                        demand_graph, link_map, waypoints[i], waypoints[i + 1], demand.amount,
                    )
                )
            except nx.NetworkXNoPath:
                debug.append(
                    f"Demand {demand.id}: no path found between waypoints in the segment list"
                )
                return step, [], False
            except nx.NodeNotFound as exc:
                debug.append(f"Demand {demand.id}: {exc}")
                return step, [], False

        # ── All legs resolved — narrate and account for them in order. ────
        for i, dist in enumerate(leg_distributions):
            leg_source, leg_target = waypoints[i], waypoints[i + 1]

            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="SELECT_ACTIVE_SEGMENT",
                title=f"Select active segment: {leg_target}",
                description=f"Routing from {leg_source} toward waypoint {leg_target}.",
                explanationText="Each segment routes toward its waypoint using ECMP under current link weights.",
                highlightedNodes=[leg_source, leg_target],
                activeDemandId=demand.id,
                activeNodeId=leg_source,
                activeDestinationId=leg_target,
                activeSegmentIndex=i,
                segmentList=stops,
            ))
            step += 1

            path_count_text = (
                "1 shortest path" if len(dist.paths) == 1 else f"{len(dist.paths)} equal-cost shortest paths"
            )
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="COMPUTE_SEGMENT_PATH",
                title=f"Compute path to {leg_target}",
                description=f"Found {path_count_text} from {leg_source} to {leg_target}.",
                explanationText="Path cost is the sum of link weights along a segment. When several paths tie for the minimum cost, Segment Routing now treats them exactly like ECMP: all of them carry traffic.",
                highlightedNodes=list({node for path in dist.paths for node in path}),
                highlightedLinks=list({lid for path in dist.paths for lid in path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                activeDestinationId=leg_target,
                activeSegmentIndex=i,
                segmentList=stops,
                costCalculation="\n".join(path_cost_calculation(path, link_map) for path in dist.paths),
                pathGroupId=f"sr-{demand.id}-leg{i}",
                pathColor=SR_PATH_COLOR,
                metadata={"pathCount": len(dist.paths)},
            ))
            step += 1

            if len(dist.paths) > 1:
                pct = f"{100.0 / len(dist.paths):g}%"
                breakdown = "\n".join(
                    f"Path {j + 1} ({pct}): {demand.amount:g} / {len(dist.paths)} = {round(share, 6):g}"
                    for j, share in enumerate(dist.shares)
                )
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="SEGMENT_ECMP_SPLIT",
                    title="Split traffic across equal-cost paths",
                    description=(
                        f"{demand.amount:g} units split equally across {len(dist.paths)} paths: "
                        + " / ".join(f"{round(share, 6):g}" for share in dist.shares) + "."
                    ),
                    explanationText="Just like plain ECMP, the traffic arriving at this segment's source splits evenly across every equal-cost path toward the segment's target.",
                    highlightedNodes=[leg_source, leg_target],
                    activeDemandId=demand.id,
                    activeDestinationId=leg_target,
                    activeSegmentIndex=i,
                    segmentList=stops,
                    formulaText=breakdown,
                    pathGroupId=f"sr-{demand.id}-leg{i}",
                    pathColor=SR_PATH_COLOR,
                ))
                step += 1

            # This leg's contribution to the running totals — computed once
            # by `compute_ecmp_leg_distribution` above; the per-path events
            # below are purely descriptive of work already accounted for
            # here, never a second source of truth for the load numbers.
            for link_id, leg_amount in dist.link_loads.items():
                link_loads[link_id] += leg_amount

            for path_index, (path, share) in enumerate(zip(dist.paths, dist.shares)):
                delta: Dict[str, float] = {}
                for u, v in zip(path, path[1:]):
                    edge_link = link_map.get((u, v))
                    if edge_link:
                        delta[edge_link.id] = round(delta.get(edge_link.id, 0.0) + share, 6)
                path_label = f" (Path {path_index + 1})" if len(dist.paths) > 1 else ""
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="ADD_TRAFFIC_TO_LINK",
                    title="Add traffic to segment path",
                    description=f"Added {round(share, 6):g} units on {' -> '.join(path)}{path_label}.",
                    explanationText="Each equal-cost path in this segment contributes its share to every link along it.",
                    highlightedNodes=path,
                    highlightedLinks=path_link_ids(path, link_map),
                    activeDemandId=demand.id,
                    activeSegmentIndex=i,
                    segmentList=stops,
                    pathGroupId=f"sr-{demand.id}-leg{i}",
                    pathColor=SR_PATH_COLOR,
                    linkLoadDelta=delta,
                    currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                ))
                step += 1

            if i < len(leg_distributions) - 1:
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="ADVANCE_TO_NEXT_SEGMENT",
                    title=f"Reach segment: {leg_target}",
                    description=f"Waypoint {leg_target} reached — advancing to the next segment.",
                    explanationText="The waypoint is marked complete and the next segment becomes active. All ECMP branches from the previous segment converge here before the next segment's split (if any) begins.",
                    highlightedNodes=[leg_target],
                    activeDemandId=demand.id,
                    activeSegmentIndex=i,
                    segmentList=stops,
                ))
                step += 1

        path_shares = SegmentRoutingAlgorithm._materialize_path_shares(leg_distributions, demand.amount, link_map)

        # Same "route: cost = ..." shape `path_cost_calculation` already uses
        # elsewhere (ECMP's candidate-paths step, this file's own
        # COMPUTE_SEGMENT_PATH above) — the frontend's `parseCostCalcLines`
        # splits on ": cost =", so keeping the same convention here lets it
        # render this multi-route summary with the same list styling with no
        # bespoke parsing.
        combo_lines = "\n".join(
            f"{' -> '.join(ps.nodes)}: cost = {ps.cost:g}, share = {round(ps.trafficShare, 6):g} units"
            for ps in path_shares
        )
        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="FINAL_ROUTE_RESOLVED",
            title="Final route resolved",
            description=(
                f"Demand {demand.id} resolved into {len(path_shares)} end-to-end route(s)."
                if len(path_shares) > 1 else
                f"Demand {demand.id} resolved route: {' -> '.join(path_shares[0].nodes)}."
            ),
            explanationText="Each end-to-end route concatenates one path per segment, sharing waypoint nodes rather than repeating them. Its traffic share is the product of each segment's own ECMP share.",
            highlightedNodes=list({node for ps in path_shares for node in ps.nodes}),
            highlightedLinks=list({lid for ps in path_shares for lid in path_link_ids(ps.nodes, link_map)}),
            activeDemandId=demand.id,
            costCalculation=combo_lines,
            segmentList=stops,
            pathGroupId=f"sr-{demand.id}",
            pathColor=SR_PATH_COLOR,
        ))
        step += 1

        return step, path_shares, True

    @staticmethod
    def _materialize_path_shares(
        leg_distributions: List[EcmpLegDistribution],
        amount: float,
        link_map: Dict[tuple, object],
    ) -> List[PathShare]:
        """Expands the leg-by-leg ECMP distributions into full end-to-end
        `PathShare` routes — the Cartesian product of each leg's equal-cost
        path set, weighted by the product of each leg's fractional share.

        This assumes traffic re-mixes fully at each waypoint (the standard
        ECMP "memoryless" assumption: a split decision depends only on the
        outgoing links available at that hop, never on which upstream path a
        unit of flow arrived by) — so a combination's absolute share is
        `amount * Π(leg_share / amount)` over its legs. With `amount == 0`
        every combination trivially carries zero traffic (no division).

        Deterministically sorted by full node sequence (matching every other
        stable-path-id convention in this codebase — see
        `resolve_equal_cost_paths`) before `pathId`s are assigned, so the
        same topology/weights/demand always produces the same ordered
        combination list.

        A demand with several waypoints, each with several equal-cost
        alternatives, produces a combination count that multiplies across
        legs (2 legs x 3 paths each = 9) — exact, not an approximation, but
        worth knowing: this can grow quickly for a topology with many
        simultaneous ties across many segments. Fine for the small teaching
        topologies this project targets; a known limitation for pathological
        cases (see the PR0 final report).
        """
        if not leg_distributions:
            return []

        combo_lists = [list(zip(dist.paths, dist.shares)) for dist in leg_distributions]
        raw_combos: List[Tuple[List[str], float]] = []
        for combo in itertools.product(*combo_lists):
            full_path: List[str] = [combo[0][0][0]]
            for leg_path, _ in combo:
                full_path.extend(leg_path[1:])
            if amount == 0:
                share = 0.0
            else:
                fraction = 1.0
                for _, leg_share in combo:
                    fraction *= leg_share / amount
                share = fraction * amount
            raw_combos.append((full_path, share))

        raw_combos.sort(key=lambda item: item[0])
        return [
            PathShare(nodes=nodes, cost=path_total_weight(nodes, link_map), trafficShare=share, pathId=f"path-{i + 1}")
            for i, (nodes, share) in enumerate(raw_combos)
        ]

    @staticmethod
    def _apply_due_failures(
        scheduler: FailureScheduler,
        step: int,
        graph: "nx.Graph",
        link_map: Dict[tuple, object],
        network: NetworkInput,
        node_ids: set,
        policy_by_demand: Dict[str, SegmentRoutingPolicy],
        config: AlgorithmConfig,
        path_results: List[PathResult],
        link_loads: Dict[str, float],
        trace_events: List[SimulationTraceEvent],
        debug: List[str],
    ) -> int:
        """Applies every scheduled failure (PR 6) whose trigger step has
        elapsed — same shape as `ECMPAlgorithm._apply_due_failures`, see its
        docstring for the general story. The one SR-specific difference:
        `_route_demand` above never clears a demand's waypoint list, so a
        reroute still visits the exact same stops and only becomes
        unreachable if a waypoint or the destination itself can no longer be
        reached at all.
        """
        due = scheduler.due(step)
        for event in due:
            link = next((l for l in network.links if l.id == event.linkId), None)
            if link is None:
                continue

            before_congested = {
                l.id: ((link_loads.get(l.id, 0.0) / l.capacity) > config.congestionThreshold if l.capacity > 0 else False)
                for l in network.links
            }

            if graph.has_edge(link.source, link.target):
                graph.remove_edge(link.source, link.target)
            if not network.isDirected and graph.has_edge(link.target, link.source):
                graph.remove_edge(link.target, link.source)

            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="LINK_FAILURE",
                title="Scheduled link failure",
                description=f"Link {link.id} fails now (scheduled after trace step {event.triggerValue}) and is excluded from routing.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. Any demand already routed over it is recomputed against the graph with it removed; its waypoint list is unchanged.",
                highlightedLinks=[link.id],
                metadata={"scheduled": True, "triggerStep": event.triggerValue, "eventId": event.eventId},
            ))
            step += 1

            affected_indices = [
                i for i, pr in enumerate(path_results)
                if any(path_uses_link(share.nodes, link_map, link.id) for share in pr.paths)
            ]

            for i in affected_indices:
                old_pr = path_results[i]
                demand = next(d for d in network.demands if d.id == old_pr.demandId)

                for share in old_pr.paths:
                    for u, v in zip(share.nodes, share.nodes[1:]):
                        lk = link_map.get((u, v))
                        if lk:
                            link_loads[lk.id] -= share.trafficShare

                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="ROUTE_INVALIDATED",
                    title="Route invalidated",
                    description=f"Demand {demand.id}'s previous route used {link.id}, which just failed — its route is no longer valid.",
                    explanationText="A link failure invalidates any already-computed route that crossed it. Segment Routing recomputes the path between waypoints from scratch using the current (post-failure) graph — the waypoint list itself is unchanged.",
                    highlightedNodes=[demand.source, demand.target],
                    highlightedLinks=[link.id],
                    activeDemandId=demand.id,
                ))
                step += 1

                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="ROUTING_RECOMPUTATION",
                    title="Recomputing route",
                    description=f"Recomputing demand {demand.id} ({demand.source} to {demand.target}) over the updated graph.",
                    explanationText="Recomputation re-resolves each leg between the same waypoints, just against the graph with the failed link excluded.",
                    highlightedNodes=[demand.source, demand.target],
                    activeDemandId=demand.id,
                ))
                step += 1

                step, new_path_shares, reachable = SegmentRoutingAlgorithm._route_demand(
                    demand, graph, link_map, node_ids, policy_by_demand, config, link_loads, step, trace_events, debug,
                )

                if not reachable:
                    path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[])
                    trace_events.append(SimulationTraceEvent(
                        stepId=str(step),
                        algorithm="SEGMENT_ROUTING",
                        stepType="ROUTE_UNREACHABLE",
                        title="Demand unreachable",
                        description=f"Demand {demand.id} has no remaining path from {demand.source} to {demand.target} after the failure — a waypoint or the destination is no longer reachable.",
                        explanationText="When a scheduled failure disconnects a required waypoint or the destination itself, the demand can no longer be routed and delivers zero traffic.",
                        highlightedNodes=[demand.source, demand.target],
                        activeDemandId=demand.id,
                    ))
                    step += 1
                    continue

                path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=new_path_shares)
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="NEW_ROUTE_SELECTED",
                    title="New route selected",
                    description=(
                        f"Demand {demand.id} now routes via: "
                        + "; ".join(" -> ".join(ps.nodes) for ps in new_path_shares) + "."
                    ),
                    explanationText="The recomputed route(s) become the demand's active route for the rest of the simulation. Its waypoints are unchanged — only the ECMP path set between them was recomputed.",
                    highlightedNodes=list({n for ps in new_path_shares for n in ps.nodes}),
                    highlightedLinks=list({lid for ps in new_path_shares for lid in path_link_ids(ps.nodes, link_map)}),
                    activeDemandId=demand.id,
                ))
                step += 1

            after_congested = {
                l.id: ((link_loads.get(l.id, 0.0) / l.capacity) > config.congestionThreshold if l.capacity > 0 else False)
                for l in network.links
            }
            touched_links = sorted({
                lid for i in affected_indices
                for share in path_results[i].paths
                for lid in path_link_ids(share.nodes, link_map)
            } | {link.id})

            if touched_links:
                util_parts = []
                for lid in touched_links:
                    nl = next((l for l in network.links if l.id == lid), None)
                    if not nl:
                        continue
                    util = (link_loads.get(lid, 0.0) / nl.capacity) if nl.capacity > 0 else 0.0
                    util_parts.append(f"{lid}: {round(util * 100, 1)}%")
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="UTILIZATION_RECOMPUTED",
                    title="Utilization recomputed",
                    description="Updated utilization after rerouting: " + ", ".join(util_parts) + ".",
                    explanationText="Utilization is recomputed for every link whose load changed because of the failure and reroute.",
                    highlightedLinks=touched_links,
                    currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                ))
                step += 1

            changed = sorted(lid for lid in before_congested if before_congested[lid] != after_congested.get(lid, before_congested[lid]))
            if changed:
                descriptions = [
                    f"{lid}: {'congested now' if after_congested[lid] else 'no longer congested'}"
                    for lid in changed
                ]
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="CONGESTION_CHANGED",
                    title="Congestion changed",
                    description="; ".join(descriptions) + ".",
                    explanationText="A link's congestion state can flip in either direction after a failure — traffic moving onto it can push it over threshold, or moving off of it (the failed link's own state) can no longer count at all.",
                    highlightedLinks=changed,
                    metadata={"congestedNow": [lid for lid in changed if after_congested[lid]], "resolvedNow": [lid for lid in changed if not after_congested[lid]]},
                ))
                step += 1

        return step
