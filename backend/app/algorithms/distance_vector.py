import time
from typing import List, Dict, Optional
import networkx as nx
from app.models import NetworkInput, AlgorithmConfig, PathResult, PathShare, LinkResult, NodeRoleResult, DistanceVectorTableEntry, SimulationResult, SimulationTraceEvent, TrafficDemandInput
from app.utils.failure_schedule import FailureScheduler
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics
from app.utils.routing_helpers import path_uses_link

class DistanceVectorAlgorithm:
    @staticmethod
    def run(network: NetworkInput, config: AlgorithmConfig) -> SimulationResult:
        start = time.time()
        graph, link_map = GraphBuilder.build_graph(network)
        path_results: List[PathResult] = []
        link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
        dv_table: List[DistanceVectorTableEntry] = []
        trace_events: List[SimulationTraceEvent] = []
        debug: List[str] = []
        step = 1

        # ── Scheduled mid-simulation failures (PR 6) — see
        #    app/utils/failure_schedule.py for the full timing model. Empty
        #    schedule => scheduler.due() always returns [] => byte-identical
        #    to the PR 1-5 baseline below.
        scheduler = FailureScheduler(config.failureSchedule)

        # Traffic Engineering policies (PR 4) are not supported by Distance
        # Vector: DV computes one all-pairs cost table for the whole graph up
        # front, not per demand, and a demand-scoped policy (e.g. forbid this
        # link for just this one demand) has no clean place in a table that
        # represents "the" cost between every pair of nodes. Supporting only
        # network-wide (demandId=None) policies would silently ignore
        # demand-scoped ones, which is worse than not supporting policies at
        # all — so none are applied here; this notice makes that explicit
        # rather than silently dropping them.
        if config.tePolicies:
            debug.append(
                "Traffic Engineering Policies are not supported by Distance Vector in this version; "
                f"{len(config.tePolicies)} polic{'y was' if len(config.tePolicies) == 1 else 'ies were'} ignored."
            )

        # ── Link failure (PR 5) — unlike TE policies, this is safe to support:
        #    failure is global topology state (not demand-scoped), and
        #    GraphBuilder has already excluded any DOWN link from `graph`
        #    above — the all-pairs table below is recomputed from that graph
        #    automatically, so no other change was needed. This is purely an
        #    explanatory trace note. ─────────────────────────────────────────
        down_link_ids = GraphBuilder.down_link_ids(network)
        if down_link_ids:
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="DISTANCE_VECTOR",
                stepType="LINK_FAILURE",
                title="Link failure",
                description=f"{len(down_link_ids)} link(s) are down and excluded from routing: {', '.join(down_link_ids)}.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. The cost table below is recomputed as if the link were removed from the graph.",
                highlightedLinks=down_link_ids,
            ))
            step += 1

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Initialize cost table",
            description="Create a stable cost/next-hop table for every node and destination.",
            explanationText="V1 uses instant stable computation for teaching. It does not model asynchronous message exchange.",
            highlightedNodes=[node.id for node in network.nodes],
            tablesSnapshot=[],
        ))
        step += 1

        # Compute stable shortest path costs for every node destination pair.
        lengths, paths, dv_table = DistanceVectorAlgorithm._compute_table(graph)

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Compute shortest costs",
            description="Compute stable minimum costs using link weights.",
            explanationText="This mirrors the converged result of repeated Distance Vector relaxation/update steps.",
            highlightedNodes=list(graph.nodes),
            tablesSnapshot=[entry.model_dump() for entry in dv_table],
            costCalculation="cost(node,destination) is the minimum sum of link weights over all available paths.",
        ))
        step += 1

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Update next-hop table",
            description="For each destination, store the first hop on the selected shortest path.",
            explanationText="The next hop tells a router where to forward traffic toward a destination after convergence.",
            highlightedNodes=list(graph.nodes),
            tablesSnapshot=[entry.model_dump() for entry in dv_table],
        ))
        step += 1

        for demand in network.demands:
            if demand.source == demand.target:
                debug.append(f"Demand {demand.id} source equals target; skipping")
                continue
            if demand.source not in graph or demand.target not in graph:
                debug.append(f"Demand {demand.id} references unknown endpoint")
                continue

            step, path_share, reachable = DistanceVectorAlgorithm._route_demand(
                demand, lengths, paths, link_map, link_loads, step, trace_events,
            )
            path_results.append(PathResult(
                demandId=demand.id, source=demand.source, target=demand.target,
                paths=[path_share] if reachable else [],
            ))
            if not reachable:
                debug.append(f"No path found for demand {demand.id}")

            # ── Scheduled mid-simulation failures (PR 6) — checked once this
            #    demand's own trace steps have all been emitted. No-op when
            #    the schedule is empty. See app/utils/failure_schedule.py.
            #    Re-running the same all-pairs computation this file always
            #    used (see `_compute_table`) is DV's "reconvergence" — not a
            #    redesign of its convergence model, just re-triggering it. ──
            step, lengths, paths, dv_table = DistanceVectorAlgorithm._apply_due_failures(
                scheduler, step, graph, link_map, network, config, lengths, paths, dv_table,
                path_results, link_loads, trace_events, debug,
            )

        # Catch a trigger step scheduled at/after the last demand's own
        # steps (or a schedule with zero demands) — see test H.
        step, lengths, paths, dv_table = DistanceVectorAlgorithm._apply_due_failures(
            scheduler, step, graph, link_map, network, config, lengths, paths, dv_table,
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
                algorithm="DISTANCE_VECTOR",
                title="Compute link utilization",
                description=f"Link {link.id} load {round(load, 6)} over capacity {link.capacity}.",
                explanationText="Utilization is continuous traffic load divided by link capacity.",
                highlightedNodes=[link.source, link.target],
                highlightedLinks=[link.id],
                currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                formulaText=f"utilization({link.id}) = {round(load, 6)} / {link.capacity} = {round(utilization, 6)}",
            ))
            step += 1

        node_roles = DistanceVectorAlgorithm._build_node_roles(network, path_results)
        metrics = Metrics.compute_summary(path_results, link_results)
        congested_links = [link.linkId for link in link_results if link.isCongested]
        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Mark congested links",
            description=f"{len(congested_links)} link(s) exceed threshold {config.congestionThreshold}.",
            explanationText="A link is congested when utilization exceeds the configured threshold.",
            highlightedLinks=congested_links,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            formulaText="isCongested = utilization > congestionThreshold",
        ))
        step += 1
        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Final summary",
            description="Distance Vector simulation complete.",
            explanationText="The final table and routed traffic represent the instant stable V1 result.",
            highlightedLinks=congested_links,
            tablesSnapshot=[entry.model_dump() for entry in dv_table],
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            metadata=metrics,
        ))
        runtime = (time.time() - start) * 1000.0
        return SimulationResult(
            algorithm="DISTANCE_VECTOR",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
            distanceVectorTable=dv_table,
            traceEvents=DistanceVectorAlgorithm._cap_trace(trace_events, config.maxTraceEvents),
            maxUtilization=metrics["maxUtilization"],
            totalDeliveredTraffic=metrics["totalDeliveredTraffic"],
            averagePathCost=metrics["averagePathCost"],
            congestedLinkCount=metrics["congestedLinkCount"],
            runtimeMs=round(runtime, 2),
            debugInfo=debug,
        )

    @staticmethod
    def _compute_table(graph: "nx.Graph"):
        """Computes the stable all-pairs cost/next-hop table this file has
        always used (see the "instant stable computation" note in `run()`'s
        first trace event). Factored out so PR 6 can call it a second time,
        against the same `graph` object with a failed link's edge removed,
        to model DV "reconverging" after a mid-simulation failure — this is
        re-triggering the existing computation, not a new convergence model.
        Returns `(lengths, paths, dv_table)`.
        """
        try:
            lengths = dict(nx.all_pairs_dijkstra_path_length(graph, weight="weight"))
            paths = dict(nx.all_pairs_dijkstra_path(graph, weight="weight"))
        except Exception as e:
            raise ValueError(f"Distance Vector failed to compute shortest paths: {e}")

        dv_table: List[DistanceVectorTableEntry] = []
        for node in graph.nodes:
            for destination in graph.nodes:
                cost = lengths.get(node, {}).get(destination, float("inf"))
                if cost == float("inf"):
                    dv_table.append(DistanceVectorTableEntry(nodeId=node, destinationId=destination, cost=-1.0, nextHop=None))
                    continue
                next_hop = DistanceVectorAlgorithm._find_next_hop(node, destination, paths)
                dv_table.append(DistanceVectorTableEntry(nodeId=node, destinationId=destination, cost=float(cost), nextHop=next_hop))
        return lengths, paths, dv_table

    @staticmethod
    def _route_demand(
        demand: TrafficDemandInput,
        lengths: Dict[str, Dict[str, float]],
        paths: Dict[str, Dict[str, List[str]]],
        link_map: Dict[tuple, object],
        link_loads: Dict[str, float],
        step: int,
        trace_events: List[SimulationTraceEvent],
    ) -> "tuple[int, PathShare | None, bool]":
        """Looks up a demand's path in the (already computed) `lengths`/
        `paths` tables and places its traffic — mutating `link_loads` in
        place exactly as the original inline loop body always did. Factored
        out so the exact same logic can run twice for the same demand: once
        against the original table, and again (PR 6) against the table
        `_compute_table` recomputed after a scheduled mid-simulation
        failure. Returns `(next_step, path_share, reachable)`.
        """
        path = paths.get(demand.source, {}).get(demand.target)
        if not path:
            return step, None, False

        cost = float(lengths[demand.source][demand.target])
        link_ids = DistanceVectorAlgorithm._path_link_ids(path, link_map)
        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Select shortest path for demand",
            description=f"Demand {demand.id} uses {' -> '.join(path)} with cost {cost:g}.",
            explanationText="After the table is stable, traffic follows the next-hop chain for the destination.",
            highlightedNodes=path,
            highlightedLinks=link_ids,
            activeDemandId=demand.id,
            costCalculation=DistanceVectorAlgorithm._path_cost_calculation(path, link_map),
            activeNodeId=demand.source,
            activeDestinationId=demand.target,
            activeTableRowIds=[f"{demand.source}::{demand.target}"],
        ))
        step += 1

        delta: Dict[str, float] = {}
        for u, v in zip(path, path[1:]):
            edge_link = link_map.get((u, v))
            if edge_link:
                link_loads[edge_link.id] += demand.amount
                delta[edge_link.id] = round(delta.get(edge_link.id, 0.0) + demand.amount, 6)

        trace_events.append(SimulationTraceEvent(
            stepId=str(step),
            algorithm="DISTANCE_VECTOR",
            title="Add traffic to chosen path",
            description=f"Added {demand.amount} units to {' -> '.join(path)}.",
            explanationText="Distance Vector V1 routes each demand on one stable shortest path.",
            highlightedNodes=path,
            highlightedLinks=link_ids,
            activeDemandId=demand.id,
            linkLoadDelta=delta,
            currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
            activeNodeId=demand.source,
            activeDestinationId=demand.target,
            activeTableRowIds=[f"{demand.source}::{demand.target}"],
        ))
        step += 1

        return step, PathShare(nodes=path, cost=cost, trafficShare=demand.amount), True

    @staticmethod
    def _apply_due_failures(
        scheduler: FailureScheduler,
        step: int,
        graph: "nx.Graph",
        link_map: Dict[tuple, object],
        network: NetworkInput,
        config: AlgorithmConfig,
        lengths: Dict[str, Dict[str, float]],
        paths: Dict[str, Dict[str, List[str]]],
        dv_table: List[DistanceVectorTableEntry],
        path_results: List[PathResult],
        link_loads: Dict[str, float],
        trace_events: List[SimulationTraceEvent],
        debug: List[str],
    ):
        """Applies every scheduled failure (PR 6) whose trigger step has
        elapsed — same shape as `ECMPAlgorithm._apply_due_failures`, see its
        docstring for the general story. DV's one difference: instead of
        recomputing per affected demand, the whole all-pairs table is
        recomputed once via `_compute_table` (DV's "reconvergence" — the
        same computation `run()` always used, just re-triggered; no change
        to DV's convergence model itself), and then only the demands whose
        committed path crossed the failed link are re-looked-up against it.
        Returns `(step, lengths, paths, dv_table)` — the possibly-updated
        tables the caller should keep using for any remaining demands.
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
                algorithm="DISTANCE_VECTOR",
                stepType="LINK_FAILURE",
                title="Scheduled link failure",
                description=f"Link {link.id} fails now (scheduled after trace step {event.triggerValue}) and is excluded from routing.",
                explanationText="A failed link stays part of the physical topology — same id, weight, and capacity — but cannot carry traffic. The cost table is recomputed as if the link were removed from the graph.",
                highlightedLinks=[link.id],
                metadata={"scheduled": True, "triggerStep": event.triggerValue, "eventId": event.eventId},
            ))
            step += 1

            lengths, paths, dv_table = DistanceVectorAlgorithm._compute_table(graph)
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="DISTANCE_VECTOR",
                stepType="ROUTING_RECOMPUTATION",
                title="Recomputing cost table",
                description="Recomputed the stable cost/next-hop table over the updated graph.",
                explanationText="Distance Vector re-converges to a new stable table after the failure — the same instant stable computation run() always uses, just re-run.",
                highlightedNodes=list(graph.nodes),
                tablesSnapshot=[entry.model_dump() for entry in dv_table],
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
                    algorithm="DISTANCE_VECTOR",
                    stepType="ROUTE_INVALIDATED",
                    title="Route invalidated",
                    description=f"Demand {demand.id}'s previous route used {link.id}, which just failed — its route is no longer valid.",
                    explanationText="A link failure invalidates any already-computed route that crossed it. Distance Vector looks the demand up again in the recomputed table.",
                    highlightedNodes=[demand.source, demand.target],
                    highlightedLinks=[link.id],
                    activeDemandId=demand.id,
                ))
                step += 1

                step, new_path_share, reachable = DistanceVectorAlgorithm._route_demand(
                    demand, lengths, paths, link_map, link_loads, step, trace_events,
                )

                if not reachable:
                    path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[])
                    debug.append(f"Demand {demand.id}: no path remains after the failure of {link.id}")
                    trace_events.append(SimulationTraceEvent(
                        stepId=str(step),
                        algorithm="DISTANCE_VECTOR",
                        stepType="ROUTE_UNREACHABLE",
                        title="Demand unreachable",
                        description=f"Demand {demand.id} has no remaining path from {demand.source} to {demand.target} after the failure.",
                        explanationText="When a scheduled failure removes the last remaining path, the demand can no longer be routed and delivers zero traffic.",
                        highlightedNodes=[demand.source, demand.target],
                        activeDemandId=demand.id,
                    ))
                    step += 1
                    continue

                path_results[i] = PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[new_path_share])
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="DISTANCE_VECTOR",
                    stepType="NEW_ROUTE_SELECTED",
                    title="New route selected",
                    description=f"Demand {demand.id} now routes via: {' -> '.join(new_path_share.nodes)}.",
                    explanationText="The recomputed route becomes the demand's active path for the rest of the simulation.",
                    highlightedNodes=new_path_share.nodes,
                    highlightedLinks=DistanceVectorAlgorithm._path_link_ids(new_path_share.nodes, link_map),
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
                for lid in DistanceVectorAlgorithm._path_link_ids(share.nodes, link_map)
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
                    algorithm="DISTANCE_VECTOR",
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
                    algorithm="DISTANCE_VECTOR",
                    stepType="CONGESTION_CHANGED",
                    title="Congestion changed",
                    description="; ".join(descriptions) + ".",
                    explanationText="A link's congestion state can flip in either direction after a failure — traffic moving onto it can push it over threshold, or moving off of it (the failed link's own state) can no longer count at all.",
                    highlightedLinks=changed,
                    metadata={"congestedNow": [lid for lid in changed if after_congested[lid]], "resolvedNow": [lid for lid in changed if not after_congested[lid]]},
                ))
                step += 1

        return step, lengths, paths, dv_table

    @staticmethod
    def _find_next_hop(node: str, destination: str, paths: Dict[str, Dict[str, List[str]]]) -> Optional[str]:
        route = paths.get(node, {}).get(destination)
        if not route or len(route) < 2:
            return None
        return route[1]

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
