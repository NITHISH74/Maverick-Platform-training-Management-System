"""Apply lib/db/migrations/0006_dashboard_kpis_and_soft_delete.sql."""
from __future__ import annotations
import os, sys
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
    # services/ai/.env first — it has the real DATABASE_URL; the root .env
    # may be the scrubbed placeholder.
    load_dotenv_file(repo_root / "services" / "ai" / ".env")
    load_dotenv_file(repo_root / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    sql_path = repo_root / "lib" / "db" / "migrations" / "0006_dashboard_kpis_and_soft_delete.sql"
    sql = sql_path.read_text(encoding="utf-8")
    import psycopg2
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute("""
              SELECT column_name FROM information_schema.columns
                WHERE table_name='batches' AND column_name IN ('clearance_rate','deleted_at')
            """)
            print("batches new columns =>", [r[0] for r in cur.fetchall()])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
