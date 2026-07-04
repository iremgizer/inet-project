# Network Algorithm Visualization Tool

A monorepo for an interactive network engineering algorithm visualization tool. It teaches ECMP, Distance Vector, and other routing algorithms with a clean frontend dashboard, Python backend, and a classroom assignment system.

## Architecture

- `backend/`: FastAPI backend that validates network inputs, runs routing simulations, and stores assignments/submissions in MongoDB.
- `frontend/`: Vite + React TypeScript interface for interactive graph editing, result visualization, and classroom workflow.

## What is implemented

- Interactive network builder with node/link creation, draggable nodes, weight/capacity editing.
- Traffic demand creation.
- **ECMP** equal-cost multipath routing with equal split.
- **Distance Vector** shortest-path routing with cost and next-hop tables.
- Step-by-step educational trace events with player controls (back/forward/play/pause/reset/speed).
- Link load, utilization, and congestion visualization.
- **Topology templates**: triangle, line, ring, mesh, Clos Fat-Tree (2S+4L+8H), Grid (3×3–5×5), Path (P4/P8/P16, weight=10), Cycle (C5/C7/C9), Random (configurable node/link count).
- **Category filter chips** on topology picker (ECMP, Distance Vector, Exercises).
- **Lecture Mode**: 4 built-in examples that auto-run on load (ECMP Triangle, DV P4, DV Grid, Clos Fat-Tree ECMP).
- Optional local MongoDB persistence for simulation runs.
- **Teacher Mode**: create classroom assignments with a guided form — set starter network, lock fields, define student task and expected solution, export/import JSON.
- **Student Mode**: import an assignment JSON, view the task prompt, run the simulation, enter answers, get auto-graded feedback, export a submission JSON.
- JSON schema files for assignment and submission formats: `frontend/src/schemas/`.

## Run the app

### MongoDB (for saved runs and assignments)

MongoDB is optional. The app fully runs without it, but simulation runs and assignments will not be persisted between sessions.

```bash
docker run --name network-viz-mongo -p 27017:27017 -d mongo:7
# Or, if the container already exists:
docker start network-viz-mongo
```

Optional environment variables for the backend:

```bash
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=network_visualizer
```

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL (default `http://localhost:5173`). The topbar shows three mode tabs: **Lab**, **Student**, and **Teacher**.

## Classroom Assignment System

### Teacher Mode

1. Click the **Teacher** tab in the topbar.
2. Fill in the assignment form (title, topic, starter network, locked fields, task prompt).
3. Click **Copy from Lab canvas** to use the network you built in Lab mode as the starter.
4. Click **Save Assignment** (persisted in MongoDB) or **Export JSON** to share with students.
5. Click **Preview as Student** to switch to Student mode and see what students will see.

### Student Mode

1. Click the **Student** tab in the topbar.
2. Drop or browse for the assignment `.json` file provided by your teacher.
3. Read the task prompt and instructions in the left panel.
4. Build or modify the network on the canvas as required (within the locked fields).
5. Click **Run My Solution** to execute the simulation.
6. Enter your answers in the answer form.
7. Click **Check Answer** to get auto-graded feedback (if the teacher set an expected solution).
8. Click **Export Submission** to download your submission as a JSON file.

### Assignment JSON format

See `frontend/src/schemas/assignment.schema.json` for the full JSON Schema.

Required fields: `title`, `topic`, `starterNetwork`, `allowedAlgorithms`, `studentTask`.

```json
{
  "title": "ECMP Triangle: Identify the Congested Link",
  "topic": "ECMP",
  "mode": "exercise",
  "course": "Network Algorithms 101",
  "starterNetwork": { "nodes": [...], "links": [...], "demands": [...], "topologyType": "triangle", "isDirected": false },
  "lockedFields": { "canEditNodes": false, "canEditLinks": false, "canEditWeights": false, "canEditCapacities": false, "canEditDemands": false, "canChooseAlgorithm": false },
  "allowedAlgorithms": ["ECMP"],
  "studentTask": {
    "taskType": "IDENTIFY_CONGESTED_LINKS",
    "prompt": "Which link becomes congested under ECMP?",
    "instructions": "1. Run the simulation.\n2. Enter the congested link ID below.",
    "answerFormatDescription": "Enter the link ID (e.g. v-t)."
  },
  "expectedSolution": { "congestedLinks": ["v-t"], "explanation": "..." },
  "gradingRules": { "tolerance": 0.01, "requireExactLinks": true, "allowEquivalentWeights": false, "maxScore": 100 }
}
```

