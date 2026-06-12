import time
from typing import List, Dict, Tuple
import networkx as nx
from app.models import NetworkInput, AlgorithmConfig, PathResult, PathShare, LinkResult, NodeRoleResult, SimulationResult
from app.utils.graph_builder import GraphBuilder
from app.utils.metrics import Metrics

class ECMPAlgorithm:
    @staticmethod
    def run(network: NetworkInput, config: AlgorithmConfig) -> SimulationResult:
        start = time.time()
        graph, link_map = GraphBuilder.build_graph(network)
        path_results: List[PathResult] = []
        link_loads: Dict[str, float] = {link.id: 0.0 for link in network.links}
        debug: List[str] = []

        for demand in network.demands:
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

            share = demand.amount / len(all_paths) if all_paths else 0.0
            path_shares: List[PathShare] = []
            for path in all_paths:
                path_shares.append(PathShare(nodes=path, cost=float(shortest_length), trafficShare=share))
                for u, v in zip(path, path[1:]):
                    edge_link = link_map.get((u, v))
                    if edge_link:
                        link_loads[edge_link.id] += share

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

        node_roles = ECMPAlgorithm._build_node_roles(network, path_results)
        metrics = Metrics.compute_summary(path_results, link_results)
        runtime = (time.time() - start) * 1000.0

        return SimulationResult(
            algorithm="ECMP",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
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
