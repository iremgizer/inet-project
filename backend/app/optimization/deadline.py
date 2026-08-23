"""Wall-clock deadline helper shared by every optimizer's search loop
(Sprint 2 PR6 — "controls, safety, UX... not a new algorithm").

A `deadline` is simply `time.time() + time_limit_s`, computed once by a
top-level `optimize_*`/`solve_*` function and threaded down into whichever
search loop it uses, checked once per candidate evaluation — cheap relative
to the evaluation itself (a handful of Dijkstra calls), so an in-progress
search stops close to, not long after, the requested wall-clock budget.

`None` means "no deadline" everywhere this is used. Every optimizer's own
top-level function defaults `time_limit_s=None`, so every existing PR1-5
call site — including the entire PR1-5 test suite, none of which pass this
parameter — is completely unaffected; a deadline is only ever set by the
HTTP-facing `/optimize` route (see `optimization_service.py`), which always
supplies one. This is deliberately an additive safety net, not a change to
any optimizer's search algorithm: when no deadline is reached (the common
case for this project's small teaching topologies), behavior is byte-for-
byte identical to before this module existed.
"""
import time
from typing import Optional


def compute_deadline(time_limit_s: Optional[float]) -> Optional[float]:
    """`None` in, `None` out. Otherwise an absolute `time.time()`-comparable
    timestamp `time_limit_s` seconds from now."""
    if time_limit_s is None:
        return None
    return time.time() + time_limit_s


def deadline_passed(deadline: Optional[float]) -> bool:
    """Always `False` for `deadline=None` — the "no deadline" case."""
    if deadline is None:
        return False
    return time.time() >= deadline
