import { SimulationRequest, SimulationResult, NetworkInput, SavedSimulationRun, SavedSimulationSummary } from "../types/network";

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
