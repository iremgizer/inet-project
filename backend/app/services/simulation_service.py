from typing import Dict, Set
from app.models import SimulationRequest
from app.algorithms.ecmp import ECMPAlgorithm
from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.algorithms.custom_splitting import CustomSplittingAlgorithm

class SimulationService:
    def simulate(self, request: SimulationRequest):
        self._validate_request(request)
        algorithm = request.algorithmConfig.selectedAlgorithm
        if algorithm == "ECMP":
            return ECMPAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "DISTANCE_VECTOR":
            return DistanceVectorAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "SEGMENT_ROUTING":
            return SegmentRoutingAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "CUSTOM_SPLITTING":
            return CustomSplittingAlgorithm.run(request.network, request.algorithmConfig)
        raise ValueError(f"Algorithm {algorithm} is not implemented")

    def _validate_request(self, request: SimulationRequest):
        node_ids: Set[str] = {node.id for node in request.network.nodes}
        for demand in request.network.demands:
            if demand.source not in node_ids:
                raise ValueError(f"Demand {demand.id} source node not found")
            if demand.target not in node_ids:
                raise ValueError(f"Demand {demand.id} target node not found")
            if demand.source == demand.target:
                raise ValueError(f"Demand {demand.id} source and target must differ")
        link_ids: Set[str] = set()
        for link in request.network.links:
            if link.source not in node_ids or link.target not in node_ids:
                raise ValueError(f"Link {link.id} references unknown node")
            if link.id in link_ids:
                raise ValueError(f"Duplicate link id {link.id}")
            link_ids.add(link.id)
            if link.capacity <= 0:
                raise ValueError(f"Link {link.id} capacity must be > 0")
            if link.weight < 0:
                raise ValueError(f"Link {link.id} weight must be >= 0")
