import { SimulationRequest, SimulationResult, NetworkInput, SavedSimulationRun, SavedSimulationSummary, AlgorithmConfig } from "../types/network";
import { Assignment, AssignmentSummary, StudentSubmission, DemoScenarioSummary } from "../types/assignment";
import { ChallengeGradingResult } from "../types/challenge";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

/** Thrown by API calls that got a real HTTP response back (so `status` is
 * known) — as opposed to `fetch()` itself throwing (network failure, CORS
 * block, backend unreachable), which surfaces as a plain TypeError with no
 * `status` at all. Callers that need to tell "backend unreachable" apart
 * from "backend responded but rejected the request" can check
 * `err instanceof ApiError` first. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getBackendHealth(): Promise<{ status: string; mongoAvailable: boolean }> {
  const r = await fetch(`${BASE_URL}/health`);
  if (!r.ok) throw new ApiError(await readError(r, "Health check failed"), r.status);
  return r.json();
}

export async function simulateNetwork(request: SimulationRequest): Promise<SimulationResult> {
  const response = await fetch(`${BASE_URL}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Simulation failed"));
  }
  return response.json();
}

export async function loadTopology(type: string): Promise<NetworkInput> {
  const response = await fetch(`${BASE_URL}/topology/${type}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load topology"));
  }
  return response.json();
}

export async function listSavedRuns(): Promise<SavedSimulationSummary[]> {
  const response = await fetch(`${BASE_URL}/simulations`);
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load saved runs"));
  }
  return response.json();
}

export async function getSavedRun(simulationRunId: string): Promise<SavedSimulationRun> {
  const response = await fetch(`${BASE_URL}/simulations/${simulationRunId}`);
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load saved run"));
  }
  return response.json();
}

export async function deleteSavedRun(simulationRunId: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/simulations/${simulationRunId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete saved run"));
  }
}

// ── Assignment API ────────────────────────────────────────────────────────────

export async function listAssignments(): Promise<AssignmentSummary[]> {
  const r = await fetch(`${BASE_URL}/assignments`);
  if (!r.ok) throw new Error(await readError(r, "Failed to list assignments"));
  return r.json();
}

export async function getAssignment(assignmentId: string): Promise<Assignment> {
  const r = await fetch(`${BASE_URL}/assignments/${assignmentId}`);
  if (!r.ok) throw new Error(await readError(r, "Assignment not found"));
  return r.json();
}

export async function saveAssignment(assignment: Assignment): Promise<Assignment> {
  const r = await fetch(`${BASE_URL}/assignments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignment),
  });
  if (!r.ok) throw new Error(await readError(r, "Failed to save assignment"));
  return r.json();
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  const r = await fetch(`${BASE_URL}/assignments/${assignmentId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await readError(r, "Failed to delete assignment"));
}

/** Student-safe full assignment (expectedSolution stripped server-side) —
 * the same endpoint every "open an assignment" flow should use. */
export async function getAssignmentForStudent(assignmentId: string): Promise<Assignment> {
  const r = await fetch(`${BASE_URL}/assignments/${assignmentId}/student`);
  if (!r.ok) throw new Error(await readError(r, "Assignment not found"));
  return r.json();
}

// ── Demo Scenario Pack ───────────────────────────────────────────────────────

export async function listDemoScenarios(): Promise<DemoScenarioSummary[]> {
  const r = await fetch(`${BASE_URL}/demo-scenarios`);
  if (!r.ok) throw new ApiError(await readError(r, "Failed to load demo scenarios"), r.status);
  return r.json();
}

export async function seedDemoScenarios(): Promise<{ seeded: number; scenarioIds: string[]; message: string }> {
  const r = await fetch(`${BASE_URL}/seed-demo-scenarios`, { method: "POST" });
  if (!r.ok) throw new ApiError(await readError(r, "Failed to seed demo scenarios"), r.status);
  return r.json();
}

/** POST /seed-demo — the Teacher Dashboard's separate "example challenge
 * assignments" seed (distinct from the Demo Scenario Pack above). Takes the
 * raw assignment objects as the backend route itself expects. */
export async function seedDemoAssignments(assignments: unknown[]): Promise<{ seeded: number; message: string }> {
  const r = await fetch(`${BASE_URL}/seed-demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignments),
  });
  if (!r.ok) throw new ApiError(await readError(r, "Failed to seed demo assignments"), r.status);
  return r.json();
}

export async function saveSubmission(submission: StudentSubmission): Promise<StudentSubmission> {
  const r = await fetch(`${BASE_URL}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (!r.ok) throw new Error(await readError(r, "Failed to save submission"));
  return r.json();
}

export async function listSubmissionsForAssignment(assignmentId: string): Promise<StudentSubmission[]> {
  const r = await fetch(`${BASE_URL}/assignments/${assignmentId}/submissions`);
  if (!r.ok) throw new Error(await readError(r, "Failed to list submissions"));
  return r.json();
}

export async function saveChallengeAttempt(attempt: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE_URL}/challenge-attempts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attempt),
  });
  if (!r.ok) throw new Error(await readError(r, "Failed to save challenge attempt"));
  return r.json();
}

export async function listChallengeAttempts(assignmentId: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${BASE_URL}/challenge-attempts?assignmentId=${encodeURIComponent(assignmentId)}`);
  if (!r.ok) throw new Error(await readError(r, "Failed to list challenge attempts"));
  return r.json();
}

export interface GradeRequest {
  assignmentId?: string;
  assignment?: Record<string, unknown>;
  submittedNetwork: NetworkInput;
  submittedAlgorithmConfig: AlgorithmConfig;
  submittedAnswers: Record<string, unknown>;
  hintsUsed: number;
  studentId?: string;
}

export async function gradeAttempt(request: GradeRequest): Promise<ChallengeGradingResult> {
  const r = await fetch(`${BASE_URL}/grade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!r.ok) throw new Error(await readError(r, "Grading failed"));
  return r.json();
}

async function readError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((item: { msg?: string }) => item.msg || JSON.stringify(item)).join("; ");
    }
  } catch {
    const text = await response.text();
    if (text) return text;
  }
  return fallback;
}
