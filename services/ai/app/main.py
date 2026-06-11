from fastapi import FastAPI, Depends, Header, HTTPException
import sentry_sdk

from app.config import settings, load_secrets

load_secrets()

if settings.SENTRY_DSN:
    sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.2)

# Note: `chatbot` was merged into `copilot` (see app/routers/copilot.py).
# Its RAG helper was ported over; the legacy file is kept on disk for
# reference but no longer registered.
from app.routers import feedback, notifications, agent, copilot, trainer_scoring, feedback_intelligence, reports_pdf  # noqa: E402

app = FastAPI(title="Maverick AI Service", version="1.0")


def verify_internal(x_internal_token: str | None = Header(default=None)):
    # Missing header → 401 (not the FastAPI default 422 for missing dep).
    # This matches the Copilot spec's "expect 401 without header" tests and
    # is the correct status for a missing auth credential.
    if not x_internal_token or x_internal_token != settings.INTERNAL_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="invalid internal token")


app.include_router(
    feedback.router,
    prefix="/ai/feedback",
    tags=["feedback"],
    dependencies=[Depends(verify_internal)],
)
app.include_router(
    notifications.router,
    prefix="/ai/notifications",
    tags=["notifications"],
    dependencies=[Depends(verify_internal)],
)
app.include_router(
    agent.router,
    prefix="/ai/agent",
    tags=["agent"],
    dependencies=[Depends(verify_internal)],
)
# Coordinator Copilot — NL→SQL over the platform schema. Prefix is /copilot
# (not /ai/copilot) per the feature spec.
app.include_router(
    copilot.router,
    prefix="/copilot",
    tags=["copilot"],
    dependencies=[Depends(verify_internal)],
)
# AI Trainer Scoring Engine — POST /trainer-scoring/score and
# GET /trainer-scoring/score/{trainer_id}/{batch_id}.
app.include_router(
    trainer_scoring.router,
    prefix="/trainer-scoring",
    tags=["trainer-scoring"],
    dependencies=[Depends(verify_internal)],
)
# Feedback Intelligence Engine (F3) — POST /feedback-intelligence/analyze and
# GET /feedback-intelligence/analysis/{batch_id}.
app.include_router(
    feedback_intelligence.router,
    prefix="/feedback-intelligence",
    tags=["feedback-intelligence"],
    dependencies=[Depends(verify_internal)],
)
# AI PDF reports — POST /reports/pdf. The Node side fetches rows from
# Postgres (exact same query path as the CSV endpoints), forwards them here,
# and we narrate + render. Keeps this service stateless w.r.t. the DB.
app.include_router(
    reports_pdf.router,
    prefix="/reports",
    tags=["reports-pdf"],
    dependencies=[Depends(verify_internal)],
)


@app.get("/healthz")
def health():
    return {"ok": True, "env": settings.ENV}


@app.get("/")
def root():
    """Friendly landing page so visiting http://localhost:9000/ doesn't
    return `{"detail":"Not Found"}`. All real endpoints live under /ai/*."""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(
        """<!doctype html><html><head><title>Maverick AI Service</title></head>
        <body style="font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;">
        <h1>Maverick AI Service</h1>
        <p>FastAPI service for the 4 AI features. All routes require header
        <code>x-internal-token</code>.</p>
        <ul>
          <li><a href="/healthz">GET /healthz</a> — health check (no auth)</li>
          <li><a href="/docs">GET /docs</a> — interactive OpenAPI docs</li>
          <li><code>POST /ai/feedback/analyze</code></li>
          <li><code>POST /ai/notifications/generate</code></li>
          <li><code>POST /ai/chatbot/query</code></li>
          <li><code>POST /ai/agent/run</code> · <code>GET /ai/agent/tasks</code> · <code>GET /ai/agent/digest</code></li>
        </ul>
        </body></html>"""
    )
