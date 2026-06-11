import json
import datetime as dt
from fastapi import APIRouter, HTTPException
from langchain_core.output_parsers import JsonOutputParser

from app.schemas import FeedbackIn, FeedbackOut
from app.ai.gemini import get_llm
from app.ai.prompts import FEEDBACK_THEMES_PROMPT, FEEDBACK_SCORE_PROMPT
from app.deps import get_supabase

router = APIRouter()


@router.post("/analyze", response_model=FeedbackOut)
async def analyze(payload: FeedbackIn):
    if not payload.responses:
        raise HTTPException(400, "responses must not be empty")

    llm = get_llm(0.1)
    parser = JsonOutputParser()
    joined = "\n".join(payload.responses)

    themes = await (FEEDBACK_THEMES_PROMPT | llm | parser).ainvoke({"responses": joined})
    result = await (FEEDBACK_SCORE_PROMPT | llm | parser).ainvoke({
        "themes": json.dumps(themes),
        "responses": joined,
    })

    sb = get_supabase()
    if sb:
        sb.table("feedback_analysis").insert({
            "batch_id": payload.batch_id,
            "analyzed_at": dt.datetime.utcnow().isoformat(),
            "sentiment_positive_pct": result["sentiment_distribution"]["positive"],
            "sentiment_neutral_pct":  result["sentiment_distribution"]["neutral"],
            "sentiment_negative_pct": result["sentiment_distribution"]["negative"],
            "top_complaints":         result["top_complaints"],
            "improvement_requests":   result["improvement_requests"],
            "quality_insights":       result["quality_insights"],
            "trainer_effectiveness_score": result["trainer_effectiveness_score"],
            "responses_analyzed":     len(payload.responses),
        }).execute()

    return result
