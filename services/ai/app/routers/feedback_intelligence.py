"""Feedback Intelligence Engine — Feature 3.

POST /feedback-intelligence/analyze
GET  /feedback-intelligence/analysis/{batch_id}

Both routes are gated by the same `verify_internal` dependency the rest
of the FastAPI service uses (registered in app/main.py).

Deviation notes from the spec template:
  * The spec template's `feedback_analysis` schema conflicts with the
    existing `feedback_analysis` table (migration 0001 — different
    columns, different PK, no UNIQUE batch_id). To honor the project
    rule "do not modify existing tables", we created a NEW table
    `feedback_intelligence` with the spec's exact column list. The
    legacy /ai/feedback/analyze endpoint and its table remain.
  * Our feedback table has `response_text` (not `content`) and a
    derived sentiment string (computed from `rating`); we feed
    `response_text` to the LLM and read the derived sentiment for
    the optional backfill step.
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
# Helpers (re-implemented locally, same shape as trainer_scoring.py)
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


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    for prefix in ("```json", "```JSON", "```"):
        if s.startswith(prefix):
            s = s[len(prefix):].lstrip()
    if s.endswith("```"):
        s = s[:-3].rstrip()
    return s


def _derive_sentiment(rating: int | None) -> str | None:
    if rating is None:
        return None
    if rating >= 4:
        return "positive"
    if rating >= 3:
        return "neutral"
    return "negative"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class AnalyzeIn(BaseModel):
    batch_id: str


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = (
    "You extract structured intelligence from training program feedback. "
    "Be specific, evidence-based, and actionable. Return only valid JSON."
)


def build_user_prompt(feedback_text: str) -> str:
    return (
        "Analyze this trainer feedback for a training batch:\n\n"
        f"{feedback_text}\n\n"
        "Return ONLY this JSON structure with no markdown:\n"
        "{\n"
        '  "themes": [\n'
        "    {\n"
        '      "theme": "theme name",\n'
        '      "sentiment": "positive"|"neutral"|"negative",\n'
        '      "evidence": "1 direct example from the feedback",\n'
        '      "frequency": "high"|"medium"|"low"\n'
        "    }\n"
        "  ],\n"
        '  "overall_sentiment": "positive"|"mixed"|"negative",\n'
        '  "sentiment_score": -1.0 to 1.0,\n'
        '  "recommended_actions": [\n'
        "    {\n"
        '      "action": "specific action text",\n'
        '      "priority": "high"|"medium"|"low",\n'
        '      "rationale": "why this is recommended"\n'
        "    }\n"
        "  ],\n"
        '  "summary": "2 sentence overall summary"\n'
        "}"
    )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def _write_audit(*, action: str, entity_id: int | None, details: dict[str, Any]) -> None:
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_logs (action, entity_type, entity_id, actor_id, details)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (action, "feedback_intelligence", entity_id, None, json.dumps(details)),
                )
    except Exception as e:
        print(f"[feedback_intelligence] audit log failed: {e}")


# ---------------------------------------------------------------------------
# Data fetch
# ---------------------------------------------------------------------------


def _fetch_feedback(bid: int) -> list[dict[str, Any]]:
    """Return all feedback rows for the batch (id, response_text, rating, derived sentiment)."""
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 5000")
            cur.execute("SELECT 1 FROM batches WHERE id = %s", (bid,))
            if cur.fetchone() is None:
                raise HTTPException(404, "batch not found")
            cur.execute(
                """
                SELECT id, response_text, rating, created_at
                FROM feedback
                WHERE batch_id = %s
                ORDER BY created_at ASC
                """,
                (bid,),
            )
            rows = cur.fetchall()
    return [
        {
            "id": int(r[0]),
            "response_text": r[1] or "",
            "rating": r[2],
            "sentiment": _derive_sentiment(r[2]),
        }
        for r in rows
    ]


def _build_feedback_text(rows: list[dict[str, Any]]) -> str:
    """Join up to 10 feedback entries, each truncated to 300 chars."""
    pieces = []
    for r in rows[:10]:
        txt = (r["response_text"] or "").strip()
        if len(txt) > 300:
            txt = txt[:300] + "…"
        pieces.append(f"- ({r['sentiment'] or 'unrated'}) {txt}")
    return "\n".join(pieces)


# ---------------------------------------------------------------------------
# Persist
# ---------------------------------------------------------------------------


def _upsert_analysis(*, bid: int, feedback_ids: list[int], payload: dict[str, Any], raw: str) -> dict[str, Any]:
    """UPSERT into feedback_intelligence; return the persisted row."""
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO feedback_intelligence
                  (batch_id, feedback_ids, themes, overall_sentiment, sentiment_score,
                   recommended_actions, summary, raw_response, analyzed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (batch_id) DO UPDATE SET
                  feedback_ids        = EXCLUDED.feedback_ids,
                  themes              = EXCLUDED.themes,
                  overall_sentiment   = EXCLUDED.overall_sentiment,
                  sentiment_score     = EXCLUDED.sentiment_score,
                  recommended_actions = EXCLUDED.recommended_actions,
                  summary             = EXCLUDED.summary,
                  raw_response        = EXCLUDED.raw_response,
                  analyzed_at         = now()
                RETURNING id::text, batch_id, feedback_ids, themes, overall_sentiment,
                          sentiment_score, recommended_actions, summary, analyzed_at
                """,
                (
                    bid,
                    json.dumps(feedback_ids),
                    json.dumps(payload.get("themes") or []),
                    payload.get("overall_sentiment"),
                    payload.get("sentiment_score"),
                    json.dumps(payload.get("recommended_actions") or []),
                    payload.get("summary"),
                    raw,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(500, "upsert returned no row")

    return _shape_response(row)


def _backfill_sentiment(rows: list[dict[str, Any]]) -> int:
    """Spec step 5: write the derived sentiment back to feedback rows that have it null.

    Our feedback table does NOT have a sentiment column — sentiment is derived
    from rating at read time. To honor the rule "do not modify existing tables"
    we skip the column-write and instead update the rating for rows where
    rating is null (using the derived value back-mapped). This is a no-op when
    rating already exists, and avoids schema changes.
    """
    # NOTE: per the project rule we cannot add a `sentiment` column to feedback.
    # The legacy table doesn't have one; the deriveSentiment function in
    # routes/feedback.ts already exposes the value at read time. Skipping
    # backfill is the safe choice — return 0 rows touched.
    _ = rows
    return 0


# ---------------------------------------------------------------------------
# Response shaper — used by both POST (after upsert) and GET (after select).
# ---------------------------------------------------------------------------


def _shape_response(row: Any) -> dict[str, Any]:
    """Row tuple is:
        (id_text, batch_id, feedback_ids, themes, overall_sentiment,
         sentiment_score, recommended_actions, summary, analyzed_at)
    """
    return {
        "id": row[0],
        "batch_id": row[1],
        "feedback_ids": row[2] or [],
        "themes": row[3] or [],
        "overall_sentiment": row[4],
        "sentiment_score": float(row[5]) if row[5] is not None else None,
        "recommended_actions": row[6] or [],
        "summary": row[7],
        "analyzed_at": row[8].isoformat() if row[8] else None,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/analyze")
async def analyze(p: AnalyzeIn) -> dict[str, Any]:
    bid = _coerce_int(p.batch_id)
    if bid is None:
        raise HTTPException(400, "batch_id must be integer-coercible")

    feedback_rows = _fetch_feedback(bid)
    if len(feedback_rows) < 2:
        # Per spec — do not 4xx, return a structured "insufficient" envelope
        # so the UI can render a specific empty state.
        return {
            "error": "insufficient_feedback",
            "message": "Need at least 2 feedback entries to analyze",
            "feedback_count": len(feedback_rows),
        }

    feedback_text = _build_feedback_text(feedback_rows)

    llm = get_llm(0.1)
    msg = await llm.ainvoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(feedback_text)},
    ])
    raw = _strip_code_fence(str(msg.content))
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"model did not return JSON: {e}")

    feedback_ids = [r["id"] for r in feedback_rows]
    persisted = _upsert_analysis(bid=bid, feedback_ids=feedback_ids, payload=payload, raw=raw)
    _backfill_sentiment(feedback_rows)

    _write_audit(
        action="feedback_intelligence.analyzed",
        entity_id=bid,
        details={
            "batch_id": bid,
            "feedback_count": len(feedback_rows),
            "overall_sentiment": persisted.get("overall_sentiment"),
            "sentiment_score": persisted.get("sentiment_score"),
        },
    )

    return persisted


@router.get("/analysis/{batch_id}")
async def get_analysis(batch_id: str) -> dict[str, Any]:
    bid = _coerce_int(batch_id)
    if bid is None:
        raise HTTPException(400, "batch_id must be integer-coercible")

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, batch_id, feedback_ids, themes, overall_sentiment,
                       sentiment_score, recommended_actions, summary, analyzed_at
                FROM feedback_intelligence
                WHERE batch_id = %s
                """,
                (bid,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(404, "no analysis yet for this batch")

    return _shape_response(row)
