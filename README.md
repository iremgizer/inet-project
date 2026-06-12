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
- Step-by-step educational trace events for ECMP and Distance Vector.
- Trace player controls in the frontend: back, forward, play, pause, reset, speed.
- Link load, utilization, and congestion visualization.
- Topology templates: triangle, line, ring, mesh, fat-tree placeholder.
- Optional local MongoDB persistence for simulation runs.

## What is intentionally deferred

- Packetized traffic simulation.
- Delay/loss modeling.
- Asynchronous Distance Vector convergence.
- Node failures.
- Segment Routing full implementation.
- Custom splitting ratio full implementation.
- WebSocket/SSE trace streaming for very large simulations.
- Virtualized large routing tables.

## Run the app

### MongoDB for saved runs

Saved simulation runs use local MongoDB. The app still runs without MongoDB, but `/simulate` will return a debug message saying the run was not persisted.

```bash
docker run --name network-viz-mongo -p 27017:27017 -d mongo:7
```

If the container already exists:

```bash
docker start network-viz-mongo
```

Optional backend environment:

```bash
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=network_visualizer
```

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

## Simulation runs and traces

Every simulation returns a `simulationRunId` and `traceEvents`.

Trace events are educational algorithm steps, not packet events. V1 uses continuous flow only: no packet delay, packet loss, asynchronous convergence, dynamic latency, or node failure modeling.

For ECMP, trace events show demand initialization, shortest-path cost calculations, equal-cost path grouping, equal traffic splitting, link load updates, utilization calculation, congestion detection, and a final summary.

For Distance Vector, trace events show stable cost-table initialization, shortest cost computation, next-hop updates, selected demand paths, link load/utilization, congestion detection, and summary. The computation remains instant and stable in V1.

## Saved run endpoints

- `GET /simulations`: list saved run metadata.
- `GET /simulations/{simulationRunId}`: load a full saved run.
- `DELETE /simulations/{simulationRunId}`: delete a saved run.

## Current limitations

- Segment Routing and Custom Splitting are clearly marked placeholders.
- `algorithmType` and `objective` are stored for future work but do not yet change ECMP/DV behavior.
- Large graphs return final results synchronously. Future versions should stream trace events, simplify graph rendering, and virtualize large tables.
