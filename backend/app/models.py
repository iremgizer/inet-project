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

LinkOperationalStatus = Literal["UP", "DOWN"]

class LinkInput(BaseModel):
    id: str
    source: str
    target: str
    capacity: float = Field(..., gt=0)
    weight: float = Field(..., ge=0)
    # Additive scenario state — deliberately separate from the physical link
    # identity/weight/capacity above. A DOWN link stays in the topology (same
    # id, weight, capacity, still visible in the UI) but is excluded from
    # routing computation (see GraphBuilder.build_graph). This is NOT the
    # same as deleting the link: physical topology identity is preserved so
    # the student can restore it and see routing recompute back. Optional and
    # defaults to "UP" so every old NetworkInput/saved run/JSON file — which
    # never had this field — continues to mean exactly what it always meant.
    operationalStatus: LinkOperationalStatus = "UP"

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

class SegmentRoutingPolicy(BaseModel):
    """Segment Routing V1 policy: an ordered list of waypoint node ids a demand
    should be routed through.

    Between the demand's source and the first waypoint, between each pair of
    consecutive waypoints, and between the last waypoint and the demand's
    destination, traffic follows the normal shortest path under the current
    link weights — this policy only constrains *which* intermediate nodes are
    visited, not how each leg between them is routed. The source and final
    destination should not be repeated inside `segments`; an empty list means
    plain shortest-path routing for that demand.
    """
    demandId: str
    segments: List[str] = Field(default_factory=list)

TrafficDistributionMode = Literal["EQUAL", "CUSTOM"]

class PathDistribution(BaseModel):
    """One path's share of a demand's traffic, as a fraction (0..1) of the
    demand amount — NOT a link weight. `pathId` must match one of the stable,
    deterministic path ids ECMP assigns after sorting a demand's equal-cost
    paths lexicographically by node sequence (see ecmp.py); the same
    topology + demand always produce the same pathId for the same route."""
    pathId: str
    share: float = Field(..., ge=0.0, le=1.0)

class TrafficDistribution(BaseModel):
    """ECMP traffic-distribution override for one demand.

    Deliberately distinct from link `weight` (routing cost, used to find the
    equal-cost paths in the first place) — this only decides how much of an
    already-routed demand's traffic goes over each already-discovered
    equal-cost path. `mode="EQUAL"` (the default) reproduces today's ECMP
    behavior exactly and ignores `paths` entirely. `paths` is only read when
    `mode="CUSTOM"`, and every discovered path must have an explicit share
    summing to 1.0 (100%) — ECMP never silently normalizes or fills in a
    default for a missing one; an invalid distribution is a rejected request,
    not a best-effort guess.
    """
    demandId: str
    mode: TrafficDistributionMode = "EQUAL"
    paths: List[PathDistribution] = Field(default_factory=list)

TEPolicyType = Literal["PREFER_LINK", "AVOID_LINK", "FORBID_LINK", "REQUIRE_WAYPOINT"]

class TrafficEngineeringPolicy(BaseModel):
    """A routing-intent constraint or preference, deliberately independent of
    any one algorithm (ECMP, Segment Routing, and — later — an optimizer can
    all consume the same policy shape).

    Hard constraints (change *which* routes are even considered):
      - FORBID_LINK: the link must not appear in the resolved route.
      - REQUIRE_WAYPOINT: the route must visit `nodeId`.
    Soft preferences (change routing *cost*, never route feasibility):
      - AVOID_LINK: adds a routing-cost penalty to the link (does not remove it).
      - PREFER_LINK: subtracts a routing-cost penalty from the link (a discount,
        floored at 0 — never a negative-cost edge).

    `demandId=None` applies the policy to every demand; a set `demandId`
    scopes it to just that one. `linkId` is used by the three *_LINK types;
    `nodeId` is used by REQUIRE_WAYPOINT. `penalty` overrides the default
    avoid/prefer cost adjustment (ignored by the hard constraint types).
    `priority` breaks ties deterministically when multiple soft policies of
    the same type reference the same link, or when combining multiple
    REQUIRE_WAYPOINT policies into an ordered stop list (lower number =
    applied/visited first; insertion order breaks remaining ties).

    This shape is intentionally routing-mechanism-agnostic: FORBID_LINK is a
    hard `x_e = 0` constraint, AVOID_LINK/PREFER_LINK are objective-penalty
    terms, and REQUIRE_WAYPOINT is a routing constraint — the same
    vocabulary a future MIP-based optimizer would consume directly.
    """
    policyId: str
    type: TEPolicyType
    demandId: Optional[str] = None
    linkId: Optional[str] = None
    nodeId: Optional[str] = None
    priority: int = 0
    penalty: Optional[float] = Field(None, ge=0.0)

FailureTriggerType = Literal["TRACE_STEP"]

