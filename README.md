# Network Algorithm Visualization Tool

An interactive educational platform for visualizing and simulating network routing algorithms, developed for the **Algorithms for Network Systems** course at Technische Universität Berlin. The tool allows students to design custom network topologies, define traffic demands, and observe how routing algorithms such as ECMP and Distance Vector make forwarding decisions — step by step. It includes a full classroom system with Teacher, Student, and Challenge modes for structured assignments and self-paced problem solving.

---

## Features

- **Interactive network topology builder** — drag-and-drop canvas with React Flow; add, delete, and connect nodes and links
- **ECMP simulation** — equal-cost multipath routing with traffic splitting across shortest paths
- **Distance Vector simulation** — Bellman-Ford shortest-path routing with cost tables and next-hop inspection
- **Step-by-step trace replay** — animated playback with forward, back, play/pause, and speed controls
- **Lecture examples** — four pre-built scenarios that auto-run on load (ECMP Triangle, DV Path P4, DV Grid, Clos Fat-Tree ECMP)
- **Topology templates** — triangle, ring, mesh, Clos Fat-Tree, grid, path, cycle, and random graphs
- **Custom topology JSON import/export** — load any topology from a validated JSON file; export the current network
- **Congestion visualization** — link utilization colour-coding; congested links highlighted on the canvas
- **Node and link inspection** — click any node or link to view routing results, update weights and capacities inline
- **Teacher mode** — create classroom assignments with a guided form; lock fields, set task prompts, export JSON
- **Student mode** — import an assignment file, solve the task, get auto-graded feedback, export a submission
- **Challenge mode** — structured problem-solving with progressive hints, attempt tracking, and scored feedback
- **Saved simulation sessions** — browse and reload previous runs from the top bar
- **MongoDB persistence** — optional; the app runs fully without it, but runs and assignments are not persisted between sessions

---

## Project Structure

```
inet-project/
├── frontend/          # React 18 + TypeScript + Vite + React Flow UI
│   ├── src/
│   │   ├── api/           # Backend API client
│   │   ├── components/    # Shared UI components (canvas, panels, toolbars)
│   │   ├── pages/         # One page component per workflow step or mode
│   │   ├── schemas/       # JSON Schema files for assignment and submission formats
│   │   ├── styles/        # Global CSS
│   │   ├── types/         # TypeScript type definitions
│   │   └── utils/         # Topology generators, JSON helpers, grading logic
│   └── package.json
├── backend/           # FastAPI + Python backend
│   ├── app/
│   │   ├── algorithms/    # ECMP and Distance Vector implementations
│   │   ├── services/      # MongoDB storage services
│   │   ├── main.py        # API entrypoint and route definitions
│   │   └── models.py      # Pydantic request/response models
│   ├── tests/             # pytest test suite
│   └── requirements.txt
└── sample-json/       # Example topology JSON files and a validation script
```

---

## Demo Login

> **Warning:** This login is for local prototype and demo purposes only.
> It is **not** production authentication. Before any deployment, replace it with
> secure authentication (JWT, OAuth, or institutional SSO) and database-backed user management.

| Role | Username | Password |
|---|---|---|
| Teacher | `teacher` | `teacher` |
| Student | `student` | `student` |

The credentials are defined in `frontend/src/utils/demoAuth.ts`.

### Demo student roster

After logging in as a student, the app asks you to choose a demo student profile:

| Student ID | Name |
|---|---|
| s001 | Alice Student |
| s002 | Bob Student |
| s003 | Charlie Student |

The roster is defined in `frontend/src/utils/demoUsers.ts`. Each student sees only the work their teacher has assigned to them (or work assigned to all students).

Each demo student has different pre-seeded progress data, so the Student Dashboard shows realistic but distinct experiences:

| Student | Strengths | Status |
|---|---|---|
| Alice (s001) | ECMP, Congestion | 4 challenges solved, avg score 88% |
| Bob (s002) | Shortest Path | 1 challenge solved, avg score 65%, using hints |
| Charlie (s003) | Getting started | 0 challenges solved, needs encouragement |

---

## Student Progress Dashboard

After logging in as a student, the **Student Dashboard** provides a full learner portal:

