"""Tests for the CORS origin configuration (app/main.py) — added after a
real deployed-production incident where the Demo Scenario Dashboard's
"Reseed pack" button failed because the deployed frontend's origin wasn't
in the backend's (hardcoded, localhost-only) CORS allowlist. See
docs/deployment-and-database-guide.md §16 for the full writeup.

`_configured_frontend_origins()` is pure env-var parsing — none of these
tests touch a real server or a real CORS request.
"""
from app.main import LOCAL_DEV_ORIGINS, _configured_frontend_origins


# ── A. No env vars set — backward compatible with every prior deployment ───

def test_a_no_env_vars_returns_empty(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    assert _configured_frontend_origins() == []


def test_a_local_dev_origins_unchanged():
    """The exact four origins this app has always allowed — a regression
    guard against ever accidentally dropping or reordering one."""
    assert LOCAL_DEV_ORIGINS == [
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ]


# ── B. FRONTEND_ORIGIN (single) ─────────────────────────────────────────────

def test_b_single_origin(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://inet-frontend.onrender.com")
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    assert _configured_frontend_origins() == ["https://inet-frontend.onrender.com"]


def test_b_trailing_slash_stripped(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://inet-frontend.onrender.com/")
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    assert _configured_frontend_origins() == ["https://inet-frontend.onrender.com"]


def test_b_blank_value_ignored(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "")
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    assert _configured_frontend_origins() == []


# ── C. FRONTEND_ORIGINS (comma-separated) ───────────────────────────────────

def test_c_multiple_origins(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://a.onrender.com,https://b.onrender.com")
    assert _configured_frontend_origins() == ["https://a.onrender.com", "https://b.onrender.com"]


def test_c_whitespace_and_trailing_slashes_normalized(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.setenv("FRONTEND_ORIGINS", " https://a.onrender.com/ , https://b.onrender.com ")
    assert _configured_frontend_origins() == ["https://a.onrender.com", "https://b.onrender.com"]


def test_c_duplicates_deduplicated(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://a.onrender.com,https://a.onrender.com")
    assert _configured_frontend_origins() == ["https://a.onrender.com"]


# ── D. Both set together — merged, not one overriding the other ────────────

def test_d_both_env_vars_merged(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://a.onrender.com")
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://b.onrender.com,https://a.onrender.com")
    assert _configured_frontend_origins() == ["https://a.onrender.com", "https://b.onrender.com"]


# ── E. Full origins list — local dev always present, production layered on ─

def test_e_full_origins_list_backward_compatible_when_unset(monkeypatch):
    monkeypatch.delenv("FRONTEND_ORIGIN", raising=False)
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    full = LOCAL_DEV_ORIGINS + _configured_frontend_origins()
    assert full == LOCAL_DEV_ORIGINS  # byte-identical to the pre-fix hardcoded list


def test_e_full_origins_list_includes_both_local_and_production(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://inet-frontend.onrender.com")
    monkeypatch.delenv("FRONTEND_ORIGINS", raising=False)
    full = LOCAL_DEV_ORIGINS + _configured_frontend_origins()
    assert "http://localhost:5173" in full  # local dev never lost
    assert "https://inet-frontend.onrender.com" in full  # production origin added
