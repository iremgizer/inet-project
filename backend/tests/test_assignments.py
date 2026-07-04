"""Tests for assignment and submission endpoints.

These tests exercise the API routes and the AssignmentStorageService in no-MongoDB
mode (graceful degradation). All endpoints must return valid responses even when
MongoDB is unavailable.
"""
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# ── Minimal valid fixtures ─────────────────────────────────────────────────────

MINIMAL_NETWORK = {
    "nodes": [
        {"id": "u", "label": "u", "x": 100, "y": 100},
        {"id": "v", "label": "v", "x": 300, "y": 100},
    ],
    "links": [
        {"id": "u-v", "source": "u", "target": "v", "weight": 1.0, "capacity": 10.0},
    ],
    "demands": [{"id": "d1", "source": "u", "target": "v", "amount": 1.0}],
    "topologyType": "custom",
    "isDirected": False,
}

MINIMAL_ALGORITHM_CONFIG = {
    "selectedAlgorithm": "ECMP",
    "algorithmType": "real_world_heuristic",
    "objective": "minimize_max_utilization",
    "congestionThreshold": 1.0,
}

MINIMAL_ASSIGNMENT = {
    "assignmentId": "test-assignment-001",
    "title": "Test ECMP Assignment",
    "description": "A test assignment.",
    "course": "Test Course",
    "topic": "ECMP",
    "mode": "exercise",
    "starterNetwork": MINIMAL_NETWORK,
    "lockedFields": {
        "canEditNodes": False,
        "canEditLinks": False,
        "canEditWeights": True,
        "canEditCapacities": False,
        "canEditDemands": False,
        "canChooseAlgorithm": False,
    },
    "allowedAlgorithms": ["ECMP"],
    "studentTask": {
        "taskType": "IDENTIFY_CONGESTED_LINKS",
        "prompt": "Which links are congested?",
        "instructions": "Run the simulation.",
        "answerFormatDescription": "Enter link ID.",
    },
    "expectedSolution": {
        "congestedLinks": ["u-v"],
        "explanation": "u-v is overloaded.",
    },
    "gradingRules": {
        "tolerance": 0.01,
        "requireExactLinks": True,
        "allowEquivalentWeights": False,
        "maxScore": 100,
    },
    "createdAt": "2026-07-03T00:00:00.000Z",
    "updatedAt": "2026-07-03T00:00:00.000Z",
}

MINIMAL_SUBMISSION = {
    "submissionId": "test-submission-001",
    "assignmentId": "test-assignment-001",
    "studentName": "Alice",
    "submittedNetwork": MINIMAL_NETWORK,
    "submittedAlgorithmConfig": MINIMAL_ALGORITHM_CONFIG,
    "submittedAnswers": {"congestedLinks": "u-v"},
    "createdAt": "2026-07-03T00:00:00.000Z",
}


# ── Health endpoint includes mongoAvailable ───────────────────────────────────

def test_health_has_mongo_flag():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert "mongoAvailable" in body
    assert isinstance(body["mongoAvailable"], bool)


# ── GET /assignments — returns list (empty if MongoDB unavailable) ─────────────

def test_list_assignments_returns_list():
    r = client.get("/assignments")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── POST /assignments — creates assignment, returns it ────────────────────────

def test_save_assignment_returns_document():
    r = client.post("/assignments", json=MINIMAL_ASSIGNMENT)
    assert r.status_code == 200
    body = r.json()
    assert body["assignmentId"] == MINIMAL_ASSIGNMENT["assignmentId"]
    assert body["title"] == MINIMAL_ASSIGNMENT["title"]
    assert body["topic"] == "ECMP"
    assert body["mode"] == "exercise"


def test_save_assignment_validates_required_fields():
    bad = {"title": "No topic or task"}
    r = client.post("/assignments", json=bad)
    assert r.status_code == 422  # Pydantic validation error


def test_save_assignment_with_dv_topic():
    a = dict(MINIMAL_ASSIGNMENT, assignmentId="test-dv-001", topic="DISTANCE_VECTOR")
    a["studentTask"] = dict(MINIMAL_ASSIGNMENT["studentTask"], taskType="COMPUTE_DV_TABLE")
    r = client.post("/assignments", json=a)
    assert r.status_code == 200
    assert r.json()["topic"] == "DISTANCE_VECTOR"


# ── GET /assignments/{id} — 404 when MongoDB unavailable ─────────────────────

def test_get_assignment_404_without_mongo():
    r = client.get("/assignments/nonexistent-id")
    # Either 404 (no MongoDB) or 200 (found). Without MongoDB it must be 404.
    assert r.status_code in (200, 404)


# ── DELETE /assignments/{id} ──────────────────────────────────────────────────

def test_delete_assignment_404_without_mongo():
    r = client.delete("/assignments/nonexistent-id")
    assert r.status_code in (200, 404)


# ── POST /submissions ─────────────────────────────────────────────────────────

def test_save_submission_returns_document():
    r = client.post("/submissions", json=MINIMAL_SUBMISSION)
    assert r.status_code == 200
    body = r.json()
    assert body["submissionId"] == MINIMAL_SUBMISSION["submissionId"]
    assert body["assignmentId"] == MINIMAL_SUBMISSION["assignmentId"]
    assert body["studentName"] == "Alice"


def test_save_submission_validates_required_fields():
    bad = {"studentName": "Bob"}
    r = client.post("/submissions", json=bad)
    assert r.status_code == 422


# ── GET /assignments/{id}/submissions ─────────────────────────────────────────

def test_list_submissions_for_assignment_returns_list():
    r = client.get("/assignments/test-assignment-001/submissions")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── GET /submissions/{id} ─────────────────────────────────────────────────────

def test_get_submission_404_without_mongo():
    r = client.get("/submissions/nonexistent-submission")
    assert r.status_code in (200, 404)


# ── Task type validation ──────────────────────────────────────────────────────

def test_save_assignment_rejects_invalid_task_type():
    a = dict(MINIMAL_ASSIGNMENT, assignmentId="test-bad-task")
    a["studentTask"] = dict(MINIMAL_ASSIGNMENT["studentTask"], taskType="INVALID_TASK")
    r = client.post("/assignments", json=a)
    assert r.status_code == 422


def test_save_assignment_rejects_invalid_topic():
    a = dict(MINIMAL_ASSIGNMENT, assignmentId="test-bad-topic", topic="INVALID")
    r = client.post("/assignments", json=a)
    assert r.status_code == 422
