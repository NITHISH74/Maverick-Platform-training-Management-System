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
