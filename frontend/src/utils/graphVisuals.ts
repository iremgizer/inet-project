import { PathResult } from "../types/network";

export const PATH_PALETTE: readonly string[] = [
  "#2563eb", // blue
  "#16a34a", // green
  "#9333ea", // purple
  "#ea580c", // orange
  "#0d9488", // teal
  "#db2777", // pink
  "#ca8a04", // yellow
  "#0891b2", // cyan
];

export function getPathColor(index: number): string {
  return PATH_PALETTE[index % PATH_PALETTE.length];
}

export type UtilSeverity = "low" | "medium" | "high" | "veryhigh" | "congested";

export function getUtilSeverity(util: number): UtilSeverity {
  if (util > 1.0) return "congested";
  if (util > 0.9) return "veryhigh";
  if (util > 0.7) return "high";
  if (util > 0.4) return "medium";
  return "low";
}

export function severityStrokeWidth(severity: UtilSeverity): number {
  switch (severity) {
    case "congested": return 6;
    case "veryhigh":  return 5;
    case "high":      return 3.5;
    case "medium":    return 2.5;
    default:          return 1.8;
  }
}

export function severityGlowColor(severity: UtilSeverity): string | null {
  if (severity === "congested" || severity === "veryhigh") return "#ef4444";
  if (severity === "high") return "#f97316";
  return null;
}

export function buildDemandColorMap(pathResults: PathResult[]): Map<string, string> {
  const map = new Map<string, string>();
  pathResults.forEach((pr, i) => {
    if (!map.has(pr.demandId)) {
      map.set(pr.demandId, getPathColor(i));
    }
  });
  return map;
}

export function getLinkDemandColor(
  linkSource: string,
  linkTarget: string,
  pathResults: PathResult[],
  demandColorMap: Map<string, string>,
  isDirected: boolean
): string | null {
  for (const pr of pathResults) {
    const color = demandColorMap.get(pr.demandId);
    if (!color) continue;
    for (const share of pr.paths) {
      const nodes = share.nodes;
      for (let i = 0; i < nodes.length - 1; i++) {
        if (
          (nodes[i] === linkSource && nodes[i + 1] === linkTarget) ||
          (!isDirected && nodes[i] === linkTarget && nodes[i + 1] === linkSource)
        ) {
          return color;
        }
      }
    }
  }
  return null;
}
