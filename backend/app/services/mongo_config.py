"""Shared MongoDB connection configuration — used by both
`AssignmentStorageService` and `RunStorageService` so the two independent
`MongoClient` connections this app opens always agree on the same timeout,
rather than each parsing `MONGODB_SERVER_SELECTION_TIMEOUT_MS` on its own
and risking drift between them.

500ms (the original hardcoded value) was tuned for local development only:
"if MongoDB isn't running on localhost, fail almost instantly and fall back
gracefully." Against a remote cluster (e.g. MongoDB Atlas), a real
connection involves DNS/SRV resolution, a TLS handshake, and replica-set
discovery — commonly well over 500ms, especially on the first connection
after a cold start. A 500ms timeout there risks reporting
`mongoAvailable: false` against a perfectly healthy remote cluster.
"""
import os

DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5000


def get_server_selection_timeout_ms() -> int:
    """Read MONGODB_SERVER_SELECTION_TIMEOUT_MS from the environment.

    Falls back to DEFAULT_SERVER_SELECTION_TIMEOUT_MS (5000ms) when the
    variable is unset, empty, non-numeric, or non-positive — the same
    "don't crash on a bad env var, just use a sane default" pattern this
    project already uses for OPTIMIZATION_MAX_EXACT_COMBINATIONS_CAP (see
    app/services/optimization_service.py).
    """
    raw = os.environ.get("MONGODB_SERVER_SELECTION_TIMEOUT_MS")
    if not raw:
        return DEFAULT_SERVER_SELECTION_TIMEOUT_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_SERVER_SELECTION_TIMEOUT_MS
    return value if value > 0 else DEFAULT_SERVER_SELECTION_TIMEOUT_MS
