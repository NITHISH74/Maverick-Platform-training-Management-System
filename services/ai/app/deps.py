from supabase import create_client, Client
from app.config import settings

_supabase: Client | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    return _supabase


# convenience alias
supabase = get_supabase() if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY else None
