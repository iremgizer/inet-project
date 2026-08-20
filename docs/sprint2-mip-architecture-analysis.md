# Sprint 2 — Optimization Layer: Architecture & Research Audit

**Status:** Read-only research/architecture audit. No production code changes. No frontend page. No implementation.
**Branch:** `feat/sprint2-mip-analysis`, based on `feat/sprint1-mid-sim-failure-comparison` @ `0396809`.
**Scope:** Everything in Sprint 1 (PR1–PR6: Segment Routing, Configurable ECMP, Distance Vector, TE Policies, Link Failure/Rerouting, Mid-Simulation Failures + Before/After Comparison) is treated as a given, reusable foundation.

---

## 0. Source materials actually available, and how they were read

Before proposing anything, the six referenced sources were located on disk and their text extracted (`pdftotext -layout`) and read directly, rather than reasoned about from memory. Their true identities, cross-checked against the paper text itself (not just filenames), are:

| # | Requested source | File found | Confirmed identity |
|---|---|---|---|
| 1 | Parham et al., CoNEXT 2021 | `conext21te.pdf` | **Parham, Fenz, Süss, Foerster, Schmid**, *"Traffic Engineering with Joint Link Weight and Segment Optimization,"* ACM CoNEXT '21. Cited below as **[Parham21]**. |
| 2 | Fortz & Thorup | `Internet_traffic_engineering_by_optimizing_OSPF_weights.pdf` | **Fortz & Thorup**, *"Internet Traffic Engineering by Optimizing OSPF Weights,"* IEEE INFOCOM 2000. Cited as **[Fortz00]**. |
| 3 | Li & Yeung, MILP | `Traffic_Engineering_in_Segment_Routing_Networks_Using_MILP.pdf` (journal) + `Traffic_Engineering_in_Segment_Routing_using_MILP.pdf` (conference) | **Li & Yeung**, *"Traffic Engineering in Segment Routing Networks Using MILP,"* IEEE Trans. Network and Service Management (TNSM), Vol. 17 No. 3, Sept 2020 (the full K-MILP/K-sMILP formulation) — cited as **[LiYeung20]** — and its earlier, shorter **IEEE INFOCOM 2019** version (©2019 on the PDF itself) — cited as **[LiYeung19]**. |
| 4 | Preprocess your Paths | `2312.00518v1.pdf` | **Brundiers, Schüller, Aschenbruck**, *"Preprocess your Paths – Speeding up Linear Programming-based Optimization for Segment Routing Traffic Engineering,"* arXiv:2312.00518, Dec 2023. Cited as **[Brundiers23]**. |
| 5 | Multi-time-step SR TE w/ traffic prediction | **not found on disk anywhere** (searched `~/Desktop`, `~/Downloads`, `~/Documents`) | **Not supplied.** Only referenced second-hand, by title, in the slide deck's own bibliography (see §0.1). Treated as unverified throughout this document — see §N and §S. |
| 6 | lp_mip_te presentation | `~/Downloads/lp_mip_te.pptx` | Internal 5-slide deck (in Turkish), unzipped and its `<a:t>` text runs extracted directly (no PowerPoint tooling required). Cited as **[pptx]**. |

Where the task said *"do not treat the slide deck as authoritative if a paper contradicts or refines it,"* that instruction turned out to matter concretely — see §0.1 and §E.

### 0.1 The slide deck's own bibliography does not match the actual papers

[pptx] slide 5 ("Kaynakça" / Bibliography) lists six references. Checked against the PDFs' actual title pages:

- **[pptx] ref [3]**: *"X. Gang et al., 'Traffic Engineering in Segment Routing using MILP,' IEEE INFOCOM 2019."* The venue/year is right, but the paper's actual authors are **Xiaoqian Li and Kwan L. Yeung** — there is no "X. Gang" on the paper.
- **[pptx] ref [4]**: *"X. Gang et al., 'Traffic Engineering in Segment Routing Networks Using MILP,' IEEE/ACM ToN 2020."* Same wrong authors, and the venue is wrong too — it's **IEEE TNSM**, not ToN.
- **[pptx] ref [5]**: *"D. Müller et al., 'Preprocess your Paths...,' arXiv 2312.00518, 2023."* The actual authors are **Brundiers, Schüller, Aschenbruck** — there is no "D. Müller" on the paper.
- **[pptx] ref [1]** (Fortz & Thorup) and **ref [2]** (Parham et al.) are both cited correctly.

This is exactly the situation the task instructions anticipated. Two consequences for the rest of this document:

1. Every formula pulled from a paper below is cited against the **paper text itself**, not against [pptx]'s restatement of it.
2. [pptx] ref [6] — *"K. Miyasawa et al., 'Multi-time-step Segment Routing based Traffic Engineering,' IEEE/IFIP IM 2021"* — is the only lead we have on the fifth requested paper, and given the deck's 2-out-of-3 misattribution rate on the other non-Fortz/Parham references, **this author name is not trusted either**. That paper is treated as unverified/unavailable for the rest of this document (§N, §S).

---

## Part A — Audit of the current project

### A.1 Backend inventory

| File | Responsibility | Reusable by the optimizer? |
|---|---|---|
| `app/models.py` | Pydantic models: `NodeInput`, `LinkInput` (+ `operationalStatus`), `NetworkInput`, `TrafficDemandInput`, `SegmentRoutingPolicy`, `TrafficDistribution`/`PathDistribution`, `TrafficEngineeringPolicy`, `SimulationFailureEvent`, `AlgorithmConfig`, `PathShare`/`PathResult`, `LinkResult`, `SimulationResult`. | **Directly.** This is the shared vocabulary every algorithm — and the optimizer — must speak. See A.3 for the field-by-field reuse map required by the task. |
| `app/utils/graph_builder.py` | `GraphBuilder.build_graph()` — the single chokepoint that turns a `NetworkInput` into a NetworkX `Graph`/`DiGraph`, silently excluding any `operationalStatus="DOWN"` link from the edge set while keeping it in `link_map`. `down_link_ids()` helper. | **Directly, unchanged.** An optimizer that also calls `build_graph()` gets DOWN-link exclusion for free and stays consistent with every simulated algorithm (see §N). |
| `app/utils/metrics.py` | `Metrics.compute_summary()` — computes `maxUtilization` (= MLU), `totalDeliveredTraffic`, `averagePathCost`, `congestedLinkCount` from `PathResult`/`LinkResult` lists. | **Directly**, provided the optimizer's solution is materialized into the same `PathResult`/`LinkResult` shapes (see §I, §J). |
| `app/utils/routing_helpers.py` | Pure helpers shared by SR (and reusable elsewhere): `resolve_segment_route`, `sanitize_segments`, `path_link_ids`, `path_total_weight`, `path_cost_calculation`, `path_uses_link` (added in PR6), `build_node_roles`, `cap_trace`. | **Partially.** `path_link_ids`/`path_total_weight`/`build_node_roles` are algorithm-agnostic utility and directly reusable. `resolve_segment_route` embeds the *current* single-shortest-path SR semantics — see Part B, this is the one piece that needs a compatibility decision before an optimizer can validate/deploy waypoint solutions against it. |
| `app/utils/te_policy.py` | `build_demand_policy_graph()` — applies `FORBID_LINK`/`AVOID_LINK`/`PREFER_LINK`/`REQUIRE_WAYPOINT` as a **copy-on-write graph transform** per demand. Its own docstring already states the intended optimizer mapping (see §M) almost verbatim. | **Directly as a semantic reference**, not as running code inside a MILP (a MILP consumes the same *policy objects*, not a graph mutation — see §M). |
| `app/utils/failure_schedule.py` | `FailureScheduler` — PR6's mid-simulation scheduled-failure trigger tracker (`due(step)`). | **Not reusable as-is** — it is inherently about *when in a trace* something happens, which has no meaning for a one-shot optimization. `SimulationFailureEvent`'s *result* (a link is down) is what matters — see §N. |
| `app/algorithms/{ecmp,segment_routing,distance_vector,custom_splitting}.py` | The four simulated algorithms behind `AlgorithmName`. `custom_splitting.py` is a **dead placeholder** — it always returns an empty `SimulationResult` with a debug note that "Custom Splitting Ratios is a planned extension"; PR3 implemented that feature as *configurable ECMP* (`trafficDistributions` on `AlgorithmConfig`) instead of as a fourth algorithm, and this file was never removed. | Not reused *as algorithms* — the optimizer is a fifth, structurally different computation mode, not a fifth entry in this dispatch list conceptually (though see §I for why it should still live behind the same `/simulate`-adjacent boundary). Worth flagging: `custom_splitting.py` is orphaned code that Sprint 2 should either delete or finally repurpose — out of scope to fix here, but noted. |
| `app/services/simulation_service.py` | `SimulationService.simulate()` — validates the request, dispatches on `algorithmConfig.selectedAlgorithm` to one of the four algorithm classes' `.run()`, stamps a `simulationRunId`, persists via `RunStorageService`. | The dispatch **pattern** (validate → compute → stamp id → persist) is worth mirroring for an `OptimizationService`, not extending — see §I. |
| `app/services/{topology_service,grading_service,assignment_service,run_storage_service}.py` | Topology templates, Challenge-mode grading, assignment CRUD, MongoDB-backed saved runs. | Out of scope for Sprint 2 V1 (§I explicitly says do not touch grading/classroom/Mongo). |
| `app/main.py` | FastAPI app: `/simulate`, `/topologies`, `/topology/{type}`, `/simulations*`, `/assignments*`, `/submissions*`, `/challenge-attempts*`, `/grade`. **No optimization endpoint exists.** | N/A — Sprint 2 needs a new route family, not implemented here. |
| `backend/requirements.txt` | `fastapi==0.118.0`, `uvicorn[standard]==0.25.0`, `networkx==3.3`, `pydantic==2.10.2`, `pymongo==4.10.1`, `httpx>=0.27.0`, `python-dotenv>=1.0.0`. | **No LP/MILP solver dependency exists today.** This is a green field — see §H. |
| `backend/tests/` | 146 tests, all behavioral/regression tests for the simulated algorithms (`test_configurable_ecmp.py`, `test_segment_routing.py`, `test_te_policies.py`, `test_link_failure.py`, `test_mid_sim_failure.py`, `test_assignments.py`, `test_challenges.py`, `test_grade.py`). No optimization tests exist (expected — no optimizer exists). | Establishes the existing test idiom (helper `NetworkInput`/`AlgorithmConfig` builder functions, `TestClient`-based endpoint smoke tests) that §Q's proposed tests should follow. |

### A.2 Frontend inventory

| File/area | Responsibility | Reusable by an optimization UI? |
|---|---|---|
| `src/types/network.ts` | The TypeScript mirror of `app/models.py` — `NetworkInput`, `LinkInput`, `TrafficDemandInput`, `AlgorithmConfig`, `SimulationResult`, `LinkResult`, `PathResult`, `SimulationFailureEvent`, etc. | **Directly** — an `OptimizationResult` type (§J) should be added alongside these, not replace them. |
| `src/components/WorkflowManager.tsx` | The ~1900-line orchestrator: network/demand/algorithm state, `handleSimulate`, baseline/comparison lifecycle (`baselineResult`, `comparisonMode`, `buildComparison`), all the `handle*` mutation callbacks. | The **state-management pattern** is reusable (a parallel `optimizationResult`/`handleOptimize` slice, not a rewrite) — but per the task's explicit instruction, no frontend work is proposed or built in Sprint 2 V1 planning; see §O. |
| `src/pages/AlgorithmSelectionPage.tsx`, `SegmentRoutingEditor.tsx`, `TrafficDistributionEditor.tsx`, `TEPolicyEditor.tsx`, `FailureScheduleEditor.tsx` | Per-algorithm configuration editors, all following the same collapsed-by-default "editor" idiom (`te-editor` CSS class family). | Reusable idiom for a future `OptimizationLab` panel (§O) — not built here. |
| `src/components/ResultSummaryPanel.tsx` | Post-run narrative + metric cards + per-algorithm compact sections (SR segments, ECMP distribution, applied TE policies). | Reusable pattern for rendering `OptimizationResult` — not built here. |
| `src/components/ComparisonPanel.tsx` + `src/utils/comparison.ts` | PR6's Before/After/Difference machinery: `buildComparison(baseline, current) → SimulationComparison`, `LinkComparisonEntry` with `status ∈ {IMPROVED, WORSENED, UNCHANGED, NEW_CONGESTION, RESOLVED_CONGESTION, DOWN}`, percentage-point deltas, `COMPARISON_STATUS_COLOR`, the three-way mode toggle, all painted onto the *existing* React Flow canvas via `SimulationOverlayContext`. | **The single most important reusable piece for Sprint 2's UI**, later. `buildComparison()`'s signature is `(baseline: SimulationResult, current: SimulationResult) → SimulationComparison` — it does not care *how* `current` was produced. If an `OptimizationResult` is mapped into a `SimulationResult`-shaped object (§J explicitly designs for this), "Current ECMP: 125% → Optimized: 82%" is **literally today's `ComparisonPanel` with zero new visualization code** (§P). |
| `src/utils/failureReplay.ts`, `src/utils/segmentRoutingTrace.ts` | Trace-derived replay-state helpers (`deriveDownLinkIdsAtStep`, `deriveSegmentRoutingDisplayState`). | Not reusable — optimization is a one-shot computation, not a trace to replay (§O/§P — no new replay system). |
| `src/api/simulationApi.ts`, saved runs (`SavedRunsDrawer`, `RunStorageService`) | REST client + MongoDB-backed run persistence. | Pattern reusable for an `optimizeNetwork()` API call later; persistence out of scope for V1. |
| Sample JSON (`sample-json/*.json`) | Hand-authored `NetworkInput` fixtures already used for regression checks. | Directly reusable as optimizer test fixtures (§Q). |

