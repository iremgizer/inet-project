from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from app.models import Assignment, SimulationRequest, StudentSubmission, ChallengeAttemptRecord
from app.services.assignment_service import AssignmentStorageService
from app.services.simulation_service import SimulationService
from app.services.topology_service import TopologyService

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
