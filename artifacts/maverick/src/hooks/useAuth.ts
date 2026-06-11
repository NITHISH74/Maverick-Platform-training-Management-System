import { useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { setAuthTokenGetter, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

const TOKEN_STORAGE_KEY = "maverick_token";

// Install once; reads the Base64 API token from localStorage on every request.
let tokenGetterInstalled = false;
function installTokenGetter() {
  if (tokenGetterInstalled) return;
  setAuthTokenGetter(() => {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  tokenGetterInstalled = true;
}

async function exchangeAuth0Token(
  auth0Token: string,
  profile: { email?: string; name?: string },
): Promise<string | null> {
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth0Token}`,
    },
    body: JSON.stringify({ email: profile.email, name: profile.name }),
  });
  if (!res.ok) {
    console.error("Token exchange failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { token?: string };
  return data.token ?? null;
}

export function useAuth() {
  const {
    isAuthenticated,
    isLoading: isAuth0Loading,
    user: auth0User,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  installTokenGetter();

  // Once Auth0 reports a session, swap the Auth0 access token for our local
  // Base64 token (and upsert the user in the DB on the server).
  const [hasApiToken, setHasApiToken] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return false;
    }
  });
  const [isExchanging, setIsExchanging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) {
      // Auth0 says not signed in — clear any stale local token.
      try {
        if (localStorage.getItem(TOKEN_STORAGE_KEY)) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
      } catch {}
      setHasApiToken(false);
      return;
    }
    if (hasApiToken) return;
    setIsExchanging(true);
    (async () => {
      try {
        const auth0Token = await getAccessTokenSilently();
        const apiToken = await exchangeAuth0Token(auth0Token, {
          email: auth0User?.email,
          name: auth0User?.name,
        });
        if (cancelled) return;
        if (apiToken) {
          localStorage.setItem(TOKEN_STORAGE_KEY, apiToken);
          setHasApiToken(true);
        }
      } catch (err) {
        console.error("Auth0 token exchange threw", err);
      } finally {
        if (!cancelled) setIsExchanging(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, hasApiToken, getAccessTokenSilently, auth0User?.email, auth0User?.name]);

  // Fetch the application user once we have an API token.
  const {
    data: user,
    isLoading: isUserLoading,
    error,
    isError,
  } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: isAuthenticated && hasApiToken,
      retry: false,
    },
  });

  useEffect(() => {
    if (isError) {
      console.error("useGetMe failed", error);
    }
  }, [isError, error]);

  const login = () => loginWithRedirect();
  const logout = () => {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {}
    setHasApiToken(false);
    auth0Logout({ logoutParams: { returnTo: window.location.origin } });
  };

  return {
    token: hasApiToken ? localStorage.getItem(TOKEN_STORAGE_KEY) : null,
    user,
    auth0User,
    isAuthenticated: isAuthenticated && hasApiToken && !!user,
    isLoading:
      isAuth0Loading ||
      isExchanging ||
      // Treat the gap between "Auth0 signed in" and "exchange done" as loading
      // so ProtectedRoute doesn't bounce us back to /login (which would just
      // bounce us back here and create a redirect loop).
      (isAuthenticated && !hasApiToken) ||
      (isAuthenticated && hasApiToken && isUserLoading),
    login,
    logout,
  };
}
