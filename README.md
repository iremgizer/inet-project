# Network Algorithm Visualization Tool

An interactive educational platform for visualizing and simulating network routing algorithms, developed for the **Algorithms for Network Systems** course at Technische Universität Berlin. The tool allows students to design custom network topologies, define traffic demands, and observe how routing algorithms such as ECMP and Distance Vector make forwarding decisions — step by step. It includes a full classroom system with Teacher, Student, and Challenge modes for structured assignments and self-paced problem solving.

---

## Features

- **Interactive network topology builder** — drag-and-drop canvas with React Flow; add, delete, and connect nodes and links
- **ECMP simulation** — equal-cost multipath routing with traffic splitting across shortest paths
- **Distance Vector simulation** — Bellman-Ford shortest-path routing with cost tables and next-hop inspection
- **Step-by-step trace replay** — animated playback with forward, back, play/pause, and speed controls; contextual per-step panel shows algorithm state, cost calculations, and link load deltas for each event
- **Interactive routing table** — searchable, filterable DV table with "relevant only" mode that highlights the active row in sync with the trace replay
- **Demand path colours** — each traffic demand gets a distinct colour on the canvas; congestion severity shown separately via line thickness and glow halo; collapsible legend panel
- **Lecture examples** — four pre-built scenarios that auto-run on load (ECMP Triangle, DV Path P4, DV Grid, Clos Fat-Tree ECMP)
- **Topology templates** — triangle, ring, mesh, Clos Fat-Tree, grid, path, cycle, and random graphs
- **Custom topology JSON import/export** — load any topology from a validated JSON file; export the current network
- **Congestion visualization** — link utilization colour-coding; congested links highlighted on the canvas
- **Node and link inspection** — floating inspector drawer; click any node or link to view routing results, update weights and capacities inline
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
│   │   ├── algorithms/    # ECMP, Distance Vector, Segment Routing implementations
│   │   ├── optimization/  # OPT/WPO/LWO/Joint optimizers (Sprint 2)
│   │   ├── demo/          # Demo Scenario Pack — pre-seeded topologies (see README's Demo Scenario Pack section)
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
| Demo Student | `demo` | `demo` |

