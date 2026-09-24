# Evaluation Results

Generated: 2026-09-24

Backend commit used for the measurements: `9280ef9` (`Merge pull request #10 from iremgizer/add-evaluation-results`). The backend was run locally with `uvicorn app.main:app --host 0.0.0.0 --port 8000` and the repository's existing virtual environment.

Optimizer request settings were:

```json
{
  "algorithmConfig": {
    "selectedAlgorithm": "ECMP",
    "algorithmType": "exact",
    "objective": "minimize_max_utilization",
    "congestionThreshold": 1.0
  },
  "minWeight": 1,
  "maxWeight": 3,
  "maxExactCombinations": 50000,
  "timeLimitSeconds": 30
}
```

The repository's `/optimize` API uses `mode` and `algorithmConfig`; it does not use the `optimizerType`, `config`, or `optimizationConfig` field names from the original evaluation request.

## Summary Table

| Topology | OPT | LWO | WPO | Joint |
|---|---:|---:|---:|---:|
| Bottleneck Triangle | 0.437500 (43.75%) † | 0.625000 (62.50%) † | 1.444444 (144.44%) † | 0.500000 (50.00%) † |
| Bidirectional Capacity Trap | 1.000000 (100.00%) † | 1.250000 (125.00%) † | 1.750000 (175.00%) † | 1.000000 (100.00%) † |
| Asymmetric Return-Demand Mesh | 1.444444 (144.44%) † | 2.000000 (200.00%) † | 2.111111 (211.11%) † | 1.666667 (166.67%) † |

† = proven optimal within the configured search space. OPT is solved by the CBC linear-programming solver; its API response reports `status: OPTIMAL` but leaves the mode-specific `provenOptimal` field unset. LWO, WPO, and JOINT used exhaustive enumeration for all three selected topologies.

## Why These Topologies Were Chosen

### Bottleneck Triangle

This topology gives the clearest four-way separation. OPT reaches `0.437500`, while the best weight-only solution is `0.625000`, demonstrating an optimality gap. WPO is much worse at `1.444444`, showing that waypoint selection alone can be harmful under this demand mix. Joint improves on both restricted strategies at `0.500000`, while remaining above the unrestricted OPT baseline as expected.

### Bidirectional Capacity Trap

This topology produces a clean congestion threshold comparison: OPT and Joint reach exactly `1.000000`, while LWO remains at `1.250000` and WPO at `1.750000`. It demonstrates that combining weights and waypoints can recover a congestion-free solution even when either restricted strategy alone leaves overload.

### Asymmetric Return-Demand Mesh

This topology has asymmetric capacities and demands in both directions. OPT is `1.444444`, LWO is `2.000000`, and WPO is `2.111111`, giving both a theoretical optimality gap and a measurable WPO-versus-LWO difference. Joint improves on both restricted single-mechanism strategies at `1.666667`, but does not reach the unrestricted OPT lower bound.

### Candidate search note

The seeded demo scenario pack was also evaluated. It contains four curated teaching scenarios, but none is labelled as an Optimization or Optimization Complexity category and none produced the requested `OPT < LWO` gap. Two additional existing test assignments were also evaluated; both returned identical MLU values for all four modes. The three topologies above were therefore selected from a deterministic generated search over connected four-node teaching-scale networks, stopping after the first three strict matches. The selected cases satisfy:

```text
OPT < LWO
LWO != WPO
Joint <= min(LWO, WPO)
```

## Detailed Results

### Bottleneck Triangle — OPT

