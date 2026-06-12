# Network Algorithm Visualization Tool

A monorepo for an interactive network engineering algorithm visualization tool inspired by VisuAlgo. It teaches ECMP and Distance Vector behavior in networks with a clean frontend dashboard and Python backend.

## Architecture

- `backend/`: FastAPI backend that validates network inputs and runs routing simulations.
- `frontend/`: Vite + React TypeScript interface for interactive graph editing and result visualization.

## What is implemented

- Interactive network builder with node/link creation and draggable nodes.
- Link weight/capacity editing.
- Traffic demand creation.
- ECMP equal-cost multipath routing with equal split.
- Distance Vector shortest-path routing with cost and next-hop tables.
- Link load, utilization, and congestion visualization.
- Topology templates: triangle, line, ring, mesh, fat-tree placeholder.

## What is intentionally deferred

- Packetized traffic simulation.
- Delay/loss modeling.
- Asynchronous Distance Vector convergence.
- Node failures.
- Segment Routing full implementation.
- Custom splitting ratio full implementation.

## Run the app

### Backend

```bash
cd backend
python -m venv .venv
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

Open the frontend URL shown by Vite and use the UI to load the triangle topology, add demands, and run ECMP or Distance Vector.
