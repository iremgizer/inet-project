"""Tests for the shared MongoDB server-selection timeout configuration
(app/services/mongo_config.py) — added when the connection timeout was made
configurable for MongoDB Atlas (the original 500ms was tuned for
local-only development; see mongo_config.py's own module docstring).

None of these tests require a real MongoDB connection (local or Atlas) —
`get_server_selection_timeout_ms()` is pure env-var parsing, and the
"both storage services consume it consistently" tests below patch
`pymongo.MongoClient` to assert on the kwarg it was called with, exactly
the same no-real-database pattern this project's existing
test_assignments.py already uses for MongoDB-adjacent tests.
"""
import importlib
from unittest.mock import MagicMock, patch

import pytest

from app.services import mongo_config


def reload_mongo_config():
    """mongo_config reads os.environ at call time (not import time), so a
    plain reimport isn't strictly necessary — kept for symmetry/clarity."""
    importlib.reload(mongo_config)
    return mongo_config


# ── A. Default behavior ──────────────────────────────────────────────────

def test_a_default_is_5000ms_when_env_unset(monkeypatch):
    monkeypatch.delenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", raising=False)
    assert mongo_config.get_server_selection_timeout_ms() == 5000
    assert mongo_config.DEFAULT_SERVER_SELECTION_TIMEOUT_MS == 5000


def test_a_default_when_env_empty_string(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "")
    assert mongo_config.get_server_selection_timeout_ms() == 5000


# ── B. Environment override ─────────────────────────────────────────────

def test_b_env_override_valid_value(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "8000")
    assert mongo_config.get_server_selection_timeout_ms() == 8000


def test_b_env_override_accepts_small_value(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "500")
    assert mongo_config.get_server_selection_timeout_ms() == 500


# ── C. Invalid/unsafe values fall back to the default, never crash ─────

def test_c_non_numeric_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "not-a-number")
    assert mongo_config.get_server_selection_timeout_ms() == 5000


def test_c_zero_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "0")
    assert mongo_config.get_server_selection_timeout_ms() == 5000


def test_c_negative_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "-100")
    assert mongo_config.get_server_selection_timeout_ms() == 5000


# ── D. Both storage services consume it consistently ───────────────────
# Patches pymongo.MongoClient so no real database (local or Atlas) is ever
# contacted — asserts only on the serverSelectionTimeoutMS kwarg passed.

def _fake_client_factory():
    """A MagicMock standing in for MongoClient — .admin.command('ping')
    succeeds so the storage service's __init__ takes its "available" path,
    letting us assert it actually used the client it constructed."""
    client = MagicMock()
    client.admin.command.return_value = {"ok": 1}
    return client


def test_d_assignment_storage_service_uses_configured_timeout(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "7500")
    mock_client_cls = MagicMock(return_value=_fake_client_factory())
    with patch("pymongo.MongoClient", mock_client_cls):
        from app.services.assignment_service import AssignmentStorageService
        AssignmentStorageService()
    assert mock_client_cls.call_count == 1
    _, kwargs = mock_client_cls.call_args
    assert kwargs["serverSelectionTimeoutMS"] == 7500


def test_d_run_storage_service_uses_configured_timeout(monkeypatch):
    monkeypatch.setenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "7500")
    mock_client_cls = MagicMock(return_value=_fake_client_factory())
    with patch("pymongo.MongoClient", mock_client_cls):
        from app.services.run_storage_service import RunStorageService
        RunStorageService()
    assert mock_client_cls.call_count == 1
    _, kwargs = mock_client_cls.call_args
    assert kwargs["serverSelectionTimeoutMS"] == 7500


def test_d_both_services_agree_when_env_unset(monkeypatch):
    """Regression guard for the exact bug class this refactor fixes: the
    two independent MongoClient connections must never silently disagree
    on timeout because one hardcodes a value the other doesn't."""
    monkeypatch.delenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", raising=False)
    mock_client_cls = MagicMock(side_effect=lambda *a, **k: _fake_client_factory())
    with patch("pymongo.MongoClient", mock_client_cls):
        from app.services.assignment_service import AssignmentStorageService
        from app.services.run_storage_service import RunStorageService
        AssignmentStorageService()
        RunStorageService()
    assert mock_client_cls.call_count == 2
    timeouts = [call.kwargs["serverSelectionTimeoutMS"] for call in mock_client_cls.call_args_list]
    assert timeouts == [5000, 5000]
