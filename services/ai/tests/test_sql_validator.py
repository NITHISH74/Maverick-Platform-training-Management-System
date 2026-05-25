"""Tests for the Copilot SQL safety validator."""

from app.utils.sql_validator import validate_sql


def test_rejects_delete() -> None:
    ok, reason = validate_sql("DELETE FROM batches WHERE id = 1")
    assert ok is False
    assert "SELECT" in reason or "DELETE" in reason


def test_rejects_drop() -> None:
    ok, reason = validate_sql("DROP TABLE batches")
    assert ok is False
    assert "SELECT" in reason or "DROP" in reason


def test_rejects_update() -> None:
    # The leading keyword is UPDATE, so the "only SELECT" rule fires first.
    ok, reason = validate_sql("UPDATE batches SET status='done' WHERE id=1")
    assert ok is False


def test_rejects_unknown_table() -> None:
    ok, reason = validate_sql("SELECT * FROM secret_payroll")
    assert ok is False
    assert "secret_payroll" in reason


def test_accepts_valid_select() -> None:
    ok, reason = validate_sql("SELECT id, name FROM batches WHERE status = 'running' LIMIT 100")
    assert ok is True, f"expected accept, got: {reason!r}"
    assert reason == ""


def test_accepts_join_on_whitelisted_tables() -> None:
    sql = (
        "SELECT b.name, AVG(CASE WHEN a.present THEN 1.0 ELSE 0 END) * 100 AS pct "
        "FROM batches b JOIN attendance a ON a.batch_id = b.id "
        "WHERE a.date >= NOW() - INTERVAL '7 days' "
        "GROUP BY b.name LIMIT 100"
    )
    ok, reason = validate_sql(sql)
    assert ok is True, f"expected accept, got: {reason!r}"
