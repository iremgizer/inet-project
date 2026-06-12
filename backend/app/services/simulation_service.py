from typing import Set
from uuid import uuid4
from app.models import SimulationRequest
from app.algorithms.ecmp import ECMPAlgorithm
from app.algorithms.distance_vector import DistanceVectorAlgorithm
from app.algorithms.segment_routing import SegmentRoutingAlgorithm
from app.algorithms.custom_splitting import CustomSplittingAlgorithm
from app.services.run_storage_service import RunStorageService

class SimulationService:
    def __init__(self):
        self.storage = RunStorageService()

    def simulate(self, request: SimulationRequest):
        self._validate_request(request)
        algorithm = request.algorithmConfig.selectedAlgorithm
        if algorithm == "ECMP":
            result = ECMPAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "DISTANCE_VECTOR":
            result = DistanceVectorAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "SEGMENT_ROUTING":
            result = SegmentRoutingAlgorithm.run(request.network, request.algorithmConfig)
        elif algorithm == "CUSTOM_SPLITTING":
            result = CustomSplittingAlgorithm.run(request.network, request.algorithmConfig)
        else:
            raise ValueError(f"Algorithm {algorithm} is not implemented")

        result.simulationRunId = str(uuid4())
        if len(request.network.nodes) > 60 or len(request.network.links) > 120:
            result.debugInfo = (result.debugInfo or []) + [
                "Large topology detected. V1 returns final results; future versions should stream trace events and virtualize large tables."
            ]
        try:
            self.storage.save_run(request, result)
        except Exception as exc:
            result.debugInfo = (result.debugInfo or []) + [f"Simulation ran, but MongoDB save failed: {exc}"]
        if not self.storage.available:
            result.debugInfo = (result.debugInfo or []) + [
                "MongoDB is not available, so this run was not persisted. Start local MongoDB to enable saved runs."
            ]
        return result

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
