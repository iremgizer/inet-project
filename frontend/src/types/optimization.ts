import { AlgorithmConfig, NetworkInput } from "./network";

// ── Sprint 2 — Optimization Lab types ──────────────────────────────────────
// Mirrors backend/app/optimization/models.py field-for-field. This is the
// ONLY place OptimizationResult's shape is declared on the frontend — do
// not duplicate individual fields elsewhere.

export type OptimizationStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "TIME_LIMIT" | "ERROR";

export type OptimizationResultMode =
  | "OPT"
  | "WAYPOINT_OPTIMIZATION"
  | "LINK_WEIGHT_OPTIMIZATION"
  | "JOINT_OPTIMIZATION";

export type SearchMethod =
  | "EXACT_ENUMERATION"
  | "GREEDY_WPO"
  | "HEURISTIC_LWO"
  | "EXACT_JOINT_ENUMERATION"
  | "JOINT_ALTERNATING";

export interface FlowAssignment {
  demandId: string;
  nodes: string[];
  share: number;
}

export interface WaypointAssignmentEntry {
  demandId: string;
  waypointNodeId: string | null;
}

export interface OptimizationResult {
  mode: OptimizationResultMode;
  status: OptimizationStatus;
  objectiveValue: number;
  mlu: number;
  linkLoads: Record<string, number>;
  linkUtilizations: Record<string, number>;
  flowAssignments: FlowAssignment[];
  solverRuntime: number;
  optimalityGap?: number | null;
  solverName: string;
  message: string;
  lowerBound?: number | null;
  debugInfo: string[];

  // WAYPOINT_OPTIMIZATION / JOINT_OPTIMIZATION only.
  recommendedWaypoints?: WaypointAssignmentEntry[] | null;
  // LINK_WEIGHT_OPTIMIZATION / JOINT_OPTIMIZATION only.
  recommendedWeights?: Record<string, number> | null;
  baselineWeights?: Record<string, number> | null;

  // WAYPOINT_OPTIMIZATION / LINK_WEIGHT_OPTIMIZATION / JOINT_OPTIMIZATION.
  baselineMLU?: number | null;
  optimizedMLU?: number | null;
  improvement?: number | null;
  searchMethod?: SearchMethod | null;
  searchSpaceSize?: number | null;
  evaluatedCandidates?: number | null;
  provenOptimal?: boolean | null;

  // JOINT_OPTIMIZATION only.
  iterations?: number | null;
  convergenceReason?: string | null;
}

// ── Optimization Lab's own vocabulary — one entry per card ─────────────────
// "CURRENT" is not a backend mode at all — it represents the network's own
// already-simulated result, shown as the reference card every optimization
// is compared against. The other four map 1:1 to OptimizeRequest.mode.
export type OptimizationLabMode = "CURRENT" | "OPT" | "WPO" | "LWO" | "JOINT";

export type BackendOptimizeMode = "OPT" | "WPO" | "LWO" | "JOINT";

export interface OptimizeRequest {
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
  mode: BackendOptimizeMode;
  maxWaypointsPerDemand?: number;
  minWeight?: number;
  maxWeight?: number;
  maxExactCombinations?: number;
  maxIterations?: number;
  epsilon?: number;
}
