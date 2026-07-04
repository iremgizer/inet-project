import { Assignment } from "../types/assignment";
import { getDefaultHints } from "./challengeHints";

// ── Challenge 1: Identify the Congested Link (beginner, ECMP) ─────────────────

const ecmpTriangleCongestion: Assignment = {
  assignmentId: "challenge-ecmp-triangle-congestion",
  title: "ECMP Triangle: Find the Congested Link",
  description:
    "Run ECMP on the triangle topology and identify which link becomes congested. " +
    "Two demands compete for the same bottleneck — find it.",
  course: "Network Algorithms 101",
  topic: "ECMP",
  mode: "challenge",
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
    canEditNodes: false, canEditLinks: false, canEditWeights: false,
    canEditCapacities: false, canEditDemands: false, canChooseAlgorithm: false,
  },
  allowedAlgorithms: ["ECMP"],
  studentTask: {
    taskType: "IDENTIFY_CONGESTED_LINKS",
    prompt:
      "The triangle has demands u→t = 1.5 and v→t = 0.5. " +
      "All links have capacity 1.0. Run ECMP and identify which link becomes congested.",
    instructions:
      "1. Click 'Run Attempt' to execute ECMP.\n" +
      "2. Look at the canvas — congested links appear in red/orange.\n" +
      "3. Enter the congested link ID(s) in the answer box below.\n" +
      "4. Click 'Submit Attempt' to check your answer.",
    answerFormatDescription: "Enter the link ID of the congested link, e.g. v-t",
  },
  expectedSolution: {
    congestedLinks: ["v-t"],
    explanation:
      "Link u-t has cost 2, path u→v→t has cost 2 (equal cost). " +
      "ECMP splits demand u→t equally: 0.75 via u-t and 0.75 via u→v→t. " +
      "Link v-t receives 0.75 (from u→t) + 0.5 (from v→t demand) = 1.25. " +
      "Capacity = 1.0 → utilization = 125% → CONGESTED.",
  },
  gradingRules: {
    tolerance: 0.01, requireExactLinks: true, allowEquivalentWeights: false, maxScore: 100,
  },
  challengeConfig: {
    challengeType: "IDENTIFY_CONGESTED_LINKS",
    difficulty: "beginner",
    learningObjectives: ["ECMP", "Congestion"],
    expectedTimeMinutes: 10,
    maxAttempts: 3,
    showOfficialSolution: "after_correct",
    editableFields: [],
    target: { congestedLinks: ["v-t"] },
    hints: getDefaultHints("IDENTIFY_CONGESTED_LINKS"),
  },
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

// ── Challenge 2: Reduce Congestion by Adjusting Weights (intermediate, ECMP) ──

