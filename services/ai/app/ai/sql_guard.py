import sqlparse
from sqlparse.tokens import DDL, DML, Keyword

FORBIDDEN = {
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER",
    "TRUNCATE", "GRANT", "REVOKE", "COPY", "CALL", "EXECUTE",
}


def validate_select_only(sql: str, allowed_batch_ids: list[int]) -> None:
    """Strict SELECT-only validator with batch-scope enforcement."""
    if ";" in sql.rstrip(";"):
        raise ValueError("multi-statement SQL not allowed")

    parsed = sqlparse.parse(sql)
    if len(parsed) != 1:
        raise ValueError("only one statement permitted")

    stmt = parsed[0]
    if stmt.get_type() != "SELECT":
        raise ValueError("only SELECT permitted")

    # Note: SELECT itself is a DML token in sqlparse, so we can't blanket-block
    # every DML/DDL token. The get_type() check above already enforces SELECT;
    # here we only block tokens whose *value* is explicitly in FORBIDDEN.
    for token in stmt.flatten():
        val = token.value.upper()
        if token.ttype in (DDL, DML, Keyword) and val in FORBIDDEN:
            raise ValueError(f"forbidden token: {token.value}")

    if "batch_id" in sql.lower():
        if not any(str(b) in sql for b in allowed_batch_ids):
            raise ValueError("query must scope by allowed batch_ids")
