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
from app.services.assignment_service import AssignmentStorageService
from app.services.simulation_service import SimulationService
from app.services.topology_service import TopologyService
from app.services.grading_service import grade_attempt

app = FastAPI(title="Network Algorithm Visualization Tool Backend")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

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
