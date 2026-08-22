"""Sprint 2 optimization result contract.

This is the shape every optimization mode (this PR's OPT; later PRs' WPO,
LWO, and JOINT) returns — a single, mode-agnostic result model so a future
frontend/service layer can handle "an optimizer ran" once, not once per mode.
Field names follow PR1's own explicit spec; `mode`, `lowerBound`, and
`debugInfo` are additive fields carried over from the architecture doc's
earlier design (see docs/research/sprint2-mip-architecture-analysis-v1.md
Part J) because every future optimizer will need them too, even though PR1
itself only ever produces `mode="OPT"`.

Status/message wording follows the precise infeasibility terminology in
...-v1.md Part K: `INFEASIBLE` means no routing satisfies flow conservation
at all (e.g. a disconnected demand) — a categorically different fact from a
successfully solved `OPTIMAL` result whose `objectiveValue` happens to be
above 1.0 (a routing exists; congestion is simply unavoidable). Never
conflate the two in code that consumes this model.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

OptimizationStatus = Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIME_LIMIT", "ERROR"]

# PR1 produces "OPT" only. PR2 added "WAYPOINT_OPTIMIZATION". PR3 adds
# "LINK_WEIGHT_OPTIMIZATION". Widened again by JOINT in a later PR.
OptimizationMode = Literal["OPT", "WAYPOINT_OPTIMIZATION", "LINK_WEIGHT_OPTIMIZATION"]

# Which search actually produced a WAYPOINT_OPTIMIZATION or
# LINK_WEIGHT_OPTIMIZATION result:
# - EXACT_ENUMERATION: a genuinely exhaustive search over an explicitly
#   bounded candidate space (never called "MILP" — see waypoint_optimizer.py/
#   lwo_optimizer.py's own module docstrings for why). Shared by both modes
#   since both search strategies are the same idea (brute-force over a
#   bounded discrete space), just over a different candidate shape.
# - GREEDY_WPO: Parham et al.'s Algorithm 3 (PR2, waypoint search only).
# - HEURISTIC_LWO: PR3's Fortz&Thorup-inspired deterministic hill-climbing
#   local search over link weights (see lwo_optimizer.py) — NOT a
#   reproduction of Fortz&Thorup's actual `HeurOSPF` (no randomized restarts/
#   tabu search; "no randomness in V1" is this PR's own explicit constraint).
# Both GREEDY_WPO and HEURISTIC_LWO carry no optimality guarantee.
SearchMethod = Literal["EXACT_ENUMERATION", "GREEDY_WPO", "HEURISTIC_LWO"]


class FlowAssignment(BaseModel):
    """One arbitrarily-split share of one demand's traffic along one
    concrete path — only meaningful for OPT's unrestricted splitting model.
    `share` is a fraction (0..1) of `demand.amount`; a demand's own
    FlowAssignments sum to 1.0 (barring solver floating-point noise; see
    app/optimization/utils.py's FLOW_EPSILON). Produced by decomposing the
    LP's raw per-edge flow solution back into explicit paths — the LP itself
    has no notion of "a path", only per-edge flow values.
    """
    demandId: str
    nodes: List[str]
    share: float


class WaypointAssignmentEntry(BaseModel):
    """One demand's recommended waypoint (PR2) — `waypointNodeId=None` is
    itself a valid, meaningful recommendation ("no additional waypoint helps
    this demand"), not an absence of data. Mirrors the `WaypointAssignment`
    shape from docs/research/sprint2-mip-architecture-analysis-v1.md Part J,
    renamed to avoid colliding with this module's `WaypointAssignment` type
    alias (a plain `Dict[str, Optional[str]]`, see waypoint_evaluator.py).
    """
    demandId: str
    waypointNodeId: Optional[str] = None


class OptimizationResult(BaseModel):
    mode: OptimizationMode = "OPT"
    status: OptimizationStatus
    # Raw LP objective value (theta, the minimized MLU epigraph variable).
    objectiveValue: float
    # Cross-checked/derived MLU: max(linkUtilizations.values()). Mathematically
    # equal to objectiveValue for a correctly-built OPT model — kept as a
    # separate field (rather than aliasing) so a future mode whose objective
    # isn't itself the MLU (unlikely for WPO/LWO/JOINT, but not guaranteed)
    # doesn't have to overload this field's meaning.
    mlu: float
    linkLoads: Dict[str, float] = Field(default_factory=dict)
    linkUtilizations: Dict[str, float] = Field(default_factory=dict)
    flowAssignments: List[FlowAssignment] = Field(default_factory=list)
    solverRuntime: float
    optimalityGap: Optional[float] = None
    solverName: str
    message: str
    # Additive, forward-looking (Part J): meaningful once an exact solve
    # produces both an objective and an independent lower bound (OPT's LP
    # relaxation has no gap at all when OPTIMAL — lowerBound == objectiveValue
    # in that case; None for INFEASIBLE/ERROR).
    lowerBound: Optional[float] = None
    debugInfo: List[str] = Field(default_factory=list)

    # ── PR2 additions (WAYPOINT_OPTIMIZATION only) ─────────────────────────
    # All optional/defaulted so every PR1 OPT result and test is completely
    # unaffected — OPT never populates any of these.
    recommendedWaypoints: Optional[List[WaypointAssignmentEntry]] = None
    baselineMLU: Optional[float] = None
    optimizedMLU: Optional[float] = None
    # baselineMLU - optimizedMLU; positive means the recommendation helps.
    improvement: Optional[float] = None
    searchMethod: Optional[SearchMethod] = None
    searchSpaceSize: Optional[int] = None
    evaluatedCandidates: Optional[int] = None
    # True only for EXACT_ENUMERATION (a genuine exhaustive search over the
    # declared candidate space); False for GREEDY_WPO/HEURISTIC_LWO. Never
    # true for a heuristic result — see Part K's OPTIMAL-vs-FEASIBLE status
    # table, which this field mirrors at the mode-specific level.
    provenOptimal: Optional[bool] = None

    # ── PR3 additions (LINK_WEIGHT_OPTIMIZATION only) ──────────────────────
    # All optional/defaulted so every PR1/PR2 result and test is completely
    # unaffected. linkId -> weight, one entry per link in the network.
    recommendedWeights: Optional[Dict[str, float]] = None
    baselineWeights: Optional[Dict[str, float]] = None
