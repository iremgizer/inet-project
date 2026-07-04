import {
  Assignment, AssignmentMode, AssignmentTopic, DVEntry, ExpectedSolution,
  GradingResult, GradingRules, LockedFields, StudentSubmission, StudentTask, TaskType,
} from "../types/assignment";
import { AlgorithmConfig, AlgorithmName } from "../types/network";
import { validateTopologyJson } from "./topologyJson";

// ── Validation ────────────────────────────────────────────────────────────────

export interface AssignmentValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_TOPICS: AssignmentTopic[] = ["ECMP", "DISTANCE_VECTOR", "SEGMENT_ROUTING", "TRAFFIC_ENGINEERING"];
const VALID_MODES: AssignmentMode[] = ["lecture", "exercise", "challenge"];
const VALID_TASK_TYPES: TaskType[] = [
  "SET_LINK_WEIGHTS", "IDENTIFY_CONGESTED_LINKS", "COMPUTE_PATH_COSTS",
  "COMPUTE_ECMP_SPLIT", "COMPUTE_DV_TABLE", "REDUCE_MAX_UTILIZATION",
];
const VALID_ALGORITHMS: AlgorithmName[] = ["ECMP", "DISTANCE_VECTOR", "SEGMENT_ROUTING", "CUSTOM_SPLITTING"];

export function validateAssignmentJson(raw: unknown): AssignmentValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["Root value must be a JSON object."] };
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.title || typeof obj.title !== "string") errors.push('"title" must be a non-empty string.');
  if (typeof obj.description !== "string") errors.push('"description" must be a string.');
  if (!VALID_TOPICS.includes(obj.topic as AssignmentTopic))
    errors.push(`"topic" must be one of: ${VALID_TOPICS.join(", ")}.`);
  if (!VALID_MODES.includes(obj.mode as AssignmentMode))
    errors.push(`"mode" must be one of: ${VALID_MODES.join(", ")}.`);

  if (typeof obj.starterNetwork !== "object" || obj.starterNetwork === null) {
    errors.push('"starterNetwork" must be an object.');
  } else {
    const netResult = validateTopologyJson(obj.starterNetwork);
    if (!netResult.valid) errors.push(...netResult.errors.map((e) => `starterNetwork → ${e}`));
  }

  if (!Array.isArray(obj.allowedAlgorithms) || (obj.allowedAlgorithms as unknown[]).length === 0) {
    errors.push('"allowedAlgorithms" must be a non-empty array.');
  } else {
    const invalid = (obj.allowedAlgorithms as unknown[]).filter((a) => !VALID_ALGORITHMS.includes(a as AlgorithmName));
    if (invalid.length) errors.push(`Invalid algorithm(s): ${invalid.join(", ")}.`);
  }

  if (typeof obj.studentTask !== "object" || obj.studentTask === null) {
    errors.push('"studentTask" must be an object.');
  } else {
    const task = obj.studentTask as Record<string, unknown>;
    if (!VALID_TASK_TYPES.includes(task.taskType as TaskType))
      errors.push(`"studentTask.taskType" must be one of: ${VALID_TASK_TYPES.join(", ")}.`);
    if (!task.prompt || typeof task.prompt !== "string")
      errors.push('"studentTask.prompt" must be a non-empty string.');
  }

  return { valid: errors.length === 0, errors };
}

// ── Import / Export ───────────────────────────────────────────────────────────

export function importAssignmentJson(data: Record<string, unknown>): Assignment {
  const now = new Date().toISOString();
  return {
    assignmentId: (data.assignmentId as string) || makeId(),
    title: data.title as string,
    description: (data.description as string) || "",
    course: (data.course as string) || "",
    topic: data.topic as AssignmentTopic,
    mode: (data.mode as AssignmentMode) || "exercise",
    starterNetwork: data.starterNetwork as Assignment["starterNetwork"],
    lockedFields: (data.lockedFields as LockedFields) || defaultLockedFields(),
    allowedAlgorithms: (data.allowedAlgorithms as AlgorithmName[]) || ["ECMP"],
    studentTask: data.studentTask as StudentTask,
    expectedSolution: (data.expectedSolution as ExpectedSolution | null) ?? null,
    gradingRules: (data.gradingRules as GradingRules) || defaultGradingRules(),
    createdAt: (data.createdAt as string) || now,
    updatedAt: now,
  };
}

