from fastapi import APIRouter, HTTPException
from langchain_core.output_parsers import JsonOutputParser

from app.schemas import NotifIn, NotifOut
from app.ai.gemini import get_llm
from app.ai.prompts import NOTIFICATION_PROMPT, TONE_MAP

router = APIRouter()


@router.post("/generate", response_model=NotifOut)
async def generate(p: NotifIn):
    try:
        llm = get_llm(0.3)
        out = await (NOTIFICATION_PROMPT | llm | JsonOutputParser()).ainvoke({
            "tone":    TONE_MAP[p.urgency_level],
            "type":    p.type,
            "name":    p.recipient_name,
            "context": p.context,
            "urgency": p.urgency_level,
        })
        return out
    except Exception as e:
        # graceful — caller (Node email service) falls back to static templates
        raise HTTPException(502, f"LLM unavailable: {e}")
