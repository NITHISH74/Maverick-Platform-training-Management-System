import { QueryClient } from "@tanstack/react-query";
import { removeToken } from "./auth";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.status === 401) return false;
        return failureCount < 3;
      },
    },
    mutations: {
      onError: (error: any) => {
        if (error?.status === 401) {
          removeToken();
          window.location.href = "/login";
        }
      },
    },
  },
});
