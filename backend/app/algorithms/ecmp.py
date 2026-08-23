import time
from typing import Dict, List, Tuple
import networkx as nx
from app.models import (
    AlgorithmConfig,
    LinkResult,
    NetworkInput,
    NodeRoleResult,
    PathResult,
    PathShare,
    SimulationResult,
    SimulationTraceEvent,
    TrafficDemandInput,
    TrafficDistribution,
)
from app.utils.failure_schedule import FailureScheduler
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics
from app.utils.routing_helpers import (
    path_total_weight,
    path_uses_link,
    resolve_equal_cost_paths,
    resolve_segment_route,
    sanitize_segments,
)
from app.utils.te_policy import build_demand_policy_graph, combined_waypoints_for_demand

# Tolerance for "do custom shares sum to 1.0 (100%)". Slightly looser than a
# strict epsilon so percent-based frontend inputs (e.g. 33.33/33.33/33.34)
# aren't rejected by float rounding, while still catching genuine mistakes.
DISTRIBUTION_SUM_TOLERANCE = 1e-4

class ECMPAlgorithm:
    @staticmethod
    def run(network: NetworkInput, config: AlgorithmConfig) -> SimulationResult:
        start = time.time()
        graph, link_map = GraphBuilder.build_graph(network)
        path_results: List[PathResult] = []
        link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
        trace_events: List[SimulationTraceEvent] = []
        debug: List[str] = []
        step = 1

        distribution_by_demand: Dict[str, TrafficDistribution] = {
            d.demandId: d for d in config.trafficDistributions
        }

        # ── Scheduled mid-simulation failures (PR 6) — see
        #    app/utils/failure_schedule.py for the full timing model. Empty
        #    schedule => scheduler.due() always returns [] => byte-identical
        #    to the PR 1-5 baseline below.
        scheduler = FailureScheduler(config.failureSchedule)

        # ── Link failure (PR 5) — global, not per-demand. GraphBuilder has
        #    already excluded any DOWN link from `graph` above, so every
        #    demand's routing below automatically recomputes around it with
        #    no further changes; this is purely an explanatory trace note. ──
        down_link_ids = GraphBuilder.down_link_ids(network)
        if down_link_ids:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="LINK_FAILURE",
                title="Link failure",
                description=f"{len(down_link_ids)} link(s) are down and excluded from routing: {', '.join(down_link_ids)}.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. Routing recomputes as if the link were removed from the graph.",
                highlightedLinks=down_link_ids,
            ))
            step += 1

        for demand in network.demands:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                title="Initialize demand",
                description=f"Demand {demand.id}: {demand.source} to {demand.target}, amount {demand.amount}.",
                explanationText="ECMP treats demand as continuous flow and searches for equal-cost minimum-weight paths.",
                highlightedNodes=[demand.source, demand.target],
                activeDemandId=demand.id,
            ))
            step += 1

            step, path_shares, reachable = ECMPAlgorithm._route_demand(
                demand, graph, link_map, config, distribution_by_demand, link_loads, step, trace_events, debug,
            )
            path_results.append(PathResult(
                demandId=demand.id, source=demand.source, target=demand.target,
                paths=path_shares if reachable else [],
            ))

            # ── Scheduled mid-simulation failures (PR 6) — checked once this
            #    demand's own trace steps have all been emitted. No-op when
            #    the schedule is empty (scheduler.due() always returns []),
            #    so this leaves the PR 1-5 trace byte-identical. See
            #    app/utils/failure_schedule.py for the timing model. ───────
            step = ECMPAlgorithm._apply_due_failures(
                scheduler, step, graph, link_map, network, config,
                distribution_by_demand, path_results, link_loads, trace_events, debug,
            )

        # Catch a trigger step scheduled at/after the last demand's own
        # steps (or a schedule with zero demands) — see test H.
        step = ECMPAlgorithm._apply_due_failures(
            scheduler, step, graph, link_map, network, config,
            distribution_by_demand, path_results, link_loads, trace_events, debug,
        )
        if scheduler.has_pending:
            # Deterministic, not a bug: a trigger step beyond the last trace
            # step this run ever reaches simply never becomes due — the
            # trace never "catches up" to it. Documented rather than silent.
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
                algorithm="ECMP",
                stepType="LINK_UTILIZATION",
                title="Compute link utilization",
                description=f"Link {link.id} load {round(load, 6)} over capacity {link.capacity}.",
                explanationText="Utilization is continuous traffic load divided by link capacity.",
                highlightedNodes=[link.source, link.target],
                highlightedLinks=[link.id],
                currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                formulaText=f"utilization({link.id}) = {round(load, 6)} / {link.capacity} = {round(utilization, 6)}",
            ))
            step += 1

        node_roles = ECMPAlgorithm._build_node_roles(network, path_results)
        metrics = Metrics.compute_summary(path_results, link_results)
        congested_links = [link.linkId for link in link_results if link.isCongested]
        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="ECMP",
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
            algorithm="ECMP",
            stepType="FINAL_SUMMARY",
            title="Final summary",
            description="ECMP simulation complete.",
            explanationText="The final result aggregates selected paths, link loads, utilizations, congestion, and summary metrics.",
            highlightedLinks=congested_links,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            metadata=metrics,
        ))
        runtime = (time.time() - start) * 1000.0

        return SimulationResult(
            algorithm="ECMP",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
            traceEvents=ECMPAlgorithm._cap_trace(trace_events, config.maxTraceEvents),
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
        config: AlgorithmConfig,
        distribution_by_demand: Dict[str, TrafficDistribution],
        link_loads: Dict[str, float],
        step: int,
        trace_events: List[SimulationTraceEvent],
        debug: List[str],
        is_reroute: bool = False,
    ) -> Tuple[int, List[PathShare], bool]:
        """Computes ECMP path(s) for one demand — TE-policy application,
        waypoint resolution, equal-cost path discovery, and traffic
        distribution — mutating `link_loads` in place exactly as the
        original inline loop body always did.

        Factored out of `run()` so the exact same logic can run twice for
        the same demand: once for its original route, and again (PR 6, see
        `_apply_due_failures` below) to recompute it after a scheduled
        mid-simulation failure, against the same `graph` object with the
        failed link's edge already removed. Returns
        `(next_step, path_shares, reachable)`; `path_shares` is `[]` and
        `reachable` is `False` when the demand cannot be routed at all.

        `is_reroute=True` only when called from `_apply_due_failures`: a
        custom traffic distribution that no longer matches the post-failure
        path set falls back to an equal split (there's no student in the
        loop mid-run to re-pick shares) instead of raising, unlike the
        original route below, which still raises exactly as ECMP always has
        — an invalid distribution is a rejected request, not a best-effort
        guess, for a demand's *first* route.
        """
        if demand.source == demand.target:
            debug.append(f"Demand {demand.id} source equals target; skipping")
            return step, [], False
        if demand.source not in graph or demand.target not in graph:
            debug.append(f"Demand {demand.id} references unknown endpoint")
            return step, [], False

        # ── Traffic Engineering policies — no-op (same graph object, zero
        #    cost) when config.tePolicies is empty or none apply to this
        #    demand. See app/utils/te_policy.py. ─────────────────────────
        policy_result = build_demand_policy_graph(graph, link_map, demand.id, config.tePolicies)
        demand_graph = policy_result.graph
        required_waypoints = sanitize_segments(
            combined_waypoints_for_demand(None, policy_result), demand.source, demand.target
        )

        if policy_result.has_effect:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="APPLY_TE_POLICY",
                title="Apply traffic engineering policies",
                description=policy_result.describe(),
                explanationText="Traffic engineering policies adjust which links are considered and their effective routing cost before ECMP searches for equal-cost paths. The physical link cost shown elsewhere never changes.",
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

        if required_waypoints:
            # A required waypoint forces a single concatenated route (the
            # same resolution Segment Routing uses) — ECMP's equal-cost
            # multi-path enumeration does not apply once the demand must
            # visit a specific node, so this demand gets exactly one path.
            try:
                full_path, _leg_paths = resolve_segment_route(
                    demand_graph, demand.source, demand.target, required_waypoints
                )
            except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
                debug.append(f"Demand {demand.id}: required-waypoint route unreachable ({exc})")
                return step, [], False

            all_paths = [full_path]
            shortest_length = path_total_weight(full_path, link_map)
            calculations = [ECMPAlgorithm._path_cost_calculation(full_path, link_map)]
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="POLICY_WAYPOINT_REQUIRED",
                title="Resolve required-waypoint route",
                description=f"Demand {demand.id} must visit {' -> '.join(required_waypoints)}; resolved as a single route: {' -> '.join(full_path)}.",
                explanationText="ECMP falls back to one concatenated route (the same mechanism Segment Routing uses) when a waypoint is required — equal-cost multi-path enumeration no longer applies.",
                highlightedNodes=full_path,
                highlightedLinks=ECMPAlgorithm._path_link_ids(full_path, link_map),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                costCalculation=calculations[0],
            ))
            step += 1
        else:
            try:
                shortest_length = nx.shortest_path_length(demand_graph, demand.source, demand.target, weight="weight")
                # `resolve_equal_cost_paths` already sorts lexicographically by
                # node sequence so the same path always lands at the same
                # position — path-1/path-2/... must be stable across
                # runs/edits, not dependent on NetworkX's internal
                # (edge-insertion-order-dependent) enumeration order. (PR0:
                # extracted to routing_helpers so Segment Routing's own
                # equal-cost discovery doesn't duplicate this — byte-identical
                # to the inline `sorted(nx.all_shortest_paths(...))` this
                # replaces.)
                all_paths = resolve_equal_cost_paths(demand_graph, demand.source, demand.target)
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                debug.append(f"No path found for demand {demand.id}")
                return step, [], False

            calculations = [
                ECMPAlgorithm._path_cost_calculation(path, link_map)
                for path in all_paths
            ]
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="COMPUTE_CANDIDATE_PATHS",
                title="Compute candidate shortest paths",
                description=f"Found {len(all_paths)} minimum path(s) with total cost {float(shortest_length)}.",
                explanationText="The path cost is the sum of link weights. Capacity is not used for shortest-path selection in ECMP V1.",
                highlightedNodes=list({node for path in all_paths for node in path}),
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                costCalculation="\n".join(calculations),
            ))
            step += 1

            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="FOUND_EQUAL_COST_PATHS",
                title="Equal-cost paths found",
                description="All highlighted paths have the same minimum total weight.",
                explanationText="These paths have the same minimum total weight, so ECMP uses all of them.",
                highlightedNodes=list({node for path in all_paths for node in path}),
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                costCalculation="\n".join(calculations),
                metadata={"pathIds": [f"path-{i + 1}" for i in range(len(all_paths))]},
            ))
            step += 1

        path_ids = [f"path-{i + 1}" for i in range(len(all_paths))]

        # ── Traffic distribution stage — unchanged from PR 3.
        #    Everything above (path discovery) and below (accumulation,
        #    utilization, congestion, metrics) is untouched. ────────────
        distribution = distribution_by_demand.get(demand.id)
        is_custom = distribution is not None and distribution.mode == "CUSTOM"
        shares_fraction: List[float] = []

        if is_custom:
            if is_reroute:
                try:
                    shares_fraction = ECMPAlgorithm._resolve_custom_shares(demand, path_ids, distribution)
                except ValueError:
                    debug.append(
                        f"Demand {demand.id}: custom traffic distribution no longer matches the post-failure "
                        "path set; falling back to an equal split for this demand"
                    )
                    is_custom = False
            else:
                # Byte-for-byte identical to before PR 6: an invalid custom
                # distribution on a demand's first route is a rejected
                # request (ValueError -> 400), never silently downgraded.
                shares_fraction = ECMPAlgorithm._resolve_custom_shares(demand, path_ids, distribution)

        if is_custom:
            per_path_amount = [demand.amount * f for f in shares_fraction]
            pct_list = [f"{f * 100:g}%" for f in shares_fraction]
            breakdown = "\n".join(
                f"Path {i + 1} ({pct_list[i]}): {demand.amount:g} × {shares_fraction[i]:.4f} = {round(per_path_amount[i], 6):g}"
                for i in range(len(all_paths))
            )
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="PATH_DISTRIBUTION",
                title="Apply custom traffic distribution",
                description=f"Demand {demand.amount:g} is distributed across {len(all_paths)} path(s) using custom shares: {', '.join(pct_list)}.",
                explanationText="Custom traffic distribution sends a student-chosen share of the demand over each equal-cost path, instead of splitting it equally.",
                highlightedNodes=[demand.source, demand.target],
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                formulaText=breakdown,
                metadata={"mode": "CUSTOM", "pathIds": path_ids, "shares": shares_fraction},
            ))
            step += 1
        else:
            # Byte-for-byte identical to ECMP before this PR.
            share = demand.amount / len(all_paths) if all_paths else 0.0
            per_path_amount = [share] * len(all_paths)
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="PATH_DISTRIBUTION",
                title="Split demand equally",
                description=f"Demand {demand.amount} is split across {len(all_paths)} equal-cost path(s): {round(share, 6)} units per path.",
                explanationText="ECMP sends the same traffic share on each equal-cost next path in this V1 model.",
                highlightedNodes=[demand.source, demand.target],
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                formulaText=f"trafficShare = {demand.amount} / {len(all_paths)} = {round(share, 6)}",
                metadata={"mode": "EQUAL", "pathIds": path_ids},
            ))
            step += 1

        path_shares: List[PathShare] = []
        for i, path in enumerate(all_paths):
            amount = per_path_amount[i]
            path_shares.append(PathShare(nodes=path, cost=float(shortest_length), trafficShare=amount, pathId=path_ids[i]))
            delta: Dict[str, float] = {}
            for u, v in zip(path, path[1:]):
                edge_link = link_map.get((u, v))
                if edge_link:
                    link_loads[edge_link.id] += amount
                    delta[edge_link.id] = round(delta.get(edge_link.id, 0.0) + amount, 6)
            path_label = f" (Path {i + 1})" if len(all_paths) > 1 else ""
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                stepType="ADD_TRAFFIC",
                title="Add traffic share to path",
                description=f"Added {round(amount, 6)} units on {' -> '.join(path)}{path_label}.",
                explanationText="Each selected path contributes its traffic share to every link along that path.",
                highlightedNodes=path,
                highlightedLinks=ECMPAlgorithm._path_link_ids(path, link_map),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                linkLoadDelta=delta,
                currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                metadata={"pathId": path_ids[i]},
            ))
            step += 1

        return step, path_shares, True

    @staticmethod
    def _apply_due_failures(
        scheduler: FailureScheduler,
        step: int,
        graph: "nx.Graph",
        link_map: Dict[tuple, object],
        network: NetworkInput,
        config: AlgorithmConfig,
        distribution_by_demand: Dict[str, TrafficDistribution],
        path_results: List[PathResult],
        link_loads: Dict[str, float],
        trace_events: List[SimulationTraceEvent],
        debug: List[str],
    ) -> int:
        """Applies every scheduled failure (PR 6) whose trigger step has
        elapsed: removes the link's edge from `graph` (mutated in place, so
        every demand routed after this point sees it automatically),
        recomputes any already-completed demand whose committed route
        crossed that link, and appends the LINK_FAILURE / ROUTE_INVALIDATED
        / ROUTING_RECOMPUTATION / NEW_ROUTE_SELECTED / ROUTE_UNREACHABLE /
        UTILIZATION_RECOMPUTED / CONGESTION_CHANGED trace events that tell
        that story. A no-op (returns `step` unchanged) when nothing is due —
        in particular always a no-op when `config.failureSchedule` is empty,
        which is what keeps the PR 1-5 trace byte-identical.
        """
        due = scheduler.due(step)
        for event in due:
            link = next((l for l in network.links if l.id == event.linkId), None)
            if link is None:
                continue  # Unknown link id in the schedule — ignore, don't crash.

            # Snapshot congestion state before this event, over every link,
            # so CONGESTION_CHANGED below can report exactly what flipped —
            # simpler and just as correct as trying to track only the
            # links this one event touches.
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
                algorithm="ECMP",
                stepType="LINK_FAILURE",
                title="Scheduled link failure",
                description=f"Link {link.id} fails now (scheduled after trace step {event.triggerValue}) and is excluded from routing.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. Any demand already routed over it is recomputed against the graph with it removed.",
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

                # Subtract this demand's previous load contribution before
                # recomputing — _route_demand below adds the new one back.
                for share in old_pr.paths:
                    for u, v in zip(share.nodes, share.nodes[1:]):
                        lk = link_map.get((u, v))
                        if lk:
                            link_loads[lk.id] -= share.trafficShare

                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="ECMP",
                    stepType="ROUTE_INVALIDATED",
                    title="Route invalidated",
                    description=f"Demand {demand.id}'s previous route used {link.id}, which just failed — its route is no longer valid.",
                    explanationText="A link failure invalidates any already-computed route that crossed it. ECMP recomputes from scratch using the current (post-failure) graph.",
                    highlightedNodes=[demand.source, demand.target],
                    highlightedLinks=[link.id],
                    activeDemandId=demand.id,
                ))
                step += 1

                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="ECMP",
                    stepType="ROUTING_RECOMPUTATION",
                    title="Recomputing route",
                    description=f"Recomputing demand {demand.id} ({demand.source} to {demand.target}) over the updated graph.",
                    explanationText="Recomputation re-runs the same equal-cost path search ECMP always uses, just against the graph with the failed link excluded.",
                    highlightedNodes=[demand.source, demand.target],
                    activeDemandId=demand.id,
                ))
                step += 1

                step, new_path_shares, reachable = ECMPAlgorithm._route_demand(
                    demand, graph, link_map, config, distribution_by_demand, link_loads, step, trace_events, debug,
                    is_reroute=True,
                )

                if not reachable:
                    path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[])
                    trace_events.append(SimulationTraceEvent(
                        stepId=str(step),
                        algorithm="ECMP",
                        stepType="ROUTE_UNREACHABLE",
                        title="Demand unreachable",
                        description=f"Demand {demand.id} has no remaining path from {demand.source} to {demand.target} after the failure.",
                        explanationText="When a scheduled failure removes the last remaining path, the demand can no longer be routed and delivers zero traffic.",
                        highlightedNodes=[demand.source, demand.target],
                        activeDemandId=demand.id,
                    ))
                    step += 1
                    continue

                path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=new_path_shares)
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="ECMP",
                    stepType="NEW_ROUTE_SELECTED",
                    title="New route selected",
                    description=f"Demand {demand.id} now routes via: " + "; ".join(" -> ".join(s.nodes) for s in new_path_shares) + ".",
                    explanationText="The recomputed route becomes the demand's active path for the rest of the simulation.",
                    highlightedNodes=list({n for s in new_path_shares for n in s.nodes}),
                    highlightedLinks=list({lid for s in new_path_shares for lid in ECMPAlgorithm._path_link_ids(s.nodes, link_map)}),
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
                for lid in ECMPAlgorithm._path_link_ids(share.nodes, link_map)
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
                    algorithm="ECMP",
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
                    algorithm="ECMP",
                    stepType="CONGESTION_CHANGED",
                    title="Congestion changed",
                    description="; ".join(descriptions) + ".",
                    explanationText="A link's congestion state can flip in either direction after a failure — traffic moving onto it can push it over threshold, or moving off of it (the failed link's own state) can no longer count at all.",
                    highlightedLinks=changed,
                    metadata={"congestedNow": [lid for lid in changed if after_congested[lid]], "resolvedNow": [lid for lid in changed if not after_congested[lid]]},
                ))
                step += 1

        return step

    @staticmethod
    def _resolve_custom_shares(
        demand: TrafficDemandInput,
        path_ids: List[str],
        distribution: TrafficDistribution,
    ) -> List[float]:
        """Validate a CUSTOM TrafficDistribution against the demand's actual
        discovered path ids and return the fractional share (0..1) for each
        path, in the same order as `path_ids`.

        Raises ValueError — never silently normalizes — when a discovered
        path has no supplied share, a supplied share references a path id
        that doesn't exist for this demand, or the shares don't sum to 1.0
        (100%) within tolerance. `PathDistribution.share` bounds (0..1) are
        already enforced by Pydantic before this runs.
        """
        supplied: Dict[str, float] = {p.pathId: p.share for p in distribution.paths}

        missing = [pid for pid in path_ids if pid not in supplied]
        if missing:
            raise ValueError(
                f"Demand {demand.id}: custom traffic distribution is missing a share for {missing} "
                f"(discovered paths: {path_ids})"
            )
        unknown = sorted(set(supplied) - set(path_ids))
        if unknown:
            raise ValueError(
                f"Demand {demand.id}: custom traffic distribution references unknown path id(s) {unknown} "
                f"(discovered paths: {path_ids})"
            )
        total = sum(supplied[pid] for pid in path_ids)
        if abs(total - 1.0) > DISTRIBUTION_SUM_TOLERANCE:
            raise ValueError(
                f"Demand {demand.id}: custom traffic distribution shares sum to {total:.6f}, expected 1.0 (100%)"
            )
        return [supplied[pid] for pid in path_ids]

    @staticmethod
    def _build_node_roles(network: NetworkInput, path_results: List[PathResult]) -> List[NodeRoleResult]:
        roles: Dict[str, NodeRoleResult] = {
            node.id: NodeRoleResult(nodeId=node.id, asSourceFor=[], asDestinationFor=[], asIntermediateFor=[])
            for node in network.nodes
        }
        for path in path_results:
            if not path.paths:
                continue
            roles[path.source].asSourceFor.append(path.demandId)
            roles[path.target].asDestinationFor.append(path.demandId)
            for share in path.paths:
                for node_id in share.nodes[1:-1]:
                    roles[node_id].asIntermediateFor.append(path.demandId)
        return list(roles.values())

    @staticmethod
    def _path_link_ids(path: List[str], link_map: Dict[tuple, object]) -> List[str]:
        link_ids: List[str] = []
        for u, v in zip(path, path[1:]):
            edge_link = link_map.get((u, v))
            if edge_link:
                link_ids.append(edge_link.id)
        return link_ids

    @staticmethod
    def _path_cost_calculation(path: List[str], link_map: Dict[tuple, object]) -> str:
        weights: List[float] = []
        parts: List[str] = []
        for u, v in zip(path, path[1:]):
            edge_link = link_map.get((u, v))
            if edge_link:
                weights.append(edge_link.weight)
                parts.append(f"w({u},{v})")
        total = sum(weights)
        weight_text = " + ".join(str(weight).rstrip("0").rstrip(".") for weight in weights)
        return f"{' -> '.join(path)}: cost = {' + '.join(parts)} = {weight_text} = {total:g}"

    @staticmethod
    def _cap_trace(events: List[SimulationTraceEvent], max_events: int | None) -> List[SimulationTraceEvent]:
        # TODO: stream trace events over SSE/WebSocket for large simulations.
        if max_events and len(events) > max_events:
            return events[:max_events]
        return events
