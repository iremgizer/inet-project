"""Segment Routing V1 — waypoint-based routing.

Educational abstraction, deliberately NOT modeling SR-MPLS control-plane
mechanics (no label stacks, no push/swap/pop, no LDP/RSVP-TE signaling).

Semantics: a demand may carry an ordered list of waypoint node ids
(`SegmentRoutingPolicy.segments`). The resolved route is the concatenation of
the shortest path from the demand's source to the first waypoint, from each
waypoint to the next, and from the last waypoint to the destination — under
the network's current link weights. A waypoint only constrains *which* nodes
are visited; the path *between* waypoints is still ordinary shortest-path
routing. An empty (or missing) segment list means plain shortest-path
routing, identical to Distance Vector's single-path behavior.

Traffic placement, utilization, and congestion reuse the exact same
load-accumulation / utilization / congestion-threshold semantics as ECMP and
Distance Vector (see `app/utils/routing_helpers.py` and `app/utils/metrics.py`)
— V1 places each demand's full traffic on its one resolved route, with no
multi-path splitting (that is ECMP's job, and weighted splitting is PR 3).
"""
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
    build_node_roles,
    cap_trace,
    path_cost_calculation,
    path_link_ids,
    path_total_weight,
    path_uses_link,
    resolve_segment_route,
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

            step, path_share, reachable = SegmentRoutingAlgorithm._route_demand(
                demand, graph, link_map, node_ids, policy_by_demand, config, link_loads, step, trace_events, debug,
            )
            path_results.append(PathResult(
                demandId=demand.id, source=demand.source, target=demand.target,
                paths=[path_share] if reachable else [],
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
    ) -> Tuple[int, "PathShare | None", bool]:
        """Resolves and places traffic for one demand's Segment Routing
        route — waypoint list, TE-policy application, per-leg shortest-path
        resolution, and traffic placement — mutating `link_loads` in place
        exactly as the original inline loop body always did.

        Factored out of `run()` so the exact same logic can run twice for
        the same demand: once for its original route, and again (PR 6, see
        `_apply_due_failures` below) to recompute it after a scheduled
        mid-simulation failure, against the same `graph` object with the
        failed link's edge already removed. The waypoint list itself is
        never touched by a failure — only the shortest path *between*
        waypoints is recomputed, so a reroute still visits the same stops
        and only fails if a waypoint or the destination becomes genuinely
        unreachable. Returns `(next_step, path_share, reachable)`.
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
            return step, None, False

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="START_DEMAND",
            title="Start demand",
            description=f"Demand {demand.id}: {demand.source} to {demand.target}, amount {demand.amount}.",
            explanationText="Segment Routing steers traffic through an ordered list of waypoints. Between waypoints, traffic follows the normal shortest path under the current link weights.",
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
                f"Segment list for {demand.id}: (none) — direct shortest path to {demand.target}."
            ),
            explanationText="Each stop is a waypoint the route must pass through, in order, before reaching the final destination.",
            highlightedNodes=stops,
            activeDemandId=demand.id,
            segmentList=stops,
        ))
        step += 1

        # ── Resolve the route — unreachable segment/destination is a clear,
        #    non-crashing per-demand failure, not a 500. ──────────────────
        try:
            full_path, leg_paths = resolve_segment_route(demand_graph, demand.source, demand.target, segments)
        except nx.NetworkXNoPath:
            debug.append(
                f"Demand {demand.id}: no path found between waypoints in the segment list"
            )
            return step, None, False
        except nx.NodeNotFound as exc:
            debug.append(f"Demand {demand.id}: {exc}")
            return step, None, False

        for i, leg in enumerate(leg_paths):
            leg_source, leg_target = leg[0], leg[-1]

            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="SELECT_ACTIVE_SEGMENT",
                title=f"Select active segment: {leg_target}",
                description=f"Routing from {leg_source} toward waypoint {leg_target}.",
                explanationText="Each segment routes toward its waypoint using the shortest path under current link weights.",
                highlightedNodes=[leg_source, leg_target],
                activeDemandId=demand.id,
                activeNodeId=leg_source,
                activeDestinationId=leg_target,
                activeSegmentIndex=i,
                segmentList=stops,
            ))
            step += 1

            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="SEGMENT_ROUTING",
                stepType="COMPUTE_SEGMENT_PATH",
                title=f"Compute path to {leg_target}",
                description=f"Shortest path {leg_source} -> {leg_target}: {' -> '.join(leg)}.",
                explanationText="Path cost is the sum of link weights along this segment.",
                highlightedNodes=leg,
                highlightedLinks=path_link_ids(leg, link_map),
                activeDemandId=demand.id,
                activeSegmentIndex=i,
                segmentList=stops,
                costCalculation=path_cost_calculation(leg, link_map),
                pathGroupId=f"sr-{demand.id}",
                pathColor=SR_PATH_COLOR,
            ))
            step += 1

            if i < len(leg_paths) - 1:
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="ADVANCE_TO_NEXT_SEGMENT",
                    title=f"Reach segment: {leg_target}",
                    description=f"Waypoint {leg_target} reached — advancing to the next segment.",
                    explanationText="The waypoint is marked complete and the next segment becomes active.",
                    highlightedNodes=[leg_target],
                    activeDemandId=demand.id,
                    activeSegmentIndex=i,
                    segmentList=stops,
                ))
                step += 1

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="FINAL_ROUTE_RESOLVED",
            title="Final route resolved",
            description=f"Demand {demand.id} resolved route: {' -> '.join(full_path)}.",
            explanationText="The final route concatenates each segment's shortest path, sharing waypoint nodes rather than repeating them.",
            highlightedNodes=full_path,
            highlightedLinks=path_link_ids(full_path, link_map),
            activeDemandId=demand.id,
            costCalculation=path_cost_calculation(full_path, link_map),
            segmentList=stops,
            pathGroupId=f"sr-{demand.id}",
            pathColor=SR_PATH_COLOR,
        ))
        step += 1

        cost = path_total_weight(full_path, link_map)
        path_share = PathShare(nodes=full_path, cost=cost, trafficShare=demand.amount)

        delta: Dict[str, float] = {}
        for u, v in zip(full_path, full_path[1:]):
            edge_link = link_map.get((u, v))
            if edge_link:
                link_loads[edge_link.id] += demand.amount
                delta[edge_link.id] = round(delta.get(edge_link.id, 0.0) + demand.amount, 6)

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="SEGMENT_ROUTING",
            stepType="ADD_TRAFFIC_TO_LINK",
            title="Add traffic to route",
            description=f"Added {demand.amount} units to {' -> '.join(full_path)}.",
            explanationText="Segment Routing V1 places each demand's full traffic on its single resolved route — no multi-path splitting.",
            highlightedNodes=full_path,
            highlightedLinks=path_link_ids(full_path, link_map),
            activeDemandId=demand.id,
            linkLoadDelta=delta,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
        ))
        step += 1

        return step, path_share, True

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

                step, new_path_share, reachable = SegmentRoutingAlgorithm._route_demand(
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

                path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[new_path_share])
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="SEGMENT_ROUTING",
                    stepType="NEW_ROUTE_SELECTED",
                    title="New route selected",
                    description=f"Demand {demand.id} now routes via: {' -> '.join(new_path_share.nodes)}.",
                    explanationText="The recomputed route becomes the demand's active path for the rest of the simulation. Its waypoints are unchanged — only the path between them was recomputed.",
                    highlightedNodes=new_path_share.nodes,
                    highlightedLinks=path_link_ids(new_path_share.nodes, link_map),
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
