"""AI trainer scoring engine.

POST /trainer-scoring/score          generate (or regenerate) a score
GET  /trainer-scoring/score/{tid}/{bid}   read the most-recent cached score

Both endpoints are gated by the same `verify_internal` dependency the rest
of the FastAPI service uses (see app/main.py); we never accept user-bearer
tokens here — the Node API proxies in the user's identity.

Deviations from the original feature spec:
  * Spec said `ai-service/routers/trainer_scoring.py` — our convention is
    `services/ai/app/routers/<feature>.py`. Same shape, our path.
  * Spec used `uuid` for trainer/batch ids — our `users.id` and `batches.id`
    are integer. The request body accepts string ids and casts to int.
  * Spec's USER prompt referenced `feedback.content` / `sentiment`; our
    feedback table is `response_text` only. We feed `response_text` as
    content; sentiment is not surfaced.
"""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.ai.gemini import get_llm
from app.config import settings


router = APIRouter()


# ---------------------------------------------------------------------------
# DB helper — re-implement here (not imported from copilot.py) to keep the
# routers loosely coupled.
# ---------------------------------------------------------------------------


def _connect():
    url = settings.DATABASE_URL or os.environ.get("DATABASE_URL")
    if not url:
        raise HTTPException(500, "DATABASE_URL not configured")
    return psycopg2.connect(url, connect_timeout=5)


def _coerce_int(s: str | int | None) -> int | None:
    if s is None:
        return None
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class TrainerScoreIn(BaseModel):
    trainer_id: str
    batch_id: str


class TrainerScoreOut(BaseModel):
    id: str
    trainer_id: int
    batch_id: int
    attendance_score: float | None
    assessment_score: float | None
    feedback_score: float | None
    composite_score: float | None
    reasoning: str | None
    strengths: list[str]
    improvements: list[str]
    generated_at: str


# ---------------------------------------------------------------------------
# Data fetch — mirrors what the LLM prompt needs.
# ---------------------------------------------------------------------------


def _fetch_batch_metrics(tid: int, bid: int) -> dict[str, Any]:
    """Returns attendance %, assessment pass %, feedback samples for one batch."""
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 5000")

            # Avg attendance % across all candidates in this batch.
            cur.execute(
                """
                SELECT round(
                  100.0 * sum(case when status='present' then 1 else 0 end)::numeric
                  / nullif(count(*), 0),
                  2
                )
                FROM attendance
                WHERE batch_id = %s
                """,
                (bid,),
            )
            row = cur.fetchone()
            att_pct = float(row[0]) if row and row[0] is not None else 0.0

            # Avg assessment score % (pass-rate equivalent) for this batch.
            cur.execute(
                """
                SELECT round(avg(100.0 * score / nullif(max_score, 0)), 2)
                FROM assessments
                WHERE batch_id = %s
                """,
                (bid,),
            )
            row = cur.fetchone()
            assess_pct = float(row[0]) if row and row[0] is not None else 0.0

            # Feedback rows for this batch (response_text + rating).
            cur.execute(
                """
                SELECT response_text, rating, created_at
                FROM feedback
                WHERE batch_id = %s
                ORDER BY created_at DESC
                LIMIT 25
                """,
                (bid,),
            )
            feedback_rows = cur.fetchall()
            feedback_count = len(feedback_rows)
            feedback_samples = [
                (r[0] or "")[:100] for r in feedback_rows[:5] if r[0]
            ]

            # Sanity: trainer + batch exist
            cur.execute("SELECT 1 FROM users WHERE id = %s", (tid,))
            if cur.fetchone() is None:
                raise HTTPException(404, "trainer not found")
            cur.execute("SELECT 1 FROM batches WHERE id = %s", (bid,))
            if cur.fetchone() is None:
                raise HTTPException(404, "batch not found")

    return {
        "att_pct": att_pct,
        "assess_pct": assess_pct,
        "feedback_count": feedback_count,
        "feedback_samples": feedback_samples,
    }


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = (
    "You are an expert training program evaluator. Given data about a "
    "trainer's batch performance, generate a fair, evidence-based "
    "effectiveness score. Be concise and specific."
)


def build_user_prompt(m: dict[str, Any]) -> str:
    return (
        "Evaluate this trainer's performance for a batch:\n"
        f"- Attendance rate: {m['att_pct']}%\n"
        f"- Assessment pass rate: {m['assess_pct']}%\n"
        f"- Candidate feedback count: {m['feedback_count']}\n"
        f"- Feedback samples: {json.dumps(m['feedback_samples'])} "
        "(first 5, truncated to 100 chars each)\n\n"
        "Return ONLY a JSON object with no markdown:\n"
        "{\n"
        '  "attendance_score": 0-100,\n'
        '  "assessment_score": 0-100,\n'
        '  "feedback_score": 0-100,\n'
        '  "composite_score": 0-100,\n'
        '  "reasoning": "2-3 sentence explanation",\n'
        '  "strengths": ["strength 1", "strength 2"],\n'
        '  "improvements": ["improvement 1", "improvement 2"]\n'
        "}\n\n"
        "Scoring weights: attendance 30%, assessment 40%, feedback 30%."
    )


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    for prefix in ("```json", "```JSON", "```"):
        if s.startswith(prefix):
            s = s[len(prefix):].lstrip()
    if s.endswith("```"):
        s = s[:-3].rstrip()
    return s