export function exportAssignmentJson(assignment: Assignment): string {
  return JSON.stringify(assignment, null, 2);
}

export function downloadAssignmentJson(assignment: Assignment): void {
  blobDownload(exportAssignmentJson(assignment), `assignment-${assignment.assignmentId.slice(0, 8)}.json`);
}

export function downloadExampleAssignmentJson(): void {
  const example: Record<string, unknown> = {
    assignmentId: "my-assignment-id",
    title: "Example Assignment",
    description: "Describe what students need to do.",
    course: "Network Algorithms 101",
    topic: "ECMP",
    mode: "exercise",
    starterNetwork: {
      nodes: [
        { id: "u", label: "u", x: 200, y: 180 },
        { id: "t", label: "t", x: 500, y: 180 },
      ],
      links: [{ id: "l1", source: "u", target: "t", weight: 1, capacity: 10 }],
      demands: [{ id: "d1", source: "u", target: "t", amount: 1 }],
      topologyType: "custom",
      isDirected: false,
    },
    lockedFields: defaultLockedFields(),
    allowedAlgorithms: ["ECMP"],
    studentTask: {
      taskType: "IDENTIFY_CONGESTED_LINKS",
      prompt: "Which links become congested under ECMP?",
      instructions: "Run the simulation and observe.",
      answerFormatDescription: "Enter link IDs separated by commas.",
    },
    expectedSolution: null,
    gradingRules: defaultGradingRules(),
  };
  blobDownload(JSON.stringify(example, null, 2), "example-assignment.json");
}

// ── Submission ────────────────────────────────────────────────────────────────

export function createSubmissionTemplate(assignment: Assignment, studentName = ""): StudentSubmission {
  const cfg: AlgorithmConfig = {
    selectedAlgorithm: assignment.allowedAlgorithms[0],
    algorithmType: "real_world_heuristic",
    objective: "minimize_max_utilization",
    congestionThreshold: 1.0,
  };
  return {
    submissionId: makeId(),
    assignmentId: assignment.assignmentId,
    studentName,
    submittedNetwork: structuredClone(assignment.starterNetwork),
    submittedAlgorithmConfig: cfg,
    submittedAnswers: {},
    createdAt: new Date().toISOString(),
  };
}

export function exportSubmissionJson(submission: StudentSubmission): string {
  return JSON.stringify(submission, null, 2);
}

export function downloadSubmissionJson(submission: StudentSubmission): void {
  blobDownload(exportSubmissionJson(submission), `submission-${submission.submissionId.slice(0, 8)}.json`);
}

export function downloadSubmissionTemplate(assignment: Assignment, studentName = ""): void {
  downloadSubmissionJson(createSubmissionTemplate(assignment, studentName));
}

// ── Local grading ─────────────────────────────────────────────────────────────

