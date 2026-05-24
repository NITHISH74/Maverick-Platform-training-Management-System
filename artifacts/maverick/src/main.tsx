import { createRoot } from "react-dom/client";
import { Auth0Provider } from "@auth0/auth0-react";
import App from "./App";
import "./index.css";

const domain = import.meta.env.VITE_AUTH0_DOMAIN as string;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID as string;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE as string;

if (!domain || !clientId || !audience) {
  throw new Error(
    "Missing Auth0 env vars. Set VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE in artifacts/maverick/.env",
  );
}

// Called by Auth0 after it finishes processing the /?code=...&state=... callback.
// Strips the OAuth params from the URL and navigates to the intended page,
// without pushing an extra history entry.
const onRedirectCallback = (appState?: { returnTo?: string }) => {
  const target = appState?.returnTo ?? "/dashboard";
  window.history.replaceState({}, document.title, target);
};

createRoot(document.getElementById("root")!).render(
  <Auth0Provider
    domain={domain}
    clientId={clientId}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience,
      scope: "openid profile email",
    }}
    cacheLocation="localstorage"
    useRefreshTokens={true}
    onRedirectCallback={onRedirectCallback}
  >
    <App />
  </Auth0Provider>,
);