### A.3 The specific reuse map the task asked for

| Concept | Where it lives today | What the optimizer needs from it |
|---|---|---|
| Topology representation | `NetworkInput{nodes, links, demands, topologyType, isDirected}` | Exactly this — the optimizer's input **is** a `NetworkInput` + `AlgorithmConfig`-like optimization config, not a new topology format. |
| Link IDs | `LinkInput.id`, stable, student-authored or `makeId("link")`-generated | Every optimizer output (recommended weights, flow assignments) must key by this same `linkId` — never by an internal index — so `comparison.ts` and `ComparisonPanel` can key-match against it for free. |
| Capacities | `LinkInput.capacity: number, > 0` | Direct RHS of every capacity constraint in every model in §C. |
| Weights | `LinkInput.weight: number, >= 0` | The **decision variable domain** for LWO/Joint (§C4/§C5); the **fixed input** for WPO/OPT (§C1/§C3). |
| Demands | `TrafficDemandInput{id, source, target, amount}` | Direct RHS of flow-conservation/demand-satisfaction constraints in every model. |
| Demand IDs | `TrafficDemandInput.id` | Keys every per-demand decision variable (`x^k_ij` in the papers) and every `flowAssignments`/`routeAssignments` entry in `OptimizationResult` (§J). |
| `operationalStatus` | `LinkInput.operationalStatus: "UP" \| "DOWN"` (PR5) | A DOWN link must simply be absent from the optimizer's edge set — reuse `GraphBuilder.build_graph()` verbatim (§N). |
| TE policies | `TrafficEngineeringPolicy{type, demandId?, linkId?, nodeId?, priority, penalty?}` (PR4) | Direct constraint/objective-term source per §M's mapping — largely already stated in `te_policy.py`'s own docstring. |
| `SegmentRoutingPolicy` | `{demandId, segments: string[]}` (PR1) | The *shape* WPO/Joint output should be written back into if "Apply recommended configuration" (§O) is ever built — not for Sprint 2 V1 itself. |
| `trafficDistributions` | `TrafficDistribution{demandId, mode, paths: PathDistribution[]}` (PR3) | Illustrates the **unsplittable-vs-splittable** tension directly — see §G; this is exactly the "how would an LP-optimal fractional split get deployed" question the existing product already had to answer once for ECMP. |
| `SimulationResult` | `{pathResults, linkResults, nodeRoles, traceEvents, maxUtilization, totalDeliveredTraffic, averagePathCost, congestedLinkCount, runtimeMs, debugInfo, ...}` | The **target shape** an `OptimizationResult` should be mappable into so `ComparisonPanel`/`ResultSummaryPanel` work unmodified later (§J, §P). |
| `LinkResult` | `{linkId, source, target, load, capacity, utilization, isCongested, weight}` | Optimizer must produce one of these per link from its solution — this is what `Metrics.compute_summary` and `buildComparison` actually consume. |
| `PathResult` | `{demandId, source, target, paths: PathShare[]}`, `PathShare{nodes, cost, trafficShare, pathId?}` | Optimizer must produce one of these per demand — `nodes` is a literal node-id sequence, which requires **path reconstruction** from a link-flow solution (non-trivial for a splittable-flow LP — see §G). |
| `Metrics` | `Metrics.compute_summary(pathResults, linkResults) → {maxUtilization, ...}` | Reusable verbatim once the two lists above exist — this *is* the MLU computation, already written. |
| Comparison utilities | `buildComparison()`, `LinkComparisonEntry`, `ComparisonMode` (PR6) | Reusable verbatim, see A.2 above — this is the biggest "for free" win in this whole audit. |

---

## Part B — Audit of current Segment Routing semantics

This section is the most consequential finding in Part A/B, because it changes what "upgrading SR for research-model compatibility" actually means.

### B.1 What the code does today

`resolve_segment_route()` in `app/utils/routing_helpers.py`:

```python
def resolve_segment_route(graph, source, destination, segments):
    waypoints = [source] + list(segments) + [destination]
    leg_paths = []
    for i in range(len(waypoints) - 1):
        leg_paths.append(
            nx.shortest_path(graph, waypoints[i], waypoints[i + 1], weight="weight")
        )
    full_path = [leg_paths[0][0]]
    for leg in leg_paths:
        full_path.extend(leg[1:])
    return full_path, leg_paths
```

The call is `nx.shortest_path(...)` — **singular**. NetworkX's `shortest_path` (Dijkstra under the hood, since `weight="weight"` is given) returns **exactly one** path per call. If several equal-cost shortest paths exist between two consecutive waypoints, NetworkX's internal tie-breaking (a function of node/edge insertion order and its priority-queue implementation, not a documented, stable public contract) silently picks one of them. There is no fallback to `nx.all_shortest_paths`, no traffic split, and no lexicographic sort of the kind ECMP itself uses (`sorted(nx.all_shortest_paths(...))` in `ecmp.py`, chosen specifically for path-id stability).

A single demand's full route places **all** of `demand.amount` on this one concatenated path (`PathShare(nodes=full_path, cost=..., trafficShare=demand.amount)` in `segment_routing.py`) — there is no per-leg splitting at all, equal or otherwise.

### B.2 Direct answers to the four questions asked

1. **Does `resolve_segment_route` use one shortest path only?** Yes, unambiguously — one `nx.shortest_path()` call per leg, full stop.
2. **If multiple equal-cost paths exist, does it (A) choose one, (B) ECMP-split, or (C) something else?** **(A) — it chooses one.** There is no code path for (B) or (C) anywhere in `segment_routing.py` or `routing_helpers.py`.
3. **Is current SR "single-path waypoint routing" or "ECMP-within-segments SR"?** **Single-path waypoint routing.** Every demand gets exactly one path, end to end, with zero traffic splitting at any point — including *between* waypoints, where the paper model assumes ECMP.
4. **Compare explicitly with [Parham21]'s Joint/WPO model.** [Parham21] §2 states this exactly: *"a flow must follow shortest path links, and it must split equally over all outgoing links that belong to a shortest path"* between consecutive waypoints (this is precisely how it derives `OPT ≤ Joint ≤ min(LWO, WPO)` — Joint's flows are still even-split flows, just steered through waypoints, never arbitrary splits). Current Sprint 1 SR does **not** implement this even-split behavior; it commits to one path arbitrarily, discarding the other equal-cost alternatives entirely. [LiYeung20]/[LiYeung19] independently confirm the same real-world motivation for caring about this distinction: they explicitly criticize the older *K-LP* approach for supporting only node-SIDs and *"[choosing] one of the routes... arbitrarily"* among ECMP alternatives at a bifurcation, showing why "an existing LP approach... [is] not optimal" precisely because it can't select or account for specific ECMP members. Sprint 1 SR has the same limitation K-LP has, but without even K-LP's LP-based path enumeration behind it — it's a direct greedy pick, not an optimization output.

### B.3 Must Sprint 1 SR be upgraded for research-model compatibility?

**Yes, eventually, but not to build Sprint 2 V1 (WPO, §C3).** Here is why the distinction matters and where the line actually falls:

- **WPO's own optimality claim does not depend on the simulator's tie-breaking.** WPO computes waypoints against `f(e,k)`/`z` variables defined directly over the *graph* (link flows), not against whatever `nx.shortest_path` happens to return. A WPO solver that (like [Parham21]'s Algorithm 3, `GreedyWPO`) evaluates candidate waypoints by re-routing under the *current weight setting* still needs a routing subroutine to score each candidate — and if that subroutine is Sprint 1's single-path `resolve_segment_route`, the WPO optimizer will be **scoring candidates against single-path routing, not even-split routing**, which means its optimality guarantee against the paper's `Joint(I)` bound (Eq. 2.1) does not transfer. The optimizer would still produce a valid, useful V1 recommendation (a real waypoint that measurably lowers MLU under Sprint 1's own routing semantics) — it just would not be provably optimal in the paper's sense whenever the topology actually has non-trivial ECMP ties on a segment.
- **This is a "CAN DEFER" item for V1, "DECIDE NOW" for anything claiming exactness** — see §S. Concretely: Sprint 2 V1's WPO/Joint modules should compute their own internal even-split routing between waypoints directly from the flow model (the LP/MILP already reasons about link flows, not about calling into `resolve_segment_route`), and **not** silently reuse the Sprint 1 simulator function as its scoring oracle. The two code paths (Sprint 1's teaching simulator, Sprint 2's optimizer) can and should diverge here on purpose.
- **Migration risk if Sprint 1 SR is changed to true ECMP-within-segments today:** every existing SR trace event (`SELECT_ACTIVE_SEGMENT`, `COMPUTE_SEGMENT_PATH`, the packet-token animation, `PathShare.pathId`) assumes exactly one path per demand. Splitting within a segment would require re-deriving SR's entire trace-event vocabulary and the frontend's `deriveSegmentRoutingDisplayState`/packet-token logic (which segment is "active" no longer has a single answer once a demand's flow forks mid-route), plus rewriting all 61 SR-related backend tests. This is a large, disruptive change to a feature that already shipped and is pedagogically explicit about being "V1" (`segment_routing.py`'s own docstring: *"deliberately NOT modeling SR-MPLS control-plane mechanics... V1 places each demand's full traffic on its one resolved route, with no multi-path splitting"*). **Recommendation: do not touch Sprint 1 SR in Sprint 2.** Build the optimizer's own even-split routing internally; treat "make Sprint 1 SR itself ECMP-aware" as a distinct, optional future initiative, not a Sprint 2 prerequisite.

---

## Part C — The optimization problems, precisely separated

Everything in this section follows [Parham21] §2's terminology exactly, since it is the one supplied paper that formally names and relates all four problems the task asks about.

### C1. OPT — unrestricted optimal routing

