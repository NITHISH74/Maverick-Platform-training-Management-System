from pydantic_settings import BaseSettings
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient


class Settings(BaseSettings):
    ENV: str = "development"
    AGENT_VERBOSE: bool = False

    KEY_VAULT_URL: str = ""
    DATABASE_URL: str = ""  # used by app/routers/copilot.py
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    # Azure OpenAI
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = "gpt-4.1"
    AZURE_OPENAI_API_VERSION: str = "2024-12-01-preview"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: str = "text-embedding-ada-002"
    HF_LLAMA_ENDPOINT: str = ""
    HF_LLAMA_TOKEN: str = ""
    INTERNAL_SHARED_SECRET: str = "change-me"
    NODE_API_URL: str = "http://localhost:8080"
    SENTRY_DSN: str = ""
    # Optional / informational — read by external tooling, not the app itself.
    SUPABASE_ANON_KEY: str = ""
    SUPABASE_DB_PASSWORD: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()


def load_secrets() -> None:
    """Hydrate settings from Azure Key Vault when KEY_VAULT_URL is set."""
    if not settings.KEY_VAULT_URL:
        return
    try:
        client = SecretClient(vault_url=settings.KEY_VAULT_URL, credential=DefaultAzureCredential())
        mapping = {
            "supabase-url": "SUPABASE_URL",
            "supabase-service-key": "SUPABASE_SERVICE_KEY",
            "azure-openai-endpoint": "AZURE_OPENAI_ENDPOINT",
            "azure-openai-api-key": "AZURE_OPENAI_API_KEY",
            "azure-openai-deployment": "AZURE_OPENAI_DEPLOYMENT",
            "azure-openai-api-version": "AZURE_OPENAI_API_VERSION",
            "azure-openai-embedding-deployment": "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
            "hf-llama-endpoint": "HF_LLAMA_ENDPOINT",
            "hf-llama-token": "HF_LLAMA_TOKEN",
            "internal-shared-secret": "INTERNAL_SHARED_SECRET",
            "sentry-dsn": "SENTRY_DSN",
        }
        for name, attr in mapping.items():
            try:
                s = client.get_secret(name)
                if s.value:
                    setattr(settings, attr, s.value)
            except Exception:
                pass
    except Exception as e:
        print(f"[config] Key Vault hydration skipped: {e}")
