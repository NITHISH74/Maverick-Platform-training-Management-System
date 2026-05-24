from crewai import Agent, LLM

from app.config import settings
from app.crew.tools import (
    ScanBatchesTool,
    WriteEventTool,
    CreateCoordinatorTaskTool,
    SendAINotificationTool,
    HistoricalLookupTool,
)

# CrewAI 0.80 uses LiteLLM under the hood. Passing a raw LangChain LLM here
# causes litellm to fail with "Failed to get supported params: ... NoneType".
# Use CrewAI's native LLM wrapper with the LiteLLM-style model identifier.
# LiteLLM Azure OpenAI format: model="azure/<deployment>" with api_base/api_version.
llm = LLM(
    model=f"azure/{settings.AZURE_OPENAI_DEPLOYMENT}",
    api_key=settings.AZURE_OPENAI_API_KEY,
    base_url=settings.AZURE_OPENAI_ENDPOINT,
    api_version=settings.AZURE_OPENAI_API_VERSION,
    temperature=0.2,
)

batch_scanner = Agent(
    role="Data Analyst",
    goal="Identify every active batch's health issues today.",
    backstory=(
        "You are a meticulous training operations data analyst. "
        "You inspect every running batch and surface measurable problems. "
        "You never speculate — you only report what the data shows."
    ),
    tools=[ScanBatchesTool()],
    llm=llm,
    allow_delegation=False,
    verbose=settings.AGENT_VERBOSE,
    max_iter=3,
)

risk_scorer = Agent(
    role="Risk Analyst",
    goal="Classify each issue's severity and determine the right action.",
    backstory=(
        "You apply policy thresholds and prior context to score each issue. "
        "You explain your reasoning concisely in one sentence per item. "
        "You consider historical events to avoid alert fatigue."
    ),
    tools=[HistoricalLookupTool()],
    llm=llm,
    allow_delegation=False,
    verbose=settings.AGENT_VERBOSE,
    max_iter=3,
)

action_executor = Agent(
    role="Operations Manager",
    goal="Carry out the action plan: notifications, tasks, and audit logging.",
    backstory=(
        "You operate the platform on behalf of the coordinator. "
        "You are decisive but never duplicate work — you check idempotency before acting. "
        "Every action you take is logged for governance."
    ),
    tools=[SendAINotificationTool(), CreateCoordinatorTaskTool(), WriteEventTool()],
    llm=llm,
    allow_delegation=False,
    verbose=settings.AGENT_VERBOSE,
    max_iter=3,
)

reporter = Agent(
    role="Communicator",
    goal="Produce a plain-English digest of today's monitoring run.",
    backstory="You translate raw telemetry into a 4-sentence executive summary.",
    tools=[WriteEventTool()],
    llm=llm,
    allow_delegation=False,
    verbose=settings.AGENT_VERBOSE,
    max_iter=2,
)
