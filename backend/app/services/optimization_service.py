"""Sprint 2 PR5 — the one place `POST /optimize` dispatches an
`OptimizeRequest` to whichever of PR1-4's already-existing optimizer entry
points its `mode` selects. Deliberately thin: no routing logic, no new
optimization behavior — every mode's actual computation still happens
entirely inside `app/optimization/*`, unmodified by this service.

Mirrors `SimulationService`'s own role for `/simulate` (thin dispatch, no
business logic of its own) rather than introducing a differently-shaped
pattern for a second HTTP-facing service.

PR6 additions (still no optimization logic of its own): request-level
validation for the two new user-controllable knobs (`maxExactCombinations`,
`timeLimitSeconds`) — a documented, environment-configurable *hard* safety
cap independent of the UI's own default/preset budgets (§11), and a sane
wall-clock range — plus `estimate_search_space`, the thin dispatcher behind
`POST /optimize/search-space` (§3).
"""
import os
from typing import Optional

from app.optimization.joint_optimizer import estimate_joint_search_space, optimize_joint
from app.optimization.lwo_optimizer import estimate_link_weight_search_space, optimize_link_weights
from app.optimization.models import (
    OptimizationResult,
    OptimizeRequest,
    SearchSpaceEstimate,
    SearchSpaceEstimateRequest,
)
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import estimate_waypoint_search_space, optimize_waypoints

# ── PR6 §11 — absolute safety cap on maxExactCombinations ──────────────────
# Independent of the UI's own default (50,000) and preset values (10k/50k/
# 250k, see the frontend's own settings panel) — a student can raise their
# *own* request up to this hard ceiling, never beyond it, regardless of what
# the frontend's own slider/input allows. Chosen from a direct measurement,
# not guessed: a 6-link, 1-demand LWO exact search evaluated 15,625
# candidates in ~0.28s on this project's own development machine (~18µs per
# candidate — see docs/research/sprint2-mip-architecture-analysis.md's PR6
# addendum for the full benchmark and hardware note). At that rate, this
# cap's own worst case (2,000,000 candidates) is a bounded, if slow,
# ~35-40s search — well within the same order of magnitude as the default
# 30s `timeLimitSeconds`, which independently guarantees no single request
# can run away regardless of this cap's value. Configurable via
# `OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP` for a deployment that wants a
# stricter (or, on faster/dedicated hardware, looser) limit.
DEFAULT_MAX_EXACT_COMBINATIONS_CAP = 2_000_000

# ── PR6 §9 — sane wall-clock range for timeLimitSeconds ─────────────────────
# 1s floor: still a meaningful, usable budget for a tiny teaching topology
# (below this, "did it even try" becomes ambiguous). 300s (5 minutes)
# ceiling: generous enough for a deliberately large exact search a student
# chose to attempt, while still bounding a single HTTP request to a
# reasonable wait — no deployment-side override for this one (unlike the
# combinations cap): time, unlike search-space size, does not depend on
# hardware in a way a fixed different number would meaningfully address.
MIN_TIME_LIMIT_SECONDS = 1.0
MAX_TIME_LIMIT_SECONDS = 300.0

MIN_ALLOWED_WEIGHT = 1
MAX_ALLOWED_WEIGHT = 1000


def _max_exact_combinations_cap() -> int:
    raw = os.environ.get("OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP")
    if not raw:
        return DEFAULT_MAX_EXACT_COMBINATIONS_CAP
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_EXACT_COMBINATIONS_CAP
    return value if value > 0 else DEFAULT_MAX_EXACT_COMBINATIONS_CAP


def _validate_common(request: OptimizeRequest) -> None:
    cap = _max_exact_combinations_cap()
    if request.maxExactCombinations <= 0:
        raise ValueError("maxExactCombinations must be a positive number.")
    if request.maxExactCombinations > cap:
        raise ValueError(
            f"maxExactCombinations ({request.maxExactCombinations:,}) exceeds the server's safety cap "
            f"({cap:,}). Lower the search budget, or ask an administrator to raise "
            "OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP."
        )
    if not (MIN_TIME_LIMIT_SECONDS <= request.timeLimitSeconds <= MAX_TIME_LIMIT_SECONDS):
        raise ValueError(
            f"timeLimitSeconds ({request.timeLimitSeconds:g}) must be between "
            f"{MIN_TIME_LIMIT_SECONDS:g} and {MAX_TIME_LIMIT_SECONDS:g} seconds."
        )
    if request.mode in ("LWO", "JOINT"):
        _validate_weight_range(request.minWeight, request.maxWeight)


