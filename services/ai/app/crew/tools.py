import datetime as dt
import json
from typing import Type

import requests
from pydantic import BaseModel, Field
from crewai.tools import BaseTool

from app.config import settings
from app.deps import get_supabase


class _NoArgs(BaseModel):
    pass


class BatchQueryArgs(BaseModel):
    status: str = Field(default="running")


class ScanBatchesTool(BaseTool):
    name: str = "scan_batches"
    description: str = "Returns running batches with derived health metrics."
    args_schema: Type[BaseModel] = BatchQueryArgs

    def _run(self, status: str = "running") -> str:
        sb = get_supabase()
        today = dt.date.today().isoformat()
        batches = (sb.table("batches").select("*").eq("status", status).execute()).data or []
        report = []
        for b in batches:
            bid = b["id"]
            att_today = (sb.table("attendance")
                         .select("id", count="exact")
                         .eq("batch_id", bid).eq("attend_date", today).execute())
            uploaded_today = (att_today.count or 0) > 0

            absent_3 = sb.rpc("absent_3plus_days", {"b_id": bid}).execute().data or []
            att_pct = sb.rpc("batch_attendance_pct", {"b_id": bid, "lookback_days": 14}).execute().data or 100
            clr_pct = sb.rpc("batch_clearance_rate", {"b_id": bid}).execute().data or 100

            overdue = (sb.table("assessments")
                       .select("id,title,scheduled_date")
                       .eq("batch_id", bid).is_("uploaded_date", "null")
                       .lt("scheduled_date", today).execute().data or [])

            report.append({
                "batch_id": bid,
                "batch_code": b["batch_code"],
                "coordinator_id": b.get("coordinator_id"),
                "attendance_uploaded_today": uploaded_today,
                "absent_3plus": absent_3,
                "attendance_pct": float(att_pct or 100),
                "clearance_pct": float(clr_pct or 100),
                "overdue_assessments": overdue,
                "attendance_threshold_pct": float(b.get("attendance_threshold_pct") or 75),
                "clearance_threshold_pct": float(b.get("clearance_threshold_pct") or 60),
            })
        return json.dumps(report)


class WriteEventArgs(BaseModel):
    payload: str  # JSON string


class WriteEventTool(BaseTool):
    name: str = "write_agent_event"
    description: str = "Logs an agent_events row. Pass a JSON string."
    args_schema: Type[BaseModel] = WriteEventArgs

    def _run(self, payload: str) -> str:
        try:
            d = json.loads(payload)
            get_supabase().table("agent_events").insert(d).execute()
            return "ok"
        except Exception as e:
            if "uniq_agent_event_window" in str(e):
                return "skipped-duplicate"
            return f"error:{e}"


class CreateTaskArgs(BaseModel):
    payload: str


class CreateCoordinatorTaskTool(BaseTool):
    name: str = "create_coordinator_task"
    description: str = "Creates a coordinator task. Pass JSON string."
    args_schema: Type[BaseModel] = CreateTaskArgs

    def _run(self, payload: str) -> str:
        try:
            d = json.loads(payload)
            rs = get_supabase().table("agent_tasks").insert(d).execute()
            return json.dumps(rs.data[0]) if rs.data else "fail"
        except Exception as e:
            return f"error:{e}"


class SendNotifArgs(BaseModel):
    payload: str


class SendAINotificationTool(BaseTool):
    name: str = "send_ai_notification"
    description: str = "Calls Node /internal/email/send which generates and sends the email."
    args_schema: Type[BaseModel] = SendNotifArgs

    def _run(self, payload: str) -> str:
        try:
            d = json.loads(payload)
            r = requests.post(
                f"{settings.NODE_API_URL}/internal/email/send",
                headers={"x-internal-token": settings.INTERNAL_SHARED_SECRET},
                json=d, timeout=15,
            )
            r.raise_for_status()
            return "sent"
        except Exception as e:
            return f"failed:{e}"


class HistoricalLookupArgs(BaseModel):
    batch_id: int


class HistoricalLookupTool(BaseTool):
    name: str = "historical_batch_data"
    description: str = "Returns prior agent_events for a batch (last 7 days)."
    args_schema: Type[BaseModel] = HistoricalLookupArgs

    def _run(self, batch_id: int) -> str:
        cutoff = (dt.datetime.utcnow() - dt.timedelta(days=7)).isoformat()
        rs = (get_supabase().table("agent_events")
              .select("issue_type,severity,action_taken,created_at")
              .eq("batch_id", batch_id).gte("created_at", cutoff).execute())
        return json.dumps(rs.data or [])
