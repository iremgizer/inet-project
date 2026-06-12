from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class RunStorageService:
    def __init__(self) -> None:
        self.uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        self.database_name = os.getenv("MONGODB_DATABASE", "network_visualizer")
        self._collection = None
        self._available = False
        try:
            from pymongo import MongoClient

            client = MongoClient(self.uri, serverSelectionTimeoutMS=500)
            client.admin.command("ping")
            self._collection = client[self.database_name]["simulation_runs"]
            self._available = True
        except Exception:
            self._collection = None
            self._available = False

    @property
    def available(self) -> bool:
        return self._available and self._collection is not None

    def save_run(self, request: Any, result: Any) -> None:
        if not self.available:
            return
        now = datetime.now(timezone.utc).isoformat()
        network = request.network.model_dump()
        algorithm_config = request.algorithmConfig.model_dump()
        result_doc = result.model_dump()
        document = {
            "simulationRunId": result.simulationRunId,
            "name": f"{result.algorithm} on {request.network.topologyType}",
            "createdAt": now,
            "updatedAt": now,
            "network": network,
            "algorithmConfig": algorithm_config,
            "simulationResult": result_doc,
            "traceEvents": result_doc.get("traceEvents", []),
            "topologyType": request.network.topologyType,
            "metadata": {
                "algorithm": result.algorithm,
                "nodeCount": len(request.network.nodes),
                "linkCount": len(request.network.links),
                "demandCount": len(request.network.demands),
                "maxUtilization": result.maxUtilization,
                "congestedLinkCount": result.congestedLinkCount,
            },
        }
        self._collection.replace_one(
            {"simulationRunId": result.simulationRunId},
            document,
            upsert=True,
        )

    def list_runs(self) -> List[Dict[str, Any]]:
        if not self.available:
            return []
        docs = self._collection.find({}, {"_id": 0, "simulationResult": 0, "network": 0, "traceEvents": 0})
        summaries: List[Dict[str, Any]] = []
        for doc in docs.sort("createdAt", -1):
            metadata = doc.get("metadata", {})
            summaries.append({
                "simulationRunId": doc["simulationRunId"],
                "name": doc.get("name", "Simulation run"),
                "createdAt": doc.get("createdAt", ""),
                "algorithm": metadata.get("algorithm", ""),
                "topologyType": doc.get("topologyType", ""),
                "nodeCount": metadata.get("nodeCount", 0),
                "linkCount": metadata.get("linkCount", 0),
                "demandCount": metadata.get("demandCount", 0),
                "maxUtilization": metadata.get("maxUtilization", 0.0),
                "congestedLinkCount": metadata.get("congestedLinkCount", 0),
            })
        return summaries

    def get_run(self, simulation_run_id: str) -> Optional[Dict[str, Any]]:
        if not self.available:
            return None
        return self._collection.find_one({"simulationRunId": simulation_run_id}, {"_id": 0})

    def delete_run(self, simulation_run_id: str) -> bool:
        if not self.available:
            return False
        result = self._collection.delete_one({"simulationRunId": simulation_run_id})
        return result.deleted_count > 0
