from __future__ import annotations
from pydantic import BaseModel, Field, validator
from typing import List, Literal, Optional

TopologyType = Literal["custom", "triangle", "line", "ring", "mesh", "fat-tree"]
AlgorithmName = Literal["ECMP", "DISTANCE_VECTOR", "SEGMENT_ROUTING", "CUSTOM_SPLITTING"]
AlgorithmType = Literal["exact", "real_world_heuristic", "custom"]
ObjectiveType = Literal["minimize_max_utilization", "minimize_path_cost"]

class NodeInput(BaseModel):
    id: str
    label: str
    x: float
    y: float
    visualType: Optional[str] = "node"

class LinkInput(BaseModel):
    id: str
    source: str
    target: str
    capacity: float = Field(..., gt=0)
    weight: float = Field(..., ge=0)

class TrafficDemandInput(BaseModel):
    id: str
    source: str
    target: str
    amount: float = Field(..., ge=0)

class NetworkInput(BaseModel):
    nodes: List[NodeInput]
    links: List[LinkInput]
    demands: List[TrafficDemandInput]
    topologyType: TopologyType
    isDirected: bool

    @validator("nodes")
    def unique_node_ids(cls, value):
        ids = [node.id for node in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate node ids are not allowed")
        return value

    @validator("links")
    def unique_link_ids(cls, value):
        ids = [link.id for link in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate link ids are not allowed")
        return value

    @validator("demands")
    def unique_demand_ids(cls, value):
        ids = [demand.id for demand in value]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate demand ids are not allowed")
        return value

class AlgorithmConfig(BaseModel):
    selectedAlgorithm: AlgorithmName
    algorithmType: AlgorithmType
    objective: ObjectiveType
    congestionThreshold: float = Field(1.0, gt=0)

class SimulationRequest(BaseModel):
    network: NetworkInput
    algorithmConfig: AlgorithmConfig

class PathShare(BaseModel):
    nodes: List[str]
    cost: float
    trafficShare: float

class PathResult(BaseModel):
    demandId: str
    source: str
    target: str
    paths: List[PathShare]

class LinkResult(BaseModel):
    linkId: str
    source: str
    target: str
    load: float
    capacity: float
    utilization: float
    isCongested: bool
    weight: float

class NodeRoleResult(BaseModel):
    nodeId: str
    asSourceFor: List[str]
    asDestinationFor: List[str]
    asIntermediateFor: List[str]

class DistanceVectorTableEntry(BaseModel):
    nodeId: str
    destinationId: str
    cost: float
    nextHop: Optional[str]

class SimulationResult(BaseModel):
    algorithm: str
    pathResults: List[PathResult]
    linkResults: List[LinkResult]
    nodeRoles: List[NodeRoleResult]
    distanceVectorTable: Optional[List[DistanceVectorTableEntry]] = None
    maxUtilization: float
    totalDeliveredTraffic: float
    averagePathCost: float
    congestedLinkCount: int
    runtimeMs: float
    debugInfo: Optional[List[str]] = None
