import datetime as dt
from fastapi import APIRouter, HTTPException

from app.schemas import RunIn
from app.deps import get_supabase

router = APIRouter()


@router.post("/run")
async def run(p: RunIn):
    # Lazy import so the FastAPI service boots even if CrewAI isn't installed
    # (e.g. dev/smoke-test environments without C++ build tools).
    try:
        from app.crew.runner import run_agent
    except ImportError as e:
        raise HTTPException(503, f"CrewAI not installed in this environment: {e}")
    return await run_agent(p.run_id, p.triggered_by, p.coordinator_id)


@router.get("/tasks")
def tasks(coordinator_id: int, status: str = "open"):
    sb = get_supabase()
    rs = (sb.table("agent_tasks")
          .select("*, batches(batch_code,name)")
          .eq("assigned_to_coordinator", coordinator_id)
          .eq("status", status)
          .order("created_at", desc=True)
          .execute())
    return {"items": rs.data or []}


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: dict):
    sb = get_supabase()
    if payload.get("status") in ("resolved", "dismissed") and "resolved_at" not in payload:
        payload["resolved_at"] = dt.datetime.utcnow().isoformat()
    rs = sb.table("agent_tasks").update(payload).eq("id", task_id).execute()
    return rs.data[0] if rs.data else {}


@router.get("/digest")
def digest(date: str = "today"):
    if date == "today":
        date = dt.date.today().isoformat()
    sb = get_supabase()
    rs = (sb.table("agent_daily_digest")
          .select("*").eq("run_date", date).maybe_single().execute())
    return rs.data or {}
