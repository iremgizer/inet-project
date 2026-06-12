import time
from typing import List, Dict
import networkx as nx
from app.models import NetworkInput, AlgorithmConfig, PathResult, PathShare, LinkResult, NodeRoleResult, SimulationResult, SimulationTraceEvent
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics

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
            if demand.source == demand.target:
                debug.append(f"Demand {demand.id} source equals target; skipping")
                continue
            if demand.source not in graph or demand.target not in graph:
                debug.append(f"Demand {demand.id} references unknown endpoint")
                continue

            try:
                shortest_length = nx.shortest_path_length(graph, demand.source, demand.target, weight="weight")
                all_paths = list(nx.all_shortest_paths(graph, demand.source, demand.target, weight="weight"))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                debug.append(f"No path found for demand {demand.id}")
                path_results.append(PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=[]))
                continue

            calculations = [
                ECMPAlgorithm._path_cost_calculation(path, link_map)
                for path in all_paths
            ]
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
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
                title="Equal-cost paths found",
                description="All highlighted paths have the same minimum total weight.",
                explanationText="These paths have the same minimum total weight, so ECMP uses all of them.",
                highlightedNodes=list({node for path in all_paths for node in path}),
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                costCalculation="\n".join(calculations),
            ))
            step += 1

            share = demand.amount / len(all_paths) if all_paths else 0.0
            trace_events.append(SimulationTraceEvent(
                stepId=str(step),
                algorithm="ECMP",
                title="Split demand equally",
                description=f"Demand {demand.amount} is split across {len(all_paths)} equal-cost path(s): {round(share, 6)} units per path.",
                explanationText="ECMP sends the same traffic share on each equal-cost next path in this V1 model.",
                highlightedNodes=[demand.source, demand.target],
                highlightedLinks=list({link_id for path in all_paths for link_id in ECMPAlgorithm._path_link_ids(path, link_map)}),
                activeDemandId=demand.id,
                pathGroupId=f"ecmp-{demand.id}",
                pathColor="#7c3aed",
                formulaText=f"trafficShare = {demand.amount} / {len(all_paths)} = {round(share, 6)}",
            ))
            step += 1
            path_shares: List[PathShare] = []
            for path in all_paths:
                path_shares.append(PathShare(nodes=path, cost=float(shortest_length), trafficShare=share))
                delta: Dict[str, float] = {}
                for u, v in zip(path, path[1:]):
                    edge_link = link_map.get((u, v))
                    if edge_link:
                        link_loads[edge_link.id] += share
                        delta[edge_link.id] = round(delta.get(edge_link.id, 0.0) + share, 6)
                trace_events.append(SimulationTraceEvent(
                    stepId=str(step),
                    algorithm="ECMP",
                    title="Add traffic share to path",
                    description=f"Added {round(share, 6)} units on {' -> '.join(path)}.",
                    explanationText="Each selected path contributes its traffic share to every link along that path.",
                    highlightedNodes=path,
                    highlightedLinks=ECMPAlgorithm._path_link_ids(path, link_map),
                    activeDemandId=demand.id,
                    pathGroupId=f"ecmp-{demand.id}",
                    pathColor="#7c3aed",
                    linkLoadDelta=delta,
                    currentLinkLoads={key: round(value, 6) for key, value in link_loads.items()},
                ))
                step += 1

            path_results.append(PathResult(demandId=demand.id, source=demand.source, target=demand.target, paths=path_shares))

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