# ---------------------------------------------------------------------------
# Audit logger — same shape as the Copilot router's _write_audit.
# ---------------------------------------------------------------------------


def _write_audit(*, actor_id: int | None, action: str, entity_id: int | None, details: dict[str, Any]) -> None:
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, details)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (action, "trainer_score", entity_id, actor_id, json.dumps(details)),
                )
    except Exception as e:
        print(f"[trainer_scoring] audit log failed: {e}")


# ---------------------------------------------------------------------------
# Score persistence
# ---------------------------------------------------------------------------


def _upsert_score(*, tid: int, bid: int, payload: dict[str, Any]) -> dict[str, Any]:
    """UPSERT into trainer_scores; returns the persisted row."""
    breakdown = {
        "strengths": payload.get("strengths") or [],
        "improvements": payload.get("improvements") or [],
    }
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO trainer_scores (
                  trainer_id, batch_id,
                  attendance_score, assessment_score, feedback_score, composite_score,
                  score_reasoning, score_breakdown, generated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (trainer_id, batch_id) DO UPDATE SET
                  attendance_score = EXCLUDED.attendance_score,
                  assessment_score = EXCLUDED.assessment_score,
                  feedback_score   = EXCLUDED.feedback_score,
                  composite_score  = EXCLUDED.composite_score,
                  score_reasoning  = EXCLUDED.score_reasoning,
                  score_breakdown  = EXCLUDED.score_breakdown,
                  generated_at     = now()
                RETURNING id::text, trainer_id, batch_id,
                          attendance_score, assessment_score, feedback_score, composite_score,
                          score_reasoning, score_breakdown, generated_at
                """,
                (
                    tid, bid,
                    payload.get("attendance_score"),
                    payload.get("assessment_score"),
                    payload.get("feedback_score"),
                    payload.get("composite_score"),
                    payload.get("reasoning"),
                    json.dumps(breakdown),
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(500, "upsert returned no row")
    return {
        "id": row[0],
        "trainer_id": row[1],
        "batch_id": row[2],
        "attendance_score": float(row[3]) if row[3] is not None else None,
        "assessment_score": float(row[4]) if row[4] is not None else None,
        "feedback_score": float(row[5]) if row[5] is not None else None,
        "composite_score": float(row[6]) if row[6] is not None else None,
        "reasoning": row[7],
        "strengths": (row[8] or {}).get("strengths", []) if row[8] else [],
        "improvements": (row[8] or {}).get("improvements", []) if row[8] else [],
        "generated_at": row[9].isoformat() if row[9] else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/score", response_model=TrainerScoreOut)
async def score(p: TrainerScoreIn):
    tid = _coerce_int(p.trainer_id)
    bid = _coerce_int(p.batch_id)
    if tid is None or bid is None:
        raise HTTPException(400, "trainer_id and batch_id must be integer-coercible")

    # 1. Fetch underlying metrics
    metrics = _fetch_batch_metrics(tid, bid)

    # 2. LLM call — GPT-4.1 (Azure deployment)
    llm = get_llm(0.1)
    msg = await llm.ainvoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(metrics)},
    ])
    raw = _strip_code_fence(str(msg.content))
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"model did not return JSON: {e}")

    # Normalize numeric fields — clamp to 0..100, allow None for missing.
    for key in ("attendance_score", "assessment_score", "feedback_score", "composite_score"):
        v = payload.get(key)
        if v is None:
            continue
        try:
            payload[key] = max(0.0, min(100.0, float(v)))
        except (TypeError, ValueError):
            payload[key] = None

    # 3. Upsert
    persisted = _upsert_score(tid=tid, bid=bid, payload=payload)

    # 4. Audit
    _write_audit(
        actor_id=None,  # actor identity arrives via Node proxy; we don't have it server-side here
        action="trainer_score.generated",
        entity_id=tid,
        details={
            "trainer_id": tid,
            "batch_id": bid,
            "composite_score": persisted["composite_score"],
            "metrics": {
                "att_pct": metrics["att_pct"],
                "assess_pct": metrics["assess_pct"],
                "feedback_count": metrics["feedback_count"],
            },
        },
    )

    return persisted


@router.get("/score/{trainer_id}/{batch_id}", response_model=TrainerScoreOut)
async def get_score(trainer_id: str, batch_id: str):
    tid = _coerce_int(trainer_id)
    bid = _coerce_int(batch_id)
    if tid is None or bid is None:
        raise HTTPException(400, "trainer_id and batch_id must be integer-coercible")

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, trainer_id, batch_id,
                       attendance_score, assessment_score, feedback_score, composite_score,
                       score_reasoning, score_breakdown, generated_at
                FROM trainer_scores
                WHERE trainer_id = %s AND batch_id = %s
                """,
                (tid, bid),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(404, "no score yet for this trainer+batch")

    return {
        "id": row[0],
        "trainer_id": row[1],
        "batch_id": row[2],
        "attendance_score": float(row[3]) if row[3] is not None else None,
        "assessment_score": float(row[4]) if row[4] is not None else None,
        "feedback_score": float(row[5]) if row[5] is not None else None,
        "composite_score": float(row[6]) if row[6] is not None else None,
        "reasoning": row[7],
        "strengths": (row[8] or {}).get("strengths", []) if row[8] else [],
        "improvements": (row[8] or {}).get("improvements", []) if row[8] else [],
        "generated_at": row[9].isoformat() if row[9] else None,
    }
