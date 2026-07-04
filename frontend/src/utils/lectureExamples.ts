import { AlgorithmConfig, NetworkInput } from "../types/network";

// ── Lecture example definition ────────────────────────────────────────────────

export interface LectureExample {
  id: string;
  title: string;
  category: string;
  tagline: string;
  description: string;
  whatToWatch: string[];
  insight: string;
  network: NetworkInput;
  algorithmConfig: AlgorithmConfig;
}

// ── ECMP Triangle ─────────────────────────────────────────────────────────────
//
// Topology: u ─(2)─ t
//            \     /
//            (1) (1)
//              v
//
// Demands: u→t = 1.5,  v→t = 0.5
//
// Cost of u→t directly   = 2
// Cost of u→v→t          = 1 + 1 = 2   (equal-cost!)
// ECMP splits u→t demand: 0.75 each path
//
// Link v-t load = 0.75 (from u→t split) + 0.5 (v→t demand) = 1.25
// Utilization   = 1.25 / 1.0 = 125%  → congested
//
// Key insight: no weight change can prevent this — the two demands
// structurally force > 100% on v-t.

const ecmpTriangleNetwork: NetworkInput = {
  nodes: [
    { id: "u", label: "u", x: 200, y: 180 },
    { id: "v", label: "v", x: 400, y: 360 },
    { id: "t", label: "t", x: 600, y: 180 },
  ],
  links: [
    { id: "u-t", source: "u", target: "t", capacity: 1.0, weight: 2.0 },
    { id: "u-v", source: "u", target: "v", capacity: 1.0, weight: 1.0 },
    { id: "v-t", source: "v", target: "t", capacity: 1.0, weight: 1.0 },
  ],
  demands: [
    { id: "d-ut", source: "u", target: "t", amount: 1.5 },
    { id: "d-vt", source: "v", target: "t", amount: 0.5 },
  ],
  topologyType: "triangle",
  isDirected: false,
};

const ecmpTriangleConfig: AlgorithmConfig = {
  selectedAlgorithm: "ECMP",
  algorithmType: "real_world_heuristic",
  objective: "minimize_max_utilization",
  congestionThreshold: 1.0,
};

// ── DV Path Graph P4 ──────────────────────────────────────────────────────────
//
// Topology: A ─(10)─ B ─(10)─ C ─(10)─ D
//
// Distance Vector on a simple 4-node chain.
// Shows how Bellman-Ford propagates cost tables hop by hop.
// Each node learns the next-hop and total cost to every destination.
//
// Final shortest path A→D: cost = 30 (via A→B→C→D)

const dvP4Network: NetworkInput = {
  nodes: [
    { id: "n1", label: "A", x: 80,  y: 260 },
    { id: "n2", label: "B", x: 240, y: 260 },
    { id: "n3", label: "C", x: 400, y: 260 },
    { id: "n4", label: "D", x: 560, y: 260 },
  ],
  links: [
    { id: "l1", source: "n1", target: "n2", weight: 10, capacity: 10 },
    { id: "l2", source: "n2", target: "n3", weight: 10, capacity: 10 },
    { id: "l3", source: "n3", target: "n4", weight: 10, capacity: 10 },
  ],
  demands: [
    { id: "d1", source: "n1", target: "n4", amount: 1 },
  ],
  topologyType: "path",
  isDirected: false,
};

const dvP4Config: AlgorithmConfig = {
  selectedAlgorithm: "DISTANCE_VECTOR",
  algorithmType: "real_world_heuristic",
  objective: "minimize_path_cost",
  congestionThreshold: 1.0,
};

// ── DV Grid (3×3) ─────────────────────────────────────────────────────────────
//
// Topology: 3×3 grid, all weights = 1
//
//   A ─ B ─ C
//   │   │   │
//   D ─ E ─ F
//   │   │   │
//   G ─ H ─ I
//
// Demand: A → I  (top-left to bottom-right)
// Shortest path cost = 4 (2 rights + 2 downs, or 2 downs + 2 rights)
// DV finds multiple equal-cost routes and picks one.

