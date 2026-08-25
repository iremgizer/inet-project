import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend directory (works whether uvicorn is started from
# /backend or the repo root).
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path, override=True)

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
from app.models import Assignment, GradeRequest, SimulationRequest, StudentSubmission, ChallengeAttemptRecord
from app.optimization.models import OptimizeRequest, SearchSpaceEstimateRequest
from app.services.assignment_service import AssignmentStorageService
from app.services.demo_scenario_service import seed_demo_scenarios
from app.services.optimization_service import estimate_search_space, run_optimization
from app.services.simulation_service import SimulationService
from app.services.topology_service import TopologyService
from app.services.grading_service import grade_attempt

app = FastAPI(title="Network Algorithm Visualization Tool Backend")

# ── CORS ─────────────────────────────────────────────────────────────────────
# Local dev origins are always allowed, unconditionally, so nothing changes
# for anyone running the project locally (backward compatible with every
# prior deployment of this middleware). A deployed frontend's origin is
# added on top via FRONTEND_ORIGIN/FRONTEND_ORIGINS — never hardcoded here,
# since the exact Render URL isn't known at commit time and shouldn't
# require a code change (or a redeploy of this file) to configure per
# environment. `allow_origins=["*"]` is never used together with
# `allow_credentials=True` — that combination is rejected by browsers
# anyway (and pointless here, since every route this app exposes is
# same-origin-cookie-free; credentials=True exists for future-proofing,
# not because any current route needs cookies).
LOCAL_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def _configured_frontend_origins() -> List[str]:
    """Production frontend origin(s) from the environment.

    Accepts either FRONTEND_ORIGIN (a single origin) or FRONTEND_ORIGINS
    (comma-separated, for multiple deployed frontends — e.g. a preview
    deploy alongside production) — both are read, since which name an
    operator reaches for isn't worth gatekeeping. Blank entries and
    surrounding whitespace are ignored; a trailing slash is stripped
    since an Origin header never includes one and an accidental
    "https://example.com/" would otherwise silently never match.
    """
    raw_values = [
        os.environ.get("FRONTEND_ORIGIN", ""),
        os.environ.get("FRONTEND_ORIGINS", ""),
    ]
    origins: List[str] = []
    for raw in raw_values:
        for candidate in raw.split(","):
            candidate = candidate.strip().rstrip("/")
            if candidate and candidate not in origins:
                origins.append(candidate)
    return origins


origins = LOCAL_DEV_ORIGINS + _configured_frontend_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

simulation_service = SimulationService()
assignment_storage = AssignmentStorageService()

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "mongoAvailable": assignment_storage.available}

# ── Simulation ────────────────────────────────────────────────────────────────

@app.post("/simulate")
def simulate(request: SimulationRequest):
    try:
        result = simulation_service.simulate(request)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.get("/topologies")
def topologies():
    return TopologyService.get_topology_names()

# ── Optimization (Sprint 2, PR5) ────────────────────────────────────────────
# The only HTTP-facing entry point onto PR1-4's optimizers (OPT/WPO/LWO/
# JOINT) — see app/services/optimization_service.py. Results are transient
# (never persisted, never saved alongside a topology) — the Optimization Lab
# calls this once per "Run" click and holds the response in frontend state
# only, exactly like every other optimizer call site in this codebase.

