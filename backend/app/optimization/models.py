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

# Widened to "LWO" | "WPO" | "JOINT" by future PRs — PR1 only ever produces "OPT".
OptimizationMode = Literal["OPT"]


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