class SimulationFailureEvent(BaseModel):
    """A scheduled mid-simulation link failure (PR 6) — additive on top of
    the PR 5 `LinkInput.operationalStatus` model, not a replacement for it.
    Where `operationalStatus="DOWN"` means "this link is down for the whole
    run", a `SimulationFailureEvent` means "this link is UP at the start of
    the run and transitions to DOWN partway through it", so a student can
    watch routing recompute live during replay instead of only comparing two
    already-different starting topologies.

    `triggerType="TRACE_STEP"` (the only trigger type PR 6 supports, by
    design — see the module docstring in `app/utils/failure_schedule.py` for
    why arbitrary wall-clock timing was deliberately left out) with
    `triggerValue=N` means: steps 0..N are the baseline state; immediately
    after trace step N is emitted, this link transitions UP -> DOWN, a
    LINK_FAILURE trace event follows, and any already-routed demand crossing
    it is recomputed against the graph with it removed.
    """
    eventId: str
    linkId: str
    triggerType: FailureTriggerType = "TRACE_STEP"
    triggerValue: int = Field(..., ge=0)

class AlgorithmConfig(BaseModel):
    selectedAlgorithm: AlgorithmName
    algorithmType: AlgorithmType
    objective: ObjectiveType
    congestionThreshold: float = Field(1.0, gt=0)
    maxTraceEvents: Optional[int] = None
    # Segment Routing V1 — optional and only meaningful when
    # selectedAlgorithm == "SEGMENT_ROUTING". A demand with no matching entry
    # here (or an entry with empty `segments`) routes via plain shortest path.
    # Kept on AlgorithmConfig (not NetworkInput) because it is "how to route"
    # configuration specific to the chosen algorithm, not topology state —
    # ECMP/DISTANCE_VECTOR requests simply omit it (default: empty list).
    segmentRoutingPolicies: List[SegmentRoutingPolicy] = Field(default_factory=list)
    # ECMP traffic distribution — optional and only meaningful when
    # selectedAlgorithm == "ECMP". A demand with no matching entry here (or
    # mode="EQUAL") splits traffic equally across its equal-cost paths,
    # exactly as ECMP already did before this field existed.
    trafficDistributions: List[TrafficDistribution] = Field(default_factory=list)
    # Traffic Engineering policies — optional, algorithm-agnostic routing
    # intent. Read by ECMP and Segment Routing; Distance Vector does not
    # support them (see distance_vector.py) because it computes one
    # all-pairs table for the whole graph up front, not per demand, which a
    # demand-scoped policy cannot cleanly apply to without changing DV's
    # educational semantics. An empty list (the default) has zero effect on
    # any algorithm.
    tePolicies: List[TrafficEngineeringPolicy] = Field(default_factory=list)
    # Scheduled mid-simulation link failures (PR 6) — optional and
    # algorithm-agnostic (ECMP, Segment Routing, and Distance Vector all
    # support it; see each algorithm's own module for how). An empty list
    # (the default) means no scheduled failures, and every algorithm's trace
    # is byte-identical to before this field existed.
    failureSchedule: List[SimulationFailureEvent] = Field(default_factory=list)

class SimulationRequest(BaseModel):
    network: NetworkInput
    algorithmConfig: AlgorithmConfig

class PathShare(BaseModel):
    nodes: List[str]
    cost: float
    trafficShare: float
    # Stable path identifier ("path-1", "path-2", ...) assigned after sorting
    # a demand's equal-cost paths lexicographically by node sequence. Only
    # populated by ECMP today; None for Distance Vector / Segment Routing
    # (single path per demand — nothing to distinguish).
    pathId: Optional[str] = None

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
    activeNodeId: Optional[str] = None
    activeDestinationId: Optional[str] = None
    activeTableRowIds: Optional[List[str]] = None
    # Machine-readable step category (e.g. "SELECT_ACTIVE_SEGMENT"), additive
    # to the human-readable `title`/`description`. Optional and unset by
    # ECMP/DISTANCE_VECTOR today — introduced for Segment Routing so a future
    # frontend can dispatch on a stable key instead of matching on title text.
    stepType: Optional[str] = None
    # Segment Routing only: index of the currently active waypoint within
    # `segmentList` (which stop, in order, is being routed toward right now).
    activeSegmentIndex: Optional[int] = None
    # Segment Routing only: the demand's ordered waypoint stops (segments +
    # final destination), for rendering a segment-list / SID panel.
    segmentList: Optional[List[str]] = None

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

class GradeRequest(BaseModel):
    """Request body for POST /grade.

    Either assignmentId (to load from MongoDB) or assignment (embedded doc)
    must be provided. If both are absent, grading returns an error result.
    """
    assignmentId: Optional[str] = None
    assignment: Optional[Dict[str, Any]] = None
    submittedNetwork: NetworkInput
    submittedAlgorithmConfig: AlgorithmConfig
    submittedAnswers: Dict[str, Any] = Field(default_factory=dict)
    hintsUsed: int = 0
    studentId: Optional[str] = None
