import { LinkResult, PathResult, LinkInput } from "../types/network";

export type EdgeKey = string;

export function edgeKey(source: string, target: string) {
  return `${source}-->${target}`;
}

export function getHighlightedEdges(pathResults: PathResult[], isDirected: boolean) {
  const edgeSet = new Set<EdgeKey>();
  for (const pathResult of pathResults) {
    for (const share of pathResult.paths) {
      for (let i = 0; i < share.nodes.length - 1; i++) {
        edgeSet.add(edgeKey(share.nodes[i], share.nodes[i + 1]));
        if (!isDirected) {
          edgeSet.add(edgeKey(share.nodes[i + 1], share.nodes[i]));
        }
      }
    }
  }
  return edgeSet;
}

export function getLinkStyle(link: LinkInput, result: LinkResult | undefined) {
  const baseThickness = 2;
  const loadThickness = result ? Math.min(10, 2 + result.utilization * 6) : baseThickness;
  let color = "#607d8b";
  if (result) {
    if (result.utilization > 1.0) {
      color = "#d32f2f";
    } else if (result.utilization > 0.7) {
      color = "#f57c00";
    } else {
      color = "#1976d2";
    }
  }
  return { stroke: color, strokeWidth: loadThickness };
}