The credentials are defined in `frontend/src/utils/demoAuth.ts`. The `demo`/`demo` account is a distinct, clearly-labeled demo-only profile — see [Demo Student](#demo-student) below.

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

## Demo Student

A fourth, dedicated demo profile — distinct from Alice/Bob/Charlie above — built to showcase Sprint 1 and Sprint 2's most important behavior with zero manual setup.

**Access:** On the landing page, choose **Student**, then sign in with `demo` / `demo`. Unlike the regular student login, this skips the "choose your profile" picker entirely and signs straight in as **Demo Student** — one login, no extra clicks. (You can also reach the same profile manually from the regular student picker, where it's listed alongside Alice/Bob/Charlie.)

**What it shows:** Instead of the normal assignment-driven "My Work" tab, Demo Student's home screen is the **Demo Scenario Pack** (below) — a curated set of pre-loaded topologies covering ECMP, Segment Routing, Traffic Engineering policies, failures, and every Sprint 2 optimization mode. Nothing needs to be built or imported by hand.

**Clearly demo-only:** this is the same kind of local-prototype credential as `teacher`/`teacher` and `student`/`student` — not real authentication, and it grants no elevated access. It is a fourth entry in the same demo roster, not a parallel login system.

## Demo Scenario Pack

Sixteen deterministic, mathematically verified scenarios, grouped into five categories:

| Category | Scenarios | What it covers |
|---|---|---|
| Routing Basics | 3 | Clean ECMP split, ECMP congestion, Segment Routing with a waypoint + ECMP-within-segments |
| Traffic Engineering | 4 | Custom ECMP distribution, FORBID_LINK, PREFER_LINK, link failure + rerouting |
| Failures | 1 additional | Mid-simulation scheduled failure (watch it happen live in Replay) |
| Optimization | 5 | OPT unavoidable congestion, current-routing-vs-OPT gap, WPO, LWO, Joint |
| Optimization Complexity | 3 | Exact-vs-heuristic WPO, exact-vs-heuristic LWO (a genuine local optimum), Joint search-budget threshold |

Every scenario's topology and demands are copied from an already mathematically-verified backend test fixture (never hand-invented) — see `backend/app/demo/demo_scenarios.py` for the exact source citation on each one, and `backend/tests/test_demo_scenarios.py` for a backend test that re-derives its teaching claim from the real simulate/optimize code paths.

**How it's stored:** each scenario is an ordinary `Assignment` document (`mode: "lecture"`, no `expectedSolution`) in the same MongoDB `assignments` collection every other assignment uses — not a parallel data model, and not localStorage. Opening one loads its topology, demands, algorithm, TE/Segment-Routing policies, and failure schedule together; it never auto-runs a simulation or optimization — you click Run / Optimize yourself.

**Seeding it:**

```bash
curl -X POST http://localhost:8000/seed-demo-scenarios
```

Idempotent — safe to run any number of times; it upserts the same 16 documents by their stable `assignmentId` (e.g. `demo-ecmp-basic`, `demo-wpo`, `demo-exact-vs-heuristic-lwo`) rather than inserting new copies. The **Reseed pack** button on the Demo Student dashboard, and the Teacher Dashboard's existing **Seed Demo to MongoDB** tool, both call the same endpoint. Requires MongoDB — see [Optional MongoDB](#optional-mongodb) above; without it, the Demo Student dashboard shows a clean "not seeded yet" message rather than fabricating data.

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

# Running the Project

This section is everything needed to clone, install, and run the project from scratch — no prior knowledge of the codebase required.

## Prerequisites

- **Python** 3.11 or later (developed and tested against 3.13)
- **Node.js** v18 or later
- **npm** v9 or later
- **MongoDB** — **optional.** The app runs fully without it; see [Optional MongoDB](#optional-mongodb) below for exactly what is and isn't affected.
- **Solver dependency** — the Optimization Lab's OPT mode solves a linear program with [PuLP](https://github.com/coin-or/pulp) (`pulp==3.3.2`, in `backend/requirements.txt`) using the CBC solver. **No separate CBC install is required** — PuLP bundles a working CBC binary for macOS/Linux/Windows and installs it automatically with `pip install -r requirements.txt`. Nothing solver-related needs to be installed manually.

## Clone

```bash
git clone https://github.com/iremgizer/inet-project.git
cd inet-project
```

## Backend Setup

Open a terminal in the project root.

```bash
cd backend

# Create virtual environment (first time only)
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

# Install dependencies (first time only) — this also installs PuLP + its bundled CBC solver
pip install -r requirements.txt

# Start the development server
uvicorn app.main:app --reload --port 8000
```

The backend runs at **http://localhost:8000**

- API documentation (interactive Swagger UI): **http://localhost:8000/docs**
- Health check: **http://localhost:8000/health** — returns `{"status": "ok", "mongoAvailable": true|false}`, which is the fastest way to confirm the backend is up and to see whether it detected a running MongoDB.

## Frontend Setup

Open a second terminal in the project root.

```bash
cd frontend

# Install dependencies (first time only)
npm install

# Start the development server
npm run dev
```

The frontend runs at **http://localhost:5173**

## Running Both

The backend and frontend are two separate processes and must run in two separate terminals at the same time — `uvicorn` in one (from `backend/`), `npm run dev` in the other (from `frontend/`). The frontend talks to the backend over `http://localhost:8000` by default (overridable with a `VITE_BACKEND_URL` environment variable); the backend's CORS configuration already allows `http://localhost:5173`. Neither process needs to be started in a particular order.

## Optimization Lab

Sprint 2 adds an opt-in **Optimization Lab**, reachable from the Choose Algorithm screen once a network and traffic demands are configured. It runs four traffic-engineering optimizers against the same topology — **OPT** (unrestricted theoretical optimum), **Waypoint Optimization**, **Link Weight Optimization**, and **Joint Optimization** — each using an exact search when the combinatorial search space is small enough, and falling back to a heuristic otherwise. The search budget (how large a search space is still solved exactly) and a per-run timeout are both user-configurable, and a search-space preview is shown before running so the exact-vs-heuristic trade-off is visible ahead of time. Full detail is in the [Sprint 2 — Optimization Lab](#sprint-2--optimization-lab) section further down and in `docs/research/sprint2-mip-architecture-analysis.md`.

## Optional MongoDB

MongoDB is **entirely optional**. The app is fully usable without it:

| Works without MongoDB | Requires MongoDB |
|---|---|
| Guest "Start Building a Network" flow, topology builder, all four algorithms (ECMP, Distance Vector, Segment Routing, ECMP-within-segments), trace replay, Optimization Lab, JSON import/export, demo teacher/student login and dashboards (seeded in `localStorage`) | Persisting simulation runs across sessions/devices; saving Teacher Workspace assignments server-side; loading assignment-type (non-challenge) student work from storage rather than a local file |

When MongoDB is unavailable, the affected save/load actions are silently disabled rather than erroring — check `GET /health`'s `mongoAvailable` field to confirm which mode you're in. Demo data (the pre-seeded teacher/student accounts, assignments, and progress) is always available regardless of MongoDB, since it's seeded in the frontend's own `localStorage`, not the database.

To enable it, start a MongoDB 7 container with Docker:

```bash
docker run -d --name network-viz-mongo -p 27018:27017 --restart unless-stopped mongo:7
```

(If the container already exists: `docker start network-viz-mongo`.)

Then configure the backend by copying `backend/.env.example` to `backend/.env` (already set to the values below by default — only edit if you need a different port/database):

```bash
MONGODB_URI=mongodb://localhost:27018
MONGODB_DATABASE=network_visualizer
```

Note the non-default port **27018** — this project intentionally runs its own MongoDB container on 27018 (not MongoDB's usual 27017) so it doesn't collide with any other local MongoDB instance.

## Demo / Quick Start

The fastest way to see the project with no login and no setup beyond the two dev servers running:

1. Open **http://localhost:5173**
2. Click **Start Building a Network** on the landing page (no account needed)
3. Use a template or **Import JSON** and load `sample-json/triangle_ecmp.json` (three nodes, two equal-cost paths — the clearest ECMP demo)
4. Add a traffic demand between two nodes, then choose **ECMP** and run the simulation to see traffic split and congestion coloring
5. Click **Optimization Lab** on the same Choose Algorithm screen to compare the baseline against OPT / Waypoint / Link Weight / Joint optimization results

**Even faster, with MongoDB running:** seed the [Demo Scenario Pack](#demo-scenario-pack) (`curl -X POST http://localhost:8000/seed-demo-scenarios`), then log in as **Demo Student** (`demo` / `demo`) — 16 pre-loaded scenarios are ready to open immediately, no template/import/demand-entry steps needed.

For the full guided teacher/student/challenge walkthrough, see [Midterm Demo Script](#midterm-demo-script) below.

## Tests

**Backend — full pytest suite**

```bash
cd backend
source .venv/bin/activate
python3 -m pytest tests/ -q
```

**Frontend — TypeScript check**

```bash
cd frontend
npx tsc --noEmit
```

**Frontend — production build**

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
- ✅ Segment Routing — ECMP-within-segments routing (Sprint 2, see below)

**Planned**

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
| Locked fields | `lockedFields` are enforced in the UI: locked nodes/links cannot be dragged or deleted; locked weights/capacities are read-only; locked algorithm selection is disabled. Handler-level guards also block keyboard shortcuts. |
| Attempt integrity | `maxAttempts` is enforced in-memory. A student can bypass it by reloading the page. |
| Grading | Grading calls `POST /grade` on the backend first; falls back to client-side if the backend is unavailable. Expected answers remain visible in the assignment JSON export — not suitable for high-stakes assessments. |
| Segment Routing | Implemented as ECMP-within-segments (Sprint 2, PR0). Full RSVP-TE / SR-TE style explicit tunnels are out of scope. |
| Concurrency | The FastAPI backend is single-worker with no connection pooling. Not suitable for classroom-scale simultaneous users. |
| DV convergence | Distance Vector runs to full convergence synchronously. Async Bellman-Ford with failure simulation is not implemented. |

---

## Sprint 2 — Optimization Lab

Sprint 2 adds a second, opt-in workflow stage — the **Optimization Lab** — reachable from the Choose Algorithm screen after a network and traffic demands are configured. It lets a student run four traffic-engineering optimizers against the same topology and compare them against the network's own already-simulated baseline. Full technical detail lives in [`docs/research/sprint2-mip-architecture-analysis.md`](docs/research/sprint2-mip-architecture-analysis.md); this section is the short, student/instructor-facing summary.

**The four modes**

| Mode | What it does | How it searches |
|---|---|---|
| **OPT** | Unrestricted optimum — the theoretical best possible link utilization if traffic could be split arbitrarily, ignoring how any real routing algorithm actually forwards packets | Linear program, solved exactly by the CBC solver (PuLP). Not a combinatorial search — there is no "search space" or "candidates evaluated" for OPT. |
| **WPO** (Waypoint Optimization) | Finds a single intermediate waypoint node per demand that reduces the maximum link utilization (MLU) versus the baseline | Exact enumeration of all waypoint combinations, or a greedy heuristic when the exact search space exceeds the configured budget |
| **LWO** (Link Weight Optimization) | Reassigns integer link weights within a configurable range to reduce MLU | Same exact-vs-heuristic split, over all weight assignments in the configured range |
| **Joint** | Optimizes waypoints and weights together | Exact joint enumeration when small enough, otherwise an alternating WPO/LWO heuristic that iterates until convergence or a round limit |

**Exact search vs. heuristic — and why it matters educationally.** WPO/LWO/Joint each have a true combinatorial search space (e.g., for LWO, `(number of weight values)^(number of optimizable links)`). If that space fits inside the configured search budget, the Lab performs an **exact enumeration** and can prove the result is optimal (`provenOptimal: true`). If it doesn't fit, the Lab automatically falls back to a fast **heuristic** and is explicit that the result is only the best the heuristic found — not proven optimal. This lets a student directly observe the classic combinatorial-explosion trade-off: as a topology grows, the exact search space grows exponentially, and at some point no realistic budget can cover it.

**Search budget.** `maxExactCombinations` controls how large a search space is still solved exactly. It defaults to **50,000** and is user-adjustable in the Lab's Optimization Settings panel via three named presets — **Fast** (10,000), **Default** (50,000), **Deep** (250,000) — or a **Custom** value. A search-space preview is shown before running WPO/LWO/Joint (e.g. "Waypoint search space: 12,500 combinations") together with a prediction of whether the current budget permits exact search, so the trade-off is visible before committing to a run. Raising the budget only ever changes whether a given search *can* be solved exactly — it never speeds anything up on its own, and the Lab never promises an exact search will be fast just because it fits inside the budget. A backend safety cap (default 2,000,000, overridable via the `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` environment variable) rejects unreasonably large exact-search requests regardless of what a student sets in the UI.

**Timeout.** Every optimization run carries a wall-clock time limit (`timeLimitSeconds`, default 30s, adjustable 1-300s in Advanced Settings). If a search is still running when the deadline hits, it returns the best result found so far with a clean `TIME_LIMIT` status — never mislabeled as optimal.

**Weight range.** LWO and Joint search integer link weights within a configurable `[minWeight, maxWeight]` range (default 1-5). Widening the range grows the search space — the preview updates live. A result proven optimal is only optimal *within that configured range*, not over all conceivable real-valued weights; the Lab states this explicitly next to any "Proven optimal" badge for LWO/Joint.

**Reading a result card.** Every result shows Method, Runtime, and (for WPO/LWO/Joint) Search space size, Candidates evaluated, and Proven optimal — plus Solver for OPT, Weight range for LWO/Joint, and Iterations/Convergence reason for Joint's heuristic mode. Two badges summarize a result at a glance without relying on color alone: an outcome badge (**PROVEN OPTIMAL** / **BEST FOUND** / **TIME LIMIT**) and a method badge (**EXACT SEARCH** / **HEURISTIC**).

**Congestion-free interpretation.** OPT's own result is the scientific reference point: `OPT.mlu ≤ 1` means congestion-free routing is theoretically possible on this topology (though a specific algorithm like ECMP may still congest it); `OPT.mlu > 1` means congestion is structurally unavoidable no matter how traffic is routed — only added capacity or reduced demand can fix it. A solver-reported `INFEASIBLE` is a separate condition (no valid routing exists at all) and is never presented as either of the above.

**Session-only experiment history.** The Lab keeps a small, in-memory table of every run this session (mode, budget, method, runtime, MLU, proven-optimal) so a student can compare, e.g., a Fast-budget run against a Deep-budget run on the same topology. It is intentionally not saved anywhere and clears on logout/refresh.

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

