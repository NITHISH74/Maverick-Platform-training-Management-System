from crewai import Task
from app.crew.agents import batch_scanner, risk_scorer, action_executor, reporter

scan_task = Task(
    description=(
        "Use scan_batches(status='running') to fetch all active batches with their health metrics. "
        "Return a JSON array of issues with shape:\n"
        '[{"batch_id":int,"batch_code":str,"coordinator_id":int|null,'
        '"candidate_id":int|null,"issue_type":str,"detail":obj}]\n'
        "Detect these issue_types from each batch:\n"
        "  - attendance_not_uploaded  (attendance_uploaded_today=false)\n"
        "  - absence_3_days           (one item per candidate in absent_3plus)\n"
        "  - low_attendance_pct       (attendance_pct < attendance_threshold_pct)\n"
        "  - low_clearance_rate       (clearance_pct < clearance_threshold_pct)\n"
        "  - assessment_overdue       (one item per row in overdue_assessments)\n"
        "Return ONLY the JSON array (no prose, no code fences)."
    ),
    expected_output="Valid JSON array of issue objects.",
    agent=batch_scanner,
)

risk_task = Task(
    description=(
        "Receive the issue array from the scanner. For each unique batch_id call "
        "historical_batch_data(batch_id) ONCE and cache the result mentally. For each issue:\n"
        "  1. Assign severity by rule:\n"
        "     - attendance_not_uploaded → MEDIUM (no prior in last 24h) / HIGH (repeat)\n"
        "     - absence_3_days          → HIGH\n"
        "     - low_attendance_pct      → HIGH\n"
        "     - low_clearance_rate      → CRITICAL\n"
        "     - assessment_overdue      → MEDIUM\n"
        "  2. Map severity → action: LOW/MEDIUM→reminder, HIGH→escalation, CRITICAL→coordinator_task\n"
        "  3. Generate a one-sentence llm_rationale.\n"
        "If an identical event was already actioned in the last 30 minutes, set action='no_action'.\n"
        'Return JSON array of:'
        ' {"batch_id","candidate_id","issue_type","severity","action","rationale","coordinator_id"}'
    ),
    expected_output="JSON array of enriched action items.",
    agent=risk_scorer,
    context=[scan_task],
)

execute_task = Task(
    description=(
        "Receive the action plan. Use the run_id from the inputs ({run_id}).\n"
        "For each item, execute in this order:\n"
        " 1. If action='no_action' → write_agent_event with action_taken='no_action' and continue.\n"
        " 2. If action='reminder' → send_ai_notification with type=issue_type,\n"
        "    urgency_level=1 (LOW) or 2 (MEDIUM).\n"
        " 3. If action='escalation' → send_ai_notification urgency_level=3, cc coordinator email.\n"
        " 4. If action='coordinator_task' → create_coordinator_task AND send_ai_notification urgency=3.\n"
        " 5. AFTER EVERY item: write_agent_event with full payload:\n"
        "    {run_id, batch_id, candidate_id, issue_type, severity, action_taken,\n"
        "     agent_name:'ActionExecutor', llm_rationale, payload:{...}}.\n"
        "If a notification call fails, set action_taken='reminder_failed' and continue.\n"
        'Return JSON: {"actions_taken":int, "failures":int}'
    ),
    expected_output="JSON execution summary.",
    agent=action_executor,
    context=[risk_task],
)

report_task = Task(
    description=(
        "Produce a 3-5 sentence plain-English digest describing today's run: "
        "how many batches were scanned, how many issues, what actions were taken, "
        "and which batches were all-clear. Return the digest text only — "
        "no JSON, no preamble."
    ),
    expected_output="Plain English digest string.",
    agent=reporter,
    context=[execute_task],
)
