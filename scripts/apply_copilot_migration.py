"""One-shot helper to apply lib/db/migrations/0002_copilot_usage.sql.

Usage:
  python scripts/apply_copilot_migration.py
Requires DATABASE_URL in the environment (loaded from .env if present).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def load_dotenv_file(p: Path) -> None:
    if not p.exists():
        return
    for raw in p.read_text(encoding="utf-8").splitlines():
        if not raw or raw.lstrip().startswith("#") or "=" not in raw:
            continue
        k, v = raw.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv_file(repo_root / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    sql_path = repo_root / "lib" / "db" / "migrations" / "0002_copilot_usage.sql"
    sql = sql_path.read_text(encoding="utf-8")

    import psycopg2

    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute("SELECT to_regclass('public.copilot_usage')")
            row = cur.fetchone()
            print("copilot_usage =>", row[0] if row else None)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