const dvGridNetwork: NetworkInput = {
  nodes: [
    { id: "n1", label: "A", x: 80,  y: 80  },
    { id: "n2", label: "B", x: 360, y: 80  },
    { id: "n3", label: "C", x: 640, y: 80  },
    { id: "n4", label: "D", x: 80,  y: 280 },
    { id: "n5", label: "E", x: 360, y: 280 },
    { id: "n6", label: "F", x: 640, y: 280 },
    { id: "n7", label: "G", x: 80,  y: 480 },
    { id: "n8", label: "H", x: 360, y: 480 },
    { id: "n9", label: "I", x: 640, y: 480 },
  ],
  links: [
    { id: "l1",  source: "n1", target: "n2", weight: 1, capacity: 10 },
    { id: "l2",  source: "n2", target: "n3", weight: 1, capacity: 10 },
    { id: "l3",  source: "n4", target: "n5", weight: 1, capacity: 10 },
    { id: "l4",  source: "n5", target: "n6", weight: 1, capacity: 10 },
    { id: "l5",  source: "n7", target: "n8", weight: 1, capacity: 10 },
    { id: "l6",  source: "n8", target: "n9", weight: 1, capacity: 10 },
    { id: "l7",  source: "n1", target: "n4", weight: 1, capacity: 10 },
    { id: "l8",  source: "n4", target: "n7", weight: 1, capacity: 10 },
    { id: "l9",  source: "n2", target: "n5", weight: 1, capacity: 10 },
    { id: "l10", source: "n5", target: "n8", weight: 1, capacity: 10 },
    { id: "l11", source: "n3", target: "n6", weight: 1, capacity: 10 },
    { id: "l12", source: "n6", target: "n9", weight: 1, capacity: 10 },
  ],
  demands: [
    { id: "d1", source: "n1", target: "n9", amount: 1 },
  ],
  topologyType: "grid",
  isDirected: false,
};

const dvGridConfig: AlgorithmConfig = {
  selectedAlgorithm: "DISTANCE_VECTOR",
  algorithmType: "real_world_heuristic",
  objective: "minimize_path_cost",
  congestionThreshold: 1.0,
};

// ── Clos Fat-Tree ECMP ────────────────────────────────────────────────────────
//
// Topology: 2 spines, 4 leaves, 8 hosts (small Clos fat-tree)
// All link weights = 1, capacity = 10
//
//      S1           S2
//    /    \       /    \
//   L1    L2   L3    L4
//  / \   / \  / \   / \
// H1 H2 H3 H4 H5 H6 H7 H8
//
// Demand: H1 → H8 (cross-pod traffic, typical data-center pattern)
//
// ECMP finds 2 equal-cost paths (both cost 3: H1→L1→S1→L4→H8, H1→L1→S2→L4→H8)
// Traffic splits evenly across spines — the hallmark of fat-tree ECMP.

const closFatTreeNetwork: NetworkInput = {
  nodes: [
    { id: "s1", label: "S1", x: 195, y: 90  },
    { id: "s2", label: "S2", x: 555, y: 90  },
    { id: "l1", label: "L1", x: 60,  y: 245 },
    { id: "l2", label: "L2", x: 255, y: 245 },
    { id: "l3", label: "L3", x: 450, y: 245 },
    { id: "l4", label: "L4", x: 645, y: 245 },
    { id: "h1", label: "H1", x: 60,  y: 400 },
    { id: "h2", label: "H2", x: 150, y: 400 },
    { id: "h3", label: "H3", x: 240, y: 400 },
    { id: "h4", label: "H4", x: 330, y: 400 },
    { id: "h5", label: "H5", x: 420, y: 400 },
    { id: "h6", label: "H6", x: 510, y: 400 },
    { id: "h7", label: "H7", x: 600, y: 400 },
    { id: "h8", label: "H8", x: 690, y: 400 },
  ],
  links: [
    { id: "hl1", source: "h1", target: "l1", weight: 1, capacity: 10 },
    { id: "hl2", source: "h2", target: "l1", weight: 1, capacity: 10 },
    { id: "hl3", source: "h3", target: "l2", weight: 1, capacity: 10 },
    { id: "hl4", source: "h4", target: "l2", weight: 1, capacity: 10 },
    { id: "hl5", source: "h5", target: "l3", weight: 1, capacity: 10 },
    { id: "hl6", source: "h6", target: "l3", weight: 1, capacity: 10 },
    { id: "hl7", source: "h7", target: "l4", weight: 1, capacity: 10 },
    { id: "hl8", source: "h8", target: "l4", weight: 1, capacity: 10 },
    { id: "ls1", source: "l1", target: "s1", weight: 1, capacity: 10 },
    { id: "ls2", source: "l1", target: "s2", weight: 1, capacity: 10 },
    { id: "ls3", source: "l2", target: "s1", weight: 1, capacity: 10 },
    { id: "ls4", source: "l2", target: "s2", weight: 1, capacity: 10 },
    { id: "ls5", source: "l3", target: "s1", weight: 1, capacity: 10 },
    { id: "ls6", source: "l3", target: "s2", weight: 1, capacity: 10 },
    { id: "ls7", source: "l4", target: "s1", weight: 1, capacity: 10 },
    { id: "ls8", source: "l4", target: "s2", weight: 1, capacity: 10 },
  ],
  demands: [
    { id: "d1", source: "h1", target: "h8", amount: 1 },
  ],
  topologyType: "fat-tree",
  isDirected: false,
};

