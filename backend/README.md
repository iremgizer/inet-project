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

## Algorithms Implemented

- `ECMP`: equal-cost multi-path routing with equal split over shortest paths
- `DISTANCE_VECTOR`: instant stable shortest-path routing with cost and next-hop table
- `SEGMENT_ROUTING`: placeholder for next version
- `CUSTOM_SPLITTING`: placeholder for next version

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
