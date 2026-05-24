from fastapi import FastAPI, Depends, Header, HTTPException
import sentry_sdk

from app.config import settings, load_secrets

load_secrets()

if settings.SENTRY_DSN:
    sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.2)

from app.routers import feedback, notifications, chatbot, agent  # noqa: E402

app = FastAPI(title="Maverick AI Service", version="1.0")


def verify_internal(x_internal_token: str = Header(...)):
    if x_internal_token != settings.INTERNAL_SHARED_SECRET:
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
    chatbot.router,
    prefix="/ai/chatbot",
    tags=["chatbot"],
    dependencies=[Depends(verify_internal)],
)
app.include_router(
    agent.router,
    prefix="/ai/agent",
    tags=["agent"],
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
