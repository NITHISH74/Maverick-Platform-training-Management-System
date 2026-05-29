"""Unit tests for the Copilot batch-scope enforcement.

These cover the security spec's Step-6 scenarios for the *pure* helpers in
`app.routers.copilot` — no DB or LLM needed. The DB-backed resolver
(`_resolve_batch_scope`) is exercised by integration tests; here we lock down
the two functions that decide whether a generated SQL is in-scope.
"""

from __future__ import annotations

from app.utils.scope_guard import (
    enforce_scope_in_sql as _enforce_scope_in_sql,
    extract_batch_ids_from_sql as _extract_batch_ids_from_sql,
)


# ---------------------------------------------------------------------------
# _extract_batch_ids_from_sql
# ---------------------------------------------------------------------------


def test_extract_eq_literal() -> None:
    assert _extract_batch_ids_from_sql("SELECT * FROM attendance WHERE batch_id = 7") == [7]


def test_extract_in_list() -> None:
    sql = "SELECT * FROM candidates WHERE batch_id IN (1, 2, 3)"
    assert _extract_batch_ids_from_sql(sql) == [1, 2, 3]


def test_extract_qualified_column() -> None:
    sql = "SELECT * FROM batches WHERE batches.id = 42"
    assert _extract_batch_ids_from_sql(sql) == [42]


def test_extract_none_for_unscoped() -> None:
    assert _extract_batch_ids_from_sql("SELECT COUNT(*) FROM users") == []


# ---------------------------------------------------------------------------
# _enforce_scope_in_sql
# ---------------------------------------------------------------------------


def test_admin_unrestricted() -> None:
    ok, reason, denied = _enforce_scope_in_sql(
        "SELECT * FROM attendance", None,  # None ⇒ admin
    )
    assert (ok, reason, denied) == (True, "", [])


def test_unscoped_query_passes() -> None:
    # No scoped table touched → always OK regardless of allowed list.
    ok, _, _ = _enforce_scope_in_sql("SELECT id, role FROM users", [1])
    assert ok is True


def test_trainer_allowed_batch_passes() -> None:
    # TEST 2: trainer assigned Batch A queries Batch A.
    ok, reason, denied = _enforce_scope_in_sql(
        "SELECT * FROM attendance WHERE batch_id = 1", [1, 2],
    )
    assert ok is True
    assert reason == ""
    assert denied == []


def test_trainer_denied_other_batch() -> None:
    # TEST 1: trainer assigned Batch A queries Batch B.
    ok, reason, denied = _enforce_scope_in_sql(
        "SELECT * FROM attendance WHERE batch_id = 99", [1, 2],
    )
    assert ok is False
    assert denied == [99]
    assert "outside" in reason.lower()


def test_substring_match_does_not_leak() -> None:
    # Regression test for the original bug: allowed=[1] must NOT permit
    # batch_id = 12 just because the character '1' appears in '12'.
    ok, _, denied = _enforce_scope_in_sql(
        "SELECT * FROM attendance WHERE batch_id = 12", [1],
    )
    assert ok is False
    assert 12 in denied


def test_trainer_in_list_partial_overlap() -> None:
    # Mixed allowed + denied in the same IN(..) ⇒ deny + name the bad ids.
    ok, _, denied = _enforce_scope_in_sql(
        "SELECT * FROM candidates WHERE batch_id IN (1, 99)", [1, 2],
    )
    assert ok is False
    assert denied == [99]


def test_trainer_no_batches_blocked_on_scoped_table() -> None:
    ok, reason, _ = _enforce_scope_in_sql(
        "SELECT * FROM attendance WHERE batch_id = 1", [],
    )
    assert ok is False
    assert "no batch access" in reason


def test_trainer_must_include_batch_filter() -> None:
    # Touching a scoped table without any batch_id literal ⇒ deny, even if
    # the caller has batches assigned — we can't prove the SQL is scoped.
    ok, _, _ = _enforce_scope_in_sql("SELECT * FROM attendance", [1])
    assert ok is False


def test_batches_table_is_scoped() -> None:
    # `SELECT * FROM batches` without an id filter must not leak the full
    # batch list to a trainer.
    ok, _, _ = _enforce_scope_in_sql("SELECT id, name FROM batches", [1])
    assert ok is False


def test_batches_table_scoped_query_passes() -> None:
    ok, _, _ = _enforce_scope_in_sql(
        "SELECT id, name FROM batches WHERE batches.id = 1", [1],
    )
    assert ok is True
