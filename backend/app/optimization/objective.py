"""MLU (max-link-utilization) epigraph objective.

`min theta` s.t. `utilization(link) <= theta` for every link is the standard
linearization of "minimize the maximum" ([Fortz00] §II.A's "general routing
problem" LP; see docs/research/sprint2-mip-architecture-analysis-v1.md Part
C1). Split out from `constraints.py` because the *objective* (minimize theta)
is the same for every future optimization mode (WPO/LWO/JOINT all minimize
MLU too) even though each mode's *flow* constraints differ — this is the one
piece of the model every mode shares verbatim.
"""
import pulp


def add_mlu_objective(problem: "pulp.LpProblem") -> "pulp.LpVariable":
    """Adds `theta` (continuous, >= 0, unbounded above) to `problem` as the
    objective to minimize, and returns it so the caller's own capacity
    constraints can be written against it (see
    `constraints.add_capacity_constraints`, which builds
    `sum(flow) <= theta * capacity`). Does not add any constraint itself.
    """
    theta = pulp.LpVariable("theta", lowBound=0)
    problem += theta, "Minimize_MLU"
    return theta