def _validate_weight_range(min_weight: int, max_weight: int) -> None:
    if min_weight > max_weight:
        raise ValueError(f"minWeight ({min_weight}) must be <= maxWeight ({max_weight}).")
    if min_weight < MIN_ALLOWED_WEIGHT or max_weight > MAX_ALLOWED_WEIGHT:
        raise ValueError(
            f"Weight range must be within [{MIN_ALLOWED_WEIGHT}, {MAX_ALLOWED_WEIGHT}] "
            f"(got [{min_weight}, {max_weight}])."
        )


def run_optimization(request: OptimizeRequest) -> OptimizationResult:
    _validate_common(request)

    if request.mode == "OPT":
        return solve_unrestricted_optimum(request.network, time_limit_s=request.timeLimitSeconds)
    if request.mode == "WPO":
        return optimize_waypoints(
            request.network,
            request.algorithmConfig,
            max_waypoints_per_demand=request.maxWaypointsPerDemand,
            max_exact_combinations=request.maxExactCombinations,
            time_limit_s=request.timeLimitSeconds,
        )
    if request.mode == "LWO":
        return optimize_link_weights(
            request.network,
            request.algorithmConfig,
            min_weight=request.minWeight,
            max_weight=request.maxWeight,
            max_exact_combinations=request.maxExactCombinations,
            time_limit_s=request.timeLimitSeconds,
        )
    if request.mode == "JOINT":
        return optimize_joint(
            request.network,
            request.algorithmConfig,
            min_weight=request.minWeight,
            max_weight=request.maxWeight,
            max_exact_combinations=request.maxExactCombinations,
            max_iterations=request.maxIterations,
            epsilon=request.epsilon,
            time_limit_s=request.timeLimitSeconds,
        )
    # Unreachable given OptimizeMode's Literal type (Pydantic already
    # rejects any other value at the request-parsing stage) — kept as an
    # explicit guard rather than silently falling through.
    raise ValueError(f"Unknown optimization mode: {request.mode}")


def estimate_search_space(request: SearchSpaceEstimateRequest) -> SearchSpaceEstimate:
    """PR6 §3 — the search-space preview `POST /optimize/search-space`
    dispatches to. No search runs here; each branch calls the exact same
    candidate-generation code (`estimate_waypoint_search_space`/
    `estimate_link_weight_search_space`/`estimate_joint_search_space`) the
    real optimizer itself uses, so the number a student sees before running
    anything can never drift from what a real run would actually search.
    """
    if request.minWeight > request.maxWeight and request.mode in ("LWO", "JOINT"):
        return SearchSpaceEstimate(
            mode=request.mode,
            error=f"minWeight ({request.minWeight}) must be <= maxWeight ({request.maxWeight}).",
        )

    if request.mode == "OPT":
        return SearchSpaceEstimate(
            mode="OPT",
            error="Not applicable — OPT is solved via linear programming (PuLP/CBC), not combinatorial search.",
        )

    if request.mode == "WPO":
        result = estimate_waypoint_search_space(request.network, request.algorithmConfig)
        return SearchSpaceEstimate(
            mode="WPO",
            searchSpaceSize=result.searchSpaceSize if not result.error else None,
            error=result.error,
            routableDemandCount=result.routableDemandCount if not result.error else None,
            candidateCountByDemand=result.candidateCountByDemand if not result.error else None,
        )

    if request.mode == "LWO":
        result = estimate_link_weight_search_space(request.network, request.minWeight, request.maxWeight)
        return SearchSpaceEstimate(
            mode="LWO",
            searchSpaceSize=result.searchSpaceSize if not result.error else None,
            error=result.error,
            optimizableLinkCount=result.optimizableLinkCount if not result.error else None,
            weightDomainSize=result.weightDomainSize if not result.error else None,
            minWeight=request.minWeight,
            maxWeight=request.maxWeight,
        )

    if request.mode == "JOINT":
        result = estimate_joint_search_space(
            request.network, request.algorithmConfig, request.minWeight, request.maxWeight,
        )
        return SearchSpaceEstimate(
            mode="JOINT",
            searchSpaceSize=result.searchSpaceSize if not result.error else None,
            error=result.error,
            weightSearchSpace=result.weightSearchSpace if not result.error else None,
            waypointSearchSpace=result.waypointSearchSpace if not result.error else None,
            minWeight=request.minWeight,
            maxWeight=request.maxWeight,
        )

    raise ValueError(f"Unknown optimization mode: {request.mode}")
