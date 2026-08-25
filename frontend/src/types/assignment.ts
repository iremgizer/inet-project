import { AlgorithmConfig, AlgorithmName, NetworkInput } from "./network";
import { ChallengeConfig } from "./challenge";

export type AppMode = "lab" | "teacher" | "student" | "challenge";

export type AssignmentTopic = "ECMP" | "DISTANCE_VECTOR" | "SEGMENT_ROUTING" | "TRAFFIC_ENGINEERING";
export type AssignmentMode = "lecture" | "exercise" | "challenge";
export type TaskType =
  | "SET_LINK_WEIGHTS"
  | "IDENTIFY_CONGESTED_LINKS"
  | "COMPUTE_PATH_COSTS"
  | "COMPUTE_ECMP_SPLIT"
  | "COMPUTE_DV_TABLE"
  | "REDUCE_MAX_UTILIZATION";

export interface LockedFields {
  canEditNodes: boolean;
  canEditLinks: boolean;
  canEditWeights: boolean;
  canEditCapacities: boolean;
  canEditDemands: boolean;
  canChooseAlgorithm: boolean;
}

export interface StudentTask {
  taskType: TaskType;
  prompt: string;
  instructions: string;
  answerFormatDescription: string;
}

export interface DVEntry {
  nodeId: string;
  destinationId: string;
  cost: number;
  nextHop: string | null;
}

export interface ExpectedSolution {
  weights?: Record<string, number>;
  congestedLinks?: string[];
  pathCosts?: Record<string, number>;
  trafficSplits?: Record<string, number>;
  distanceVectorEntries?: DVEntry[];
  maxUtilizationTarget?: number;
  explanation?: string;
}

export interface GradingRules {
  tolerance: number;
  requireExactLinks: boolean;
  allowEquivalentWeights: boolean;
  maxScore: number;
}

// ── Demo Scenario Pack ──────────────────────────────────────────────────────
// Additive-only — see backend/app/models.py's DemoScenarioMeta docstring.
// `demoScenario` is dashboard/organizational metadata only; any
// optimization-related fields on it are UI hints (what budget to try), never
// a stored expected result. The real teaching claim always comes from a
// fresh /simulate or /optimize call, exactly like every other run.
// "Demo Scenarios" is the single category the curated, student-facing pack
// uses; the five before it are kept only because the original 16 (internal
// backend/test fixture) scenarios still carry them — see
// backend/app/demo/demo_scenarios.py's module docstring.
export type DemoCategory =
  | "Routing Basics" | "Traffic Engineering" | "Failures" | "Optimization" | "Optimization Complexity"
  | "Demo Scenarios";
export type DemoComplexity = "Beginner" | "Intermediate" | "Advanced";
export type DemoOptimizationMode = "OPT" | "WPO" | "LWO" | "JOINT";

export interface DemoScenarioMeta {
  category: DemoCategory;
  order: number;
  shortDescription: string;
  complexity?: DemoComplexity | null;
  recommended: boolean;
  tags: string[];
  optimizationMode?: DemoOptimizationMode | null;
  recommendedBudget?: number | null;
  alternateBudget?: number | null;
  recommendedMinWeight?: number | null;
  recommendedMaxWeight?: number | null;
  /** Short attribution line for a scenario reproducing a real course
   * exercise (e.g. "INET Network Algorithms — Exercise 2") — never the
   * exercise's own text/PDF content, just a citation. */
  courseSource?: string | null;
}

export interface Assignment {
  assignmentId: string;
  title: string;
  description: string;
  course: string;
  topic: AssignmentTopic;
  mode: AssignmentMode;
  starterNetwork: NetworkInput;
  lockedFields: LockedFields;
  allowedAlgorithms: AlgorithmName[];
  studentTask: StudentTask;
  expectedSolution: ExpectedSolution | null;
  gradingRules: GradingRules;
  challengeConfig?: ChallengeConfig;
  starterAlgorithmConfig?: AlgorithmConfig | null;
  demoScenario?: DemoScenarioMeta | null;
  createdAt: string;
  updatedAt: string;
}

// Lightweight summary shape returned by GET /demo-scenarios — everything
// needed for a dashboard card, nothing needed to actually run one (no
// starterNetwork/starterAlgorithmConfig — fetch the full Assignment via
// GET /assignments/{id}/student, the same student-safe endpoint every other
// "open an assignment" flow already uses, to actually open it).
export interface DemoScenarioSummary {
  assignmentId: string;
  title: string;
  description: string;
  course: string;
  topic: AssignmentTopic;
  mode: AssignmentMode;
  allowedAlgorithms: AlgorithmName[];
  demoScenario: DemoScenarioMeta;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentSummary {
  assignmentId: string;
  title: string;
  course: string;
  topic: AssignmentTopic;
  mode: AssignmentMode;
  taskType: TaskType;
  createdAt: string;
  updatedAt: string;
}

export interface StudentSubmission {
  submissionId: string;
  assignmentId: string;
  studentName: string;
  submittedNetwork: NetworkInput;
  submittedAlgorithmConfig: AlgorithmConfig;
  submittedAnswers: Record<string, unknown>;
  createdAt: string;
}

export interface GradingResult {
  score: number;
  maxScore: number;
  passed: boolean;
  feedback: string;
  details: Record<string, unknown>;
}
