import time
from typing import List, Dict, Optional
import networkx as nx
from app.models import NetworkInput, AlgorithmConfig, PathResult, PathShare, LinkResult, NodeRoleResult, DistanceVectorTableEntry, SimulationResult
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
        debug: List[str] = []

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
            path_results.append(PathResult(
                demandId=demand.id,
                source=demand.source,
                target=demand.target,
                paths=[PathShare(nodes=path, cost=cost, trafficShare=demand.amount)],
            ))
            for u, v in zip(path, path[1:]):
                edge_link = link_map.get((u, v))
                if edge_link:
                    link_loads[edge_link.id] += demand.amount

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

        node_roles = DistanceVectorAlgorithm._build_node_roles(network, path_results)
        metrics = Metrics.compute_summary(path_results, link_results)
        runtime = (time.time() - start) * 1000.0
        return SimulationResult(
            algorithm="DISTANCE_VECTOR",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
            distanceVectorTable=dv_table,
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
