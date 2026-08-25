"""Idempotent seeding for the Demo Scenario Pack.

Thin orchestration layer over `app.demo.demo_scenarios.build_curated_demo_scenarios`
(the pure, in-memory, CURATED scenario definitions — 4 as of the final
instructor-curated pack, see that module's docstring) and
`AssignmentStorageService` (MongoDB persistence, already idempotent via
`replace_one(upsert=True)` keyed on `assignmentId` — running the seed twice
never creates duplicates, it just re-writes the same documents in place).

Also prunes any demoScenario-tagged document left over from a PREVIOUS,
larger pack (e.g. the original 16-scenario set) so the dashboard never
shows a stale scenario that's no longer part of the curated set — see
`AssignmentStorageService.prune_demo_scenarios` for why this can never
touch an ordinary teacher-created assignment.
"""
from __future__ import annotations

from typing import Any, Dict

from app.demo.demo_scenarios import build_curated_demo_scenarios
from app.services.assignment_service import AssignmentStorageService


def seed_demo_scenarios(assignment_storage: AssignmentStorageService) -> Dict[str, Any]:
    if not assignment_storage.available:
        return {"seeded": 0, "removed": 0, "scenarioIds": [], "message": "MongoDB not available — nothing seeded."}
    scenarios = build_curated_demo_scenarios()
    seeded_ids = []
    for scenario in scenarios:
        doc = scenario.model_dump()
        assignment_storage.save_assignment(doc)
        seeded_ids.append(scenario.assignmentId)
    removed = assignment_storage.prune_demo_scenarios(seeded_ids)
    message = f"Seeded {len(seeded_ids)} demo scenarios (idempotent — safe to re-run)."
    if removed:
        message += f" Removed {removed} stale demo scenario document(s) from a previous pack."
    return {
        "seeded": len(seeded_ids),
        "removed": removed,
        "scenarioIds": seeded_ids,
        "message": message,
    }
