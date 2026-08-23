"""Sprint 2 PR5 — the one place `POST /optimize` dispatches an
`OptimizeRequest` to whichever of PR1-4's already-existing optimizer entry
points its `mode` selects. Deliberately thin: no routing logic, no new
optimization behavior — every mode's actual computation still happens
entirely inside `app/optimization/*`, unmodified by this PR.

Mirrors `SimulationService`'s own role for `/simulate` (thin dispatch, no
business logic of its own) rather than introducing a differently-shaped
pattern for a second HTTP-facing service.
"""
from app.optimization.joint_optimizer import optimize_joint
from app.optimization.lwo_optimizer import optimize_link_weights
from app.optimization.models import OptimizationResult, OptimizeRequest
from app.optimization.unrestricted_optimizer import solve_unrestricted_optimum
from app.optimization.waypoint_optimizer import optimize_waypoints


def run_optimization(request: OptimizeRequest) -> OptimizationResult:
    if request.mode == "OPT":
        return solve_unrestricted_optimum(request.network)
    if request.mode == "WPO":
        return optimize_waypoints(
            request.network,
            request.algorithmConfig,
            max_waypoints_per_demand=request.maxWaypointsPerDemand,
            max_exact_combinations=request.maxExactCombinations,
        )
    if request.mode == "LWO":
        return optimize_link_weights(
            request.network,
            request.algorithmConfig,
            min_weight=request.minWeight,
            max_weight=request.maxWeight,
            max_exact_combinations=request.maxExactCombinations,
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
        )
    # Unreachable given OptimizeMode's Literal type (Pydantic already
    # rejects any other value at the request-parsing stage) — kept as an
    # explicit guard rather than silently falling through.
    raise ValueError(f"Unknown optimization mode: {request.mode}")