### Overview tab
- Personalised greeting with an average-score ring indicator
- 8 metric cards: assigned work, completed, in progress, needs retry, best score, challenges solved, hints used, replays watched
- **Continue Learning** — 3 recommended next actions (challenges, lectures, lab), with progress bars and CTA buttons (Start / Continue / Retry)
- **Your Insights** — 3–5 AI-derived observations about the student's performance patterns

### Progress tab
- **Topic Progress** — 8 topic cards (ECMP, Distance Vector, Congestion, Traffic Engineering, Shortest Path, Routing Tables, Link Weights, Capacity), each showing status (Not Started / Learning / Completed), a progress bar, score, description, and a next-step action button
- **Achievements** — 6 badges (First Simulation, ECMP Explorer, Congestion Detective, Replay Learner, No-Hint Solver, Challenge Streak) with locked/unlocked states and unlock dates

### My Work tab
- Filter bar: All / Active / Completed / Needs attention (with a red badge count)
- Assignments and Challenges shown separately, each row shows status badge, score, attempts, last activity, and a context-aware CTA (Start / Continue / Retry / Review)
- Inline lecture examples panel (collapsed by default)
- JSON import fallback

### Timeline tab
- Chronological activity log: submissions, attempts, hints revealed, replays watched, lectures opened, simulation runs
- Color-coded icons per event type
- Relative timestamps ("just now", "2h ago", "yesterday")

### Prototype data model

Progress data is seeded in `frontend/src/utils/studentProgressService.ts` and parameterised per student ID. The service exports:

| Function | Description |
|---|---|
| `computeStudentOverview` | Aggregate metrics (completed, avg score, hints, replays) |
| `computeTopicProgress` | Per-topic status, progress %, score, next action |
| `computeContinueLearning` | 3 recommended next-step items |
| `computeStudentTimeline` | Chronological activity events |
| `computeStudentAchievements` | All 6 badges with locked/unlocked state |
| `computeStudentInsights` | 3–5 personalised insight cards |
| `getStudentWorkRecord` | Per-student status/score for a specific work item |

In production, replace the `SEED` object with real queries to MongoDB submission and attempt collections.

---

## Teacher Workflow

1. Log in as **Teacher** and open the Teacher Dashboard
2. Go to **Assignments** tab → click **Create New Assignment** to open the Teacher Workspace
3. Fill in title, topic, starter network, locked fields, task prompt, and expected solution
4. Click **Save** (requires MongoDB) and optionally **Export JSON** to get `assignment.json`
5. Back on the dashboard, click **Assign** next to a saved assignment, choose which students receive it and an optional due date, then click **Assign**
6. To export a PDF version, click **PDF** (student copy, no answer) or **PDF+Ans** (teacher copy with expected solution)
7. Use the **Assigned Work** tab to see which work has been distributed and to whom

## Student Workflow

1. Log in as **Student**, choose your demo profile (Alice, Bob, or Charlie)
2. Open **My Work** tab — any work your teacher has assigned appears here
3. Click **Open** on an assignment to load it into the Student Workspace (requires MongoDB)
4. Alternatively, import an `assignment.json` directly from **My Assignments** if received by email or file share
5. Solve the task on the canvas, run the simulation, and fill in any required answers
6. Click **Export Submission** to save a `submission.json` file and send it to your teacher

## Assignment Distribution

Teachers can assign saved assignments to all students or to specific students. The assignment distribution model:

```
AssignedWork {
  workType:   "assignment" | "challenge"
  workId:     assignmentId from MongoDB
  assignedTo: "all" | string[]    // studentId[] from the demo roster
  assignedAt: ISO timestamp
  dueDate?:   ISO date (optional)
}
```

Assigned work is stored in the browser's `localStorage` so it persists across sessions on the same machine. In production this would be server-side.

## PDF Export

Teacher users can export any saved assignment as a PDF directly from the Assignments tab:

- **PDF** — student version (no expected solution)
- **PDF+Ans** — teacher version (includes expected solution, grading rules, marked with a red banner)