@app.post("/optimize")
def optimize(request: OptimizeRequest):
    try:
        return run_optimization(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

# PR6 §3 — search-space preview, called before a student commits to running
# WPO/LWO/JOINT (and live, again, whenever they adjust the weight range —
# see the Optimization Lab's own settings panel). No search runs here.

@app.post("/optimize/search-space")
def optimize_search_space(request: SearchSpaceEstimateRequest):
    try:
        return estimate_search_space(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/topology/{topology_type}")
def load_topology(topology_type: str):
    try:
        return TopologyService.build_topology(topology_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

# ── Saved simulation runs ─────────────────────────────────────────────────────

@app.get("/simulations")
def list_simulations():
    return simulation_service.storage.list_runs()

@app.get("/simulations/{simulation_run_id}")
def get_simulation(simulation_run_id: str):
    run = simulation_service.storage.get_run(simulation_run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found or MongoDB is unavailable")
    return run

@app.delete("/simulations/{simulation_run_id}")
def delete_simulation(simulation_run_id: str):
    deleted = simulation_service.storage.delete_run(simulation_run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Simulation run not found or MongoDB is unavailable")
    return {"deleted": True}

# ── Assignments ───────────────────────────────────────────────────────────────

@app.get("/assignments")
def list_assignments():
    """Return assignment summaries. Returns [] if MongoDB unavailable."""
    return assignment_storage.list_assignments()

@app.post("/assignments")
def save_assignment(assignment: Assignment):
    """Create or update an assignment. Persists if MongoDB available."""
    doc = assignment.model_dump()
    saved = assignment_storage.save_assignment(doc)
    return saved

@app.get("/assignments/{assignment_id}")
def get_assignment(assignment_id: str):
    doc = assignment_storage.get_assignment(assignment_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found or MongoDB is unavailable")
    return doc

@app.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: str):
    deleted = assignment_storage.delete_assignment(assignment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found or MongoDB is unavailable")
    return {"deleted": True}

@app.post("/seed-demo")
def seed_demo(assignments: List[Assignment]) -> Dict[str, Any]:
    """Seed demo assignment documents into MongoDB."""
    if not assignment_storage.available:
        return {"seeded": 0, "message": "MongoDB not available"}
    count = 0
    for a in assignments:
        doc = a.model_dump()
        assignment_storage.save_assignment(doc)
        count += 1
    return {"seeded": count, "message": f"Seeded {count} demo assignments."}

# ── Demo Scenario Pack ───────────────────────────────────────────────────────
# Server-side-configured, MongoDB-persisted teaching scenarios shown to the
# "Demo Student" account (see app/demo/demo_scenarios.py). Idempotent —
# calling this endpoint any number of times upserts the same 4 curated
# documents, never creating duplicates (same replace_one(upsert=True)-by-
# assignmentId path as /seed-demo above and every other assignment save),
# and prunes any demoScenario-tagged document left over from a previous,
# larger pack (see seed_demo_scenarios()'s own docstring).

@app.post("/seed-demo-scenarios")
def seed_demo_scenarios_route() -> Dict[str, Any]:
    return seed_demo_scenarios(assignment_storage)

@app.get("/demo-scenarios")
def list_demo_scenarios() -> List[Dict[str, Any]]:
    """Student-safe summaries (no starterNetwork/expectedSolution/lockedFields
    payload) for the Demo Student dashboard. Returns [] if MongoDB is
    unavailable or nothing has been seeded yet — never fabricated data."""
    return assignment_storage.list_demo_scenarios()

@app.get("/assignments/{assignment_id}/submissions")
def list_submissions(assignment_id: str):
    """Return submissions for a given assignment. Returns [] if MongoDB unavailable."""
    return assignment_storage.list_submissions_for_assignment(assignment_id)

# ── Submissions ───────────────────────────────────────────────────────────────

@app.post("/submissions")
def save_submission(submission: StudentSubmission):
    """Save a student submission. Persists if MongoDB available."""
    doc = submission.model_dump()
    saved = assignment_storage.save_submission(doc)
    return saved

@app.get("/submissions/{submission_id}")
def get_submission(submission_id: str):
    doc = assignment_storage.get_submission(submission_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found or MongoDB is unavailable")
    return doc

# ── Challenge attempts ────────────────────────────────────────────────────────

@app.post("/challenge-attempts")
def save_challenge_attempt(attempt: ChallengeAttemptRecord):
    """Save a lightweight challenge attempt record. Persists if MongoDB available."""
    doc = attempt.model_dump()
    saved = assignment_storage.save_challenge_attempt(doc)
    return saved

@app.get("/challenge-attempts")
def list_challenge_attempts(assignmentId: Optional[str] = Query(None)):
    """Return attempt records. Returns [] if MongoDB unavailable or no assignmentId."""
    if not assignmentId:
        return []
    return assignment_storage.list_challenge_attempts(assignmentId)

@app.get("/challenge-attempts/{attempt_id}")
def get_challenge_attempt(attempt_id: str):
    doc = assignment_storage.get_challenge_attempt(attempt_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Challenge attempt not found or MongoDB is unavailable")
    return doc

# ── Server-side grading ───────────────────────────────────────────────────────

@app.post("/grade")
def grade(request: GradeRequest) -> Dict[str, Any]:
    """Grade a challenge attempt server-side.

    Loads the assignment from MongoDB when assignmentId is given.
    Falls back to the embedded assignment dict in the request body (demo mode).
    Returns a ChallengeGradingResult-shaped dict.
    """
    assignment_doc: Optional[Dict[str, Any]] = None

    if request.assignmentId:
        assignment_doc = assignment_storage.get_assignment(request.assignmentId)

    if not assignment_doc and request.assignment:
        assignment_doc = request.assignment

    if not assignment_doc:
        return {
            "isCorrect": False, "score": 0, "maxScore": 100, "percentage": 0,
            "attemptNumber": 1, "hintsUsed": request.hintsUsed,
            "feedbackItems": [{"type": "error", "title": "Assignment not found",
                               "message": "Could not locate the assignment for server-side grading.",
                               "relatedLinkIds": [], "relatedNodeIds": [], "relatedDemandIds": []}],
            "summary": "Assignment not found — cannot grade server-side.",
            "nextSuggestion": "",
            "highlightedLinks": [], "highlightedNodes": [],
            "gradingMode": "server",
        }

    return grade_attempt(
        submitted_network=request.submittedNetwork,
        algorithm_config=request.submittedAlgorithmConfig,
        submitted_answers=request.submittedAnswers,
        assignment=assignment_doc,
        hints_used=request.hintsUsed,
    )

@app.get("/assignments/{assignment_id}/student")
def get_assignment_student(assignment_id: str) -> Dict[str, Any]:
    """Return assignment without expectedSolution (safe for student-facing use)."""
    doc = assignment_storage.get_assignment(assignment_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found or MongoDB is unavailable")
    doc.pop("expectedSolution", None)
    return doc