### Supported task types

| Task type | Answer fields | Auto-graded |
|---|---|---|
| `IDENTIFY_CONGESTED_LINKS` | `congestedLinks` (string or array) | Yes |
| `COMPUTE_DV_TABLE` | `pathCost` (number), `nextHop` (string) | Yes |
| `REDUCE_MAX_UTILIZATION` | `maxUtilization` (auto-captured from simulation) | Yes |
| `SET_LINK_WEIGHTS` | — | No |
| `COMPUTE_PATH_COSTS` | — | No |
| `COMPUTE_ECMP_SPLIT` | — | No |

### Limitations

- **No authentication.** Teacher and Student are local UI modes with no login system. Do not use for exams that require identity verification.
- **Auto-grading is local.** Grading runs in the browser using the expected solution embedded in the assignment JSON. There is no server-side grade book.
- **Submissions are JSON files.** Students export submissions and send them manually to teachers; there is no submission queue in V1.
- MongoDB assignment storage uses the same graceful degradation as simulation run storage: the app works without MongoDB but does not persist data.

---

## Challenge Mode

Challenge Mode delivers a structured, self-contained problem-solving experience with progressive hints, intelligent feedback, and attempt tracking. Challenges are a specialisation of the Assignment JSON — load them in **Student** mode via drag-and-drop or from the built-in library.

### How it works

1. The teacher sets `"mode": "challenge"` in the assignment JSON and fills in `challengeConfig`.
2. The student loads the file in **Student** mode — the Challenge Workspace replaces the normal Student view.
3. The student edits the network (within `editableFields`), runs a simulation, and submits an answer.
4. The browser grades the answer client-side and shows a structured `FeedbackPanel`.
5. Hints can be revealed progressively; each hint may deduct points from the score.
6. Attempt history is tracked locally and saved to MongoDB when available.

### Challenge JSON format

```json
{
  "title": "Triangle Congestion: ECMP",
  "topic": "ECMP",
  "mode": "challenge",
  "starterNetwork": { "nodes": [...], "links": [...], "demands": [...], "topologyType": "triangle", "isDirected": false },
  "allowedAlgorithms": ["ECMP"],
  "studentTask": {
    "taskType": "IDENTIFY_CONGESTED_LINKS",
    "prompt": "Which link is congested under ECMP?",
    "instructions": "Run the simulation, then enter the congested link ID.",
    "answerFormatDescription": "Link ID, e.g. v-t"
  },
  "challengeConfig": {
    "challengeType": "IDENTIFY_CONGESTED_LINKS",
    "difficulty": "beginner",
    "learningObjectives": ["ECMP", "Congestion"],
    "expectedTimeMinutes": 10,
    "maxAttempts": 5,
    "showOfficialSolution": "after_correct",
    "editableFields": [],
    "target": {
      "congestedLinks": ["v-t"]
    },
    "hints": [
      {
        "hintId": "h1",
        "level": "conceptual",
        "title": "What is ECMP?",
        "text": "ECMP splits traffic equally across all shortest paths.",
        "relatedNodeIds": [],
        "relatedLinkIds": [],
        "revealCostPenalty": 0
      },
      {
        "hintId": "h2",
        "level": "calculation",
        "title": "Calculate the load",
        "text": "Each demand is split equally. Add the contributions of all demands on each link.",
        "relatedNodeIds": [],
        "relatedLinkIds": ["v-t"],
        "revealCostPenalty": 10
      }
    ]
  }
}
```

### Supported challenge types

