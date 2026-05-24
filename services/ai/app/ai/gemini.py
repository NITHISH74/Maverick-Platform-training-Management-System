"""Azure OpenAI LLM + embeddings client.

Module is named `gemini.py` for historical reasons (the project originally
used Google Gemini). All callers import `get_llm` / `get_embeddings` from
here — keeping the filename avoids churning every router. The implementation
is Azure OpenAI GPT-4.1.
"""

from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings
from app.config import settings


def get_llm(temperature: float = 0.2) -> AzureChatOpenAI:
    return AzureChatOpenAI(
        azure_deployment=settings.AZURE_OPENAI_DEPLOYMENT,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version=settings.AZURE_OPENAI_API_VERSION,
        temperature=temperature,
        max_retries=2,
        timeout=30,
    )


def get_embeddings() -> AzureOpenAIEmbeddings:
    return AzureOpenAIEmbeddings(
        azure_deployment=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
        api_key=settings.AZURE_OPENAI_API_KEY,
        api_version=settings.AZURE_OPENAI_API_VERSION,
    )
