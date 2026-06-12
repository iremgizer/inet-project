# Backend for Network Algorithm Visualization Tool

This backend provides simulation APIs for network routing and traffic engineering algorithms.

## API Endpoints

- `GET /health`
  - response: `{ "status": "ok" }`
- `POST /simulate`
  - request body: `SimulationRequest`
  - response body: `SimulationResult`
- `GET /topologies`
  - returns available topology names
- `POST /topology/{topologyType}`
  - returns a generated topology for the selected type
- `GET /simulations`
  - returns saved run metadata from MongoDB
- `GET /simulations/{simulationRunId}`
  - returns a full saved run
- `DELETE /simulations/{simulationRunId}`
  - deletes a saved run

## Algorithms Implemented

- `ECMP`: equal-cost multi-path routing with equal split over shortest paths
- `DISTANCE_VECTOR`: instant stable shortest-path routing with cost and next-hop table
- `SEGMENT_ROUTING`: placeholder for next version
- `CUSTOM_SPLITTING`: placeholder for next version

ECMP and Distance Vector return `traceEvents` for step-by-step educational playback. These trace events describe algorithm reasoning and continuous-flow load updates; they are not packet events.

## Local MongoDB

Saved simulation runs use MongoDB if available:

```bash
docker run --name network-viz-mongo -p 27017:27017 -d mongo:7
```

If the container exists:

```bash
docker start network-viz-mongo
```

Environment variables:

```bash
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=network_visualizer
```

## Run Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Notes

- User input models are separated from result models.
- The backend validates node references, link weights, capacities, and demand values.
- ECMP uses weight to route traffic and capacity only to compute utilization.
- Distance Vector returns cost and next-hop tables for teaching.
- Distance Vector remains instant/stable in V1; asynchronous convergence is intentionally deferred.
- TODO: stream trace events over WebSocket/SSE for large graphs.
- TODO: virtualize large tables and simplify graph rendering for large topologies.