| `challengeType` | What the student does | Auto-graded against |
|---|---|---|
| `IDENTIFY_CONGESTED_LINKS` | Enter link IDs that are congested | `target.congestedLinks` |
| `COMPUTE_DV_TABLE` | Enter path cost and next-hop for a node/destination pair | `target.expectedDVEntries` |
| `REDUCE_CONGESTION` | Modify link weights so max utilization drops below threshold | `target.maxUtilizationBelow` |
| `FIND_ECMP_WEIGHTS` | Set weights so ECMP achieves the target utilization | `target.maxUtilizationBelow` |
| `COMPUTE_ECMP_SPLIT` | Enter per-path traffic share percentages | `target.expectedTrafficSplits` |
| `PREDICT_SHORTEST_PATH` | Enter the shortest-path node sequence | `sim.pathResults[0].paths[0].nodes` |

### Hint system

Hints are revealed one at a time. Each hint has a `level` (conceptual → calculation → solution_direction) and a `revealCostPenalty` (0–100 percentage points deducted from the final score). Teachers can override or extend the three built-in defaults per challenge type.

### Grading result format

```json
{
  "isCorrect": true,
  "score": 90,
  "maxScore": 100,
  "percentage": 90,
  "attemptNumber": 1,
  "hintsUsed": 1,
  "feedbackItems": [
    {
      "type": "success",
      "title": "Correct link identified",
      "message": "v-t carries 150% of its capacity.",
      "explanation": "Traffic from u→t and v→t both route through this link under ECMP.",
      "relatedNodeIds": ["v", "t"],
      "relatedLinkIds": ["v-t"],
      "expectedValue": "v-t",
      "receivedValue": "v-t",
      "formula": "utilization = load / capacity",
      "workedExample": "load = 1.5 + 0.5 = 2.0\ncapacity = 1.0\nutilization = 2.0 > 1.0  → congested"
    }
  ],
  "summary": "You identified the congested link correctly.",
  "nextSuggestion": "Try increasing the capacity of v-t to see when it stops being congested.",
  "highlightedNodes": ["v", "t"],
  "highlightedLinks": [{ "linkId": "v-t", "status": "correct" }]
}
```

### Built-in example challenges

Three example challenges are bundled and accessible from the Challenge import screen without a JSON file:

| ID | Type | Difficulty |
|---|---|---|
| `challenge-ecmp-triangle-congestion` | `IDENTIFY_CONGESTED_LINKS` | beginner |
| `challenge-reduce-ecmp-congestion` | `REDUCE_CONGESTION` | intermediate |
| `challenge-dv-p4-table` | `COMPUTE_DV_TABLE` | beginner |

### Challenge Mode limitations

- **No authentication.** Challenge identity is based on a student name field typed by the student.
- **Client-side grading.** The expected answers are in the challenge JSON visible to the student. Suitable for self-study and formative assessment, not high-stakes exams.
- **No grade book.** Attempt history is persisted to MongoDB (lightweight records only — no full simulation result) when available; otherwise stored in browser session state only.
- **Attempt count is enforced locally.** A student can bypass the `maxAttempts` limit by reloading the page.

## API endpoints

### Simulation

- `POST /simulate` — run a simulation
- `GET /topologies` — list topology names
- `POST /topology/{type}` — generate a topology

### Saved simulation runs

- `GET /simulations` — list saved run metadata
- `GET /simulations/{id}` — load a full saved run
- `DELETE /simulations/{id}` — delete a saved run

### Assignments

- `GET /assignments` — list assignment summaries
- `POST /assignments` — create or update an assignment
- `GET /assignments/{id}` — get a full assignment
- `DELETE /assignments/{id}` — delete an assignment
- `GET /assignments/{id}/submissions` — list submissions for an assignment

### Submissions

- `POST /submissions` — save a submission
- `GET /submissions/{id}` — get a submission

### Challenge attempts

- `POST /challenge-attempts` — save a lightweight attempt record
- `GET /challenge-attempts?assignmentId={id}` — list attempt records for a challenge
- `GET /challenge-attempts/{id}` — get a specific attempt record

### Health

- `GET /health` — `{ "status": "ok", "mongoAvailable": bool }`

## Running tests

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt  # includes httpx for TestClient
python3 -m pytest tests/ -q
```

## What is intentionally deferred

- Real authentication and per-student grade books.
- Packetized traffic simulation.
- Delay/loss modeling.
- Asynchronous Distance Vector convergence.
- Node failures.
- Segment Routing and Custom Splitting full implementations.
- WebSocket/SSE trace streaming for very large simulations.
