# sample-json

Example topology JSON files for the Network Algorithm Visualizer.

All files conform to `frontend/src/schemas/topology.schema.json` (draft-07).
The two `invalid_*` files are intentionally broken for testing import validation.

---

## Valid files

### `triangle_ecmp.json`
Classic ECMP lecture example.
Three nodes (u, v, t). Two equal-cost paths u→v→t (cost 2) and one direct u→t (cost 2).
Demand u→t (1.5) should be ECMP-split across both paths; demand v→t (0.5) has a single path.
Links have capacity=1, so the split demand saturates each link at exactly 75%.
**Suggested algorithm:** ECMP

### `path_p4.json`
P4 shortest-path exercise.
Four nodes in a line (A-B-C-D). Every link has weight=10, capacity=10.
Only one path A→D exists, cost=30. No ECMP tie-breaking involved.
Demand A→D (5) should produce 50% utilization on every link.
**Suggested algorithm:** Distance Vector

### `grid_3x3.json`
3×3 grid shortest-path topology.
Nine nodes laid out as a regular grid. All links weight=1, capacity=10.
Multiple shortest paths exist between opposite corners (n11 → n33).
Good for exploring ECMP tie-breaking across a mesh.
Demand n11→n33 (4), expected shortest-path cost=4 (Manhattan distance).
**Suggested algorithm:** Distance Vector or ECMP

### `clos_fat_tree_small.json`
Small Clos / fat-tree topology: 2 spine switches + 4 leaf switches.
Each leaf connects to both spines (8 links total, full spine-leaf fabric).
Inter-leaf demand L1→L3 (2) must traverse one spine; ECMP will split equally across SP1 and SP2.
Demonstrates ECMP path selection in a data-center fabric.
**Suggested algorithm:** ECMP

### `random_medium.json`
Stress-test topology: 10 nodes arranged in a ring with cross-links through two hub nodes (R9, R10).
18 links, all weight=1, capacity=10.
Four demands exercising different paths across the mesh.
Good for testing performance and validating ECMP/DV on larger graphs.
**Suggested algorithm:** ECMP or Distance Vector

---

## Invalid files (validation tests)

### `invalid_negative_weight.json`
One link (`u-t`) has `"weight": -1`.
This violates the schema constraint `"minimum": 0` on the `weight` field.
Both the JSON Schema validator and the application's runtime validator reject it.
Expected error: `links[2]: "weight" must be >= 0`

### `invalid_duplicate_links.json`
Two links share the same `id` field (`"u-v"`).
The application's runtime validator explicitly rejects duplicate link IDs.
Expected error: `links[1]: duplicate id "u-v"`

> Note: The JSON Schema itself does not enforce `uniqueItems` on the links array,
> so this file only fails the application-level validator, not the raw JSON Schema.
> This tests that the import UI correctly surfaces semantic validation errors.

---

## Validation script

```bash
cd sample-json
node validate.js
```

Validates all `.json` files in this folder. Prints `✅` for each expected outcome
(valid files pass, `invalid_*` files are correctly rejected).

---

## Schema reference

`frontend/src/schemas/topology.schema.json`

| Field | Required | Type | Notes |
|---|---|---|---|
| `nodes` | yes | array | min 1 item |
| `links` | yes | array | |
| `demands` | no | array | |
| `name` | no | string | display label |
| `topologyType` | no | string | enum: `custom triangle ring mesh fat-tree clos-fat-tree line grid path cycle random` |
| `isDirected` | no | boolean | default `false` |
| `nodes[].id` | yes | string | must be unique |
| `nodes[].label` | yes | string | |
| `nodes[].x / .y` | no | number | canvas position; auto-layout if omitted |
| `links[].id` | yes | string | must be unique (app-level) |
| `links[].source` | yes | string | must reference a node id |
| `links[].target` | yes | string | must reference a node id |
| `links[].weight` | no | number | ≥ 0; defaults to 1 |
| `links[].capacity` | no | number | ≥ 0.01; defaults to 10 |
| `demands[].id` | yes | string | must be unique |
| `demands[].source` | yes | string | must reference a node id |
| `demands[].target` | yes | string | must reference a node id |
| `demands[].amount` | yes | number | > 0 |
