import re
from fastapi import APIRouter

from app.schemas import ChatIn, ChatOut
from app.ai.gemini import get_llm, get_embeddings
from app.ai.prompts import SCHEMA_CARD, CHATBOT_SQL_PROMPT, CHATBOT_SUMMARY_PROMPT
from app.ai.sql_guard import validate_select_only
from app.deps import get_supabase

router = APIRouter()


async def rag_context(question: str) -> str:
    try:
        emb = get_embeddings().embed_query(question)
        rs = get_supabase().rpc("match_rag", {"query_embedding": emb, "match_count": 5}).execute()
        return "\n".join(d["content"] for d in (rs.data or []))
    except Exception:
        return ""


def _looks_like_sql(s: str) -> bool:
    """Return True if the model's response looks like a SELECT statement."""
    head = s.lstrip().lower()
    return head.startswith("select") or head.startswith("with")


def _is_rate_limit(err: Exception) -> bool:
    s = str(err)
    return (
        "RESOURCE_EXHAUSTED" in s
        or "quota" in s.lower()
        or "rate limit" in s.lower()
        or "429" in s
    )


@router.post("/query", response_model=ChatOut)
async def query(p: ChatIn):
    sb = get_supabase()

    # Derive batch list. Admins / fresh coordinators see all batches.
    if not p.batch_ids:
        rs = sb.table("batches").select("id").eq("coordinator_id", p.coordinator_id).execute()
        p.batch_ids = [r["id"] for r in (rs.data or [])]
    if not p.batch_ids:
        rs = sb.table("batches").select("id").execute()
        p.batch_ids = [r["id"] for r in (rs.data or [])]
    if not p.batch_ids:
        return ChatOut(sql_generated="", result=[], summary="No batches exist yet.")

    ctx = await rag_context(p.question)
    llm = get_llm(0.0)

    # Step 1: ask the model for SQL.
    try:
        sql_msg = await (CHATBOT_SQL_PROMPT | llm).ainvoke({
            "schema":  SCHEMA_CARD,
            "ids":     ",".join(map(str, p.batch_ids)),
            "context": ctx,
            "q":       p.question,
        })
    except Exception as e:
        if _is_rate_limit(e):
            return ChatOut(
                sql_generated="",
                result=[],
                summary=(
                    "The AI is rate-limited. "
                    "Please wait ~30 seconds and try again, or raise the Azure OpenAI deployment quota."
                ),
            )
        return ChatOut(sql_generated="", result=[], summary=f"AI error: {e}")

    sql = sql_msg.content.strip()
    # Strip Markdown code fences if model added them.
    for prefix in ("```sql", "```SQL", "```"):
        if sql.startswith(prefix):
            sql = sql[len(prefix):].lstrip()
    if sql.endswith("```"):
        sql = sql[:-3].rstrip()
    # Supabase `execute_safe_select` wraps the query in a sub-SELECT, so a
    # trailing semicolon breaks the syntax.
    sql = sql.rstrip().rstrip(";").rstrip()

    # If the model responded with prose (e.g. greeting), don't 400 — just
    # surface its text as the answer.
    if not _looks_like_sql(sql):
        # Trim any obvious "I can't do that" headers and just pass the prose.
        clean = re.sub(r"^(I cannot|Sorry,|I'm sorry,|Hi[!,]|Hello[!,])\s*", "", sql, flags=re.I)
        return ChatOut(
            sql_generated="",
            result=[],
            summary=clean or sql,
        )

    try:
        validate_select_only(sql, allowed_batch_ids=p.batch_ids)
    except ValueError as e:
        # Don't 400; return the message so the UI can show it.
        return ChatOut(
            sql_generated=sql,
            result=[],
            summary=f"I generated a query but it failed the safety check: {e}",
        )

    try:
        rs = sb.rpc("execute_safe_select", {"q": sql}).execute()
        rows = rs.data or []
    except Exception as e:
        return ChatOut(sql_generated=sql, result=[], summary=f"I couldn't answer that. ({e})")

    # Step 2: ask the model to summarise. If quota is exhausted, fall back
    # to a row-count summary so the user still sees data.
    try:
        summary_msg = await (CHATBOT_SUMMARY_PROMPT | llm).ainvoke({"q": p.question, "rows": rows[:20]})
        return ChatOut(sql_generated=sql, result=rows, summary=summary_msg.content)
    except Exception as e:
        if _is_rate_limit(e):
            return ChatOut(
                sql_generated=sql,
                result=rows,
                summary=(
                    f"Got {len(rows)} row(s). "
                    "(Couldn't render a natural-language summary — the AI is rate-limited, "
                    "see the SQL/results below.)"
                ),
            )
        return ChatOut(sql_generated=sql, result=rows, summary=f"Got {len(rows)} row(s). Summary error: {e}")
