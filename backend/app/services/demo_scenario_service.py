"""Idempotent seeding for the Demo Scenario Pack.

Thin orchestration layer over `app.demo.demo_scenarios.build_demo_scenarios`
(the pure, in-memory scenario definitions) and `AssignmentStorageService`
(MongoDB persistence, already idempotent via `replace_one(upsert=True)`
keyed on `assignmentId` — running the seed twice never creates duplicates,
it just re-writes the same 16 documents in place).
"""
from __future__ import annotations

from typing import Any, Dict

from app.demo.demo_scenarios import build_demo_scenarios
from app.services.assignment_service import AssignmentStorageService


def seed_demo_scenarios(assignment_storage: AssignmentStorageService) -> Dict[str, Any]:
    if not assignment_storage.available:
        return {"seeded": 0, "scenarioIds": [], "message": "MongoDB not available — nothing seeded."}
    scenarios = build_demo_scenarios()
    seeded_ids = []
    for scenario in scenarios:
        doc = scenario.model_dump()
        assignment_storage.save_assignment(doc)
        seeded_ids.append(scenario.assignmentId)
    return {
        "seeded": len(seeded_ids),
        "scenarioIds": seeded_ids,
        "message": f"Seeded {len(seeded_ids)} demo scenarios (idempotent — safe to re-run).",
    }
