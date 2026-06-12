from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.models import SimulationRequest
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

@app.get("/health")
def health():
    return {"status": "ok"}

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