const closFatTreeConfig: AlgorithmConfig = {
  selectedAlgorithm: "ECMP",
  algorithmType: "real_world_heuristic",
  objective: "minimize_max_utilization",
  congestionThreshold: 1.0,
};

// ── Exported examples ─────────────────────────────────────────────────────────

export const LECTURE_EXAMPLES: LectureExample[] = [
  {
    id: "ecmp-triangle",
    title: "ECMP Triangle",
    category: "ECMP",
    tagline: "Equal-cost paths split traffic — but a shared link still congests.",
    description:
      "Triangle with nodes u, v, t. Both paths u→t and u→v→t have cost 2. " +
      "ECMP splits the 1.5-unit demand evenly: 0.75 per path. " +
      "Meanwhile v→t sends 0.5 directly. " +
      "Link v-t ends up carrying 0.75 + 0.5 = 1.25 against capacity 1.",
    whatToWatch: [
      "Path u→t costs 2; path u→v→t costs 1+1=2 — equal!",
      "ECMP splits 1.5 evenly: 0.75 via u→t, 0.75 via u→v→t",
      "Demand v→t (0.5) takes the only shortest path: v→t",
      "Link v-t: 0.75 + 0.5 = 1.25 > capacity 1 → 125% utilization",
    ],
    insight:
      "No link-weight assignment can ensure less than 100% utilization on v-t when both demands are active simultaneously. The two demands structurally force congestion on this topology.",
    network: ecmpTriangleNetwork,
    algorithmConfig: ecmpTriangleConfig,
  },
  {
    id: "dv-path-p4",
    title: "DV Path P4",
    category: "Distance Vector",
    tagline: "Bellman-Ford propagates costs hop-by-hop along a 4-node chain.",
    description:
      "Four nodes A-B-C-D in a path. Each link has weight 10. " +
      "Distance Vector iterates until every node knows the shortest cost to every other node. " +
      "Watch the cost tables build up from direct neighbors outward.",
    whatToWatch: [
      "Each node starts knowing only its direct neighbors",
      "B learns: to D costs 20 via C; to A costs 10 directly",
      "A learns: to D costs 30 via B (10+10+10)",
      "Final path A→D: A→B→C→D, total cost 30",
    ],
    insight:
      "Distance Vector converges in O(diameter) rounds. On a chain of N nodes, it takes N-1 rounds. The step-by-step replay shows each Bellman-Ford iteration propagating cost knowledge outward.",
    network: dvP4Network,
    algorithmConfig: dvP4Config,
  },
  {
    id: "dv-grid-3x3",
    title: "DV Grid 3×3",
    category: "Distance Vector",
    tagline: "Shortest path in a grid — multiple equal-cost routes from A to I.",
    description:
      "A 3×3 grid (nodes A–I). All link weights = 1. " +
      "Demand: A (top-left) → I (bottom-right). " +
      "Any combination of 2 right moves and 2 down moves gives cost 4. " +
      "DV picks one; ECMP would split across all of them.",
    whatToWatch: [
      "All link weights = 1; shortest path cost = 4",
      "DV builds a cost table at each node for all destinations",
      "Multiple paths (e.g. A→B→C→F→I vs A→D→G→H→I) have equal cost",
      "DV selects one path; compare with ECMP to see the difference",
    ],
    insight:
      "In a grid, Distance Vector picks one shortest path. Switch the algorithm to ECMP to see how traffic can be split across all equal-cost paths simultaneously — a key difference in data-plane behavior.",
    network: dvGridNetwork,
    algorithmConfig: dvGridConfig,
  },
  {
    id: "ecmp-clos-fat-tree",
    title: "Clos Fat-Tree ECMP",
    category: "ECMP",
    tagline: "Data-center fabric — ECMP distributes traffic evenly across both spines.",
    description:
      "Small Clos fat-tree: 2 spines, 4 leaves, 8 hosts. All weights = 1. " +
      "Cross-pod demand H1→H8. " +
      "ECMP finds 2 equal-cost paths through S1 and S2, splitting traffic evenly. " +
      "No congestion — fat-tree provides bisection bandwidth for exactly this pattern.",
    whatToWatch: [
      "All link weights = 1 — every path H1→H8 costs 3 hops",
      "Two equal-cost paths: via S1 and via S2",
      "ECMP splits 0.5 to each spine — utilization stays well under capacity",
      "Spine links carry aggregated cross-pod traffic; host-leaf links are lightly loaded",
    ],
    insight:
      "Clos fat-tree topologies are designed for ECMP: equal link weights ensure all paths between hosts have the same cost. With uniform traffic, utilization is perfectly balanced. Try adding more demands to see where congestion first appears.",
    network: closFatTreeNetwork,
    algorithmConfig: closFatTreeConfig,
  },
];
