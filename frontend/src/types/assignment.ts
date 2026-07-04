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
