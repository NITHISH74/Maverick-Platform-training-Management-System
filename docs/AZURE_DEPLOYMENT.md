# Azure Deployment Guide — Maverick Platform

This app has **three deployable units** plus a database:

| Unit | Tech | Port | Azure target |
|------|------|------|--------------|
| Frontend (`artifacts/maverick`) | React + Vite static build | — | Azure Static Web Apps |
| API server (`artifacts/api-server`) | Node/Express (Docker) | 8080 | Azure Container Apps (public) |
| AI service (`services/ai`) | Python FastAPI (Docker) | 9000 | Azure Container Apps (internal) |
| Database | PostgreSQL | 5432 | Azure DB for PostgreSQL Flexible Server *(or keep Supabase)* |

## Azure resources to create (inside your resource group)

1. **Azure Container Registry (ACR)** — stores the API + AI Docker images.
2. **Azure Container Apps Environment** — shared runtime for both containers.
3. **Container App: `maverick-api`** — public ingress on 8080.
4. **Container App: `maverick-ai`** — **internal** ingress on 9000.
5. **Azure Static Web App** — hosts the frontend, routes `/api/*` to `maverick-api`.
6. **Azure OpenAI** — GPT-4.1 + `text-embedding-ada-002` deployments.
7. **Azure Key Vault** — holds all secrets; both container apps read via managed identity.
8. **Azure Database for PostgreSQL Flexible Server** — *optional if staying on Supabase.*
9. **Application Insights** — logging/monitoring.
10. *(Optional)* **Azure Functions (Timer)** — the monitoring agent (`infra/azure-functions/`); handler not yet implemented.
11. **Email** — keep Gmail SMTP, or add **Azure Communication Services (Email)**.

## Secrets to put in Key Vault

- `DATABASE-URL`
- `API-TOKEN-SECRET` (generate: `openssl rand -hex 32`)
- `INTERNAL-SHARED-SECRET` (same value in API + AI)
- `AZURE-OPENAI-API-KEY`
- `SMTP-PASS`

## Build & push images (run from repo root once `az login` + ACR exist)

```powershell
$ACR = "<your-acr-name>"            # e.g. maverickacr
az acr login --name $ACR

# API server (build context = repo root; pnpm workspace)
docker build -f artifacts/api-server/Dockerfile -t "$ACR.azurecr.io/maverick-api:v7" .
docker push "$ACR.azurecr.io/maverick-api:v7"

# AI service (build context = services/ai)
docker build -f services/ai/Dockerfile -t "$ACR.azurecr.io/maverick-ai:v7" services/ai
docker push "$ACR.azurecr.io/maverick-ai:v7"
```

## Key env vars per unit (full list in each `.env.example`)

**maverick-api**: `DATABASE_URL`, `PORT=8080`, `NODE_ENV=production`, `API_TOKEN_SECRET`,
`AI_SERVICE_URL=https://maverick-ai.internal.<region>.azurecontainerapps.io`,
`INTERNAL_SHARED_SECRET`, `AI_INTERNAL_TOKEN`, SMTP_* , `NOTIFICATION_CC`.

**maverick-ai**: `AZURE_OPENAI_*`, `DATABASE_URL`, `INTERNAL_SHARED_SECRET`,
`NODE_API_URL=https://maverick-api.<region>.azurecontainerapps.io`, optional `KEY_VAULT_URL`.

**frontend (build-time)**: `PORT`, `BASE_PATH=/`, `VITE_AUTH0_DOMAIN`,
`VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`.

## Deploy order

1. Push DB schema: `pnpm --filter @workspace/db exec drizzle-kit push` (with prod `DATABASE_URL`).
2. Deploy `maverick-ai` (internal) → note its internal FQDN.
3. Deploy `maverick-api` with `AI_SERVICE_URL` = that FQDN.
4. Build frontend (`pnpm --filter ./artifacts/maverick run build`) → deploy `dist/public` to Static Web Apps; configure `/api/*` route to the API app.
5. In Auth0, add the Static Web App URL to Allowed Callback/Logout/Web Origins.

> Detailed `az containerapp create` commands come next — provide the resource group name, region, and chosen ACR name when ready.
