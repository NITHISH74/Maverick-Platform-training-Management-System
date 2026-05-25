"""SQL safety validator for the Coordinator Copilot.

Deviation note: an older guard already exists at `app/ai/sql_guard.py`
(`validate_select_only`) — that one is used by the existing chatbot and adds
batch-scope enforcement. The Copilot has different rules (table whitelist,
no batch-scope requirement, plain SELECT only), so we keep a separate
validator here per spec.
"""

from __future__ import annotations

import re

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

# Tables the Copilot is allowed to read. Anything else => reject.
ALLOWED_TABLES: set[str] = {
    "batches",
    "candidates",
    "attendance",
    "assessments",
    "feedback",
    "audit_logs",
    "users",
}

# Statements / keywords that may NEVER appear. Matched as whole words
# (case-insensitive) so e.g. a column called `updated_at` is fine but the
# `UPDATE` keyword is rejected.
FORBIDDEN_KEYWORDS: tuple[str, ...] = (
    "DROP",
    "DELETE",
    "UPDATE",
    "INSERT",
    "TRUNCATE",
    "ALTER",
    "CREATE",
    "EXEC",
    "EXECUTE",
)

# Hard execution timeout (seconds). Enforced by the router when running
# the SQL; exposed here so callers don't have to re-define the constant.
EXECUTION_TIMEOUT_SECONDS: int = 5

# Match identifiers that appear after FROM / JOIN. Captures the table name
# (optionally schema-qualified). The router-side whitelist check then strips
# any schema prefix before comparing.
_TABLE_REF_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w\.]*)",
    re.IGNORECASE,
)


# ----------------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------------


def validate_sql(sql: str) -> tuple[bool, str]:
    """Validate a SQL string for the Copilot's safety rules.

    Returns ``(True, "")`` if the SQL is safe to execute, otherwise
    ``(False, reason)`` where ``reason`` is a short human-readable message.
    """

    if not isinstance(sql, str) or not sql.strip():
        return False, "empty sql"

    stripped = sql.strip().rstrip(";").strip()

    # Rule 1 — must start with SELECT (case-insensitive).
    if not stripped[:6].upper().startswith("SELECT"):
        return False, "only SELECT statements are allowed"

    upper = stripped.upper()

    # Rule 2 — block dangerous keywords as whole words.
    for kw in FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{kw}\b", upper):
            return False, f"forbidden keyword: {kw}"

    # Rule 3 — semicolon in the middle => multi-statement attempt.
    # (We already stripped one trailing ';' above.)
    if ";" in stripped:
        return False, "multi-statement SQL is not allowed"

    # Rule 4 — every referenced table must be in the whitelist. We parse
    # identifiers that follow FROM / JOIN. Schema-qualified names like
    # `public.batches` are accepted as long as the final segment is allowed.
    for raw in _TABLE_REF_RE.findall(stripped):
        table = raw.split(".")[-1].lower()
        if table not in ALLOWED_TABLES:
            return False, f"table not allowed: {table}"

    return True, ""
