import { SimulationRequest, SimulationResult, NetworkInput } from "../types/network";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

export async function simulateNetwork(request: SimulationRequest): Promise<SimulationResult> {
  const response = await fetch(`${BASE_URL}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Simulation failed");
  }
  return response.json();
}

export async function loadTopology(type: string): Promise<NetworkInput> {
  const response = await fetch(`${BASE_URL}/topology/${type}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to load topology");
  }
  return response.json();
}
