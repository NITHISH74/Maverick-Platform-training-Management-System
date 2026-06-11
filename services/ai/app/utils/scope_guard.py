"""Batch-scope enforcement for the Coordinator Copilot.

Lives in `utils/` (alongside `sql_validator.py`) instead of inside the router
module so it has no heavy imports — the test suite can import these pure
functions without pulling in psycopg2 / langchain.

The DB-backed half (`_resolve_batch_scope` in `routers/copilot.py`) still
lives in the router because it needs the connection helper. These two
functions are the *enforcement* half: given the SQL the LLM produced and the
list of batch_ids the caller is allowed to touch, can the SQL run?
"""

from __future__ import annotations

import re


# Tables that contain per-batch data. Any SELECT touching these for a non-admin
# caller MUST be scoped to an allowed batch_id. `batches` itself is included so
# `SELECT * FROM batches` does not leak the list of batches outside the
# caller's scope.
SCOPED_TABLES: tuple[str, ...] = (
    "attendance", "candidates", "assessments", "feedback", "batches",
)

# Pull every integer literal that is being compared to a batch_id column,
# whether via `=` or `IN (..)`. Matches `batch_id` and `batches.id`; alias
# forms like `b.id` are intentionally NOT matched (we can't safely map the
# alias without a real parser), so those queries fall through to the
# "no batch_id literal" branch and are rejected for non-admins.
_BATCH_ID_LITERAL_RE = re.compile(
    r"(?:\bbatch_id\b|\bbatches\.id\b)\s*"
    r"(?:=\s*(\d+)|IN\s*\(\s*([\d,\s]+?)\s*\))",
    re.IGNORECASE,
)


def extract_batch_ids_from_sql(sql: str) -> list[int]:
    """Return every integer literal compared to a batch_id column in `sql`."""
    out: list[int] = []
    for m in _BATCH_ID_LITERAL_RE.finditer(sql):
        eq_val, in_list = m.group(1), m.group(2)
        if eq_val is not None:
            out.append(int(eq_val))
        elif in_list is not None:
            for tok in re.split(r"\s*,\s*", in_list):
                tok = tok.strip()
                if tok.isdigit():
                    out.append(int(tok))
    return out


def enforce_scope_in_sql(
    sql: str, allowed: list[int] | None,
) -> tuple[bool, str, list[int]]:
    """Belt-and-braces scope check. Returns ``(ok, reason, denied_batch_ids)``.

    * ``allowed is None`` → admin, no restriction.
    * ``allowed == []``   → explicit deny when SQL touches scoped tables.
    * Otherwise the SQL must reference batch_id literals AND every literal
      referenced must be in the allowed list. Substring matching (the
      original bug) is unsafe — e.g. ``allowed=[1]`` must NOT permit
      ``batch_id = 12`` just because '1' appears in '12'.
    """
    if allowed is None:
        return True, "", []
    lower = sql.lower()
    touches_scoped = any(re.search(rf"\b{t}\b", lower) for t in SCOPED_TABLES)
    if not touches_scoped:
        return True, "", []
    if not allowed:
        return False, "caller has no batch access", []

    referenced = extract_batch_ids_from_sql(sql)
    allowed_set = set(allowed)
    denied = sorted({b for b in referenced if b not in allowed_set})
    if denied:
        return (
            False,
            f"query references batch_id(s) outside the caller's scope: {denied}",
            denied,
        )
    if not referenced:
        return False, "query must scope by an allowed batch_id literal", []
    return True, "", []