PDF generation is done client-side with [jsPDF](https://github.com/parallax/jsPDF). No server or external service is involved.

## JSON Workflow

Students do not write JSON manually. The workflow is:

```
Teacher  → creates assignment.json in Teacher Workspace → shares with students
Student  → imports assignment.json via My Assignments  → solves task on canvas
Student  → exports submission.json                     → sends to teacher
Teacher  → reviews submission.json or saved submissions
```

### Schema files

| File | Location |
|---|---|
| `topology.schema.json` | `frontend/src/schemas/topology.schema.json` |
| `assignment.schema.json` | `frontend/src/schemas/assignment.schema.json` |
| `submission.schema.json` | `frontend/src/schemas/submission.schema.json` |

These schemas are used internally by the app to validate imported files. Students do not need to read or edit them.

---

## Requirements

- **Node.js** v18 or later
- **npm** v9 or later
- **Python** 3.11 or later
- **MongoDB** 7 (optional — required only for saving simulation runs and assignments)

---

## Installation

```bash
git clone https://github.com/iremgizer/inet-project.git
cd inet-project
```

---

## Running the Backend

Open a terminal in the project root.

```bash
cd backend

# Create virtual environment (first time only)
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

# Install dependencies (first time only)
pip install -r requirements.txt

# Start the development server
uvicorn app.main:app --reload --port 8000
```

The backend runs at **http://localhost:8000**

API documentation is available at **http://localhost:8000/docs**

---

## Running the Frontend

Open a second terminal in the project root.

```bash
cd frontend

# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

The frontend runs at **http://localhost:5173**

---

## MongoDB (Optional)

Simulations, saved runs, and classroom assignments can be persisted to a local MongoDB instance. The application works without it — saved runs and assignment storage are silently disabled when the database is unavailable.

Start a MongoDB 7 container with Docker:

```bash
docker run --name network-viz-mongo \
  -p 27017:27017 \
  -d mongo:7
```

If the container already exists:

```bash
docker start network-viz-mongo
```

The backend connects to `mongodb://localhost:27017` and uses the `network_visualizer` database by default. Override these with environment variables if needed:

```bash
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=network_visualizer
```

---

## Running Tests

**Backend**

```bash
cd backend
source .venv/bin/activate
python3 -m pytest tests/ -q
```

**Frontend — production build check**

```bash
cd frontend
npm run build
```

**Sample JSON validation**

```bash
cd sample-json
node validate.js
```

---

## Sample JSON Files

The `sample-json/` folder contains ready-made topology files that can be imported directly through the application using the **Import JSON** option on the home screen.

| File | Description |
|---|---|
| `triangle_ecmp.json` | Classic three-node triangle; two equal-cost paths |
| `path_p4.json` | Linear four-node chain with weight=10; DV convergence demo |
| `grid_3x3.json` | 3×3 lattice; multiple equal-cost routes in all directions |
| `clos_fat_tree_small.json` | Two-spine, four-leaf, eight-host data-centre topology |
| `random_medium.json` | Ten-node random connected graph |
| `invalid_duplicate_links.json` | Intentionally invalid — duplicate link IDs (rejected by validator) |
| `invalid_negative_weight.json` | Intentionally invalid — negative link weight (rejected by validator) |

Run `node validate.js` inside `sample-json/` to validate all files against the schema.

---

## Supported Algorithms

**Currently implemented**

- ✅ ECMP — Equal-Cost Multi-Path routing with uniform traffic splitting
- ✅ Distance Vector — Bellman-Ford shortest-path routing with routing table generation

**Planned**

- Segment Routing
- Custom traffic splitting

---

## Educational Workflow

The Lab mode guides users through a four-step workflow:

```
Home
  ↓
Design Network     — draw nodes and links, load a template, or import JSON
  ↓
Configure Traffic  — define source-to-destination demand flows
  ↓
Choose Algorithm   — select ECMP or Distance Vector
  ↓
Run Simulation     — execute routing and view link utilization results
  ↓
Replay Trace       — step through the algorithm's decisions one event at a time
```

---

## Midterm Demo Script

Use this script for the live demo. Allow approximately 15 minutes. MongoDB is **optional** — all demo data is pre-loaded in localStorage.

> **Fast demo shortcut:** On the landing page, click **Start Building a Network** to enter the Lab immediately — no login required. Skip directly to Part 2 if you only have 5 minutes.

### Part 1 — Teacher view (5 min)

1. Open the app at `http://localhost:5173`
2. Click **Teacher login**, enter `teacher` / `teacher`
3. On the **Teacher Dashboard → Overview** tab, point out: assignment count, pending-review badge, student completion breakdown
4. Switch to **Assignments** tab — three demo assignments appear immediately (ECMP Triangle, Reduce Congestion, DV P4). Note: "demo data always shown — MongoDB adds more"
5. Switch to **Submissions** tab — the review center shows 8 pre-seeded rows across Alice, Bob, and Charlie. Point out:
   - Bob's Reduce Congestion is flagged **Needs Review** (score 55, 3 attempts)
   - Click that row to open the slide-in drawer — show teacher notes (auto-saved), assignment prompt, expected answer, score breakdown
   - Click **Export CSV** to download the gradebook

### Part 2 — Challenge mode (5 min)

6. On the **Lab & Demos** tab, click **Challenge Library**
7. Open **ECMP Triangle: Find the Congested Link**
   - Point out the task description, progressive hints, and the attempt counter
   - Run ECMP simulation using the **Run** button
   - Reveal hint 1, then submit an answer — show the graded feedback panel and score badge
8. Go back, open **Reduce Congestion: Adjust Link Weights**
   - Adjust link weights on the canvas, re-run ECMP — watch utilizations drop
   - Submit and show the score

### Part 3 — Student view (5 min)

9. Log out → log in as `student` / `student` → choose **Alice**
10. **My Work** tab — three assigned challenges appear (ECMP Triangle ✓ 88%, DV P4 in progress, Reduce Congestion not started). Click **Review** on the ECMP Triangle to reopen the result
11. Switch to **Overview** tab — show metric cards (4 challenges solved, avg score 88%), Continue Learning panel, and Your Insights
12. Switch to **Progress** tab — show topic progress bars and achievement badges
13. Switch to **Timeline** tab — show chronological activity log
14. Log out → log in as **Bob** — show a different progress state (1 solved, hints used, Reduce Congestion needs retry)

### Demo Tips

- Demo data survives **page refresh** — no MongoDB required for the demo
- If data looks wrong: Teacher Dashboard → Lab & Demos → Demo Tools → **Reset demo data**
- If everything is broken: Demo Tools → **Clear all local data & reload**

---

## Known Limitations

These are intentional scope decisions for a university course prototype, not bugs.

| Area | Limitation |
|---|---|
| Authentication | Credentials are hardcoded in `demoAuth.ts`. No real login, JWT, or session management. |
| Assignment persistence | Without MongoDB, assignments created in Teacher Workspace are lost on page reload. Demo assignments always reload from localStorage. |
| Student assignment access | Without MongoDB, challenge-type assignments open from local memory. Assignment-type (non-challenge) works require MongoDB to load their topology. |
| Locked fields | `lockedFields` and `challengeConfig.editableFields` are displayed in the task panel but not enforced on the canvas — students can still drag nodes or change weights. |
| Attempt integrity | `maxAttempts` is enforced in-memory. A student can bypass it by reloading the page. |
| Grading | All grading is client-side. Expected answers are visible in the assignment JSON file. |
| Segment Routing | Stub only — returns empty results. Planned for a future sprint. |
| Concurrency | The FastAPI backend is single-worker with no connection pooling. Not suitable for classroom-scale simultaneous users. |
| DV convergence | Distance Vector runs to full convergence synchronously. Async Bellman-Ford with failure simulation is not implemented. |

---

## Future Production Work

This is a university course prototype. Before any real deployment the following are required:

- **Real authentication** — replace `demoAuth.ts` with JWT or institutional SSO (e.g. Shibboleth / OAuth)
- **Database-backed user management** — store users, roles, and course enrolments in MongoDB or PostgreSQL instead of a hardcoded list
- **Server-side assignment distribution** — move `assignedWorks` from `localStorage` to a `/assigned-work` API endpoint with per-student access control
- **Submission queue** — add a backend route for students to submit work; replace the current file-export-and-email flow
- **Grade book integration** — connect submission scores to a course LMS (Moodle, Canvas) via LTI or REST
- **Secure file sharing** — replace manual `assignment.json` distribution with signed download links from the backend
- **Scalability** — the current in-memory Python backend has no concurrency limits; add worker processes and connection pooling for classroom-scale load

