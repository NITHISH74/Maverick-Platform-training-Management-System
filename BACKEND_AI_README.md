# Maverick — Backend + AI Layer

Scaffolded artifacts of the architecture document.

## Layout

```
lib/db/migrations/
  └─ 0001_maverick_ai_schema.sql        # Supabase schema (tables, RLS, RPCs, pgvector)

artifacts/api/                          # Node.js Express API
  ├─ src/
  │  ├─ server.ts                       # entry
  │  ├─ config/                         # env + Supabase client + Key Vault hydration
  │  ├─ middleware/                     # Auth0 JWT, RBAC, error handler
  │  ├─ routes/                         # 13 route modules (REST API)
  │  ├─ services/                       # ai client, email (ACS), audit
  │  ├─ jobs/                           # node-cron: attendance cut-off + agent trigger
  │  └─ utils/                          # pino logger
  ├─ package.json
  ├─ tsconfig.json
  └─ .env.example

services/ai/                            # FastAPI Python AI microservice
  ├─ app/
  │  ├─ main.py                         # FastAPI app + internal-token guard
  │  ├─ config.py                       # Settings + Key Vault hydration
  │  ├─ deps.py                         # Supabase client
  │  ├─ schemas.py                      # Pydantic IO models
  │  ├─ ai/                             # Gemini wrapper, prompts, SQL guard
  │  ├─ routers/                        # 4 features: feedback, notifications, chatbot, agent
  │  └─ crew/                           # CrewAI: agents.py, tasks.py, tools.py, runner.py
  ├─ requirements.txt
  ├─ Dockerfile
  └─ .env.example

infra/azure-functions/                  # Cron trigger
  ├─ host.json
  └─ agent-trigger/
     ├─ function.json                   # schedule: 0 */30 * * * *
     └─ index.js
```

## Local development

### 1. Apply the SQL migration
```bash
psql "$SUPABASE_DB_URL" -f lib/db/migrations/0001_maverick_ai_schema.sql
```

### 2. Node.js API
```bash
cd artifacts/api
cp .env.example .env   # fill in Auth0 + Supabase + INTERNAL_SHARED_SECRET
pnpm install
pnpm dev               # http://localhost:8080
```

### 3. FastAPI AI service
```bash
cd services/ai
cp .env.example .env   # fill GEMINI_API_KEY, SUPABASE_*, INTERNAL_SHARED_SECRET (same as Node)
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 4. Frontend → API wiring
The existing Vite dev server proxies `/api` to `http://127.0.0.1:8080` (see `artifacts/maverick/vite.config.ts`).

### 5. Trigger the agent manually
```bash
curl -X POST http://localhost:8080/api/ai/agent/run \
  -H "Authorization: Bearer <AUTH0_JWT>"
```

## Endpoint map

| Module       | Node REST                          | AI (FastAPI, internal)               |
|--------------|------------------------------------|--------------------------------------|
| Batches      | `/api/batches`                     | —                                    |
| Candidates   | `/api/candidates` + `/upload`      | —                                    |
| Attendance   | `/api/attendance` + `/upload`      | —                                    |
| Assessments  | `/api/assessments`                 | —                                    |
| Feedback     | `/api/feedback`                    | `/ai/feedback/analyze`               |
| Notifications| `/api/notifications/send`          | `/ai/notifications/generate`         |
| Dashboard    | `/api/dashboard/summary` etc.      | `/ai/chatbot/query`                  |
| Toppers      | `/api/toppers/*`                   | —                                    |
| Agent        | `/api/ai/agent/run|tasks|digest`   | `/ai/agent/run|tasks|digest`         |
| Internal     | `/internal/agent/run`, `/email/send` | —                                  |

All `/api/ai/*` routes require an Auth0 JWT and proxy to the FastAPI service using the shared internal token.

## Production deploy targets

- **Node API** → Azure App Service (Linux, Node 20). Uses Managed Identity to read Key Vault.
- **FastAPI** → Azure Container Apps (autoscale 1→5). Build the `services/ai/Dockerfile`.
- **Postgres** → Supabase managed.
- **Cron** → Azure Functions (`infra/azure-functions/agent-trigger`) — schedule already set to every 30 min.
- **Secrets** → Azure Key Vault — see `BACKEND_AI_README.md` checklist in the architecture doc.
- **Auth** → Auth0 SPA app + API audience `https://api.maverick`, RS256, RBAC.

## Notes

- The Node `node-cron` agent trigger only runs in non-production environments, so the 30-min job won't double-fire when the Azure Functions trigger is active in prod.
- `execute_safe_select` is a Postgres function (security definer) that gates the NL→SQL chatbot to SELECT statements only.
- `uniq_agent_event_window` is a partial unique index that makes the CrewAI agent idempotent across the 30-min window.
- AI failures degrade gracefully: feedback / chatbot return useful errors; notifications fall back to static templates; the agent runs in rule-only mode.
