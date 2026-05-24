from supabase import create_client, Client
from app.config import settings

_supabase: Client | None = None


def get_supabase() -> Client | None:
    """Returns a Supabase client, or None if creds are missing/invalid.
    Lazy: only constructed on first real use so the service can boot in dev."""
    global _supabase
    if _supabase is not None:
        return _supabase
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_KEY:
        return None
    try:
        _supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    except Exception as e:
        print(f"[deps] Supabase client unavailable: {e}")
        return None
    return _supabase


supabase = None  # populated on first call to get_supabase()