- MLU: `0.437500` (`43.75%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`status` is `OPTIMAL`; the API does not populate `provenOptimal` for OPT)
- Runtime: `20.45 ms`
- Candidates evaluated: not applicable
- Search space size: not applicable

### Bottleneck Triangle — LWO

- MLU: `0.625000` (`62.50%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `24.30 ms`
- Candidates evaluated: `729`
- Search space size: `729`

### Bottleneck Triangle — WPO

- MLU: `1.444444` (`144.44%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `0.51 ms`
- Candidates evaluated: `9`
- Search space size: `9`

### Bottleneck Triangle — Joint

- MLU: `0.500000` (`50.00%`)
- Status: `OPTIMAL`
- Method: `EXACT_JOINT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `325.54 ms`
- Candidates evaluated: `6561`
- Search space size: `6561`

### Bidirectional Capacity Trap — OPT

- MLU: `1.000000` (`100.00%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`status` is `OPTIMAL`; the API does not populate `provenOptimal` for OPT)
- Runtime: `24.92 ms`
- Candidates evaluated: not applicable
- Search space size: not applicable

### Bidirectional Capacity Trap — LWO

- MLU: `1.250000` (`125.00%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `11.75 ms`
- Candidates evaluated: `243`
- Search space size: `243`

### Bidirectional Capacity Trap — WPO

- MLU: `1.750000` (`175.00%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `1.48 ms`
- Candidates evaluated: `27`
- Search space size: `27`

### Bidirectional Capacity Trap — Joint

- MLU: `1.000000` (`100.00%`)
- Status: `OPTIMAL`
- Method: `EXACT_JOINT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `499.59 ms`
- Candidates evaluated: `6561`
- Search space size: `6561`

### Asymmetric Return-Demand Mesh — OPT

- MLU: `1.444444` (`144.44%`)
- Status: `OPTIMAL`
- Method: `EXACT (LP/CBC)`
- Proven optimal: `true` (`status` is `OPTIMAL`; the API does not populate `provenOptimal` for OPT)
- Runtime: `32.13 ms`
- Candidates evaluated: not applicable
- Search space size: not applicable

### Asymmetric Return-Demand Mesh — LWO

- MLU: `2.000000` (`200.00%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `15.32 ms`
- Candidates evaluated: `243`
- Search space size: `243`

### Asymmetric Return-Demand Mesh — WPO

- MLU: `2.111111` (`211.11%`)
- Status: `OPTIMAL`
- Method: `EXACT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `1.75 ms`
- Candidates evaluated: `27`
- Search space size: `27`

### Asymmetric Return-Demand Mesh — Joint

- MLU: `1.666667` (`166.67%`)
- Status: `OPTIMAL`
- Method: `EXACT_JOINT_ENUMERATION`
- Proven optimal: `true`
- Runtime: `561.38 ms`
- Candidates evaluated: `6561`
- Search space size: `6561`

## Topology Definitions

The following are the exact JSON network objects sent to the API.

### Bottleneck Triangle

```json
{
  "nodes": [
    {"id": "A", "label": "A", "x": 0, "y": 0},
    {"id": "B", "label": "B", "x": 0, "y": 0},
    {"id": "C", "label": "C", "x": 0, "y": 0},
    {"id": "D", "label": "D", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "l1", "source": "B", "target": "C", "weight": 3, "capacity": 2},
    {"id": "l2", "source": "B", "target": "D", "weight": 3, "capacity": 2},
    {"id": "l3", "source": "C", "target": "D", "weight": 1, "capacity": 0.5},
    {"id": "l4", "source": "A", "target": "B", "weight": 1, "capacity": 1.5},
    {"id": "l5", "source": "A", "target": "C", "weight": 1, "capacity": 2},
    {"id": "l6", "source": "A", "target": "D", "weight": 2, "capacity": 1.5}
  ],
  "demands": [
    {"id": "d1", "source": "B", "target": "D", "amount": 0.75},
    {"id": "d2", "source": "A", "target": "D", "amount": 1}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```

### Bidirectional Capacity Trap

```json
{
  "nodes": [
    {"id": "A", "label": "A", "x": 0, "y": 0},
    {"id": "B", "label": "B", "x": 0, "y": 0},
    {"id": "C", "label": "C", "x": 0, "y": 0},
    {"id": "D", "label": "D", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "l1", "source": "A", "target": "C", "weight": 1, "capacity": 1.5},
    {"id": "l2", "source": "B", "target": "C", "weight": 1, "capacity": 1},
    {"id": "l3", "source": "A", "target": "D", "weight": 1, "capacity": 3},
    {"id": "l4", "source": "B", "target": "D", "weight": 2, "capacity": 1.5},
    {"id": "l5", "source": "C", "target": "D", "weight": 1, "capacity": 0.5}
  ],
  "demands": [
    {"id": "d1", "source": "B", "target": "D", "amount": 1},
    {"id": "d2", "source": "D", "target": "B", "amount": 1.5},
    {"id": "d3", "source": "A", "target": "D", "amount": 1}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```

### Asymmetric Return-Demand Mesh

```json
{
  "nodes": [
    {"id": "A", "label": "A", "x": 0, "y": 0},
    {"id": "B", "label": "B", "x": 0, "y": 0},
    {"id": "C", "label": "C", "x": 0, "y": 0},
    {"id": "D", "label": "D", "x": 0, "y": 0}
  ],
  "links": [
    {"id": "l1", "source": "B", "target": "D", "weight": 1, "capacity": 0.5},
    {"id": "l2", "source": "C", "target": "D", "weight": 2, "capacity": 3},
    {"id": "l3", "source": "A", "target": "C", "weight": 2, "capacity": 0.75},
    {"id": "l4", "source": "A", "target": "B", "weight": 1, "capacity": 2},
    {"id": "l5", "source": "B", "target": "C", "weight": 3, "capacity": 1}
  ],
  "demands": [
    {"id": "d1", "source": "D", "target": "B", "amount": 2},
    {"id": "d2", "source": "D", "target": "A", "amount": 0.75},
    {"id": "d3", "source": "B", "target": "C", "amount": 0.5}
  ],
  "topologyType": "custom",
  "isDirected": false
}
```
