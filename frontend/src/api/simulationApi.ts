import { SimulationRequest, SimulationResult, NetworkInput, SavedSimulationRun, SavedSimulationSummary } from "../types/network";
import { Assignment, AssignmentSummary, StudentSubmission } from "../types/assignment";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

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
