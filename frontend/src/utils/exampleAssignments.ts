import { Assignment } from "../types/assignment";

const ecmpTriangleCongestion: Assignment = {
  assignmentId: "example-ecmp-triangle-congestion",
  title: "ECMP Triangle: Identify the Congested Link",
  description:
    "Apply ECMP routing to the triangle topology with two active demands and determine which link becomes congested.",
  course: "Network Algorithms 101",
  topic: "ECMP",
  mode: "exercise",
  starterNetwork: {
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
  },
  lockedFields: {
    canEditNodes: false,
    canEditLinks: false,
    canEditWeights: false,
    canEditCapacities: false,
    canEditDemands: false,
    canChooseAlgorithm: false,
  },
  allowedAlgorithms: ["ECMP"],
  studentTask: {
    taskType: "IDENTIFY_CONGESTED_LINKS",
    prompt:
      "Given the triangle topology with demands u→t = 1.5 and v→t = 0.5, determine which link becomes congested under ECMP routing. Run the simulation and observe the utilization on each link.",
    instructions:
      "1. The network is fixed — do not modify nodes, links, or demands.\n" +
      "2. Click 'Run My Solution' to execute ECMP.\n" +
      "3. Observe which link exceeds 100% utilization (shown in red).\n" +
      "4. Enter the congested link ID in the answer field below.",
    answerFormatDescription:
      "Enter the link ID of the congested link (e.g. v-t). Separate multiple IDs with a comma.",
  },
  expectedSolution: {
    congestedLinks: ["v-t"],
    explanation:
      "Link v-t carries 0.75 (from u→t ECMP split via v) + 0.5 (from v→t demand) = 1.25 > capacity 1.0. Utilization = 125%.",
  },
  gradingRules: {
    tolerance: 0.01,
    requireExactLinks: true,
    allowEquivalentWeights: false,
    maxScore: 100,
  },
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

const dvP4ShortestPath: Assignment = {
  assignmentId: "example-dv-p4-shortest-path",
  title: "Distance Vector P4: Compute the Routing Table",
  description:
    "Run Distance Vector on a 4-node path graph and determine the shortest path cost and next hop from node A to node D.",
  course: "Network Algorithms 101",
  topic: "DISTANCE_VECTOR",
  mode: "exercise",
  starterNetwork: {
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
    demands: [{ id: "d1", source: "n1", target: "n4", amount: 1 }],
    topologyType: "path",
    isDirected: false,
  },
  lockedFields: {
    canEditNodes: false,
    canEditLinks: false,
    canEditWeights: false,
    canEditCapacities: false,
    canEditDemands: false,
    canChooseAlgorithm: false,
  },
  allowedAlgorithms: ["DISTANCE_VECTOR"],
  studentTask: {
    taskType: "COMPUTE_DV_TABLE",
    prompt:
      "Given path graph P4 (nodes A–B–C–D) with all link weights = 10, run Distance Vector routing and answer: (1) What is the shortest path cost from A to D? (2) What is A's next hop toward D?",
    instructions:
      "1. Click 'Run My Solution' to execute Distance Vector.\n" +
      "2. Open the right panel to see the Distance Vector routing table.\n" +
      "3. Find the row for node A → destination D.\n" +
      "4. Enter the cost and next hop in the answer fields below.",
    answerFormatDescription:
      "Enter the total cost (a number) and the next-hop node label (e.g. B).",
  },
  expectedSolution: {
    pathCosts: { "n1-n4": 30 },
    distanceVectorEntries: [
      { nodeId: "n1", destinationId: "n4", cost: 30, nextHop: "n2" },
    ],
    explanation:
      "A→B→C→D costs 10+10+10=30. From A, the only neighbor toward D is B, so next hop = B (id: n2).",
  },
  gradingRules: {
    tolerance: 0.01,
    requireExactLinks: false,
    allowEquivalentWeights: false,
    maxScore: 100,
  },
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

export const EXAMPLE_ASSIGNMENTS: Assignment[] = [
  ecmpTriangleCongestion,
  dvP4ShortestPath,
];
