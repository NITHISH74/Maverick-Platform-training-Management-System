import { useState, useEffect, useCallback } from "react";
import { getToken, setToken, removeToken } from "../lib/auth";
import { setAuthTokenGetter, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

// Initialize the custom fetch auth token getter
setAuthTokenGetter(getToken);

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(getToken());

  // Set up token change listener
  useEffect(() => {
    const handleStorageChange = () => {
      setTokenState(getToken());
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const login = useCallback((newToken: string) => {
    setToken(newToken);
    setTokenState(newToken);
    // Notify other tabs
    window.dispatchEvent(new Event("storage"));
  }, []);

  const logout = useCallback(() => {
    removeToken();
    setTokenState(null);
    window.dispatchEvent(new Event("storage"));
  }, []);

  // Fetch current user if we have a token
  const { data: user, isLoading: isUserLoading, error, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      enabled: !!token,
      retry: false,
    }
  });

  // Handle 401s
  useEffect(() => {
    if (isError && error?.status === 401) {
      logout();
    }
  }, [isError, error, logout]);

  return {
    token,
    user,
    isAuthenticated: !!token && !!user,
    isLoading: !!token && isUserLoading,
    login,
    logout,
  };
}
