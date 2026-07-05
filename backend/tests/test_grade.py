"""Tests for POST /grade endpoint.

Covers: correct/wrong answers for IDENTIFY_CONGESTED_LINKS, REDUCE_CONGESTION,
COMPUTE_DV_TABLE, missing assignment, and embedded-assignment (demo mode) fallback.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# ── Shared fixtures ───────────────────────────────────────────────────────────

TRIANGLE_NETWORK = {
    "nodes": [
        {"id": "A", "label": "A", "x": 0, "y": 0},
        {"id": "B", "label": "B", "x": 200, "y": 0},
        {"id": "C", "label": "C", "x": 100, "y": 150},
    ],
    "links": [
        {"id": "AB", "source": "A", "target": "B", "weight": 1, "capacity": 5},
        {"id": "AC", "source": "A", "target": "C", "weight": 1, "capacity": 10},
        {"id": "BC", "source": "B", "target": "C", "weight": 1, "capacity": 10},
    ],
    "demands": [
        {"id": "d1", "source": "A", "target": "B", "amount": 8},
    ],
    "topologyType": "triangle",
    "isDirected": False,
}

ECMP_ALGO = {
    "selectedAlgorithm": "ECMP",
    "algorithmType": "real_world_heuristic",
    "objective": "minimize_max_utilization",
    "congestionThreshold": 1.0,
}

DV_ALGO = {
    "selectedAlgorithm": "DISTANCE_VECTOR",
    "algorithmType": "real_world_heuristic",
    "objective": "minimize_path_cost",
    "congestionThreshold": 1.0,
}

CONGESTED_ASSIGNMENT = {
    "assignmentId": "test-congested",
    "title": "Test",
    "topic": "ECMP",
    "mode": "challenge",
    "challengeConfig": {
        "challengeType": "IDENTIFY_CONGESTED_LINKS",
        "difficulty": "beginner",
        "target": {},
        "hints": [],
    },
    "gradingRules": {"maxScore": 100},
    "starterNetwork": TRIANGLE_NETWORK,
    "lockedFields": {
        "canEditNodes": False, "canEditLinks": False, "canEditWeights": True,
        "canEditCapacities": False, "canEditDemands": False, "canChooseAlgorithm": False,
    },
    "studentTask": {"taskType": "IDENTIFY_CONGESTED_LINKS", "prompt": "Find congested links."},
    "allowedAlgorithms": ["ECMP"],
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
}

REDUCE_ASSIGNMENT = {
    **CONGESTED_ASSIGNMENT,
    "assignmentId": "test-reduce",
    "challengeConfig": {
        "challengeType": "REDUCE_CONGESTION",
        "difficulty": "beginner",
        "target": {"maxUtilizationTarget": 1.0},
        "hints": [],
    },
}

DV_ASSIGNMENT = {
    **CONGESTED_ASSIGNMENT,
    "assignmentId": "test-dv",
    "topic": "DISTANCE_VECTOR",
    "challengeConfig": {
        "challengeType": "COMPUTE_DV_TABLE",
        "difficulty": "intermediate",
        "target": {
            "expectedDVEntries": [
                {"nodeId": "A", "destinationId": "B", "cost": 1, "nextHop": "B"},
            ],
        },
        "hints": [],
    },
}

def _grade(assignment, answers, algo=None, hints=0):
    return client.post("/grade", json={
        "assignment": assignment,
        "submittedNetwork": TRIANGLE_NETWORK,
        "submittedAlgorithmConfig": algo or ECMP_ALGO,
        "submittedAnswers": answers,
        "hintsUsed": hints,
    })


# ── IDENTIFY_CONGESTED_LINKS ──────────────────────────────────────────────────

class TestIdentifyCongestedLinks:
    def test_correct_answer(self):
        r = _grade(CONGESTED_ASSIGNMENT, {"congestedLinks": ["AB"]})
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is True
        assert body["score"] == 100
        assert body["gradingMode"] == "server"

    def test_wrong_answer(self):
        r = _grade(CONGESTED_ASSIGNMENT, {"congestedLinks": ["AC"]})
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is False
        assert body["score"] < 100

    def test_empty_answer(self):
        r = _grade(CONGESTED_ASSIGNMENT, {"congestedLinks": []})
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is False

    def test_hint_penalty_applied(self):
        assignment_with_hint = {
            **CONGESTED_ASSIGNMENT,
            "challengeConfig": {
                **CONGESTED_ASSIGNMENT["challengeConfig"],
                "hints": [{"hintId": "h1", "level": "conceptual", "title": "Tip",
                           "text": "Look for load > capacity.", "revealCostPenalty": 20}],
            },
        }
        r = _grade(assignment_with_hint, {"congestedLinks": ["AB"]}, hints=1)
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is True
        assert body["score"] == 80  # 100 - 20% of 100


# ── REDUCE_CONGESTION ─────────────────────────────────────────────────────────

class TestReduceCongestion:
    def test_congested_network_fails(self):
        r = _grade(REDUCE_ASSIGNMENT, {})
        assert r.status_code == 200
        body = r.json()
        # AB link has load 8 on capacity 5 → still congested → not correct
        assert body["isCorrect"] is False
        assert body["score"] == 0

    def test_uncongested_network_passes(self):
        uncongested = {
            **TRIANGLE_NETWORK,
            "links": [
                {"id": "AB", "source": "A", "target": "B", "weight": 1, "capacity": 20},
                {"id": "AC", "source": "A", "target": "C", "weight": 1, "capacity": 20},
                {"id": "BC", "source": "B", "target": "C", "weight": 1, "capacity": 20},
            ],
        }
        r = client.post("/grade", json={
            "assignment": REDUCE_ASSIGNMENT,
            "submittedNetwork": uncongested,
            "submittedAlgorithmConfig": ECMP_ALGO,
            "submittedAnswers": {},
            "hintsUsed": 0,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is True
        assert body["score"] == 100


# ── COMPUTE_DV_TABLE ──────────────────────────────────────────────────────────

class TestComputeDVTable:
    def test_correct_dv_entry(self):
        r = _grade(DV_ASSIGNMENT, {"pathCost": 1, "nextHop": "B"}, algo=DV_ALGO)
        assert r.status_code == 200
        body = r.json()
        assert body["score"] > 0

    def test_wrong_cost(self):
        r = _grade(DV_ASSIGNMENT, {"pathCost": 99, "nextHop": "B"}, algo=DV_ALGO)
        assert r.status_code == 200
        body = r.json()
        # Wrong cost → partial score (next-hop might still be correct)
        assert body["score"] < 100


# ── Missing assignment ────────────────────────────────────────────────────────

class TestMissingAssignment:
    def test_no_assignment_returns_error_result(self):
        r = client.post("/grade", json={
            "submittedNetwork": TRIANGLE_NETWORK,
            "submittedAlgorithmConfig": ECMP_ALGO,
            "submittedAnswers": {},
            "hintsUsed": 0,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is False
        assert "not found" in body["summary"].lower()

    def test_nonexistent_assignment_id_falls_back_gracefully(self):
        r = client.post("/grade", json={
            "assignmentId": "does-not-exist",
            "submittedNetwork": TRIANGLE_NETWORK,
            "submittedAlgorithmConfig": ECMP_ALGO,
            "submittedAnswers": {},
            "hintsUsed": 0,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["isCorrect"] is False


# ── Student assignment endpoint ───────────────────────────────────────────────

class TestStudentAssignmentEndpoint:
    def test_missing_returns_404(self):
        r = client.get("/assignments/nonexistent-id/student")
        assert r.status_code == 404
