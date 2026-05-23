from pydantic_settings import BaseSettings
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient


class Settings(BaseSettings):
    ENV: str = "development"
    AGENT_VERBOSE: bool = False

    KEY_VAULT_URL: str = ""
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    EMBEDDING_MODEL: str = "text-embedding-004"
    HF_LLAMA_ENDPOINT: str = ""
    HF_LLAMA_TOKEN: str = ""
    INTERNAL_SHARED_SECRET: str = "change-me"
    NODE_API_URL: str = "http://localhost:8080"
    SENTRY_DSN: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


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
            "gemini-api-key": "GEMINI_API_KEY",
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