const reduceEcmpCongestion: Assignment = {
  assignmentId: "challenge-reduce-ecmp-congestion",
  title: "Reduce Congestion: Adjust Link Weights",
  description:
    "A star topology has a bottleneck link. Adjust link weights so that " +
    "ECMP routes traffic away from the congested link and max utilization drops to ≤ 100%.",
  course: "Network Algorithms 101",
  topic: "ECMP",
  mode: "challenge",
  starterNetwork: {
    nodes: [
      { id: "s",  label: "s",  x: 300, y: 80  },
      { id: "a",  label: "a",  x: 150, y: 240 },
      { id: "b",  label: "b",  x: 450, y: 240 },
      { id: "t",  label: "t",  x: 300, y: 400 },
    ],
    links: [
      { id: "s-a", source: "s", target: "a", capacity: 10, weight: 1 },
      { id: "s-b", source: "s", target: "b", capacity: 10, weight: 1 },
      { id: "a-t", source: "a", target: "t", capacity:  3, weight: 1 },
      { id: "b-t", source: "b", target: "t", capacity: 10, weight: 1 },
    ],
    demands: [
      { id: "d1", source: "s", target: "t", amount: 8 },
    ],
    topologyType: "custom",
    isDirected: false,
  },
  lockedFields: {
    canEditNodes: false, canEditLinks: false, canEditWeights: true,
    canEditCapacities: false, canEditDemands: false, canChooseAlgorithm: false,
  },
  allowedAlgorithms: ["ECMP"],
  studentTask: {
    taskType: "REDUCE_MAX_UTILIZATION",
    prompt:
      "Demand s→t = 8 is split equally between paths s→a→t and s→b→t by ECMP. " +
      "However, link a-t has capacity 3 and becomes congested. " +
      "Adjust link weights so that ECMP routes all traffic via b, achieving max utilization ≤ 100%.",
    instructions:
      "1. Click 'Run Attempt' to see the current congestion.\n" +
      "2. Click on a link in the canvas to edit its weight.\n" +
      "3. Increase the weight on links leading to the congested path.\n" +
      "4. Click 'Run Attempt' again to verify your solution.\n" +
      "5. Click 'Submit Attempt' when max utilization ≤ 100%.",
    answerFormatDescription:
      "Modify link weights in the canvas, then run the simulation to capture max utilization.",
  },
  expectedSolution: {
    maxUtilizationTarget: 1.0,
    explanation:
      "Set weight of s-a to 2 (so path s→a→t has cost 3 > s→b→t cost 2). " +
      "ECMP then routes all 8 units via s→b→t. " +
      "b-t load = 8, capacity = 10, utilization = 80% ≤ 100%.",
  },
  gradingRules: {
    tolerance: 0.001, requireExactLinks: false, allowEquivalentWeights: true, maxScore: 100,
  },
  challengeConfig: {
    challengeType: "REDUCE_CONGESTION",
    difficulty: "intermediate",
    learningObjectives: ["ECMP", "Congestion", "Link Weights"],
    expectedTimeMinutes: 15,
    maxAttempts: 5,
    showOfficialSolution: "after_correct",
    editableFields: ["weights"],
    target: { maxUtilizationBelow: 1.0 },
    hints: getDefaultHints("REDUCE_CONGESTION"),
  },
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

// ── Challenge 3: Distance Vector P4 Routing Table (beginner, DV) ──────────────

const dvP4Table: Assignment = {
  assignmentId: "challenge-dv-p4-table",
  title: "Distance Vector P4: Compute the Routing Table",
  description:
    "Given path graph A–B–C–D with link weights = 10, manually compute the " +
    "shortest path cost and next hop from A to D, then verify with the simulation.",
  course: "Network Algorithms 101",
  topic: "DISTANCE_VECTOR",
  mode: "challenge",
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
    canEditNodes: false, canEditLinks: false, canEditWeights: false,
    canEditCapacities: false, canEditDemands: false, canChooseAlgorithm: false,
  },
  allowedAlgorithms: ["DISTANCE_VECTOR"],
  studentTask: {
    taskType: "COMPUTE_DV_TABLE",
    prompt:
      "Path graph P4: A–B–C–D with all link weights = 10. " +
      "Without running the simulation, compute: " +
      "(1) the shortest path cost from A to D, and " +
      "(2) A's next hop toward D.",
    instructions:
      "1. Study the graph — there is only one path from A to D.\n" +
      "2. Add up the link weights along that path.\n" +
      "3. Enter the total cost and next hop (node label) in the fields below.\n" +
      "4. Click 'Run Attempt' to verify with Distance Vector.\n" +
      "5. Click 'Submit Attempt' to check your manual answer.",
    answerFormatDescription:
      "Enter the total path cost (a number) and the next-hop node label (B, C, or D).",
  },
  expectedSolution: {
    pathCosts: { "n1-n4": 30 },
    distanceVectorEntries: [
      { nodeId: "n1", destinationId: "n4", cost: 30, nextHop: "n2" },
    ],
    explanation:
      "Only one path exists: A→B→C→D. Cost = 10 + 10 + 10 = 30. " +
      "A's next hop toward D is B (node id: n2).",
  },
  gradingRules: {
    tolerance: 0.01, requireExactLinks: false, allowEquivalentWeights: false, maxScore: 100,
  },
  challengeConfig: {
    challengeType: "COMPUTE_DV_TABLE",
    difficulty: "beginner",
    learningObjectives: ["Distance Vector", "Shortest Path"],
    expectedTimeMinutes: 10,
    maxAttempts: 3,
    showOfficialSolution: "after_correct",
    editableFields: [],
    target: {
      expectedDVEntries: [
        { nodeId: "n1", destinationId: "n4", cost: 30, nextHop: "n2" },
      ],
    },
    hints: getDefaultHints("COMPUTE_DV_TABLE"),
  },
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
};

export const EXAMPLE_CHALLENGES: Assignment[] = [
  ecmpTriangleCongestion,
  reduceEcmpCongestion,
  dvP4Table,
];
