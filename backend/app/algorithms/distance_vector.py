import time
from typing import List, Dict, Optional
import networkx as nx
from app.models import NetworkInput, AlgorithmConfig, PathResult, PathShare, LinkResult, NodeRoleResult, DistanceVectorTableEntry, SimulationResult, SimulationTraceEvent
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics

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
        try:
            lengths = dict(nx.all_pairs_dijkstra_path_length(graph, weight="weight"))
            paths = dict(nx.all_pairs_dijkstra_path(graph, weight="weight"))
        except Exception as e:
            raise ValueError(f"Distance Vector failed to compute shortest paths: {e}")

        for node in graph.nodes:
            for destination in graph.nodes:
                cost = lengths.get(node, {}).get(destination, float("inf"))
                if cost == float("inf"):
                    dv_table.append(DistanceVectorTableEntry(nodeId=node, destinationId=destination, cost=-1.0, nextHop=None))
                    continue
                next_hop = DistanceVectorAlgorithm._find_next_hop(node, destination, paths)
                dv_table.append(DistanceVectorTableEntry(nodeId=node, destinationId=destination, cost=float(cost), nextHop=next_hop))

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
            path = paths.get(demand.source, {}).get(demand.target)
            if not path:
                debug.append(f"No path found for demand {demand.id}")
                path_results.append(PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[]))
                continue
            cost = float(lengths[demand.source][demand.target])
            path_link_ids = DistanceVectorAlgorithm._path_link_ids(path, link_map)
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="DISTANCE_VECTOR",
                title="Select shortest path for demand",
                description=f"Demand {demand.id} uses {' -> '.join(path)} with cost {cost:g}.",
                explanationText="After the table is stable, traffic follows the next-hop chain for the destination.",
                highlightedNodes=path,
                highlightedLinks=path_link_ids,
                activeDemandId=demand.id,
                costCalculation=DistanceVectorAlgorithm._path_cost_calculation(path, link_map),
                activeNodeId=demand.source,
                activeDestinationId=demand.target,
                activeTableRowIds=[f"{demand.source}::{demand.target}"],
            ))
            step += 1
            path_results.append(PathResult(
                demandId=demand.id,
                source=demand.source,
                target=demand.target,
                paths=[PathShare(nodes=path, cost=cost, trafficShare=demand.amount)],
            ))
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
                highlightedLinks=path_link_ids,
                activeDemandId=demand.id,
                linkLoadDelta=delta,
                currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                activeNodeId=demand.source,
                activeDestinationId=demand.target,
                activeTableRowIds=[f"{demand.source}::{demand.target}"],
            ))
            step += 1

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
