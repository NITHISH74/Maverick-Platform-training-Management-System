from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict, Any


class FeedbackIn(BaseModel):
    batch_id: int
    responses: List[str]


class SentimentDist(BaseModel):
    positive: float
    neutral: float
    negative: float


class FeedbackOut(BaseModel):
    sentiment_distribution: SentimentDist
    top_complaints: List[str]
    improvement_requests: List[str]
    quality_insights: str
    trainer_effectiveness_score: float


class NotifIn(BaseModel):
    type: str
    recipient_name: str
    context: Dict[str, Any] = Field(default_factory=dict)
    urgency_level: Literal[1, 2, 3] = 1


class NotifOut(BaseModel):
    subject: str
    body: str


class ChatIn(BaseModel):
    question: str
    coordinator_id: int
    batch_ids: List[int] = Field(default_factory=list)


class ChatOut(BaseModel):
    sql_generated: str
    result: list
    summary: str


class RunIn(BaseModel):
    run_id: str
    triggered_by: Literal["cron", "manual"]
    coordinator_id: Optional[int] = None
