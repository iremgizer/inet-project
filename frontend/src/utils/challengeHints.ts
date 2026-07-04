import { ChallengeType, Hint } from "../types/challenge";

// Default hints generated when teacher hasn't defined custom ones.
// Each challenge type gets 3 progressive hints: conceptual → calculation → solution direction.

function makeHint(
  id: string,
  level: Hint["level"],
  title: string,
  text: string,
  opts: Partial<Hint> = {},
): Hint {
  return {
    hintId: id,
    level,
    title,
    text,
    relatedNodeIds: opts.relatedNodeIds ?? [],
    relatedLinkIds: opts.relatedLinkIds ?? [],
    revealCostPenalty: opts.revealCostPenalty ?? 0,
  };
}

const DEFAULT_HINTS: Record<ChallengeType, Hint[]> = {
  IDENTIFY_CONGESTED_LINKS: [
    makeHint("icl-h1", "conceptual",
      "What makes a link congested?",
      "A link is congested when its total traffic load exceeds its capacity. Utilization = Load / Capacity. When utilization > 100%, the link is congested.",
      { revealCostPenalty: 0 },
    ),
    makeHint("icl-h2", "calculation",
      "How does ECMP distribute traffic?",
      "ECMP splits each demand equally among all shortest-cost paths. To find the load on a link, sum the traffic from every demand that routes through it.",
      { revealCostPenalty: 10 },
    ),
    makeHint("icl-h3", "solution_direction",
      "How to identify congested links in the UI",
      "Run the simulation. In the canvas, links shown in red (or orange) exceed capacity. Hover a link to see its exact load and utilization. The Results panel on the right also lists all link utilizations.",
      { revealCostPenalty: 20 },
    ),
  ],

  REDUCE_CONGESTION: [
    makeHint("rc-h1", "conceptual",
      "How do link weights affect routing?",
      "ECMP selects all shortest-cost paths for each demand. Increasing the weight on a link raises that path's total cost, making ECMP prefer other paths. Decreasing a weight does the opposite.",
      { revealCostPenalty: 0 },
    ),
    makeHint("rc-h2", "calculation",
      "Find which links feed the congested one",
      "Identify the congested link (red in the canvas). Look at which demands route traffic through it. Then trace back which incoming link weights you can increase to redirect those flows.",
      { revealCostPenalty: 10 },
    ),
    makeHint("rc-h3", "solution_direction",
      "Strategy: redirect traffic away from the bottleneck",
      "Select the congested link and raise the weight of the links that lead to it. This forces ECMP to use an alternative path. Re-run the simulation to verify the utilization drops below 100%.",
      { revealCostPenalty: 20 },
    ),
  ],

  FIND_ECMP_WEIGHTS: [
    makeHint("few-h1", "conceptual",
      "Equal-cost paths share traffic equally",
      "ECMP routes traffic evenly across all paths with the same total cost. Your goal is to set weights so that multiple equal-cost paths exist, spreading load across links.",
      { revealCostPenalty: 0 },
    ),
    makeHint("few-h2", "calculation",
      "Compute total path costs",
      "For a path to be included in ECMP, its total weight must equal the minimum cost among all paths. Calculate the cost of each candidate path and adjust weights to make them equal.",
      { revealCostPenalty: 10 },
    ),
    makeHint("few-h3", "solution_direction",
      "Try symmetric weights first",
      "Setting all links to weight = 1 creates equal-cost paths through all symmetric routes. Adjust individual weights from there if you need to steer traffic more precisely.",
      { revealCostPenalty: 20 },
    ),
  ],

  COMPUTE_ECMP_SPLIT: [
    makeHint("ces-h1", "conceptual",
      "ECMP splits traffic equally",
      "Equal-Cost Multi-Path (ECMP) routing divides a demand's traffic equally among all shortest paths. If there are N equal-cost paths, each carries 1/N of the demand.",
      { revealCostPenalty: 0 },
    ),
    makeHint("ces-h2", "calculation",
      "Count the shortest paths",
      "First compute the cost of every path from source to destination. Only paths with the minimum cost are used. Count those equal-cost paths — that count is the divisor for the split.",
      { revealCostPenalty: 10 },
    ),
    makeHint("ces-h3", "solution_direction",
      "Read the path results after simulation",
      "Run the simulation. In the Results panel, expand 'Path Results' for each demand. Each path shows its trafficShare (as a fraction). Multiply by the demand amount to get absolute traffic.",
      { revealCostPenalty: 20 },
    ),
  ],

  COMPUTE_DV_TABLE: [
    makeHint("dv-h1", "conceptual",
      "Distance Vector finds the shortest path cost",
      "Distance Vector routing computes the shortest (minimum-cost) path from each node to every destination. The cost of a path is the sum of all link weights along it. The next hop is the first neighbor on that shortest path.",
      { revealCostPenalty: 0 },
    ),
    makeHint("dv-h2", "calculation",
      "Sum the link weights along the path",
      "List every possible path from source to destination. Add the weights of each link along each path. The path with the smallest total is the shortest path. That total is the cost.",
      { revealCostPenalty: 10 },
    ),
    makeHint("dv-h3", "solution_direction",
      "Check the Routing Table panel after running DV",
      "Run the simulation with Distance Vector. Open the Routing Table panel on the right side. Find the row for your source node → destination node to read the cost and next hop directly.",
      { revealCostPenalty: 20 },
    ),
  ],

  PREDICT_SHORTEST_PATH: [
    makeHint("psp-h1", "conceptual",
      "Shortest path minimizes total link weight",
      "The shortest path is the one whose sum of link weights is lowest — not necessarily the fewest hops. Two paths may have equal costs; either is acceptable.",
      { revealCostPenalty: 0 },
    ),
    makeHint("psp-h2", "calculation",
      "Enumerate paths and compute costs",
      "List every simple path (no repeated nodes) from source to destination. For each, add up all link weights. The path(s) with the minimum total cost are the shortest path(s).",
      { revealCostPenalty: 10 },
    ),
    makeHint("psp-h3", "solution_direction",
      "Verify with Distance Vector simulation",
      "Run Distance Vector. The Routing Table panel shows the next hop for each node → destination pair. Trace hops from source to destination to reconstruct the full shortest path.",
      { revealCostPenalty: 20 },
    ),
  ],
};

export function getDefaultHints(challengeType: ChallengeType): Hint[] {
  return DEFAULT_HINTS[challengeType] ?? [];
}

/** Returns the hints to display: teacher-defined if present, otherwise defaults. */
export function resolveHints(challengeType: ChallengeType, teacherHints: Hint[]): Hint[] {
  return teacherHints.length > 0 ? teacherHints : getDefaultHints(challengeType);
}
