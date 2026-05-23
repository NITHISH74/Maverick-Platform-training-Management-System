from fastapi import APIRouter, HTTPException

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


@router.post("/query", response_model=ChatOut)
async def query(p: ChatIn):
    sb = get_supabase()

    # 1. Authorize: derive batch list if not provided.
    if not p.batch_ids:
        rs = sb.table("batches").select("id").eq("coordinator_id", p.coordinator_id).execute()
        p.batch_ids = [r["id"] for r in (rs.data or [])]
    if not p.batch_ids:
        return ChatOut(sql_generated="", result=[], summary="You have no batches assigned.")

    ctx = await rag_context(p.question)
    llm = get_llm(0.0)

    sql_msg = await (CHATBOT_SQL_PROMPT | llm).ainvoke({
        "schema":  SCHEMA_CARD,
        "ids":     ",".join(map(str, p.batch_ids)),
        "context": ctx,
        "q":       p.question,
    })
    sql = sql_msg.content.strip()
    # strip Markdown code fences if model added them
    for prefix in ("```sql", "```SQL", "```"):
        if sql.startswith(prefix):
            sql = sql[len(prefix):].lstrip()
    if sql.endswith("```"):
        sql = sql[:-3].rstrip()

    try:
        validate_select_only(sql, allowed_batch_ids=p.batch_ids)
    except ValueError as e:
        raise HTTPException(400, f"Unsafe SQL: {e}")

    try:
        rs = sb.rpc("execute_safe_select", {"q": sql}).execute()
        rows = rs.data or []
    except Exception as e:
        return ChatOut(sql_generated=sql, result=[], summary=f"I couldn't answer that. ({e})")

    summary_msg = await (CHATBOT_SUMMARY_PROMPT | llm).ainvoke({"q": p.question, "rows": rows[:20]})
    return ChatOut(sql_generated=sql, result=rows, summary=summary_msg.content)
