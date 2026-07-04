from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class AssignmentStorageService:
    """MongoDB-backed storage for assignments, submissions, and challenge attempts.

    Degrades gracefully when MongoDB is unavailable — all write methods
    become no-ops and all read methods return empty results.
    """

    def __init__(self) -> None:
        self.uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        self.database_name = os.getenv("MONGODB_DATABASE", "network_visualizer")
        self._assignments = None
        self._submissions = None
        self._challenge_attempts = None
        self._available = False
        try:
            from pymongo import MongoClient
            client = MongoClient(self.uri, serverSelectionTimeoutMS=500)
            client.admin.command("ping")
            db = client[self.database_name]
            self._assignments = db["assignments"]
            self._submissions = db["submissions"]
            self._challenge_attempts = db["challenge_attempts"]
            self._available = True
        except Exception:
            pass

    @property
    def available(self) -> bool:
        return self._available

    # ── Assignments ────────────────────────────────────────────────────────────

    def save_assignment(self, assignment: Dict[str, Any]) -> Dict[str, Any]:
        assignment["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if self._available and self._assignments is not None:
            self._assignments.replace_one(
                {"assignmentId": assignment["assignmentId"]},
                assignment,
                upsert=True,
            )
        return assignment

    def list_assignments(self) -> List[Dict[str, Any]]:
        if not self._available or self._assignments is None:
            return []
        docs = self._assignments.find(
            {},
            {"_id": 0, "starterNetwork": 0, "expectedSolution": 0, "lockedFields": 0},
        )
        return [
            {
                "assignmentId": d.get("assignmentId", ""),
                "title": d.get("title", ""),
                "course": d.get("course", ""),
                "topic": d.get("topic", "ECMP"),
                "mode": d.get("mode", "exercise"),
                "taskType": (d.get("studentTask") or {}).get("taskType", ""),
                "createdAt": d.get("createdAt", ""),
                "updatedAt": d.get("updatedAt", ""),
            }
            for d in docs.sort("createdAt", -1)
        ]

    def get_assignment(self, assignment_id: str) -> Optional[Dict[str, Any]]:
        if not self._available or self._assignments is None:
            return None
        return self._assignments.find_one({"assignmentId": assignment_id}, {"_id": 0})

    def delete_assignment(self, assignment_id: str) -> bool:
        if not self._available or self._assignments is None:
            return False
        result = self._assignments.delete_one({"assignmentId": assignment_id})
        return result.deleted_count > 0

    # ── Submissions ────────────────────────────────────────────────────────────

    def save_submission(self, submission: Dict[str, Any]) -> Dict[str, Any]:
        if self._available and self._submissions is not None:
            self._submissions.replace_one(
                {"submissionId": submission["submissionId"]},
                submission,
                upsert=True,
            )
        return submission

    def get_submission(self, submission_id: str) -> Optional[Dict[str, Any]]:
        if not self._available or self._submissions is None:
            return None
        return self._submissions.find_one({"submissionId": submission_id}, {"_id": 0})

    def list_submissions_for_assignment(self, assignment_id: str) -> List[Dict[str, Any]]:
        if not self._available or self._submissions is None:
            return []
        docs = self._submissions.find(
            {"assignmentId": assignment_id},
            {"_id": 0, "submittedNetwork": 0},
        )
        return list(docs.sort("createdAt", -1))

    # ── Challenge attempts ─────────────────────────────────────────────────────

    def save_challenge_attempt(self, attempt: Dict[str, Any]) -> Dict[str, Any]:
        if self._available and self._challenge_attempts is not None:
            self._challenge_attempts.replace_one(
                {"attemptId": attempt["attemptId"]},
                attempt,
                upsert=True,
            )
        return attempt

    def list_challenge_attempts(self, assignment_id: str) -> List[Dict[str, Any]]:
        if not self._available or self._challenge_attempts is None:
            return []
        docs = self._challenge_attempts.find(
            {"assignmentId": assignment_id},
            {"_id": 0},
        )
        return list(docs.sort("createdAt", -1))

    def get_challenge_attempt(self, attempt_id: str) -> Optional[Dict[str, Any]]:
        if not self._available or self._challenge_attempts is None:
            return None
        return self._challenge_attempts.find_one({"attemptId": attempt_id}, {"_id": 0})
