"""Scheduled mid-simulation link failures (PR 6).

Deliberately NOT a streaming/async execution model. The existing simulator
computes continuous-traffic results fully before returning (see
`SimulationService.simulate` — one request, one response, the whole trace
precomputed) and replay is a frontend concept layered on top of that
precomputed trace (see `TraceTimeline`/`TraceStepPanel`). A "failure at step
N" therefore has to be modeled as a deterministic event inside that
precomputed trace, not as something that happens at a real wall-clock moment
— which is also why `SimulationFailureEvent.triggerType` only supports
`"TRACE_STEP"` in this PR: arbitrary wall-clock timing would require the
backend to either block for real time (pointless for a teaching tool) or
fake it, and neither is worth the complexity over a step-indexed trigger the
frontend can already replay deterministically.

Semantics of `triggerValue=N`: steps 0..N are the baseline state. Once an
algorithm's own running step counter has advanced past N — i.e. it has just
finished emitting a demand's (or, for Distance Vector, the table's) own
trace steps — the event is "due". The calling algorithm applies it: removes
the link's edge from its effective graph, emits a LINK_FAILURE trace event,
finds any already-completed demand whose committed path crossed that link,
and recomputes just those demands against the updated graph. Demands not yet
processed simply see the updated graph naturally, with no special-casing
needed.

Each algorithm calls `.due(step)` at the same point it always advances past
a natural "unit of work" boundary (after each demand, and once more after
the demand loop ends, to catch a trigger step at or beyond the last emitted
step). `.due()` marks what it returns as fired, so multiple calls never
double-apply the same event, and multiple events due at once are returned in
trigger-step order — resolving each in order, in a single call, is what
makes two failures scheduled close together deterministic (test H).
"""
from typing import List

from app.models import SimulationFailureEvent


class FailureScheduler:
    def __init__(self, events: List[SimulationFailureEvent]):
        self._pending = sorted(events, key=lambda e: e.triggerValue)
        self._fired: set = set()

    def due(self, step: int) -> List[SimulationFailureEvent]:
        """Return (and mark fired) every not-yet-fired event whose
        triggerValue <= step, in trigger-step order. An event with an
        `eventId` already returned by a previous call is never returned
        again."""
        due = [e for e in self._pending if e.triggerValue <= step and e.eventId not in self._fired]
        for e in due:
            self._fired.add(e.eventId)
        return due

    @property
    def has_pending(self) -> bool:
        return len(self._fired) < len(self._pending)
