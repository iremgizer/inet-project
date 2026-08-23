"""Solver abstraction — the one seam between this project's optimization
code and the specific LP/MILP solver backend it happens to run on.

Every optimizer in `app/optimization/` (this PR's `unrestricted_optimizer.py`;
later PRs' WPO/LWO/Joint) builds its model directly against PuLP's own
modeling API (`pulp.LpProblem`, `pulp.LpVariable`, `pulp.lpSum`) — PuLP
already *is* a solver-agnostic modeling layer, so wrapping it in a second,
project-specific modeling DSL would be pure overhead with no benefit (see
docs/research/sprint2-mip-architecture-analysis-v1.md §H/§I). What a fully-
built `pulp.LpProblem` does *not* normalize on its own is: which concrete
solver binary actually runs it, and how that solver's raw status/objective/
timing get translated into this project's own vocabulary
(`app.optimization.models.OptimizationStatus`). That translation is this
module's only job — optimizer code calls `SolverAdapter.solve(problem)` and
never imports a `pulp.*Solver*` class directly, so swapping CBC for a
different open-source backend later means editing this file alone.

Only one adapter ships today: `PulpCbcAdapter`, wrapping PuLP's bundled CBC
binary (open-source, no license or separate install step — see PR1's
explicit "no commercial solvers" constraint).
"""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Tuple

import pulp

from app.optimization.models import OptimizationStatus


@dataclass
class SolveOutcome:
    """Solver-agnostic result of one `problem.solve()` call. Deliberately
    does not include per-variable values — the optimizer that built
    `problem` already holds direct references to its own `pulp.LpVariable`
    objects, and PuLP populates `.varValue` on those same objects in place
    during `solve()`, so reading them back through a name-keyed dict here
    would just add a redundant (and, for user-supplied ids, fragile —
    PuLP sanitizes characters in variable names) round-trip.
    """
    status: OptimizationStatus
    objectiveValue: Optional[float]
    runtimeMs: float
    solverName: str
    message: str


class SolverAdapter(ABC):
    @abstractmethod
    def solve(self, problem: "pulp.LpProblem", time_limit_s: Optional[float] = None) -> SolveOutcome:
        ...


class PulpCbcAdapter(SolverAdapter):
    """The only solver adapter this project ships: PuLP's bundled CBC
    (`PULP_CBC_CMD`) — confirmed available via `pulp.listSolvers(onlyAvailable=True)`
    with no separate installation step needed.
    """

    def solve(self, problem: "pulp.LpProblem", time_limit_s: Optional[float] = None) -> SolveOutcome:
        solver_kwargs = {"msg": False}
        if time_limit_s is not None:
            solver_kwargs["timeLimit"] = time_limit_s
        cbc = pulp.PULP_CBC_CMD(**solver_kwargs)

        start = time.time()
        problem.solve(cbc)
        runtime_ms = (time.time() - start) * 1000.0

        raw_status = pulp.LpStatus[problem.status]
        status, message = self._normalize_status(raw_status, time_limit_s)
        objective_value = (
            pulp.value(problem.objective) if status in ("OPTIMAL", "FEASIBLE", "TIME_LIMIT") else None
        )

        return SolveOutcome(
            status=status,
            objectiveValue=objective_value,
            runtimeMs=runtime_ms,
            solverName="CBC",
            message=message,
        )

    @staticmethod
    def _normalize_status(raw_status: str, time_limit_s: Optional[float]) -> Tuple[OptimizationStatus, str]:
        """Maps PuLP's own `LpStatus` strings ("Optimal", "Infeasible",
        "Unbounded", "Undefined", "Not Solved") onto this project's
        `OptimizationStatus` + the exact product-facing phrasing from
        docs/research/sprint2-mip-architecture-analysis-v1.md Part K's
        status/wording table.
        """
        if raw_status == "Optimal":
            return "OPTIMAL", "Optimal solution found."
        if raw_status == "Infeasible":
            return "INFEASIBLE", "No valid routing exists for this configuration."
        if raw_status == "Unbounded":
            # Should not happen for this LP's formulation (theta is bounded
            # below by 0 and the objective only minimizes it) — an engineering
            # bug, not a network-topology fact, if it ever does.
            return "ERROR", "Optimization failed — the model was unbounded, which should not happen for this formulation. Please report this."
        if raw_status == "Not Solved":
            if time_limit_s is not None:
                return "TIME_LIMIT", "Best solution found so far — the solver reached its time limit before proving optimality."
            return "ERROR", "Optimization failed — the solver did not return a solution. Please report this."
        return "ERROR", f"Optimization failed — unexpected solver status '{raw_status}'. Please report this."
