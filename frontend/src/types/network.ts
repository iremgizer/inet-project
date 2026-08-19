export type TopologyType = "custom" | "triangle" | "line" | "ring" | "mesh" | "fat-tree" | "grid" | "path" | "cycle" | "random";
export type AlgorithmName = "ECMP" | "DISTANCE_VECTOR" | "SEGMENT_ROUTING" | "CUSTOM_SPLITTING";
export type AlgorithmType = "exact" | "real_world_heuristic" | "custom";
export type ObjectiveType = "minimize_max_utilization" | "minimize_path_cost";

export interface NodeInput {
  id: string;
  label: string;
  x: number;
  y: number;
  visualType?: string;
}

export type LinkOperationalStatus = "UP" | "DOWN";

export interface LinkInput {
  id: string;
  source: string;
  target: string;
  capacity: number;
  weight: number;
  /** Additive scenario state, separate from physical identity/weight/
   * capacity above. A DOWN link stays in the topology (same id, weight,
   * capacity, still visible) but is excluded from routing. Optional,
   * defaults to "UP" — old networks/saved runs/JSON without this field mean
   * exactly what they always meant. */
  operationalStatus?: LinkOperationalStatus;
}

export interface TrafficDemandInput {
  id: string;
  source: string;
  target: string;
  amount: number;
}

export interface NetworkInput {
  nodes: NodeInput[];
  links: LinkInput[];
  demands: TrafficDemandInput[];
  topologyType: TopologyType;
  isDirected: boolean;
}

export interface SegmentRoutingPolicy {
  demandId: string;
  segments: string[]; // ordered waypoint node ids (source/destination excluded)
}

export type TrafficDistributionMode = "EQUAL" | "CUSTOM";

export interface PathDistribution {
  pathId: string;
  /** Fraction (0..1) of the demand's traffic on this path — NOT a link weight. */
  share: number;
}

export interface TrafficDistribution {
  demandId: string;
  mode: TrafficDistributionMode;
  /** Only read when mode === "CUSTOM"; every discovered path for the demand
   * must have an explicit entry summing to 1.0 (100%). */
  paths: PathDistribution[];
}

export type TEPolicyType = "PREFER_LINK" | "AVOID_LINK" | "FORBID_LINK" | "REQUIRE_WAYPOINT";

export interface TrafficEngineeringPolicy {
  policyId: string;
  type: TEPolicyType;
  /** undefined/null = applies to every demand; set = scoped to just this one. */
  demandId?: string | null;
  /** Used by PREFER_LINK / AVOID_LINK / FORBID_LINK. */
  linkId?: string | null;
  /** Used by REQUIRE_WAYPOINT. */
  nodeId?: string | null;
  priority: number;
  /** Overrides the default avoid/prefer cost adjustment; ignored by the two
   * hard-constraint types. */
  penalty?: number | null;
}

export interface AlgorithmConfig {
  selectedAlgorithm: AlgorithmName;
  algorithmType: AlgorithmType;
  objective: ObjectiveType;
  congestionThreshold: number;
  maxTraceEvents?: number;
  // Segment Routing V1 — optional, only meaningful when
  // selectedAlgorithm === "SEGMENT_ROUTING". No SR feature UI ships in this
  // PR; this mirrors the backend's additive, optional field.
  segmentRoutingPolicies?: SegmentRoutingPolicy[];
  // ECMP configurable traffic distribution — optional, only meaningful when
  // selectedAlgorithm === "ECMP". A demand with no entry here (or the
  // default array) splits traffic equally, exactly as ECMP always has.
  trafficDistributions?: TrafficDistribution[];
  // Traffic Engineering policies — optional, algorithm-agnostic routing
  // intent read by ECMP and Segment Routing (Distance Vector ignores them
  // and reports why via debugInfo). An empty array has zero effect.
  tePolicies?: TrafficEngineeringPolicy[];
}

export interface SimulationRequest {
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
}

export interface PathShare {
  nodes: string[];
  cost: number;
  trafficShare: number;
  /** Stable id ("path-1", "path-2", ...) assigned by ECMP after sorting
   * equal-cost paths lexicographically by node sequence. Undefined for
   * Distance Vector / Segment Routing (single path per demand). */
  pathId?: string | null;
}

export interface PathResult {
  demandId: string;
  source: string;
  target: string;
  paths: PathShare[];
}

export interface LinkResult {
  linkId: string;
  source: string;
  target: string;
  load: number;
  capacity: number;
  utilization: number;
  isCongested: boolean;
  weight: number;
}

export interface NodeRoleResult {
  nodeId: string;
  asSourceFor: string[];
  asDestinationFor: string[];
  asIntermediateFor: string[];
}

export interface DistanceVectorTableEntry {
  nodeId: string;
  destinationId: string;
  cost: number;
  nextHop: string | null;
}

export interface SimulationTraceEvent {
  stepId: string;
  algorithm: string;
  title: string;
  description: string;
  explanationText: string;
  highlightedNodes: string[];
  highlightedLinks: string[];
  activeDemandId?: string | null;
  pathGroupId?: string | null;
  pathColor?: string | null;
  costCalculation?: string | null;
  formulaText?: string | null;
  linkLoadDelta?: Record<string, number> | null;
  currentLinkLoads?: Record<string, number> | null;
  tablesSnapshot?: unknown;
  metadata?: Record<string, unknown> | null;
  activeNodeId?: string | null;
  activeDestinationId?: string | null;
  activeTableRowIds?: string[] | null;  // format: "nodeId::destinationId"
  stepType?: string | null;             // machine-readable step category (e.g. "SELECT_ACTIVE_SEGMENT")
  activeSegmentIndex?: number | null;   // Segment Routing: index into segmentList
  segmentList?: string[] | null;        // Segment Routing: ordered waypoint stops for this demand
}

export interface SimulationResult {
  simulationRunId: string;
  algorithm: string;
  pathResults: PathResult[];
  linkResults: LinkResult[];
  nodeRoles: NodeRoleResult[];
  distanceVectorTable?: DistanceVectorTableEntry[];
  traceEvents: SimulationTraceEvent[];
  maxUtilization: number;
  totalDeliveredTraffic: number;
  averagePathCost: number;
  congestedLinkCount: number;
  runtimeMs: number;
  debugInfo?: string[];
}

export interface SavedSimulationSummary {
  simulationRunId: string;
  name: string;
  createdAt: string;
  algorithm: string;
  topologyType: string;
  nodeCount: number;
  linkCount: number;
  demandCount: number;
  maxUtilization: number;
  congestedLinkCount: number;
}

export interface SavedSimulationRun {
  simulationRunId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
  simulationResult: SimulationResult;
  traceEvents: SimulationTraceEvent[];
  topologyType: TopologyType;
  metadata: Record<string, unknown>;
}