export function gradeSubmission(
  submission: StudentSubmission,
  assignment: Assignment,
): GradingResult {
  const maxScore = assignment.gradingRules.maxScore;
  const noSolution: GradingResult = {
    score: 0, maxScore, passed: false,
    feedback: "No expected solution has been defined for this assignment.",
    details: {},
  };

  if (!assignment.expectedSolution) return noSolution;

  const { expectedSolution, gradingRules, studentTask } = assignment;
  const { taskType } = studentTask;
  const answers = submission.submittedAnswers;
  const tol = gradingRules.tolerance;

  if (taskType === "IDENTIFY_CONGESTED_LINKS") {
    const expected = new Set(expectedSolution.congestedLinks ?? []);
    const raw = answers.congestedLinks;
    const submitted = new Set(
      Array.isArray(raw) ? raw as string[]
      : typeof raw === "string" ? raw.split(",").map((s: string) => s.trim()).filter(Boolean)
      : []
    );
    const passed = setsEqual(expected, submitted);
    return {
      score: passed ? maxScore : 0,
      maxScore, passed,
      feedback: passed
        ? `Correct! The congested link(s): ${[...expected].join(", ")}.`
        : `Incorrect. You answered: ${[...submitted].join(", ") || "(none)"}. Expected: ${[...expected].join(", ")}.`,
      details: { expected: [...expected], submitted: [...submitted] },
    };
  }

  if (taskType === "COMPUTE_DV_TABLE") {
    const entries = expectedSolution.distanceVectorEntries ?? [];
    const costAns = Number(answers.pathCost);
    const nextHopAns = String(answers.nextHop ?? "").trim().toLowerCase();

    // Check against the first entry (A→D)
    const target = entries[0];
    if (!target) return noSolution;

    const costOk = Math.abs(costAns - target.cost) <= tol;
    // Next hop: match by id or by label via the network
    const nextHopOk =
      nextHopAns === (target.nextHop ?? "").toLowerCase() ||
      submission.submittedNetwork.nodes
        .find((n) => n.id === target.nextHop)
        ?.label.toLowerCase() === nextHopAns;

    const passed = costOk && nextHopOk;
    return {
      score: passed ? maxScore : Math.round(maxScore * (costOk ? 0.5 : 0) + maxScore * (nextHopOk ? 0.5 : 0)),
      maxScore, passed,
      feedback: passed
        ? `Correct! Cost = ${target.cost}, next hop = ${target.nextHop}.`
        : [
            costOk ? null : `Cost: you answered ${costAns}, expected ${target.cost}.`,
            nextHopOk ? null : `Next hop: you answered "${nextHopAns}", expected "${target.nextHop}".`,
          ].filter(Boolean).join(" "),
      details: { expected: target, submitted: { pathCost: costAns, nextHop: nextHopAns } },
    };
  }

  if (taskType === "REDUCE_MAX_UTILIZATION") {
    const target = expectedSolution.maxUtilizationTarget ?? 1.0;
    const maxUtil = answers.maxUtilization as number | undefined;
    if (maxUtil === undefined) {
      return { score: 0, maxScore, passed: false, feedback: "Run the simulation first to compute max utilization.", details: {} };
    }
    const passed = maxUtil <= target + tol;
    return {
      score: passed ? maxScore : 0,
      maxScore, passed,
      feedback: passed
        ? `Max utilization ${(maxUtil * 100).toFixed(1)}% ≤ target ${(target * 100).toFixed(1)}%. `
        : `Max utilization ${(maxUtil * 100).toFixed(1)}% exceeds target ${(target * 100).toFixed(1)}%.`,
      details: { maxUtilization: maxUtil, target },
    };
  }

  // For other task types: placeholder
  return {
    score: 0, maxScore, passed: false,
    feedback: `Auto-grading for task type "${taskType}" is not yet implemented. Ask your teacher to review your submission.`,
    details: {},
  };
}

// ── Parse file ────────────────────────────────────────────────────────────────

export function parseAssignmentFile(file: File): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { resolve(JSON.parse(e.target?.result as string)); }
      catch { reject(new Error("Invalid JSON file.")); }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export function defaultLockedFields(): LockedFields {
  return {
    canEditNodes: false,
    canEditLinks: false,
    canEditWeights: true,
    canEditCapacities: false,
    canEditDemands: false,
    canChooseAlgorithm: false,
  };
}

export function defaultGradingRules(): GradingRules {
  return { tolerance: 0.01, requireExactLinks: false, allowEquivalentWeights: true, maxScore: 100 };
}

export function defaultStudentTask(): StudentTask {
  return {
    taskType: "IDENTIFY_CONGESTED_LINKS",
    prompt: "",
    instructions: "",
    answerFormatDescription: "",
  };
}

export function newAssignmentDraft(): Partial<Assignment> {
  const now = new Date().toISOString();
  return {
    assignmentId: makeId(),
    title: "",
    description: "",
    course: "",
    topic: "ECMP",
    mode: "exercise",
    starterNetwork: { nodes: [], links: [], demands: [], topologyType: "custom", isDirected: false },
    lockedFields: defaultLockedFields(),
    allowedAlgorithms: ["ECMP"],
    studentTask: defaultStudentTask(),
    expectedSolution: null,
    gradingRules: defaultGradingRules(),
    createdAt: now,
    updatedAt: now,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blobDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
