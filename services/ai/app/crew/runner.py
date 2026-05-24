import datetime as dt
import json
import uuid

from crewai import Crew, Process

from app.crew.tasks import scan_task, risk_task, execute_task, report_task
from app.crew.tools import ScanBatchesTool, WriteEventTool, SendAINotificationTool
from app.deps import get_supabase


def _coerce_uuid(run_id: str) -> str:
    """The agent_runs.id column is UUID. Accept any caller string but produce
    a deterministic UUID from it so callers can still pass human-readable IDs
    like 'run-20260524125937' without a 22P02 error."""
    try:
        uuid.UUID(run_id)
        return run_id
    except (ValueError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"maverick-run/{run_id}"))


async def run_agent(run_id: str, triggered_by: str, coordinator_id: int | None):
    run_id = _coerce_uuid(run_id)
    sb = get_supabase()
    if sb:
        sb.table("agent_runs").insert({
            "id": run_id, "triggered_by": triggered_by, "status": "running",
        }).execute()

    import os
    verbose_on = os.environ.get("AGENT_VERBOSE", "").lower() in ("1", "true", "yes")
    crew = Crew(
        agents=[scan_task.agent, risk_task.agent, execute_task.agent, report_task.agent],
        tasks=[scan_task, risk_task, execute_task, report_task],
        process=Process.sequential,
        # memory=True requires Chroma + OPENAI_API_KEY by default. We use Gemini,
        # and our tasks already pass context explicitly via `context=[...]` in
        # tasks.py, so cross-task state still flows correctly.
        memory=False,
        verbose=verbose_on,
        max_rpm=20,
    )

    try:
        result = crew.kickoff(inputs={"run_id": run_id})
        digest_text = str(result)

        counts = {"batches_scanned": 0, "issues_found": 0, "actions_taken": 0}
        if sb:
            agg = sb.rpc("agent_run_counts", {"r_id": run_id}).execute().data or {}
            counts.update({k: agg.get(k, 0) for k in counts})

            today = dt.date.today().isoformat()
            sb.table("agent_daily_digest").upsert({
                "run_date": today,
                "digest_text": digest_text,
                **counts,
            }, on_conflict="run_date").execute()

            sb.table("agent_runs").update({
                "completed_at": dt.datetime.utcnow().isoformat(),
                "status": "completed",
                **counts,
            }).eq("id", run_id).execute()

        return {"run_id": run_id, **counts, "digest": digest_text}

    except Exception as e:
        import traceback
        print("=" * 60, flush=True)
        print(f"[crew] kickoff failed: {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
        print("=" * 60, flush=True)
        if sb:
            sb.table("agent_runs").update({
                "completed_at": dt.datetime.utcnow().isoformat(),
                "status": "failed", "error_message": f"{type(e).__name__}: {e}",
            }).eq("id", run_id).execute()
        return await _fallback_rule_only(run_id, f"{type(e).__name__}: {e}")


async def _fallback_rule_only(run_id: str, err: str):
    """When the LLM fails, run scanner + hard-coded thresholds so the system still produces alerts."""
    scanner = ScanBatchesTool()
    write = WriteEventTool()
    issues = json.loads(scanner._run("running"))
    actions = 0
    for b in issues:
        if not b["attendance_uploaded_today"]:
            write._run(json.dumps({
                "run_id": run_id,
                "batch_id": b["batch_id"],
                "issue_type": "attendance_not_uploaded",
                "severity": "MEDIUM",
                "action_taken": "reminder",
                "agent_name": "Fallback",
                "llm_rationale": f"LLM down ({err[:60]}); rule-based reminder.",
            }))
            actions += 1
    return {
        "run_id": run_id,
        "batches_scanned": len(issues),
        "issues_found": actions,
        "actions_taken": actions,
        "digest": f"Fallback rule-only run due to LLM error: {err[:120]}",
    }
