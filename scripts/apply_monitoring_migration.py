"""One-shot helper to apply lib/db/migrations/0003_batch_monitoring_agent.sql.

Usage:
  python scripts/apply_monitoring_migration.py
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

    sql_path = repo_root / "lib" / "db" / "migrations" / "0003_batch_monitoring_agent.sql"
    sql = sql_path.read_text(encoding="utf-8")

    import psycopg2

    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            # Verify the three new tables, the view, and the helper functions
            # all landed. Print one line per object so a CI / dev log shows
            # exactly what changed.
            for obj in (
                "public.monitoring_alerts",
                "public.monitoring_email_log",
                "public.monitoring_config",
                "public.batch_risk_summary",
            ):
                cur.execute("SELECT to_regclass(%s)", (obj,))
                row = cur.fetchone()
                print(f"{obj} =>", row[0] if row else None)
            for fn in (
                "batch_attendance_drop_pct",
                "candidate_attendance_pct",
                "batch_candidates_below_attendance",
                "batch_candidates_low_assessment",
                "batch_trainer_emails",
            ):
                cur.execute(
                    "SELECT 1 FROM pg_proc WHERE proname = %s LIMIT 1",
                    (fn,),
                )
                print(f"function {fn} =>", "ok" if cur.fetchone() else "MISSING")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
