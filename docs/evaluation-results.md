# Evaluation Results

Generated: 2026-09-24

Backend commit used for the measurements: `a4f8865b6c1fc8be5ef5fbbc22ba750522a765fb` (`docs: add self-hosted university deployment guide`). The evaluation was run locally with the backend virtual environment and `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

The repository API uses `mode` and `algorithmConfig` rather than `optimizerType` and `config`. The supplied topologies also omitted required `NetworkInput` fields, so the requests added `x: 0`, `y: 0`, `topologyType: "custom"`, and `isDirected: false` to each topology. These fields do not affect the routing calculations. All other topology values and optimizer settings were used exactly as supplied:

```json
{
  "selectedAlgorithm": "ECMP",
  "algorithmType": "exact",
  "objective": "minimize_max_utilization",
  "congestionThreshold": 1.0
}
```

Optimizer settings were `minWeight=1`, `maxWeight=5`, `maxExactCombinations=50000`, and `timeLimitSeconds=30`.

The measured results do not reproduce two expectations in the request: ECMP Triangle OPT is `0.50`, not greater than `1.0`, and Mesh LWO is `1.00` (`100.0%`), not `2.632` (`263.2%`). The values below are the actual responses from the current backend.

## Results Table

| Topology | OPT | LWO | WPO | Joint |
|---|---|---|---|---|
| ECMP Triangle | 0.500000 (50.0%) † | 0.500000 (50.0%) † | 0.750000 (75.0%) † | 0.500000 (50.0%) † |
| Diamond (4 nodes) | 0.500000 (50.0%) † | 0.500000 (50.0%) † | 0.500000 (50.0%) † | 0.500000 (50.0%) † |
| Mesh (7 nodes) | 1.000000 (100.0%) † | 1.000000 (100.0%) ‡ | 1.000000 (100.0%) † | 1.000000 (100.0%) ‡ |

† = proven optimal. For OPT, this means the CBC LP solver returned `OPTIMAL`; the API does not populate the mode-specific `provenOptimal` field for OPT.

‡ = heuristic result; not proven optimal.

## Detailed Results Per Run

### ECMP Triangle — OPT

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`provenOptimal` is not populated for OPT)
- Runtime: `826.77 ms`
- Candidates evaluated: not applicable
- Search space: not applicable
- Message: `Optimal solution found.`

### ECMP Triangle — LWO

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `3.21 ms`
- Candidates evaluated: `125`
- Search space: `125`
- Message: `Optimal weight assignment within the configured weight range.`

### ECMP Triangle — WPO

- MLU: `0.750000` (`75.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `0.46 ms`
- Candidates evaluated: `4`
- Search space: `4`
- Message: `Optimal waypoint assignment within the configured candidate space.`

### ECMP Triangle — JOINT

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_JOINT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `9.50 ms`
- Candidates evaluated: `500`
- Search space: `500`
- Message: `Optimal joint assignment within the configured weight range and candidate space.`

### Diamond (4 nodes) — OPT

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`provenOptimal` is not populated for OPT)
- Runtime: `14.88 ms`
- Candidates evaluated: not applicable
- Search space: not applicable
- Message: `Optimal solution found.`

### Diamond (4 nodes) — LWO

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `9.12 ms`
- Candidates evaluated: `625`
- Search space: `625`
- Message: `Optimal weight assignment within the configured weight range.`

### Diamond (4 nodes) — WPO

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `0.12 ms`
- Candidates evaluated: `3`
- Search space: `3`
- Message: `Optimal waypoint assignment within the configured candidate space.`

### Diamond (4 nodes) — JOINT

- MLU: `0.500000` (`50.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_JOINT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `30.07 ms`
- Candidates evaluated: `1875`
- Search space: `1875`
- Message: `Optimal joint assignment within the configured weight range and candidate space.`

### Mesh (7 nodes) — OPT

- MLU: `1.000000` (`100.0%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`provenOptimal` is not populated for OPT)
- Runtime: `14.78 ms`
- Candidates evaluated: not applicable
- Search space: not applicable
- Message: `Optimal solution found.`

### Mesh (7 nodes) — LWO

- MLU: `1.000000` (`100.0%`)
- Status: `FEASIBLE`
- Method: `HEURISTIC_LWO`
- Proven optimal: `false`
- Runtime: `2.25 ms`
- Candidates evaluated: `69`
- Search space: `390625`
- Message: `Heuristic weight assignment (deterministic hill-climbing) — not proven optimal.`

