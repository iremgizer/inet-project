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

