from __future__ import annotations
from pydantic import BaseModel, Field, validator
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4
from datetime import datetime, timezone

TopologyType = Literal["custom", "triangle", "line", "ring", "mesh", "fat-tree", "grid", "path", "cycle", "random"]
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
    maxTraceEvents: Optional[int] = None

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

class SimulationTraceEvent(BaseModel):
    stepId: str
    algorithm: str
    title: str
    description: str
    explanationText: str
    highlightedNodes: List[str] = Field(default_factory=list)
    highlightedLinks: List[str] = Field(default_factory=list)
    activeDemandId: Optional[str] = None
    pathGroupId: Optional[str] = None
    pathColor: Optional[str] = None
    costCalculation: Optional[str] = None
    formulaText: Optional[str] = None
    linkLoadDelta: Optional[Dict[str, float]] = None
    currentLinkLoads: Optional[Dict[str, float]] = None
    tablesSnapshot: Optional[Any] = None
    metadata: Optional[Dict[str, Any]] = None

class SimulationResult(BaseModel):
    simulationRunId: str = Field(default_factory=lambda: str(uuid4()))
    algorithm: str
    pathResults: List[PathResult]
    linkResults: List[LinkResult]
    nodeRoles: List[NodeRoleResult]
    distanceVectorTable: Optional[List[DistanceVectorTableEntry]] = None
    traceEvents: List[SimulationTraceEvent] = Field(default_factory=list)
    maxUtilization: float
    totalDeliveredTraffic: float
    averagePathCost: float
    congestedLinkCount: int
    runtimeMs: float
    debugInfo: Optional[List[str]] = None

class SavedSimulationSummary(BaseModel):
    simulationRunId: str
    name: str
    createdAt: str
    algorithm: str
    topologyType: str
    nodeCount: int
    linkCount: int
    demandCount: int
    maxUtilization: float
    congestedLinkCount: int

# ── Classroom / Assignment models ─────────────────────────────────────────────

AssignmentTopic = Literal["ECMP", "DISTANCE_VECTOR", "SEGMENT_ROUTING", "TRAFFIC_ENGINEERING"]
AssignmentMode = Literal["lecture", "exercise", "challenge"]

# ── Challenge models ──────────────────────────────────────────────────────────

ChallengeType = Literal[
    "REDUCE_CONGESTION",
    "FIND_ECMP_WEIGHTS",
    "IDENTIFY_CONGESTED_LINKS",
    "COMPUTE_ECMP_SPLIT",
    "COMPUTE_DV_TABLE",
    "PREDICT_SHORTEST_PATH",
]
ChallengeDifficulty = Literal["beginner", "intermediate", "advanced"]
SolutionVisibility = Literal["immediately", "after_correct", "never", "after_deadline"]
EditableField = Literal["weights", "capacities", "demands", "topology", "algorithm"]
LearningObjective = Literal[
    "ECMP", "Distance Vector", "Congestion", "Shortest Path", "Link Weights", "Capacity", "Traffic Engineering"
]

class ChallengeTarget(BaseModel):
    maxUtilizationBelow: Optional[float] = None
    congestedLinks: Optional[List[str]] = None
    expectedPaths: Optional[Dict[str, Any]] = None
    expectedTrafficSplits: Optional[Dict[str, float]] = None
    expectedDVEntries: Optional[List[Dict[str, Any]]] = None

class ChallengeHint(BaseModel):
    hintId: str
    level: Literal["conceptual", "calculation", "solution_direction"]
    title: str
    text: str
    relatedNodeIds: List[str] = Field(default_factory=list)
    relatedLinkIds: List[str] = Field(default_factory=list)
    revealCostPenalty: float = 0.0

class ChallengeConfig(BaseModel):
    challengeType: ChallengeType
    difficulty: ChallengeDifficulty = "beginner"
    learningObjectives: List[LearningObjective] = Field(default_factory=list)
    expectedTimeMinutes: int = 15
    maxAttempts: int = 5
    showOfficialSolution: SolutionVisibility = "after_correct"
    editableFields: List[EditableField] = Field(default_factory=list)
    target: ChallengeTarget = Field(default_factory=ChallengeTarget)
    hints: List[ChallengeHint] = Field(default_factory=list)

class ChallengeAttemptRecord(BaseModel):
    """Lightweight record stored in MongoDB — no full SimulationResult."""
    attemptId: str = Field(default_factory=lambda: str(uuid4()))
    assignmentId: str
    studentName: str = ""
    attemptNumber: int = 1
    score: float = 0.0
    maxScore: float = 100.0
    isCorrect: bool = False
    hintsUsed: int = 0
    maxUtilization: Optional[float] = None
    congestedLinkCount: Optional[int] = None
    submittedAnswers: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
TaskType = Literal[
    "SET_LINK_WEIGHTS",
    "IDENTIFY_CONGESTED_LINKS",
    "COMPUTE_PATH_COSTS",
    "COMPUTE_ECMP_SPLIT",
    "COMPUTE_DV_TABLE",
    "REDUCE_MAX_UTILIZATION",
]

class LockedFields(BaseModel):
    canEditNodes: bool = False
    canEditLinks: bool = False
    canEditWeights: bool = True
    canEditCapacities: bool = False
    canEditDemands: bool = False
    canChooseAlgorithm: bool = False

class StudentTask(BaseModel):
    taskType: TaskType
    prompt: str
    instructions: str = ""
    answerFormatDescription: str = ""

class DVExpectedEntry(BaseModel):
    nodeId: str
    destinationId: str
    cost: float
    nextHop: Optional[str] = None

class ExpectedSolution(BaseModel):
    weights: Optional[Dict[str, float]] = None
    congestedLinks: Optional[List[str]] = None
    pathCosts: Optional[Dict[str, float]] = None
    trafficSplits: Optional[Dict[str, float]] = None
    distanceVectorEntries: Optional[List[DVExpectedEntry]] = None
    maxUtilizationTarget: Optional[float] = None
    explanation: Optional[str] = None

class GradingRules(BaseModel):
    tolerance: float = 0.01
    requireExactLinks: bool = False
    allowEquivalentWeights: bool = True
    maxScore: int = 100

class Assignment(BaseModel):
    assignmentId: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str = ""
    course: str = ""
    topic: AssignmentTopic
    mode: AssignmentMode = "exercise"
    starterNetwork: NetworkInput
    lockedFields: LockedFields = Field(default_factory=LockedFields)
    allowedAlgorithms: List[AlgorithmName]
    studentTask: StudentTask
    expectedSolution: Optional[ExpectedSolution] = None
    gradingRules: GradingRules = Field(default_factory=GradingRules)
    challengeConfig: Optional[ChallengeConfig] = None
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AssignmentSummary(BaseModel):
    assignmentId: str
    title: str
    course: str
    topic: AssignmentTopic
    mode: AssignmentMode
    taskType: TaskType
    createdAt: str
    updatedAt: str

class StudentSubmission(BaseModel):
    submissionId: str = Field(default_factory=lambda: str(uuid4()))
    assignmentId: str
    studentName: str = ""
    submittedNetwork: NetworkInput
    submittedAlgorithmConfig: AlgorithmConfig
    submittedAnswers: Dict[str, Any] = Field(default_factory=dict)
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class GradingResult(BaseModel):
    score: float
    maxScore: int
    passed: bool
    feedback: str
    details: Dict[str, Any] = Field(default_factory=dict)