**[Parham21] §2, "The Optimal Flow (OPT)":** *"OPT is the multi-commodity flow problem with the objective of minimizing the MLU subject to link capacities... OPT has no routing restrictions; it may assign a positive flow to any link, and it may split a flow arbitrarily at any node."* The paper does not reproduce the LP itself — it cites an external reference ([Parham21]'s ref. [18], not among our supplied materials, see §S) for the exact formulation — but [Fortz00] §II.A **does** give the LP explicitly (its "general routing problem"), and independently states the key fact:

> *"Proposition 1: If each Φ_a is a piece-wise linear increasing and convex function, we can solve the general routing problem optimally in polynomial time."* — [Fortz00] §II.A. It is *"a complete linear programming formulation... [solvable] in polynomial time (Khachiyan)."*

**Is this pure LP? Yes.** Decision variables are per-demand, per-link flow fractions `f(e,k) ≥ 0`; constraints are flow conservation (one equality per node per demand) and capacity (one inequality per link); the objective `min z` s.t. `z ≥ Σ_k f(e,k) / c(e) ∀e` is the standard epigraph-form linearization of "minimize the max." Every constraint and the objective are linear in the flow variables — no product of two variables, no conditional, no integrality anywhere. `Metrics.compute_summary`'s existing `maxUtilization` field is exactly this `z`.

**Why OPT is the right theoretical baseline (not a routing recommendation):** OPT answers *"how good could routing possibly be, if we ignore that real routers run OSPF/ECMP/SR and not general MPLS-style per-flow forwarding?"* It is not deployable as-is on the topologies Sprint 1 simulates (arbitrary splitting at every node is not what ECMP, DV, or SR do), but it is the only number against which "how far is ECMP/SR from ideal" (the task's Q8/Fig. "ECMP MLU 1.25 / SR MLU 1.05 / OPT MLU 0.82 / Optimization gap ECMP/OPT") can be honestly stated. [Parham21]'s whole §3 ("Optimality Gaps") is built on exactly this kind of ratio, formalized as `R_LWO(I) = LWO(I)/Joint(I)` and `R_WPO(I) = WPO(I)/Joint(I)` (Def. 3.1) — the same pattern generalizes directly to `ECMP/OPT` and `SR/OPT` gaps for Sprint 2's product UI.

### C2. Congestion feasibility

**This must be phrased as a threshold question on OPT, not as a separate model.** `MLU ≤ 1` is congestion-free **for some** routing iff `OPT(I) ≤ 1`; since OPT is already the *unrestricted minimum* of MLU over all possible routings, no other routing model can do better than OPT. So:

- **`OPT(I) ≤ 1` ⟹ a congestion-free general routing exists** (though it may not be realizable by OSPF/ECMP or plain SR — see below).
- **`OPT(I) > 1` ⟹ congestion is structurally unavoidable, for *any* routing model whatsoever**, including a hypothetical perfect per-packet router. This is the strongest possible statement the system can make about a topology/demand pair — nothing routing-related can fix it; only adding capacity or reducing demand can.

**The distinction the task explicitly asks to document:** *"no ECMP weight assignment works"* (`LWO(I) > 1` even at the optimal weight setting) is a **strictly weaker** and **different** claim than *"congestion is structurally unavoidable"* (`OPT(I) > 1`). [Parham21]'s own Eq. 2.1, `OPT ≤ Joint ≤ min{LWO, WPO}`, makes this an inequality chain, not an equivalence: it is entirely possible (and, per [Parham21] Theorem 3.4, provably happens with an `Ω(n)` gap in worst-case instances) for `LWO(I) > 1` and even `WPO(I) > 1` while `OPT(I) ≤ 1` — meaning a congestion-free routing exists in principle, but no ECMP-based weight setting alone, and no waypoint setting alone, can reach it. Sprint 2's product copy must never conflate these two.

### C3. WPO — Waypoint Optimization

**[Parham21] §2:** weights `w` are given as input; WPO computes *"a sequence of up to `W` waypoints for each demand such that MLU is minimized when flows are routed through shortest paths between consecutive waypoints"* — i.e., routing between waypoints is still shortest-path + even-split (ECMP), never arbitrary. WPO with `W = 0` degenerates to plain OSPF/ECMP under `w` (no waypoints at all).

The paper's own practical algorithm for this, **Algorithm 3 `GreedyWPO`** ([Parham21] §6), is fully specified (not deferred to an external reference) and directly implementable:

> *Input: network instance `(N, D)`, weight setting `w`. For each demand `ψ = (s,t,d)` in descending order of demand size, for each candidate node `w ∈ V`, split the demand into `(s,w,d)` + `(w,t,d)`, recompute MLU under the fixed weight setting, and greedily keep whichever single waypoint (or none) most reduces MLU.* — [Parham21] Algorithm 3.

This is **not** the exact binary-`α[k,i,j]` MILP the task's own outline sketches — that formulation exists (it is essentially [LiYeung20]/[LiYeung19]'s `K-MILP`/`e2-LP` specialized to `K=2` segments, i.e. exactly one waypoint), but [Parham21] itself demonstrates it can also be attacked by a polynomial greedy heuristic with no solver at all, and that this greedy heuristic performs well in their evaluation (average MLU 1.17 for WPO on their small-network MILP comparison — [Parham21] §7.1).

**Modeling questions to research and answer (per the task):**
- *One waypoint per demand, or more?* [Parham21]'s own gap analysis (Table 1, §3) treats `W=1` and `W ∈ O(1)`/"`2 ≤ W`" as the two headline cases; `GreedyWPO` as written picks **at most one** waypoint per demand (`π_ψ = w`, a single node, or none). [LiYeung20]/[LiYeung19]'s `K-segment path` generalizes to `K−1` waypoints for arbitrary `K`, at the cost of `O(|N|^{K−1})` candidate paths per demand pair — exponential in `K`.
- *Optional no-waypoint case?* Yes in both papers — [Parham21]'s `GreedyWPO` explicitly considers "no improvement found" as a valid outcome (`U_min` only updates if a candidate strictly improves it), and [LiYeung20]'s node-SID-only segment list can legitimately be length 1 (`{destination}`, i.e. plain shortest path).
- *Arbitrary splitting vs. unsplittable demand between waypoint legs?* Both papers assume **even ECMP splitting** on each leg (not arbitrary LP-style splitting) — this is what makes WPO strictly weaker than OPT and is the crux of Part B's compatibility gap.
- *ECMP behavior between segments* — confirmed above: shortest-path + even split, exactly matching what [Parham21] calls the routing restriction that distinguishes `LWO`/`WPO`/`Joint` from `OPT`.

**Recommended V1 model:** **single waypoint per demand** (`W=1`, matching [Parham21]'s own primary analysis case and its fully-specified `GreedyWPO` algorithm), **no-waypoint always a valid outcome**, and — because of the Part B finding — **WPO's internal routing subroutine should implement true even-split ECMP itself** rather than delegating to Sprint 1's single-path `resolve_segment_route`. This is directly implementable as a polynomial greedy search (`O(|V| × |D|)` MLU evaluations) with **no MILP solver required at all** for V1 — a genuinely good scope cut, see §L/§R.

### C4. LWO — Link Weight Optimization

Topology/capacity/demands fixed; decision variables are link weights `w(e)`; routing is OSPF shortest-path + ECMP even-split; objective is `min MLU`.

**Why this is fundamentally harder than OPT** — [Fortz00] states the mechanism precisely, and it is *not* merely "OSPF is a special case of OPT with extra constraints tacked on":

> *"the [ECMP] condition of splitting between shortest paths based on variable weights cannot be formulated as a linear program, and this extra condition makes the problem NP-hard."* — [Fortz00] §II.B.

Unpacking why, in the paper's own terms: whether flow can even be positive on link `(x,y)` for a given source/destination pair depends on whether `(x,y)` lies on *some* shortest path under the weight setting `w` — a condition of the form *"`w(x,y) + dist_w(y,t) = dist_w(x,t)`"* that is **itself a function of the weight variables**, not a fixed constant. That makes shortest-path membership a **combinatorial (effectively binary: "on the shortest path or not") condition entangled with the weight variables themselves** — a genuine bilinear/conditional relationship between two sets of unknowns (`w(e)` and `f(e)`), which is exactly what [pptx] slide 3 (the one part of the deck that survives comparison against the paper) calls out: *"w(e) ile f(e) bilinmeyenleri birbirine çarpıyor... w × f çarpımı anlamına gelir → non-linear."* [pptx]'s slide-level framing here is **consistent** with [Fortz00]'s actual claim, unlike its bibliography (§0.1) — worth noting explicitly since the task says not to trust the deck blindly, and here it happens to hold up.

The even-split requirement compounds this: *"`d/k`"* (demand split evenly across `k` equal-cost paths, where `k` itself depends on the weight setting) is a division by a variable, again outside LP's linear-combination-only vocabulary.

**NP-hardness:** [Fortz00] states the NP-hardness result but explicitly **defers its proof**: *"Because of space limitations, we defer to the journal version the proof that it is NP-hard to find an optimal weight setting for OSPF routing. In the journal version, based on collaborative work with Johnson and Papadimitriou, we will even prove it NP-hard to find a weight setting getting within a factor 1.77 from optimality for arbitrary graphs."* — [Fortz00] §I.D. **This is itself a supplied-materials gap**: the INFOCOM 2000 paper we have asserts NP-hardness (and even a 1.77 inapproximability factor) but the actual proof lives in a journal version not among our sources. The claim is trustworthy (it is the foundational, widely-cited result of this literature, restated without contradiction by every later paper we have, including [Parham21] which builds directly on it), but this document is not claiming to have independently verified the proof.

**Exact MIP vs. heuristic/local search:** [Fortz00]'s own answer, given the NP-hardness, is **not** an exact MIP at all — it is a **local search heuristic** ("HeurOSPF" in later papers' terminology), using hash tables to avoid search cycling and dynamic-graph algorithms to make re-evaluating a perturbed weight setting fast (§V–VI of [Fortz00]). [Parham21]'s `JOINT-Heur` (Algorithm 2, §6) explicitly reuses this exact heuristic as its first step: *"Run HeurOSPF [11] and let ω be the weight setting result."* No paper in our supplied set gives a complete exact MIP formulation for LWO that correctly encodes shortest-path-membership-under-variable-weights and ECMP-even-split as linear/MILP constraints — this is consistent with the fact that doing so exactly is exactly the NP-hard, non-LP-representable core of the problem described above.

**What the naive slide-deck constraint set is missing (per the task's explicit instruction not to assume it is enough):** [pptx] slide 4's `C5` (`f(e,k) ≤ M·y(e,k)`, big-M) only forces flow to zero when a binary "link used" indicator is off — it says nothing about **which** binary pattern is consistent with *some* single-weight-setting shortest-path tree, nor does it enforce the even-split ratio. An exact LWO MIP would additionally need, at minimum: (a) per-destination shortest-path-tree consistency constraints tying `w(e)` to a binary "on-shortest-path" indicator per `(node, destination)` pair (the standard trick is a per-destination potential/distance variable `d(v,t)` with `d(u,t) ≤ d(v,t) + w(u,v)` for every edge, and `y(e) = 1` exactly when this holds with equality — itself already `O(|V|²)` extra continuous variables and `O(|E|·|V|)` extra constraints), and (b) exact-equal-split constraints among all edges sharing a bifurcation node's "on shortest path" status for a given destination. Neither is in the deck. **This document does not attempt to invent the complete constraint set** — it states precisely what is missing and why the literature's answer to "how do we actually solve LWO" is a heuristic, not this MIP.

### C5. JOINT — Link Weight + Waypoint Optimization

**[Parham21] §2, Eq. 2.1:** `OPT ≤ Joint ≤ min{LWO, WPO}`. **Why Joint is not "run LWO then run WPO":**

> *"We emphasize that Joint is not equivalent to applying LWO and WPO separately (e.g., sequentially), and it generalizes both of these optimizations, and hence, it is stronger. Joint is specifically the optimization problem of minimizing MLU over the Cartesian product of all link-weight settings and all waypoint settings."* — [Parham21] §2.

The paper *proves* this gap is not just theoretical hand-waving, via **Theorem 3.4**: there exist `n`-node instances with an `Ω(n)` optimality gap between `Joint` and `min{LWO, WPO}` when both are restricted to `W=1` waypoint per demand (Table 1 in the paper summarizes several such gap results, all `Ω(n log n)` or `Ω(n)` depending on the weight-setting assumption). Sequentially running "best weights, then best waypoints given those weights" (or vice versa) can get stuck in a *local* optimum of one dimension that is far from the *joint* optimum, because a weight setting chosen without knowledge of waypoints can make every useful waypoint detour expensive, and a waypoint chosen without knowledge of weights can't correct for a bad weight setting's structural bottlenecks.

**Do we have enough formulation detail to implement an exact Joint MILP? No — and this is stated explicitly rather than guessed at.** [Parham21] itself says, in its own evaluation section:

> *"The MILP formulation of Joint is presented in [18]."* — [Parham21] §7 ("Small Networks").

Reference **[18]** in [Parham21]'s own bibliography is:

> *"[18] Thomas Fenz, Klaus-Tycho Förster, Mahmoud Parham, Stefan Schmid, and Nikolaus Süß. Traffic engineering with joint link weight and segment optimization. September 2021. https://whatif-tools.net/segment-routing."*

This is the authors' own companion technical report / project website — **not one of the six materials supplied for this sprint**, and not otherwise available in our environment. **The exact Joint MILP formulation is therefore not present in any of our supplied sources.** Per the task's explicit instruction, **we do not invent it.** What *is* fully specified in the paper we do have is the polynomial-time **heuristic**, `JOINT-Heur` (Algorithm 2, §6, quoted fully in §C3 above): run `HeurOSPF`, then `GreedyWPO` under the resulting weights, then re-split each demand at its chosen waypoint and re-run `HeurOSPF` once more on the resulting demand list. The paper is explicit that this is *"not exactly a joint optimization, it is a first attempt to approximate Joint"* — but it is real, specified, and evaluated (average MLU 1.58 for `JOINT-Heur` vs. 1.65 for `HeurOSPF` alone on their large-topology benchmark — [Parham21] §7.1, "Large Networks").

**Recommendation:** Sprint 2 should not promise an exact Joint MILP. It should implement `JOINT-Heur` (§C3's WPO + §C4's LWO heuristic, composed exactly as the paper specifies) as the V1 "Joint" mode, and be explicit in the UI copy that this is a *heuristic approximation* of Joint, not a proven optimum (§J's `status` field already has room for this: `FEASIBLE`/"Best solution found," never `OPTIMAL`, for this mode specifically — see §K).

---

## Part D — Core product questions, answered directly

**Q1. Can Sprint 2 formally answer "is congestion unavoidable"?**

- **(A) Unrestricted routing:** **Yes, exactly and provably.** `OPT(I) ≤ 1` iff a congestion-free routing exists at all, for any conceivable routing model (§C2). This is the one case where "yes/no" is a clean, LP-solvable, provably-correct answer.
- **(B) OSPF/ECMP weight optimization:** **No, not exactly — only heuristically, and only as an upper bound.** LWO is NP-hard (§C4); Sprint 2 V1 can report *"the best weight setting our local-search heuristic found has MLU = X"*, which is an **upper bound** on the true `LWO(I)`, not a proof. If that upper bound is `≤ 1`, congestion-free ECMP is proven *achievable* (any feasible weight setting is a witness). If it's `> 1`, that does **not** prove congestion is unavoidable under LWO — only that the heuristic didn't find a better one. This asymmetry must be reflected precisely in product copy (§K).
- **(C) Segment Routing:** Depends on which SR model. Under [LiYeung20]'s exact `K-MILP`, congestion-freeness (`MLU ≤ 1`) for a *given, fixed* `K` can be answered exactly, subject to solver time limits (it's an exact MILP, not a heuristic) — but only within the constraint that routing must consist of `≤K`-segment paths. Under Sprint 1's current single-path SR (Part B), no such exactness claim is meaningful at all — Sprint 1 SR isn't an optimizer, it's a simulator of a student-chosen waypoint list.
- **(D) Joint optimization:** **No exact answer available from our sources** (§C5) — only the `JOINT-Heur` upper bound, same caveat as (B).

**Q2. Can we compute "the optimal weight assignment"? Under what exact assumptions?**

Not exactly, in general (NP-hard, §C4). We can compute a **locally-optimal-in-the-heuristic-sense** weight assignment via `HeurOSPF`-style local search, under the assumptions: ECMP even-split routing, real-valued or bounded-integer weights (§S — must decide), single objective = MLU (or [Fortz00]'s piecewise-linear penalty sum — see the note in §E), a fixed topology/demand snapshot (no dynamics). "Optimal" in product copy must be qualified as *"best found by local search, not proven optimal"* whenever LWO or Joint is involved.

**Q3. Can we compute "the optimal routing"? Clarify it is not necessarily ECMP/DV/SR.**

Yes, exactly, via OPT (§C1) — an LP, polynomial-time solvable, and it is explicitly **not** constrained to look like ECMP, Distance Vector, or Segment Routing output. It may split a single demand's traffic across three, four, or more paths in arbitrary fractional ratios that no shortest-path-based even-split protocol could reproduce. This must be surfaced clearly: OPT's "optimal routing" is a **theoretical ceiling**, not a **deployable configuration**, unless every fractional split it computes happens to be realizable by SR/ECMP (rare in general — see §G).

**Q4. What should "Show Optimal Routing" mean in the product? Should the UI distinguish modes?**

**Yes — distinguish explicitly, exactly as the task's own §O sketch already implies.** A single ambiguous "Optimal" button would silently conflate four different, non-interchangeable numbers (`OPT`, `LWO`, `WPO`, `Joint`) that can legitimately differ by an `Ω(n)` factor from each other (§C5, Theorem 3.4) on the *same* topology. Recommended labels, matching §C's naming exactly so the UI and this document never drift apart: **"Optimal Flow"** (OPT, unrestricted, theoretical baseline only), **"Optimize OSPF Weights"** (LWO, heuristic, deployable as router config), **"Optimize Waypoints"** (WPO, heuristic, deployable as SR config, weights held fixed), **"Joint Weights + Waypoints"** (JOINT-Heur, heuristic, deployable, both configs). See §O for the full mockup.

---

## Part E — Review of the lp_mip_te.pptx constraint set

[pptx] slide 4's variables: `f(e,k) ≥ 0` (continuous per-demand link flow), `z ≥ 0` (MLU), `y(e,k) ∈ {0,1}` (demand `k` uses link `e`), `λ(k,p) ∈ {0,1}` (demand `k` uses path `p`). Constraints `C1`–`C5` plus a stated "Segment Routing extension." Audited against [Parham21], [Fortz00], [LiYeung20]/[LiYeung19], and [Brundiers23]'s reproduced formulation:

| Claim | Verdict | Basis |
|---|---|---|
| **C1 — Demand satisfaction** `Σ_p λ(k,p) = 1 ∀k` | **Correct in spirit, but conflates two different modeling choices.** This is a **path-selection** constraint (choose exactly one path `p` per demand `k`) — i.e. it silently assumes **unsplittable demands**. [Brundiers23]'s reproduced "Problem 1" formulation is explicit that the *original* 2SR LP (from Bhatia et al., not one of our six sources, but reproduced faithfully inside [Brundiers23]) used **continuous** `x^k_ij` variables (arbitrary fractional splitting across segments), and that "newer variations... generally prohibit splitting demands over multiple SR paths by making the `x^k_ij` binary variables... [because] such an arbitrary splitting is not feasible in practice." Both choices exist in the literature; the slide presents only the binary (unsplittable) one without saying so — an **oversimplification**, not an error per se (see §G). | [Brundiers23] §II, "Problem 1" and surrounding text. |
| **C2 — Flow conservation** `Σ_out f(e,k) − Σ_in f(e,k) = {d_k, −d_k, 0}` | **Correct**, standard multi-commodity-flow flow conservation, matches [Fortz00]'s LP formulation's constraint (1) and every paper's OPT formulation. No issue. | [Fortz00] §II.A (constraint labeled `(1)` in the source, garbled in OCR but structurally identical); [Brundiers23] Eq. 2 analog. |
| **C3 — Capacity** `Σ_k f(e,k) ≤ c(e)` | **Correct**, standard. Note this is the *unrestricted-routing* capacity constraint (OPT-level); once weights or SR paths are added as decision variables, capacity has to be checked against **whichever** flow the weight/path choice produces, which is exactly where the non-linearity in §C4 enters. | [Fortz00] §II.A constraint `(2)`+`(4)`-class; [Brundiers23] Eq. 3. |
| **C4 — MLU upper-bound variable** `z ≥ (Σ_k f(e,k))/c(e) ∀e` | **Correct**, the textbook epigraph linearization of `min max_e util(e)`. Matches [Brundiers23]'s own `min θ` / `θ·c(e)` formulation and [Fortz00]'s Proposition-1 LP exactly in structure. No issue. | [Brundiers23] Eq. 1+3; [Fortz00] §II.A. |
| **C5 — "Segment / Waypoint constraint (MIP)"** `f(e,k) ≤ M·y(e,k)` (big-M) | **Correct as a big-M linkage between a continuous flow and its binary indicator, but insufficient by itself** for either "this is a shortest-path" (LWO, §C4) or "this obeys the K-segment structure" (WPO/SR, next row) — it only says "no flow without the indicator," never "the indicator pattern is achievable by some weight setting / segment list." This is the general big-M pattern, correctly stated, but the slide presents it as if it alone captures OSPF or SR semantics, which it does not. | Cross-checked against [Fortz00] §II.B's shortest-path-membership discussion and [LiYeung20] §IV's much larger constraint set for the same underlying idea (see below). |
| **"Segment Routing extension": `Σ_e y(e,k) ≤ K ∀k`** | **Incorrect as stated — this is the specific claim the task asked to scrutinize, and it does not survive comparison against the actual K-segment formulation.** `Σ_e y(e,k) ≤ K` counts **links** used by demand `k`. But a single *segment* (node-SID) in [LiYeung20]/[LiYeung19] is a **shortest path that can itself traverse an arbitrary number of links** — e.g. a node-SID "hop" from A to a waypoint five links away is still exactly **one** segment. Counting used links therefore over- or under-counts segments depending on topology, and cannot distinguish "one long node-SID hop" from "five separate adjacency-SID hops." [LiYeung20] does not use a link-counting inequality for this at all — it uses a dedicated **voltage-propagation constraint system** (Eqs. 30–32 in the paper): a positive-integer "voltage" variable `v_ij^p` is assigned to every segment `p` a flow traverses, initialized to 1 at the source's first segment (Eq. 30), propagated so that each segment's voltage is at least the max incoming voltage plus 1 (Eq. 31), and finally bounded, `v_ij^p|t_p=j ≤ K` (Eq. 32) — i.e. the constraint bounds the length of the *longest path reconstructible from the segment-based solution*, not a simple link count. The paper itself explains *why* this indirection is necessary: a segment-based (rather than explicit path-based) MILP solution does not by itself guarantee that *reconstructing* a concrete path from the chosen segments stays within `K` segments (§IV.B, discussion of Fig. 6's rejected solution). **Verdict: the slide's `Σ_e y(e,k) ≤ K` "merely counts used links," and does not represent a correct K-segment constraint.** | [LiYeung20] §IV.A–B, Eqs. (20), (30)–(32), and the Fig. 6 worked example explaining why link-counting fails. |
| **ECMP semantics** ("Node-SID: waypoint → ECMP devreye girer") | **Correct at the conceptual level stated on the slide**, and matches [LiYeung20] exactly: *"equal traffic splitting among ECMPs at a bifurcating node is ensured"* via Eq. (21)/(28) (`z_ij|l1 = z_ij|l2` for any two links sharing a bifurcating node on the same segment). The slide does not attempt to write this constraint out, so there's nothing to fault beyond noting it's a real, separate constraint the deck doesn't show. | [LiYeung20] Eq. (21), (28) and surrounding text. |
| **Shortest-path semantics** | The slide's C5 big-M is a placeholder, not a shortest-path encoding — see the C4/C5 row above and §C4's full discussion of why this is genuinely hard. **Insufficient**, and the slide does not claim otherwise (it says "NP-Hard → heuristic veya MILP" immediately after, which is itself accurate). | [Fortz00] §II.B. |
| **Adjacency-SID semantics** ("Adj-SID: exact link seçimi → binary y(e,k)") | **Correct at the conceptual level.** [LiYeung20] confirms precisely this framing: a node-SID cannot disambiguate among multiple ECMP-equal links leaving a bifurcation node, while an adjacency-SID names one specific link unambiguously — *"if there are ECMPs between a pair of nodes, a single node-SID cannot [identify a specific member]... an adjacency-SID must be used to unambiguously identify [it]."* | [LiYeung20] §IV.A discussion, and Abstract. |

**Summary verdict for Part E:** C1–C4 are correct simplifications of real, standard multi-commodity-flow LP structure (matching [Fortz00]/[Brundiers23] closely), with the caveat that C1 silently picks the unsplittable-demand modeling choice without flagging it. C5's big-M pattern is correctly stated but insufficient alone (as the deck itself half-acknowledges by calling the whole thing NP-hard). **The K-segment inequality `Σ_e y(e,k) ≤ K` is the one claim in the deck that is actually wrong**, not merely simplified — it conflates "segments" with "links," and the real mechanism (voltage propagation) is structurally different and substantially more involved. Any Sprint 2 SR/WPO optimizer that wants K-segment correctness must implement something like [LiYeung20]'s voltage constraints, not the slide's inequality.

---

## Part F — Node-SID, Adjacency-SID, and ECMP

Per [LiYeung20]/[LiYeung19] (studied carefully, as instructed):

- **Node-SID**: *"identifies a shortest-path segment"* — a compact instruction meaning "route via the shortest path to this node," which may traverse any number of links and, at any bifurcation along the way, is subject to whatever ECMP behavior the underlying IGP applies.
- **Adjacency-SID**: *"identifies a link segment"* — an instruction meaning "cross exactly this one link, regardless of what the shortest-path/ECMP computation would have chosen."

**The gap they create, in the paper's own words:** *"if there are ECMPs between a pair of nodes, a single node-SID cannot [uniquely identify a specific member link]... on the other hand, an adjacency-SID must be used to uniquely identify [it]."* Concretely: if node A has three ECMP-equal shortest paths to waypoint W, a node-SID `{W}` in the segment list leaves *which* of the three paths carries the traffic entirely up to the router's local ECMP hash — the controller/optimizer cannot pin a specific member without dropping to an adjacency-SID for at least the first hop of the tie.

**Why this matters for optimality:** [LiYeung20]'s central finding is that the older *K-LP* approach ([LiYeung19]'s own earlier work, and prior work it builds on) — node-SID-only — *"is not optimal because K-LP does not support adjacency-SIDs."* An MLU-minimizing solution may specifically want to route through one particular member of an ECMP group and *not* the others (to relieve congestion on a link the other members would use); a node-SID-only formulation cannot express that preference at all, so its LP relaxation systematically under-performs an adjacency-SID-aware one.

**Gap between this model and Sprint 1 SR V1:** Sprint 1's `SegmentRoutingPolicy.segments` is a plain list of **node ids** — architecturally, Sprint 1 SR is entirely node-SID-based already (no adjacency-SID concept exists anywhere in the schema or engine). But because Sprint 1 SR's `resolve_segment_route` picks exactly *one* path per node-SID hop rather than modeling ECMP at all (Part B), it doesn't even have the ECMP-ambiguity problem that motivates adjacency-SIDs in the first place — it sidesteps the question by never exposing multiple paths per hop to begin with.

**Recommendation — V1 vs. V2, with complexity estimates:**

- **V1: Node-SID / waypoint optimization only** (i.e., §C3's WPO, `W=1` waypoint, even-split-ECMP-aware internal routing). **Complexity: low-to-moderate.** No new SID concept needed in the data model at all — `SegmentRoutingPolicy.segments: string[]` already only ever holds node ids. The optimizer is a polynomial greedy search (`GreedyWPO`-style), no MILP solver strictly required. This is squarely within reach of a single Sprint 2 PR (§R, PR3).
- **V2: Node-SID + Adjacency-SID K-MILP**, i.e. a real implementation of [LiYeung20]'s `K-MILP`/`K-sMILP`. **Complexity: high.** Requires: (a) a new SID-type concept in the data model (`{type: "NODE" | "ADJACENCY", target: nodeId | linkId}` per segment, a genuine schema change), (b) the full voltage-constraint machinery from §E to correctly bound K-segment paths (the one piece of real mathematical sophistication in the whole literature set we have), (c) `O(M·|P|·|N|²)` variables for `K-MILP` or `O(|P|·|N|²)` for the simplified `K-sMILP` — both scale with `|P| ≈ |N|²` and the maximum-K-segment-paths count `M ~ O(|N|^{K−1})` (§L), meaning even the "simplified" version is a genuine MILP requiring a real solver with a time budget, not a greedy heuristic. **Recommendation: V2 is out of scope for Sprint 2 V1**, and should only be attempted after V1 (WPO) and LWO/Joint (heuristic) modes are shipped and validated (§S: DECIDE NOW is "V1 only for this sprint"; V2 is CAN DEFER, likely to a Sprint 3).

---

## Part G — Flow splitting semantics

Five models compared, each traced to where it appears (or doesn't) in the supplied sources:

1. **Arbitrary fractional flow splitting** — OPT's model (§C1): a demand may be divided into any number of fractional shares across any paths/links, in any ratio an LP solver finds optimal. This is what [Fortz00]'s general-routing LP and [Parham21]'s OPT both assume, with no deployability constraint attached at the model level.
2. **One SR path per demand (unsplittable)** — Sprint 1 SR's *actual current behavior* (Part B: `PathShare(nodes=full_path, trafficShare=demand.amount)`, no splitting anywhere), and also the modeling choice [Brundiers23] reports as the *"newer variations"* of the 2SR LP (binary `x^k_ij`) that superseded the original continuous formulation specifically *because* arbitrary splitting "is not feasible in practice" for SR deployments.
3. **Multiple SR paths per aggregate demand** — the *original* 2SR LP [Brundiers23] reproduces as "Problem 1" (continuous `x^k_ij ∈ [0,1]`, "the percentage share of the demand... routed over the intermediate segment k") — i.e., one aggregate demand can be legitimately split across several node-SID middlepoints simultaneously, at the LP-optimal fractional ratios. [LiYeung20]'s own `K-MILP`/`K-sMILP` output (§C3/§F) is explicitly of this shape too: *"the fraction of flow t_ij to be carried on path_m"* (`ratio_m`), i.e. one demand carried by potentially several K-segment paths at fixed ratios, installed at the source's flow table (`Algorithm 1`/`2`, "Traffic Splitting at Source Node").
4. **ECMP local equal splitting** — the routing behavior *between* waypoints/segments in [Parham21]'s LWO/WPO/Joint and in [LiYeung20]'s segment legs (Eq. 21/28): flow entering a bifurcation node splits evenly across every outgoing link that is on a shortest path to the segment's target, decided locally and mechanically by the router hash, not by the optimizer's choice.
5. **Current Sprint 1 custom ECMP traffic distribution** — `TrafficDistribution{demandId, mode: "EQUAL"|"CUSTOM", paths: PathDistribution[]}` (PR3): splits a demand across ECMP's own **already-discovered equal-cost path set** at *student-chosen* ratios, which is a genuinely different mechanism from all four above — it isn't a routing decision (paths are still whatever plain-shortest-path ECMP found), it's a **traffic-engineering override of the split ratio only**, closer in spirit to model 3's "fraction of flow per path" than to model 4's "mechanical equal split," but constrained to paths ECMP itself already enumerated (never a path ECMP wouldn't have found on its own).

**Which papers assume which model, restated for clarity:**

| Model | Papers | Sprint 1 precedent |
|---|---|---|
| Arbitrary fractional (1) | [Fortz00] (OPT LP), [Parham21] (OPT), [Brundiers23]'s *original* 2SR LP before its "newer variations" note | None — no Sprint 1 algorithm does this |
| Unsplittable single path (2) | [Brundiers23]'s "newer variations," and (structurally) Sprint 1 SR today | Sprint 1 SR V1 (Part B) |
| Multi-path fractional per aggregate demand (3) | [Brundiers23]'s original 2SR LP, [LiYeung20]/[LiYeung19]'s K-MILP output | Closest existing analog: PR3's `TrafficDistribution` (model 5), though not identical |
| ECMP even-split (4) | [Parham21] LWO/WPO/Joint's routing-between-waypoints, [LiYeung20] segment-leg splitting | Sprint 1 ECMP (`ecmp.py`) plain mode, and DV's single-path model is the degenerate `k=1` case of this everywhere it applies |
| Student-tunable ECMP split (5) | — (no paper source; this is a Sprint 1 UX feature, not a research model) | PR3 `TrafficDistribution` |

**Recommended educational V1 semantics for Sprint 2's optimizer:**
- **OPT (§C1):** arbitrary fractional splitting (model 1) — this is definitionally what makes it the theoretical ceiling; do not restrict it, or it stops being OPT.
- **WPO/LWO/Joint (§C3–C5):** ECMP even-split (model 4) between waypoints/on shortest paths, matching [Parham21] exactly, **not** [Fortz00]'s arbitrary-split OPT and **not** an unsplittable single path — this is the one place a wrong choice would silently make the optimizer's optimality claims meaningless relative to the papers they're derived from.
- **The explicit warning the task asks for:** OPT's LP-optimal solution is **not directly deployable** on a real ECMP/OSPF/SR network, precisely because it uses model 1 while real routers use model 4 (or 2, for SR). Sprint 2's UI (§O/§P) must never present OPT's flow assignment as "the configuration to apply" — only LWO/WPO/Joint outputs (which are constrained to model 4/2 by construction) are deployable recommendations. OPT is a **ceiling to measure against**, never a **config to install**.

---

## Part H — Solver / library analysis

Current `backend/requirements.txt` has **zero** optimization dependencies (`fastapi`, `uvicorn`, `networkx`, `pydantic`, `pymongo`, `httpx`, `python-dotenv` only) — this is a genuinely green field, not a migration.

| | PuLP + CBC | OR-Tools | scipy.optimize / HiGHS | Gurobi | CPLEX |
|---|---|---|---|---|---|
| License | PuLP: MIT. CBC: EPL-2.0 (permissive, OSI-approved). | Apache 2.0. | scipy: BSD-3. HiGHS (bundled since scipy 1.9 via `scipy.optimize.linprog(method="highs")` and `milp()`): MIT. | Commercial; free academic license available, no free-tier production use. | Commercial; free academic license, IBM community edition size-limited. |
| Python support | Native, pure-Python modeling layer (`PuLP`), CBC as a bundled binary. | Native (`ortools.linear_solver`, `ortools.sat.python.cp_model`). | Native, stdlib-adjacent (already a NetworkX-ecosystem-adjacent dependency in practice). | Native via `gurobipy`, requires license activation. | Native via `docplex`/`cplex` Python API, requires license activation. |
| LP support | Yes, via CBC or by swapping to another `LpSolver`. | Yes (GLOP for pure LP). | Yes (`linprog`, HiGHS backend, fast for pure LP). | Yes. | Yes. |
| MILP support | Yes (CBC is a MILP solver, branch-and-cut). | Yes (SCIP/CBC/`CP-SAT` — `CP-SAT` in particular is very strong for combinatorial structure like K-segment counting). | Yes since scipy 1.9 (`scipy.optimize.milp`, HiGHS branch-and-bound) but **less mature for large MILPs** than CBC/OR-Tools. | Yes, industry-leading performance. | Yes, industry-leading performance. |
| Ease of installation | `pip install pulp` — CBC ships bundled as a binary inside the wheel; no separate system package needed on any of Linux/macOS/Windows. | `pip install ortools` — also ships bundled binaries, similarly turnkey. | Already effectively free if `scipy` is added — no extra binary distribution concerns. | Requires a licensed installer + license file/server; not `pip install`-and-go for MILP-capable use. | Same licensing friction as Gurobi. |
| Docker/deployment implications | Trivial — one extra `pip install`, no license server, no binary licensing to manage inside a container. | Same — trivial. | Trivial if scipy is already a dependency footprint the project is comfortable with. | Requires baking a license file or license-server reachability into every deployment target, including CI and any student-run local instance. | Same friction as Gurobi. |
| Educational reproducibility | **Excellent** — every student/grader can `pip install` and get byte-identical solver behavior with zero account/license setup, matching this project's whole "runs locally, no external accounts" ethos (visible already in `python-dotenv`/local MongoDB fallback patterns elsewhere in the codebase). | Excellent, same reasoning. | Excellent, same reasoning, and zero new *named* dependency if scipy is judged acceptable. | **Poor** — a student without a license cannot run the optimizer at all; breaks the project's reproducibility model outright. | Same as Gurobi. |
| Performance (small/medium educational topologies) | Good enough — CBC is not the fastest MILP solver in absolute terms, but Sprint 1's own topologies (triangle/grid/fat-tree examples, `sample-json/*.json`) are all small (≤ tens of nodes), well within CBC's comfortable range for LP and small-K MILP. | Comparable or better than CBC for MILP at similar scale; `CP-SAT` is particularly strong for combinatorial (K-segment-style) structure. | Comparable to CBC for pure LP (OPT, §C1); `scipy.optimize.milp` is less battle-tested than CBC/OR-Tools for anything beyond small MILPs. | Best-in-class at any scale, irrelevant advantage at this project's scale. | Best-in-class, same caveat. |
| Solver-status reporting | PuLP exposes CBC's status (`Optimal`, `Infeasible`, `Unbounded`, `Not Solved`) directly — maps cleanly onto §J/§K's `OptimizationResult.status`. | OR-Tools exposes an equally rich status enum (`OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, `UNBOUNDED`, `MODEL_INVALID`, `NOT_SOLVED`) — arguably richer than PuLP/CBC's. | `linprog`/`milp` return a `success` bool + `status` code + message; usable but less granular out of the box. | Rich status + built-in optimality-gap reporting (`MIPGap`). | Same, rich status + gap reporting. |
| Timeout / optimality-gap control | CBC supports a wall-clock time limit and returns the best incumbent found so far, but PuLP's exposure of CBC's *relative MIP gap* setting is more limited/version-dependent than OR-Tools'. | First-class, well-documented timeout (`solver.SetTimeLimit`) and gap (`SetSolverSpecificParametersAsString` / `CpSolver.parameters.relative_gap_limit` for CP-SAT) controls. | `scipy.optimize.milp` accepts `time_limit` and `mip_rel_gap` directly as of recent scipy versions — clean, but a newer/less-proven surface. | First-class, industry-standard `TimeLimit`/`MIPGap` parameters. | Same. |

**Recommendation:** **PuLP + CBC for V1**, exactly as [pptx] itself proposes ("Solver: PuLP + CBC (açık kaynak)") — but arrived at independently here on license/reproducibility/deployment grounds, not because the slide said so. The decisive factors for *this specific project* are: (a) zero license friction, matching every other dependency choice already made (FastAPI, NetworkX, Pydantic, MongoDB-with-graceful-fallback — all free/local-first); (b) trivial Docker/CI story; (c) sufficient performance headroom for the topology sizes this project actually simulates. OR-Tools is a very close second and worth reconsidering if K-segment/adjacency-SID (§F, V2) work ever proceeds, since `CP-SAT`'s native support for combinatorial counting constraints (closer to §E's "voltage" propagation structure) may be a better fit than a hand-rolled big-M MILP in PuLP.

**Solver abstraction — recommended, not optional:** Given the explicit instruction to avoid hard-coupling to CBC, propose a small `SolverAdapter` (or `OptimizationBackend`) interface — e.g. `solve(problem: LPProblem | MILPProblem, time_limit_s: float, gap: float) -> SolveOutcome{status, objective, variables, lower_bound, wall_time_s}` — with a `PulpCbcAdapter` as the only V1 implementation. This is a thin interface, not a generic solver-agnostic modeling DSL (that would be over-engineering for V1) — its only job is to keep `status`/`gap`/`time_limit` plumbing (§J/§K) decoupled from PuLP's specific API surface, so a future `GurobiAdapter` is a self-contained addition, not a rewrite of every `*_optimizer.py` module in §I.

---

## Part I — Proposed backend architecture (design only, not implemented)

```
backend/app/optimization/
    __init__.py
    models.py            # OptimizationRequest, OptimizationMode, OptimizationResult, etc. (Pydantic — see §J)
    solver.py             # SolverAdapter interface + PulpCbcAdapter (see §H)
    result.py              # Maps a raw solver solution -> OptimizationResult, and (separately) -> a
                            #  SimulationResult-shaped view so ComparisonPanel/ResultSummaryPanel work unmodified (§J/§P)
    opt_flow.py            # C1: unrestricted multi-commodity flow LP (OPT)
    waypoint_optimizer.py  # C3: WPO — GreedyWPO-style search, even-split-ECMP-aware internal routing (§B/§G)
    weight_optimizer.py    # C4: LWO — HeurOSPF-style local search heuristic
    joint_optimizer.py     # C5: JOINT-Heur — composes weight_optimizer + waypoint_optimizer per [Parham21] Algorithm 2
    preprocessing.py       # §L: middlepoint/path preprocessing (candidate-set reduction), off by default in V1
    comparison.py           # thin glue: build a SimulationComparison (reusing frontend's comparison.ts *logic*,
                             #  mirrored server-side only if a backend-computed gap/summary is ever needed —
                             #  see the note below on why this may not even be a real module)
```

**Responsibility of each module:**

- **`models.py`** — the Pydantic request/response contract (§J). Depends only on `app.models` (reuses `NetworkInput`, `TrafficDemandInput`, `LinkInput`, `TrafficEngineeringPolicy` directly — no parallel topology type is introduced, per the task's explicit instruction to avoid duplicating network semantics).
- **`solver.py`** — the one place PuLP/CBC-specific code lives (§H). Every `*_optimizer.py` module below calls through this, never `import pulp` directly.
- **`result.py`** — the one place that knows how to turn a solved LP/MILP's variable values into (a) an `OptimizationResult` (§J, the "honest" optimizer-specific contract with `status`/`objective`/`lowerBound`/etc.) and (b) — critically — a `SimulationResult`-shaped projection of the *same* solution, purely so that `Metrics.compute_summary` (already written), `buildComparison()` (already written, frontend), and `ResultSummaryPanel`/`ComparisonPanel` (already built, frontend) can all be reused completely unmodified (§P). This module is the seam that makes "no new visualization engine" (§P's explicit instruction) actually true rather than aspirational.
- **`opt_flow.py`** — builds and solves the OPT LP (§C1) via `solver.py`. Pure LP, no binaries — this is also the natural place to answer §C2's "is congestion-free routing feasible" question (`solve(); status == OPTIMAL and objective <= 1`).
- **`waypoint_optimizer.py`** — implements §C3's V1 recommendation: a polynomial `GreedyWPO`-style search over candidate waypoints per demand, **with its own internal even-split-ECMP routing subroutine** (deliberately *not* calling into `app.utils.routing_helpers.resolve_segment_route`, per Part B's finding). No solver dependency needed for V1's greedy version; if K>1 or adjacency-SID (§F, V2) is ever added, this module would grow a MILP path through `solver.py`.
- **`weight_optimizer.py`** — implements §C4's V1 recommendation: a local-search heuristic over weight settings (`HeurOSPF`-style), reusing `GraphBuilder.build_graph()` to recompute ECMP routing under each candidate weight perturbation, scoring via `Metrics.compute_summary`. No solver dependency for V1 either (local search, not a MIP solve) — `solver.py` stays reserved for OPT's LP and any future exact-MIP experiments.
- **`joint_optimizer.py`** — composes `weight_optimizer` + `waypoint_optimizer` exactly per [Parham21] Algorithm 2 (§C3/§C5): run LWO, run WPO under the resulting weights, re-split demands at the chosen waypoints, re-run LWO once more. Explicitly documented (in code and in `OptimizationResult.status`, §K) as a heuristic approximation of Joint, never as an exact solve.
- **`preprocessing.py`** — §L's middlepoint/candidate-path reduction techniques (centrality-based, stretch-bounding, demand pinning, SR path domination), implemented as an **optional, off-by-default** pre-filter that any of the above optimizers can call before building their model — kept as a separate module specifically so it stays optional and swappable, matching [Brundiers23]'s framing of these as pluggable, independently-evaluable techniques.
- **`comparison.py`** — **tentative, likely unnecessary as a distinct module.** Given `buildComparison()` already exists and is fully general (§A.2: `(baseline: SimulationResult, current: SimulationResult) → SimulationComparison`, no backend involvement at all today), the honest recommendation is that this module may end up being *nothing more than* `result.py`'s `SimulationResult`-projection function, and a dedicated `comparison.py` should only be added if/when a genuinely backend-only comparison need appears (e.g. server-side gap reporting for a saved-run history feature). Listed here because the task's suggested architecture includes it, but flagged so Sprint 2 doesn't build speculative glue code.

**Explicit non-duplication commitments:** every optimizer module takes a `NetworkInput` and calls `GraphBuilder.build_graph()` exactly like the four existing algorithms do (so DOWN-link exclusion, directed/undirected handling, and `link_map` construction all come for free and stay consistent — §N); none of them re-implement demand/capacity/weight parsing, path-cost computation, or node-role bookkeeping — `routing_helpers.py`'s `path_link_ids`/`path_total_weight`/`build_node_roles` are reused verbatim wherever a concrete path needs to be turned into a `PathShare`.

---

## Part J — Optimization result contract (design only)

```python
OptimizationStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIME_LIMIT", "ERROR"]

class LinkOptimizationDelta(BaseModel):
    linkId: str
    load: float
    utilization: float
    # present only for LWO/Joint results
    recommendedWeight: Optional[float] = None

class WaypointAssignment(BaseModel):
    demandId: str
    waypointNodeId: Optional[str] = None   # None = "no waypoint" is itself a valid recommendation

class FlowAssignment(BaseModel):
    """One arbitrarily-split share of one demand — only meaningful for OPT (§C1/§G model 1)."""
    demandId: str
    nodes: List[str]
    share: float   # fraction of demand.amount, sums to 1.0 across a demand's FlowAssignments

class OptimizationResult(BaseModel):
    mode: Literal["OPT", "LWO", "WPO", "JOINT"]
    status: OptimizationStatus
    objective: float                    # MLU under this mode's routing restriction
    lowerBound: Optional[float] = None  # meaningful for OPT (LP: lowerBound == objective when OPTIMAL);
                                         # for LWO/WPO/JOINT, may be OPT(I)'s value as an external lower bound,
                                         # NOT a bound produced by the heuristic itself (heuristics don't produce one)
    optimalityGap: Optional[float] = None   # only meaningful when both objective and lowerBound are populated
                                             # and the mode is an exact solve (OPT, or a future exact WPO/Joint MILP)
    solveTimeMs: float
    linkLoads: Dict[str, float]
    linkUtilizations: Dict[str, float]
    recommendedWeights: Optional[Dict[str, float]] = None      # LWO, JOINT
    waypointAssignments: Optional[List[WaypointAssignment]] = None  # WPO, JOINT
    flowAssignments: Optional[List[FlowAssignment]] = None      # OPT only (arbitrary splitting, §G)
    routeAssignments: Optional[List[PathResult]] = None         # LWO/WPO/JOINT — same PathResult shape as
                                                                  # SimulationResult, for direct reuse (see below)
    debugInfo: List[str] = []
```

**The "explain like ComparisonPanel already does" requirement is satisfied by design, not by new UI code:** `result.py` (§I) additionally produces a `SimulationResult`-shaped projection — `algorithm = "OPTIMIZED_" + mode`, `pathResults = routeAssignments` (or a reconstructed path list from `flowAssignments` for OPT — see §G's caveat that this reconstruction is not always unique/deployable), `linkResults` built from `linkLoads`/`linkUtilizations` exactly like every existing algorithm's own `link_results` loop, `maxUtilization = objective`. Handed to the *existing, unmodified* `buildComparison(baselineResult, thisProjection)`, this produces exactly the task's target narrative for free:

```
Current ECMP:      125%
Optimized:           82%
Improvement:        −43 pp
```

**Status/gap wording is spelled out precisely in §K** — this section only defines the fields; §K defines what values may legally appear together and what each combination means in product copy.

---

## Part K — Infeasibility terminology (precise definitions)

This is the one area the task calls "extremely important," so it gets its own worked-through definitions rather than a table.

**Two entirely different kinds of "no":**

1. **`status = INFEASIBLE`** — the *model itself* has no feasible solution at all, for *any* value of the objective. For a pure MLU-minimization LP/MILP as specified in §C, this should essentially never happen on a well-formed `NetworkInput` — flow conservation + non-negative capacities always admits the trivial "route nothing" if demands could be zero, and in practice `z` (MLU) is unbounded above, so *some* feasible point (however bad) always exists **unless** the model has additional **hard structural constraints** that conflict — the two realistic sources of true infeasibility in this system are: (a) a demand's source and destination are **disconnected** in the effective graph (e.g. after `operationalStatus=DOWN` exclusion, §N, or after `FORBID_LINK`, §M, removes the only path), so flow conservation cannot be satisfied at all; or (b) a hard policy combination is self-contradictory (e.g. `REQUIRE_WAYPOINT` to a node that a `FORBID_LINK` has just made unreachable from the source). **Product wording:** *"No routing exists that satisfies every hard constraint — check for disconnected demands or a link/waypoint policy conflict."* Never say "MLU too high" here — infeasibility is not a congestion statement at all.
2. **`status = OPTIMAL` (or `FEASIBLE`) with `objective > 1.0`** — the model was solved successfully; a routing exists; it is simply not congestion-free. This is [Parham21]'s and [Fortz00]'s entire subject matter, and it is the **normal, expected outcome** for a demand set that exceeds network capacity. **Product wording:** *"Congestion-free routing is infeasible — the best possible maximum link utilization is 127%."* Note the word "infeasible" is doing real, separate work here — it modifies "**congestion-free** routing," a *derived* claim from the solved objective value, not the model's own solver status. **The two uses of the word "infeasible" in this paragraph must never be allowed to collapse into each other in the UI or in engineering discussion** — they are answers to two different questions ("does a routing exist at all" vs. "does a routing exist that also avoids congestion").

**Precise status/wording table:**

| Solver status | `objective` | Meaning | Exact product phrasing |
|---|---|---|---|
| `INFEASIBLE` | n/a | No routing satisfies the hard constraints (disconnected demand, contradictory policies, etc.) | *"No valid routing exists for this configuration."* |
| `OPTIMAL` | `≤ 1.0` | A routing exists, provably the best possible under this mode, and it avoids congestion | *"Optimal — congestion-free routing found. Proven optimal."* |
| `OPTIMAL` | `> 1.0` | A routing exists, provably the best possible under this mode, but congestion is unavoidable under this mode | *"Optimal — but congestion-free routing is infeasible under this mode. Best possible maximum utilization: 127%."* |
| `FEASIBLE` | any | A heuristic (LWO/WPO/JOINT, §C4/C5) found a routing but cannot prove it's the best possible | *"Best solution found (not proven optimal)."* + report gap-to-`OPT` if available, e.g. *"at most ~12% above the theoretical minimum."* — **never** report a solver-internal MIP gap for a heuristic that has none (§J: `optimalityGap` stays `None` for LWO/WPO/JOINT unless a genuinely exact MILP mode is added later) |
| `TIME_LIMIT` | any (incumbent) | An exact-solve mode (OPT, or a future exact WPO/Joint MILP) hit its wall-clock budget before proving optimality | *"Best solution found so far, 2.3% optimality gap"* — exactly the task's own example phrasing, valid **only** when `lowerBound` is populated (true for LP relaxations/MILP branch-and-bound, not for pure local-search heuristics) |
| `ERROR` | n/a | Solver crashed, malformed model, etc. — an engineering bug, not a network-topology fact | *"Optimization failed — please report this."* (never surfaced as a network-analysis conclusion) |

---

## Part L — Scalability

Grounded specifically in [Brundiers23] (the one supplied paper whose entire subject is scalability) and [LiYeung20]'s own stated variable/constraint counts.

**Growth drivers, with concrete figures from the sources:**

- **Candidate SR paths per demand**: [Brundiers23] states the base 2SR formulation has *"|V|^{k−1} paths to choose from"* per demand, *"resulting in a total number of `O(|V|^{k+1})` possible SR paths"* system-wide — for `k=2` (a single middlepoint, i.e. exactly §C3's V1 WPO case), that's already `O(|V|³)` system-wide, growing to `O(|V|^{K+1})` for general `K`-segment paths.
- **Maximum segments K, binary variable explosion**: [LiYeung20] states `K-MILP` introduces `O(M·|P|·|N|²)` variables/constraints, where `|P| ≈ |N|²` (total distinct segments ≈ node pairs) and `M`, the max number of `K`-segment paths between any node pair, is `O(|N|^{K−1})` — i.e. **the variable count is exponential in K**, confirmed directly by the paper's own complexity statement: *"solving K-MILP for optimal solutions can be extremely time-consuming."* The simplified `K-sMILP` improves this to `O(|P|·|N|²)` — polynomial in `|N|`, independent of `M` — precisely by trading the explicit path enumeration for the voltage-constraint indirection (§E), at the cost of the completeness gap the paper itself documents (a valid segment-based `K-sMILP` solution is not always reconstructible into a valid path-based one, though the paper's own experiments find this rare in practice).
- **Solver timeout**: [Brundiers23]'s whole premise is that unmitigated LP-based SR TE *"can reach up to multiple hours or even days"* on large (ISP-scale) topologies, against a practical need for *"solutions... on a timescale of just a few minutes."* This project's own topologies (`sample-json/*.json`: triangle, grid 3×3, small fat-tree, path/cycle examples) are far smaller than the ISP/Repetita-scale networks the preprocessing literature targets, so V1 should not need aggressive preprocessing to stay responsive — but the *architecture* should not assume it never will (a curious student building a 60-node custom topology, the existing `debugInfo` warning threshold in `simulation_service.py` at `>60 nodes or >120 links`, is a real, already-present signal worth reusing as the trigger for "consider preprocessing" rather than inventing a new threshold).

**Preprocessing techniques — what preserves optimality and what doesn't, per [Brundiers23]:**

| Technique | Mechanism | Preserves optimality? |
|---|---|---|
| **Centrality-based middlepoint selection** | Restrict candidate middlepoints to the highest Group Shortest-Path (GSP) centrality nodes ([Brundiers23] §III.A, citing Everett & Borgatti's centrality definition) | **No** — explicitly a lossy approximation; the paper reports *"a considerable deterioration in solution quality"* is the known trade-off, and flags a real operational risk (SLA/latency violations) if the same small "central" set is forced onto geographically distant demands. |
| **Stretch-Bounding (SB)** | Exclude any middlepoint `m` where `(DIST(src→m)+DIST(m→dst)) / DIST(src→dst) > α_SB` ([Brundiers23] §III.B, Eq. 6) | **No** — an approximate speed/quality trade-off; the paper documents a specific failure mode (1-hop demands get zero usable detours at any reasonable `α`) that its own evaluation had to patch around. |
| **Demand Pinning (DP)** | Fix the smallest demands to plain shortest-path routing (SPR), optimize only the largest ones ([Brundiers23] §III.C) | **No**, strictly — but the paper's argument for why the impact is *practically* negligible (small demands contribute little to the objective) is itself unverified in that paper's own words: *"there are no evaluation results reported in the literature, at all"* prior to [Brundiers23]'s own study. Treat as heuristic with a plausibility argument, not a proof. |
| **SR Path Domination** | Provably discard a path `p1` only if a strictly-no-worse alternative `p2` exists on every link `p2` uses (formal domination/equivalence definition, [Brundiers23] §III.D, Eq. 7, attributed to Callebaut, De Boeck & Fortz — note: **Bruno Fortz**, the same Fortz as [Fortz00], appears as a co-author of this technique in the underlying reference) | **Yes — the only one of the four that is exact.** *"Dominated SR paths are never needed for an optimal solution"* is stated as a proven property, not an approximation; excluding them (or all-but-one of a mutually-equivalent set) cannot change the optimal objective value. |

**Sprint 2 V1 vs. later:** given this project's small topology sizes, **no preprocessing is required for V1's WPO (`K=2`) or LWO scope** — `O(|V|³)` candidate paths for a handful-of-nodes teaching topology is trivially solvable. **SR Path Domination is the one technique worth building even in V1's `preprocessing.py`** specifically because it is free (loses nothing) and is the natural on-ramp toward V2's K-MILP (§F) if that is ever pursued — the other three (centrality, stretch-bounding, demand pinning) should be **deferred until an actual scale problem is observed**, per the paper's own caution that their quality/speed trade-off is topology-dependent and not free to assume.

---

## Part M — Current TE policy compatibility

`app/utils/te_policy.py`'s own module docstring already states this mapping almost verbatim (quoted in full in §A.1) — this section validates and completes it:

| Sprint 1 policy | Optimizer constraint/objective mapping |
|---|---|
| `FORBID_LINK` | **Hard constraint**: fix `f(e,k) = 0` for the forbidden link `e` and every demand `k` it applies to (global if `demandId=None`, per-demand otherwise) — identical in spirit to how `build_demand_policy_graph` already removes the edge from the per-demand graph copy before ECMP/SR ever runs. |
| `operationalStatus = DOWN` (PR5) | **Hard constraint, but global (not per-demand) and simpler**: the edge does not exist in the optimizer's graph at all — reuse `GraphBuilder.build_graph()` verbatim, exactly as every simulated algorithm already does (§N). |
| `REQUIRE_WAYPOINT` | **Routing/segment constraint**: for OPT/LWO this means "flow must pass through node `w`" (a genuine multi-commodity-flow-with-waypoint constraint, expressible by splitting the demand into two sub-demands `s→w` and `w→t` exactly as [Parham21]'s `GreedyWPO`/`JOINT-Heur` already do internally — Algorithm 2, line 3, quoted in §C3); for WPO/Joint it is even more natural, since waypoints are already the decision variable — a `REQUIRE_WAYPOINT` policy simply pins that decision rather than leaving it free. |
| `AVOID_LINK` | **Objective penalty / soft constraint**: add the policy's `penalty` (or the existing `DEFAULT_AVOID_PENALTY = 100.0`) to the link's effective cost in the *routing* sense (LWO/WPO's shortest-path computation), or as a secondary penalty term in the *pure-MLU* objective if the optimizer is meant to also respect it directly (see the lexicographic recommendation below). |
| `PREFER_LINK` | **Objective preference**: symmetric to `AVOID_LINK`, a cost discount (`DEFAULT_PREFER_DISCOUNT = 100.0`, floored at 0 exactly as `te_policy.py` already floors it) rather than a penalty. |

**Does applying soft-policy penalties conflict with pure MLU minimization? Yes, potentially, and this must be resolved deliberately, not silently.** A single scalar objective that adds "minimize MLU" and "minimize total avoid-penalty incurred" together (a weighted sum) risks either dimension dominating the other depending on arbitrary weight-parameter choices, and — worse for an *educational* tool — makes the reported MLU number not actually the minimum achievable MLU, which would silently break the OPT/LWO/WPO/Joint comparison numbers this entire sprint exists to produce (§C1's whole value proposition is "the honest theoretical minimum").

**Recommendation: lexicographic, exactly as the task suggests, and exactly as [Fortz00]'s own objective structure already hints at** (its piecewise-linear `Φ_a` penalizes congestion severity in tiers — 1x, 3x, 10x, 70x, 500x, 5000x cost multipliers across utilization bands, §C4's note — a form of "mostly minimize congestion, but let a secondary shaping signal exist within the same scalar" that only works because the *primary* signal so overwhelmingly dominates near 100% utilization that it never meaningfully trades off against a *sum* of secondary terms). For Sprint 2:

1. **Primary objective**: minimize MLU exactly, ignoring soft policies, hard constraints only (`FORBID_LINK`, `DOWN`, `REQUIRE_WAYPOINT`) applied.
2. **Secondary objective** (solved only among primary-optimal — or near-optimal, within a configurable tolerance — solutions): minimize total soft-policy penalty incurred.

This keeps the headline "optimal MLU" number honest and comparable across modes (§D's core promise), while still respecting the product's existing soft-policy vocabulary as a tie-breaker among otherwise-equally-good routings. **Do not implement this in Sprint 2 V1** (per the task) — it is a real design decision to record now (§S) and build once the four core modes (§C1–C5) exist and are validated on their own.

---

## Part N — Failure compatibility

**`operationalStatus = DOWN` (PR5):** trivial and free — reuse `GraphBuilder.build_graph()` unmodified (§A.1, §M table). A DOWN link is simply absent from the graph the optimizer builds its model over; no optimizer-specific code is needed for this at all, matching exactly how ECMP/SR/DV already get this "for free" today (per PR5's own design rationale, restated in `graph_builder.py`'s docstring: *"this is the single place link failure is applied... [every algorithm] automatically recompute[s] around a failure with no per-algorithm changes"*).

**Scheduled mid-simulation failures (PR6, `SimulationFailureEvent`/`FailureScheduler`) are explicitly NOT required for Sprint 2 V1**, per the task's own instruction, and this document agrees with that scoping for a structural reason beyond just "the task said so": `FailureScheduler.due(step)` is inherently a function of **trace-step progression** — it has no meaning for a one-shot LP/MILP solve, which has no "steps" at all. Building "optimize routing *as if* link X fails at step N" would require either (a) solving the optimizer twice — once for the pre-failure graph, once for the post-failure graph, which is just "run OPT/LWO/WPO/Joint twice with different `GraphBuilder` inputs," already fully supported by treating each as an independent `NetworkInput` snapshot, or (b) a genuinely different, **stochastic or multi-period** optimization model that reasons about failure *probability* or a *sequence* of network states jointly — which is a different research problem entirely (see below).

**The one paper that might specialize in exactly (b) — "Multi-time-step Segment Routing based Traffic Engineering Leveraging Traffic Prediction" — is not available in our supplied materials** (§0), and the only lead on it ([pptx]'s own bibliography entry, *"K. Miyasawa et al., IEEE/IFIP IM 2021... PuLP+CBC ile MILP çözümü — MLU + routing change sayısı ikili objektif"*, i.e. a claimed bi-objective MLU + routing-change-count MILP) carries the same authorship-trust caveat as the deck's two other confirmed misattributions (§0.1). **This document does not treat any specific claim about that paper's formulation as verified**, and recommends Sprint 2 do the same: mention multi-time-step/predictive optimization only as a **named, clearly-labeled future specialization** ("Sprint 2 does not attempt dynamic or stochastic optimization; a future sprint could revisit multi-time-step SR TE, pending access to the actual paper"), never as a planned or partially-planned V1/V2 feature.

**Recommendation:** Sprint 2 V1 optimizes exactly one static `NetworkInput` snapshot at a time (present-state `operationalStatus` respected, nothing else about failure). "What if this link fails?" is answered by the student re-running the optimizer against a second, PR5-style manually-toggled-DOWN snapshot and using the **existing, unmodified** `ComparisonPanel`/`buildComparison()` to view Before/After — this is not new work, it's the same reuse story as §P, and it deliberately keeps Sprint 2 out of stochastic/dynamic optimization territory entirely, exactly as instructed.

---

## Part O — Frontend product design (proposal only, not implemented)

*(No frontend code is written for this task — per the explicit instruction — but the task also explicitly asks for a proposed design, so one is sketched here in prose/mockup form only.)*

**Recommended entry point: "Optimization Lab"**, a new step/panel alongside (not replacing) the existing algorithm-selection flow, reachable once a topology + demands exist — the same information a `NetworkInput` optimizer request needs is already fully assembled by that point in the existing wizard.

```
┌─ Optimization Lab ────────────────────────────────────────────┐
│                                                                 │
│  Objective: Minimize Maximum Link Utilization                  │
│                                                                 │
│  Optimization model                                            │
│  ○ Optimal Flow           (theoretical ceiling — not deployable)│
│  ○ Optimize OSPF Weights  (ECMP, weights only)                 │
│  ○ Optimize Waypoints     (Segment Routing, weights fixed)     │
│  ○ Joint Weights + Waypoints                                   │
│                                                                 │
│                                        [ Run Optimization ]    │
│                                                                 │
│  ── Results ──────────────────────────────────────────────────│
│  Current Configuration (ECMP)              125%                │
│  Optimized (Optimize OSPF Weights)           82%                │
│                                                                 │
│  Congestion-free?                    YES                       │
│  Solver:                             Optimal                   │
│  Solve time:                         420 ms                    │
│                                                                 │
│  [ Apply recommended configuration ]  [ Compare ]  [ Explain ] │
└─────────────────────────────────────────────────────────────┘
```

The four radio options map 1:1 onto §D's Q4 answer and §C's naming — deliberately **not** one ambiguous "Optimal" button, and deliberately labeling OPT as "not deployable" right in the UI copy (§G's warning made visible to the student, not just to engineers).

**"Explain solution"** is the one genuinely new UI *surface* this sprint would eventually need (not built now) — but it should not be a new engine: it is `TraceStepPanel`'s existing title/description/explanation-text rendering pattern (already generic enough to render six different PR6 step types with zero bespoke components, per that PR's own final report), fed a small, fixed sequence of synthetic "trace-like" steps such as *"Found N candidate waypoints for demand A→D"* → *"Waypoint C reduces MLU from 125% to 90%"* → *"Final MLU: 82%"* — reusing the *rendering component*, not the *replay machinery* (§P explicitly rules out a new replay system, and this respects that).

**"Apply recommended configuration"** would write `recommendedWeights`/`waypointAssignments` (§J) back into `network.links[].weight` / `algorithmConfig.segmentRoutingPolicies` via the *exact same* `handleUpdateLink`/`handleAddWaypoint`-style handlers `WorkflowManager.tsx` already exposes — not a new mutation pathway.

Kept deliberately uncluttered, per the task's instruction: no live parameter sliders, no solver-internals exposition, no per-constraint toggles in V1 — those are exactly the kind of scope creep the "Do not over-clutter" instruction is guarding against.

---

## Part P — Visualization: integration with Sprint 1 comparison

**The single most load-bearing design decision in this whole document is that this integration requires writing zero new visualization code**, because of how PR6 already generalized Before/After/Difference:

- **Before** = current ECMP/SR/DV configuration's `SimulationResult` (already what `baselineResult` holds today).
- **After** = the optimizer's recommendation, mapped into a `SimulationResult`-shaped object by `result.py` (§I/§J) — `buildComparison(baseline, thisProjection)` does not know or care that "current" was computed by an LP solver instead of `ECMPAlgorithm.run()`.
- **Difference** = `NetworkEdge.tsx`'s existing per-link `IMPROVED`/`WORSENED`/`NEW_CONGESTION`/`RESOLVED_CONGESTION`/`UNCHANGED`/`DOWN` heatmap, painted from `comparisonByLink` exactly as it already is for a PR6 failure-scenario comparison — literally the same code path.

**Additional, genuinely new (but still no-new-engine) pieces to design for a later PR:**
- **"Recommended weights: old → optimized"** — a small table, same visual idiom as `LinkDetailPanel`'s existing Before/After comparison block (§A.2, PR6), just with `weight` instead of `utilization` as the compared quantity, and only rendered when `OptimizationResult.recommendedWeights` is present.
- **"Recommended waypoints: none → C"** — same idiom, reusing `SegmentRoutingEditor`'s existing node-label lookup helpers, rendered when `waypointAssignments` is present.
- **Flow/path changes** — the exact same `routeChanges` (`SimulationComparison.routeChanges`, already computed by `buildComparison()` via sorted-path-set comparison, PR6) already answers "which demands' routes changed" with zero new code, provided `routeAssignments` (§J) is populated with real `PathResult`-shaped paths.

**Explicit non-goal, restated:** no second canvas, no new replay/trace system, no new comparison-math module on the frontend — `comparison.ts` as it exists today is already general enough for this.

---

## Part Q — Validation / correctness strategy

Nine hand-verifiable cases, each with an expected mathematical result stated where the math is simple enough to state exactly (small integer/rational topologies, matching the existing test-fixture style in `test_link_failure.py`/`test_mid_sim_failure.py`'s `diamond_network()`/`single_path_network()` helper pattern):

| # | Case | Expected result |
|---|---|---|
| 1 | Single path network (`A—B—C`, one demand `A→C`, no alternatives) | `OPT = LWO = WPO = JOINT` all equal — there is only one possible routing, so every optimization mode degenerates to it. `objective = demand.amount / min(capacity on the path)`. |
| 2 | Parallel-path network (two disjoint equal-capacity/equal-cost paths `A→B`, one demand) | `OPT` splits the demand evenly (or in any capacity-respecting ratio achieving the same MLU) across both; if weights are already equal, `LWO = WPO = OPT` too, since plain ECMP already achieves the split OPT would choose. |
| 3 | ECMP triangle "lecture example" (the project's own `triangleTemplate`/`sample-json/triangle_ecmp.json` fixture, already used throughout Sprint 1's own tests) | Reuse directly — `OPT`/`LWO`/`WPO` should all report the *same or better* MLU than the fixture's already-known plain-ECMP MLU value; this is a regression-style sanity check ("optimization never reports something worse than the un-optimized baseline"), not a proof. |
| 4 | Structurally impossible capacity case (single link of capacity `c`, demand `> c`, no alternative path at all) | `OPT` reports `status=OPTIMAL`, `objective = demand/c > 1` — **not** infeasible (§K: a routing exists, it's just congested). Confirms the INFEASIBLE-vs-`objective>1` distinction end to end. |
| 5 | Unrestricted OPT avoids congestion, ECMP cannot | This is precisely [Parham21] **TE-Instance 1** (Figure 1, §3): `s → t` with `m = n−1` unit demands, capacity-`m` "trunk" links and capacity-1 "spoke" links to `t`. The paper proves `OPT = 1` (each demand takes its own capacity-1 spoke) while `LWO ≥ (n−1)/2` under *any* weight setting (Lemma 3.6) — a directly reproducible, citable worked example, not a hypothetical one. |
| 6 | Waypoint improves MLU | Also directly from [Parham21] **Lemma 3.5**: the *same* TE-Instance 1 admits `Joint = OPT = 1` using exactly one waypoint per demand (`v_i` as the waypoint for the `i`-th demand) — i.e. this single fixture proves both case 5 and case 6 at once, and is worth building as the project's own canonical "why does joint optimization matter" teaching example. |
| 7 | Joint beats LWO and WPO separately | [Parham21] **Theorem 3.4** (`Ω(n)` gap at `W=1`) is the formal statement; TE-Instance 1 again is the paper's own worked construction. Reproducible **only if** V1 actually implements `W=1` WPO and a real LWO heuristic against this exact fixture — flagged as a good target integration test once §C3/§C4 exist, expected result: `Joint(I) = 1` while `min(LWO(I), WPO(I)) ≥ (n−1)/3` (Lemma 3.7, the worst standard-weight-setting case). |
| 8 | Solver timeout | Construct (or simply reuse) a topology large enough that CBC does not return within a short artificial `time_limit_s` (§H); expect `status=TIME_LIMIT`, a populated `objective` (best incumbent), and — for OPT specifically, since it's pure LP and CBC/HiGHS solve LPs to completion essentially always at this project's scale — this case is realistically only reachable for a MILP mode (§F's V2, or a stress-test-sized WPO/K>1 instance), which is itself a useful scope-boundary confirmation for V1. |
| 9 | Infeasible hard policy combination | E.g. `FORBID_LINK` on the only edge into a `REQUIRE_WAYPOINT` node for some demand — expect `status=INFEASIBLE` (§K row 1), confirming the model-infeasibility path is reachable and distinct from `objective>1`. |

Test placement should follow the existing idiom exactly: a new `backend/tests/test_optimization_*.py` per mode, small hand-built `NetworkInput`/demand fixtures as local helper functions (mirroring `diamond_network()`, `single_path_network()` from PR5/PR6's own test files), asserting on `OptimizationResult.status`/`.objective` the same way existing tests assert on `SimulationResult.maxUtilization`.

---

## Part R — Proposed Sprint 2 PR breakdown

The task's suggested six-PR shape holds up well against everything audited above, with one structural adjustment: **PR3 (Waypoint Optimization) should come before PR4 (Link Weight Optimization)**, reversed from the task's own suggested order — because §C3's V1 WPO is a pure polynomial greedy search with **no solver dependency at all**, while §C4's LWO is inherently a heuristic local-search that is materially harder to get right (and, per [Fortz00], its own authors deferred even the NP-hardness *proof* to a follow-up paper). Landing the simpler, solver-independent win first de-risks the sprint and produces a demoable "optimizer" faster.

| PR | Goal | Likely files/modules | Tests | Depends on | Formulation | Regression risk |
|---|---|---|---|---|---|---|
| **PR1** | Optimization foundation: `backend/app/optimization/{models,solver,result}.py`, `SolverAdapter`/`PulpCbcAdapter` (§H/§I), and **unrestricted OPT LP** (§C1) end-to-end, including the §C2 congestion-feasibility answer. New `POST /optimize` route (mirroring `/simulate`'s shape) in a new `optimization_service.py`, dispatched analogously to `SimulationService`. | `backend/app/optimization/*`, `backend/app/services/optimization_service.py`, `backend/app/main.py` (one new route), `backend/requirements.txt` (+PuLP+CBC) | New `test_opt_flow.py` covering Part Q cases 1, 2, 4, 9 (INFEASIBLE) at minimum | None (first PR) | [Fortz00] §II.A general-routing LP; [Parham21] §2's `OPT` definition | **None to existing code** — entirely new module tree, one new route, one new dependency; zero changes to `app/algorithms/*`, `app/models.py`, or any existing test. |
| **PR2** | Optimal-baseline frontend integration: `OptimizationResult → SimulationResult` projection wired to the *existing, unmodified* `ComparisonPanel`; minimal "Optimization Lab" entry point with only the "Optimal Flow" radio enabled (§O). | `frontend/src/types/network.ts` (+`OptimizationResult` types), `frontend/src/api/simulationApi.ts` (+`optimizeNetwork()`), new minimal `OptimizationLabPage.tsx`, `WorkflowManager.tsx` (new `optimizationResult` state slice, additive) | Manual scenario verification (this project has no JS test runner today, per PR6's own noted limitation) + backend PR1 tests already cover the math | PR1 | N/A (integration only) | **Low** — additive state slice in `WorkflowManager.tsx`, no changes to existing handlers; the real regression surface to watch is accidentally coupling `ComparisonPanel` to optimizer-specific assumptions it shouldn't need — mitigated by PR2's whole point being that no `ComparisonPanel` changes are needed at all. |
| **PR3** | **Waypoint Optimization** (§C3): `waypoint_optimizer.py`, `GreedyWPO`-style greedy search with its own even-split-ECMP internal routing (deliberately not reusing Sprint 1's single-path `resolve_segment_route`, §B). "Optimize Waypoints" radio enabled. | `backend/app/optimization/waypoint_optimizer.py`, `test_wpo.py` | Part Q cases 3, 6, and (once PR4 exists) 7 | PR1 (result contract), not PR2 (frontend can lag) | [Parham21] Algorithm 3 (`GreedyWPO`), §2 definitions | **None to Sprint 1 SR** — explicitly does not touch `segment_routing.py`/`routing_helpers.py` (§B's recommendation). |
| **PR4** | **Link Weight Optimization** (§C4): `weight_optimizer.py`, `HeurOSPF`-style local search (hash-table cycle avoidance and incremental re-evaluation are explicitly *not* required for V1 correctness, only for the paper's large-topology performance — a simpler restart-based local search is an acceptable V1 given this project's topology sizes). "Optimize OSPF Weights" radio enabled. | `backend/app/optimization/weight_optimizer.py`, `test_lwo.py` | Part Q case 5 (TE-Instance 1) | PR1 | [Fortz00] §V (local search heuristic, conceptually — not a line-by-line port of the hash-table machinery) | **None to existing routing** — reads `LinkInput.weight` as a *starting point*, never mutates it; only the optimizer's own local candidate weight settings are transient. |
| **PR5** | **Joint Weight + Waypoint Optimization** (§C5): `joint_optimizer.py` implementing `JOINT-Heur` exactly (§C3, quoted algorithm) — explicitly labeled in `OptimizationResult`/UI copy as a heuristic approximation, never as an exact Joint solve (§C5's supplied-materials gap). "Joint" radio enabled. | `backend/app/optimization/joint_optimizer.py`, `test_joint.py` | Part Q cases 6, 7 | PR3, PR4 | [Parham21] Algorithm 2 (`JOINT-Heur`) | **None** — pure composition of PR3+PR4's already-tested logic. |
| **PR6** | Infeasibility explanations + solver UX + performance guards: precise §K status/wording plumbed end to end into the UI, `time_limit_s`/`optimalityGap` surfaced, the "large topology" `debugInfo` threshold pattern (§L) reused as a preprocessing-suggestion trigger, `preprocessing.py`'s SR Path Domination (§L, the one exact technique) wired in as an always-on, lossless optimization for PR3/PR5. | `backend/app/optimization/preprocessing.py`, status/copy updates across PR1–5's modules, frontend copy per §K's table | Part Q cases 8, 9 end-to-end through the UI | PR1–5 | [Brundiers23] §III.D (SR Path Domination) | **Low** — mostly wording/UX polish plus one additive, provably-lossless preprocessing pass; no behavior change to any already-shipped optimization mode's *results*, only to solve time and status/copy clarity. |

**What is deliberately excluded from this PR sequence, per earlier sections:** §F's V2 (adjacency-SID K-MILP), §M's soft-policy lexicographic objective, §N's mid-simulation/dynamic optimization, and three of §L's four preprocessing techniques (centrality, stretch-bounding, demand pinning) are all named, scoped, and explicitly deferred — see §S for the full decision list.

---

## Part S — Research gaps / decisions needed

| Decision | Recommendation | Status |
|---|---|---|
| Current SR single-path vs. ECMP-within-segments (Part B) | Keep Sprint 1 SR exactly as-is; build the optimizer's *own* even-split routing internally, never delegating to `resolve_segment_route` | **DECIDE NOW** — this determines `waypoint_optimizer.py`'s (PR3) internal design from day one; getting it wrong silently breaks the optimality claims in §C3/§C5. |
| Integer vs. real-valued OSPF weights (§C4) | Real-valued (`float`) for V1, matching `LinkInput.weight: float` already — no reason to force integers given this is an educational tool, not a router-firmware-constrained deployment | **DECIDE NOW**, but low-risk either way — trivial to change later since it's a domain restriction on one variable type, not a structural model choice. |
| Weight range/bounds for LWO's search space | Bound to a reasonable positive range (e.g. `[0.1, 100]` or derived from existing link weights in the topology) to keep local search well-behaved | **CAN DEFER** to PR4 itself — doesn't affect anything upstream. |
| Splittable vs. unsplittable demands, per mode (§G) | OPT: arbitrary/splittable (model 1). LWO/WPO/Joint: ECMP even-split (model 4), never arbitrary | **DECIDE NOW** — this is §G's central warning; get it backwards and the "optimal" numbers stop meaning what the papers say they mean. |
| Max waypoint count for WPO/Joint | `W=1` for V1 (§C3), matching [Parham21]'s own primary analysis case and its fully-specified `GreedyWPO` algorithm | **DECIDE NOW** for V1 scope; `W>1` is a natural, well-understood extension (**CAN DEFER**) once V1 ships. |
| Node-SID only vs. node-SID + adjacency-SID (§F) | Node-SID only (V1) — matches Sprint 1's existing schema exactly, no migration needed | **DECIDE NOW** (V1 scope) — adjacency-SID/K-MILP (V2) is **CAN DEFER**, likely out of Sprint 2 entirely. |
| Exact Joint MILP availability (§C5) | Not available in supplied sources; build `JOINT-Heur` instead, label it honestly as a heuristic in both code and UI | **DECIDE NOW** — this is a hard factual constraint, not a preference; there is nothing to defer, only to document (done, here). |
| Solver choice (§H) | PuLP + CBC, behind a `SolverAdapter` interface | **DECIDE NOW** for V1; the adapter interface is specifically what makes swapping later **CAN DEFER**-safe. |
| Timeout | A short default (seconds, not minutes) given this project's topology sizes; make it configurable per-request | **CAN DEFER** to PR1's implementation details — doesn't affect the model/architecture design above. |
| Acceptable optimality gap | Default to "solve to proven optimality" for V1's small topologies (no gap tolerance needed in practice); expose a gap parameter in the contract (§J) for future large-topology use | **CAN DEFER** — the *field* needs to exist now (§J does this), the *policy* for what value to default it to does not need deciding until PR6. |
| Directed vs. undirected assumptions | **Must match `NetworkInput.isDirected` exactly**, including the existing subtlety that `GraphBuilder` gives an "undirected" link two **independent** directed capacity constraints (one per direction), not one shared bidirectional pool — every optimizer model must replicate this exactly or its capacity constraints will silently diverge from what the simulated algorithms (and the student's mental model of "undirected") actually enforce | **DECIDE NOW** — this is a subtle, easy-to-get-wrong existing behavior (documented here precisely because it is not obvious from the model name alone) that directly affects constraint correctness in every one of §C1–C5. |
| Soft-policy objective handling (§M) | Lexicographic (MLU primary, policy-penalty secondary) | **CAN DEFER** — not needed until a PR that actually wires TE policies into the optimizer is scheduled (not in the PR1–6 sequence above at all). |
| Mid-simulation/dynamic/multi-time-step optimization (§N) | Out of scope entirely for Sprint 2; the one paper that might specialize in this is unverified and unavailable | **CAN DEFER** indefinitely, pending actually obtaining and reading that paper. |

---

## Deliverable confirmation

- ✅ This document: `docs/sprint2-mip-architecture-analysis.md`
- ✅ No frontend page, route, React component, or dashboard was created
- ✅ No production backend or frontend code was changed
- ✅ Branch `feat/sprint2-mip-analysis`, based on `feat/sprint1-mid-sim-failure-comparison` @ `0396809` (not `main`)
- ✅ Not merged, not pushed
- ✅ Every mathematical claim above is cited to a specific supplied source and location; every gap (exact Joint MILP, the fifth paper, [Fortz00]'s deferred NP-hardness proof) is stated explicitly rather than filled in by invention
