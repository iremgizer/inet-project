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

export interface LinkInput {
  id: string;
  source: string;
  target: string;
  capacity: number;
  weight: number;
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

export interface AlgorithmConfig {
  selectedAlgorithm: AlgorithmName;
  algorithmType: AlgorithmType;
  objective: ObjectiveType;
  congestionThreshold: number;
  maxTraceEvents?: number;
}

export interface SimulationRequest {
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
}

export interface PathShare {
  nodes: string[];
  cost: number;
  trafficShare: number;
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