### Mesh (7 nodes) — WPO

- MLU: `1.000000` (`100.0%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `1.08 ms`
- Candidates evaluated: `36`
- Search space: `36`
- Message: `Optimal waypoint assignment within the configured candidate space.`

### Mesh (7 nodes) — JOINT

- MLU: `1.000000` (`100.0%`)
- Status: `FEASIBLE`
- Method: `JOINT_ALTERNATING`
- Proven optimal: `false`
- Runtime: `6.10 ms`
- Candidates evaluated: `176`
- Search space: `14062500`
- Message: `Heuristic joint assignment (alternating LWO/WPO) — not proven optimal.`

## Topology Definitions Used

The following are the exact topology objects sent to the API. Coordinates and metadata were added because they are required by the repository's `NetworkInput` schema.

### ECMP Triangle

```json
{
  "nodes": [
    {"id": "u", "label": "u", "x": 0, "y": 0},
    {"id": "v", "label": "v", "x": 0, "y": 0},
    {"id": "t", "label": "t", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "uv", "source": "u", "target": "v", "weight": 1, "capacity": 1},
    {"id": "vu", "source": "v", "target": "u", "weight": 1, "capacity": 1},
    {"id": "vt", "source": "v", "target": "t", "weight": 1, "capacity": 1},
    {"id": "tv", "source": "t", "target": "v", "weight": 1, "capacity": 1},
    {"id": "ut", "source": "u", "target": "t", "weight": 2, "capacity": 1},
    {"id": "tu", "source": "t", "target": "u", "weight": 2, "capacity": 1}
  ],
  "demands": [
    {"id": "d1", "source": "u", "target": "t", "amount": 0.5},
    {"id": "d2", "source": "v", "target": "t", "amount": 0.5}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```

### Diamond (4 nodes)

```json
{
  "nodes": [
    {"id": "s", "label": "s", "x": 0, "y": 0},
    {"id": "a", "label": "a", "x": 0, "y": 0},
    {"id": "b", "label": "b", "x": 0, "y": 0},
    {"id": "t", "label": "t", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "sa", "source": "s", "target": "a", "weight": 1, "capacity": 1},
    {"id": "as", "source": "a", "target": "s", "weight": 1, "capacity": 1},
    {"id": "sb", "source": "s", "target": "b", "weight": 1, "capacity": 1},
    {"id": "bs", "source": "b", "target": "s", "weight": 1, "capacity": 1},
    {"id": "at", "source": "a", "target": "t", "weight": 1, "capacity": 1},
    {"id": "ta", "source": "t", "target": "a", "weight": 1, "capacity": 1},
    {"id": "bt", "source": "b", "target": "t", "weight": 1, "capacity": 1},
    {"id": "tb", "source": "t", "target": "b", "weight": 1, "capacity": 1}
  ],
  "demands": [
    {"id": "d1", "source": "s", "target": "t", "amount": 1.0}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```

### Mesh (7 nodes)

```json
{
  "nodes": [
    {"id": "A", "label": "A", "x": 0, "y": 0},
    {"id": "B", "label": "B", "x": 0, "y": 0},
    {"id": "C", "label": "C", "x": 0, "y": 0},
    {"id": "D", "label": "D", "x": 0, "y": 0},
    {"id": "E", "label": "E", "x": 0, "y": 0},
    {"id": "F", "label": "F", "x": 0, "y": 0},
    {"id": "G", "label": "G", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "AB", "source": "A", "target": "B", "weight": 0.7, "capacity": 3.8},
    {"id": "BC", "source": "B", "target": "C", "weight": 1, "capacity": 1},
    {"id": "BF", "source": "B", "target": "F", "weight": 1, "capacity": 1},
    {"id": "CD", "source": "C", "target": "D", "weight": 1, "capacity": 1},
    {"id": "CG", "source": "C", "target": "G", "weight": 1, "capacity": 1},
    {"id": "DF", "source": "D", "target": "F", "weight": 1, "capacity": 1},
    {"id": "FG", "source": "F", "target": "G", "weight": 1, "capacity": 1},
    {"id": "AE", "source": "A", "target": "E", "weight": 10.9, "capacity": 1}
  ],
  "demands": [
    {"id": "d1", "source": "A", "target": "C", "amount": 1.0},
    {"id": "d2", "source": "A", "target": "G", "amount": 1.0}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```
