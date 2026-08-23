import { OptimizationResult, OptimizeRequest } from "../types/optimization";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

/** The only call the Optimization Lab makes to the backend — real data,
 * every time. No mode is ever mocked or computed client-side. */
export async function runOptimization(request: OptimizeRequest): Promise<OptimizationResult> {
  const response = await fetch(`${BASE_URL}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Optimization failed"));
  }
  return response.json();
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
