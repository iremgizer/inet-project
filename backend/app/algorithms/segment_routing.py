from typing import List
import time
from app.models import NetworkInput, AlgorithmConfig, SimulationResult, PathResult, LinkResult, NodeRoleResult

class SegmentRoutingAlgorithm:
    @staticmethod
    def run(network: NetworkInput, config: AlgorithmConfig) -> SimulationResult:
        start = time.time()
        debug = [
            "Segment Routing is a planned extension for the next version.",
            "This placeholder returns no routed traffic for V1.",
        ]
        path_results: List[PathResult] = []
        link_results: List[LinkResult] = []
        node_roles: List[NodeRoleResult] = [
            NodeRoleResult(nodeId=node.id, asSourceFor=[], asDestinationFor=[], asIntermediateFor=[])
            for node in network.nodes
        ]
        runtime = (time.time() - start) * 1000.0
        return SimulationResult(
            algorithm="SEGMENT_ROUTING",
            pathResults=path_results,
            linkResults=link_results,
            nodeRoles=node_roles,
            maxUtilization=0.0,
            totalDeliveredTraffic=0.0,
            averagePathCost=0.0,
            congestedLinkCount=0,
            runtimeMs=round(runtime, 2),
            debugInfo=debug,
        )
