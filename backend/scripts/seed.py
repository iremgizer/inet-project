"""
Seed script — populates network-viz-mongo with:
  1. assignments   → 3 example challenges (ECMP + DV)
  2. topologies    → valid sample topology JSON files

Run from /backend:
    python scripts/seed.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Load .env so MONGODB_URI / MONGODB_DATABASE are available
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

from pymongo import MongoClient

MONGODB_URI      = os.getenv("MONGODB_URI", "mongodb://localhost:27018")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "network_visualizer")

# ── Connect ───────────────────────────────────────────────────────────────────

try:
    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
    client.admin.command("ping")
    db = client[MONGODB_DATABASE]
    print(f"✓ Connected to {MONGODB_URI} / {MONGODB_DATABASE}")
except Exception as e:
    print(f"✗ Cannot connect to MongoDB at {MONGODB_URI}: {e}")
    sys.exit(1)

# ── Hint data (mirrors frontend/src/utils/challengeHints.ts) ──────────────────

HINTS = {
    "IDENTIFY_CONGESTED_LINKS": [
        {"hintId": "icl-h1", "level": "conceptual",
         "title": "What makes a link congested?",
         "text": "A link is congested when its total traffic load exceeds its capacity. Utilization = Load / Capacity. When utilization > 100%, the link is congested.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 0},
        {"hintId": "icl-h2", "level": "calculation",
         "title": "How does ECMP distribute traffic?",
         "text": "ECMP splits each demand equally among all shortest-cost paths. To find the load on a link, sum the traffic from every demand that routes through it.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 10},
        {"hintId": "icl-h3", "level": "solution_direction",
         "title": "How to identify congested links in the UI",
         "text": "Run the simulation. In the canvas, links shown in red (or orange) exceed capacity. Hover a link to see its exact load and utilization. The Results panel on the right also lists all link utilizations.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 20},
    ],
    "REDUCE_CONGESTION": [
        {"hintId": "rc-h1", "level": "conceptual",
         "title": "How do link weights affect routing?",
         "text": "ECMP selects all shortest-cost paths for each demand. Increasing the weight on a link raises that path's total cost, making ECMP prefer other paths.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 0},
        {"hintId": "rc-h2", "level": "calculation",
         "title": "Find which links feed the congested one",
         "text": "Identify the congested link (red in the canvas). Look at which demands route traffic through it. Then trace back which incoming link weights you can increase to redirect those flows.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 10},
        {"hintId": "rc-h3", "level": "solution_direction",
         "title": "Strategy: redirect traffic away from the bottleneck",
         "text": "Select the congested link and raise the weight of the links that lead to it. This forces ECMP to use an alternative path. Re-run the simulation to verify the utilization drops below 100%.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 20},
    ],
    "COMPUTE_DV_TABLE": [
        {"hintId": "dv-h1", "level": "conceptual",
         "title": "Distance Vector finds the shortest path cost",
         "text": "Distance Vector routing computes the shortest (minimum-cost) path from each node to every destination. The cost of a path is the sum of all link weights along it. The next hop is the first neighbor on that shortest path.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 0},
        {"hintId": "dv-h2", "level": "calculation",
         "title": "Sum the link weights along the path",
         "text": "List every possible path from source to destination. Add the weights of each link along each path. The path with the smallest total is the shortest path. That total is the cost.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 10},
        {"hintId": "dv-h3", "level": "solution_direction",
         "title": "Check the Routing Table panel after running DV",
         "text": "Run the simulation with Distance Vector. Open the Routing Table panel on the right side. Find the row for your source node → destination node to read the cost and next hop directly.",
         "relatedNodeIds": [], "relatedLinkIds": [], "revealCostPenalty": 20},
    ],
}

# ── Example challenges (mirrors frontend/src/utils/exampleChallenges.ts) ──────

ASSIGNMENTS = [
    {
        "assignmentId": "challenge-ecmp-triangle-congestion",
        "title": "ECMP Triangle: Find the Congested Link",
        "description": (
            "Run ECMP on the triangle topology and identify which link becomes congested. "
            "Two demands compete for the same bottleneck — find it."
        ),
        "course": "Network Algorithms 101",
        "topic": "ECMP",
        "mode": "challenge",
        "starterNetwork": {
            "nodes": [
                {"id": "u", "label": "u", "x": 200, "y": 180},
                {"id": "v", "label": "v", "x": 400, "y": 360},
                {"id": "t", "label": "t", "x": 600, "y": 180},
            ],
            "links": [
                {"id": "u-t", "source": "u", "target": "t", "capacity": 1.0, "weight": 2.0},
                {"id": "u-v", "source": "u", "target": "v", "capacity": 1.0, "weight": 1.0},
                {"id": "v-t", "source": "v", "target": "t", "capacity": 1.0, "weight": 1.0},
            ],
            "demands": [
                {"id": "d-ut", "source": "u", "target": "t", "amount": 1.5},
                {"id": "d-vt", "source": "v", "target": "t", "amount": 0.5},
            ],
            "topologyType": "triangle",
            "isDirected": False,
        },
        "lockedFields": {
            "canEditNodes": False, "canEditLinks": False, "canEditWeights": False,
            "canEditCapacities": False, "canEditDemands": False, "canChooseAlgorithm": False,
        },
        "allowedAlgorithms": ["ECMP"],
        "studentTask": {
            "taskType": "IDENTIFY_CONGESTED_LINKS",
            "prompt": (
                "The triangle has demands u→t = 1.5 and v→t = 0.5. "
                "All links have capacity 1.0. Run ECMP and identify which link becomes congested."
            ),
            "instructions": (
                "1. Click 'Run Attempt' to execute ECMP.\n"
                "2. Look at the canvas — congested links appear in red/orange.\n"
                "3. Enter the congested link ID(s) in the answer box below.\n"
                "4. Click 'Submit Attempt' to check your answer."
            ),
            "answerFormatDescription": "Enter the link ID of the congested link, e.g. v-t",
        },
        "expectedSolution": {
            "congestedLinks": ["v-t"],
            "explanation": (
                "Link u-t has cost 2, path u→v→t has cost 2 (equal cost). "
                "ECMP splits demand u→t equally: 0.75 via u-t and 0.75 via u→v→t. "
                "Link v-t receives 0.75 (from u→t) + 0.5 (from v→t demand) = 1.25. "
                "Capacity = 1.0 → utilization = 125% → CONGESTED."
            ),
        },
        "gradingRules": {
            "tolerance": 0.01, "requireExactLinks": True,
            "allowEquivalentWeights": False, "maxScore": 100,
        },
        "challengeConfig": {
            "challengeType": "IDENTIFY_CONGESTED_LINKS",
            "difficulty": "beginner",
            "learningObjectives": ["ECMP", "Congestion"],
            "expectedTimeMinutes": 10,
            "maxAttempts": 3,
            "showOfficialSolution": "after_correct",
            "editableFields": [],
            "target": {"congestedLinks": ["v-t"]},
            "hints": HINTS["IDENTIFY_CONGESTED_LINKS"],
        },
        "createdAt": "2026-07-03T00:00:00.000Z",
        "updatedAt": "2026-07-03T00:00:00.000Z",
    },
    {
        "assignmentId": "challenge-reduce-ecmp-congestion",
        "title": "Reduce Congestion: Adjust Link Weights",
        "description": (
            "A star topology has a bottleneck link. Adjust link weights so that "
            "ECMP routes traffic away from the congested link and max utilization drops to ≤ 100%."
        ),
        "course": "Network Algorithms 101",
        "topic": "ECMP",
        "mode": "challenge",
        "starterNetwork": {
            "nodes": [
                {"id": "s", "label": "s", "x": 300, "y": 80},
                {"id": "a", "label": "a", "x": 150, "y": 240},
                {"id": "b", "label": "b", "x": 450, "y": 240},
                {"id": "t", "label": "t", "x": 300, "y": 400},
            ],
            "links": [
                {"id": "s-a", "source": "s", "target": "a", "capacity": 10, "weight": 1},
                {"id": "s-b", "source": "s", "target": "b", "capacity": 10, "weight": 1},
                {"id": "a-t", "source": "a", "target": "t", "capacity": 3,  "weight": 1},
                {"id": "b-t", "source": "b", "target": "t", "capacity": 10, "weight": 1},
            ],
            "demands": [
                {"id": "d1", "source": "s", "target": "t", "amount": 8},
            ],
            "topologyType": "custom",
            "isDirected": False,
        },
        "lockedFields": {
            "canEditNodes": False, "canEditLinks": False, "canEditWeights": True,
            "canEditCapacities": False, "canEditDemands": False, "canChooseAlgorithm": False,
        },
        "allowedAlgorithms": ["ECMP"],
        "studentTask": {
            "taskType": "REDUCE_MAX_UTILIZATION",
            "prompt": (
                "Demand s→t = 8 is split equally between paths s→a→t and s→b→t by ECMP. "
                "However, link a-t has capacity 3 and becomes congested. "
                "Adjust link weights so that ECMP routes all traffic via b, achieving max utilization ≤ 100%."
            ),
            "instructions": (
                "1. Click 'Run Attempt' to see the current congestion.\n"
                "2. Click on a link in the canvas to edit its weight.\n"
                "3. Increase the weight on links leading to the congested path.\n"
                "4. Click 'Run Attempt' again to verify your solution.\n"
                "5. Click 'Submit Attempt' when max utilization ≤ 100%."
            ),
            "answerFormatDescription": "Modify link weights in the canvas, then run the simulation to capture max utilization.",
        },
        "expectedSolution": {
            "maxUtilizationTarget": 1.0,
            "explanation": (
                "Set weight of s-a to 2 (so path s→a→t has cost 3 > s→b→t cost 2). "
                "ECMP then routes all 8 units via s→b→t. "
                "b-t load = 8, capacity = 10, utilization = 80% ≤ 100%."
            ),
        },
        "gradingRules": {
            "tolerance": 0.001, "requireExactLinks": False,
            "allowEquivalentWeights": True, "maxScore": 100,
        },
        "challengeConfig": {
            "challengeType": "REDUCE_CONGESTION",
            "difficulty": "intermediate",
            "learningObjectives": ["ECMP", "Congestion", "Link Weights"],
            "expectedTimeMinutes": 15,
            "maxAttempts": 5,
            "showOfficialSolution": "after_correct",
            "editableFields": ["weights"],
            "target": {"maxUtilizationBelow": 1.0},
            "hints": HINTS["REDUCE_CONGESTION"],
        },
        "createdAt": "2026-07-03T00:00:00.000Z",
        "updatedAt": "2026-07-03T00:00:00.000Z",
    },
    {
        "assignmentId": "challenge-dv-p4-table",
        "title": "Distance Vector P4: Compute the Routing Table",
        "description": (
            "Given path graph A–B–C–D with link weights = 10, manually compute the "
            "shortest path cost and next hop from A to D, then verify with the simulation."
        ),
        "course": "Network Algorithms 101",
        "topic": "DISTANCE_VECTOR",
        "mode": "challenge",
        "starterNetwork": {
            "nodes": [
                {"id": "n1", "label": "A", "x": 80,  "y": 260},
                {"id": "n2", "label": "B", "x": 240, "y": 260},
                {"id": "n3", "label": "C", "x": 400, "y": 260},
                {"id": "n4", "label": "D", "x": 560, "y": 260},
            ],
            "links": [
                {"id": "l1", "source": "n1", "target": "n2", "weight": 10, "capacity": 10},
                {"id": "l2", "source": "n2", "target": "n3", "weight": 10, "capacity": 10},
                {"id": "l3", "source": "n3", "target": "n4", "weight": 10, "capacity": 10},
            ],
            "demands": [
                {"id": "d1", "source": "n1", "target": "n4", "amount": 1},
            ],
            "topologyType": "path",
            "isDirected": False,
        },
        "lockedFields": {
            "canEditNodes": False, "canEditLinks": False, "canEditWeights": False,
            "canEditCapacities": False, "canEditDemands": False, "canChooseAlgorithm": False,
        },
        "allowedAlgorithms": ["DISTANCE_VECTOR"],
        "studentTask": {
            "taskType": "COMPUTE_DV_TABLE",
            "prompt": (
                "Path graph P4: A–B–C–D with all link weights = 10. "
                "Without running the simulation, compute: "
                "(1) the shortest path cost from A to D, and "
                "(2) A's next hop toward D."
            ),
            "instructions": (
                "1. Study the graph — there is only one path from A to D.\n"
                "2. Add up the link weights along that path.\n"
                "3. Enter the total cost and next hop (node label) in the fields below.\n"
                "4. Click 'Run Attempt' to verify with Distance Vector.\n"
                "5. Click 'Submit Attempt' to check your manual answer."
            ),
            "answerFormatDescription": "Enter the total path cost (a number) and the next-hop node label (B, C, or D).",
        },
        "expectedSolution": {
            "pathCosts": {"n1-n4": 30},
            "distanceVectorEntries": [
                {"nodeId": "n1", "destinationId": "n4", "cost": 30, "nextHop": "n2"},
            ],
            "explanation": (
                "Only one path exists: A→B→C→D. Cost = 10 + 10 + 10 = 30. "
                "A's next hop toward D is B (node id: n2)."
            ),
        },
        "gradingRules": {
            "tolerance": 0.01, "requireExactLinks": False,
            "allowEquivalentWeights": False, "maxScore": 100,
        },
        "challengeConfig": {
            "challengeType": "COMPUTE_DV_TABLE",
            "difficulty": "beginner",
            "learningObjectives": ["Distance Vector", "Shortest Path"],
            "expectedTimeMinutes": 10,
            "maxAttempts": 3,
            "showOfficialSolution": "after_correct",
            "editableFields": [],
            "target": {
                "expectedDVEntries": [
                    {"nodeId": "n1", "destinationId": "n4", "cost": 30, "nextHop": "n2"},
                ],
            },
            "hints": HINTS["COMPUTE_DV_TABLE"],
        },
        "createdAt": "2026-07-03T00:00:00.000Z",
        "updatedAt": "2026-07-03T00:00:00.000Z",
    },
]

# ── Sample topology files ─────────────────────────────────────────────────────
# Stored in the `topologies` collection for reference / future API use.

VALID_TOPOLOGY_FILES = [
    "triangle_ecmp.json",
    "grid_3x3.json",
    "path_p4.json",
    "random_medium.json",
    "clos_fat_tree_small.json",
]

SAMPLE_JSON_DIR = Path(__file__).parent.parent.parent / "sample-json"


def load_topology_docs() -> list[dict]:
    docs = []
    for fname in VALID_TOPOLOGY_FILES:
        fpath = SAMPLE_JSON_DIR / fname
        if not fpath.exists():
            print(f"  ⚠ {fname} not found, skipping")
            continue
        with open(fpath) as f:
            data = json.load(f)
        topology_id = fname.replace(".json", "")
        docs.append({
            "topologyId": topology_id,
            "filename": fname,
            "name": data.get("name", topology_id),
            "topologyType": data.get("topologyType", "custom"),
            "isDirected": data.get("isDirected", False),
            "nodeCount": len(data.get("nodes", [])),
            "linkCount": len(data.get("links", [])),
            "demandCount": len(data.get("demands", [])),
            "network": data,
        })
    return docs


# ── Seed ──────────────────────────────────────────────────────────────────────

def seed_assignments() -> int:
    col = db["assignments"]
    count = 0
    for doc in ASSIGNMENTS:
        col.replace_one({"assignmentId": doc["assignmentId"]}, doc, upsert=True)
        count += 1
        print(f"  ✓ assignment: {doc['assignmentId']}")
    return count


def seed_topologies() -> int:
    col = db["topologies"]
    docs = load_topology_docs()
    count = 0
    for doc in docs:
        col.replace_one({"topologyId": doc["topologyId"]}, doc, upsert=True)
        count += 1
        print(f"  ✓ topology:   {doc['topologyId']}  ({doc['nodeCount']} nodes, {doc['linkCount']} links)")
    return count


if __name__ == "__main__":
    print("\n── Seeding assignments ──────────────────────────────────────────")
    a = seed_assignments()

    print("\n── Seeding sample topologies ────────────────────────────────────")
    t = seed_topologies()

    print(f"\n✓ Done. {a} assignments, {t} topologies seeded into '{MONGODB_DATABASE}'.")

    # Verify
    print("\n── Verification ─────────────────────────────────────────────────")
    for col_name in ["assignments", "topologies", "simulation_runs"]:
        n = db[col_name].count_documents({})
        print(f"  {col_name}: {n} documents")
