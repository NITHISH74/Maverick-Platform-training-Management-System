# Maverick Execution Platform

Enterprise **Training Management System (TMS)** for running training programmes end to end: batches, candidates, trainers, attendance, assessments, toppers (leaderboards), feedback, notifications, reports, and audit logs. Role-based access supports **Admin**, **Coordinator**, and **Trainer** workflows.

---

## Table of contents

- [Architecture](#architecture)
- [Application flow](#application-flow)
- [Autonomous Batch Monitoring Agent](#autonomous-batch-monitoring-agent)
- [Key features](#key-features)
- [Techniques used](#techniques-used)
- [Tech stack](#tech-stack)
- [Coordinator Copilot](#coordinator-copilot)
- [Prerequisites](#prerequisites)
- [Download and install](#download-and-install)
- [Configuration and secrets](#configuration-and-secrets)
- [Run on Replit](#run-on-replit)
- [Run locally (Windows / macOS / Linux)](#run-locally-windows--macos--linux)
- [Default ports and routing](#default-ports-and-routing)
- [Project structure](#project-structure)
- [Product modules](#product-modules)
- [Development commands](#development-commands)
- [Troubleshooting](#troubleshooting)

---

## Architecture

Monorepo (**pnpm workspaces**). The **OpenAPI spec** is the contract; **Orval** generates Zod schemas and React Query hooks. The **Express API** talks to **PostgreSQL** via **Drizzle ORM**. The **React (Vite)** app calls `/api` through the Replit proxy in development or your reverse proxy in production.

```mermaid
flowchart TB
  subgraph Client["Browser"]
    UI["Maverick UI<br/>React + Vite + TanStack Query"]
    LS["localStorage<br/>maverick_token"]
    UI --> LS
  end

  subgraph ReplitProxy["Replit proxy (dev / deploy)"]
    P["/ → Frontend<br/>/api → API Server"]
  end

  subgraph Artifacts["artifacts/"]
  FE["@workspace/maverick<br/>port 19174"]
  API["@workspace/api-server<br/>port 8080"]
  end

  subgraph Libs["lib/"]
  OAS["api-spec / openapi.yaml"]
  ZOD["api-zod (generated)"]
  RQ["api-client-react (generated)"]
  DB["db + Drizzle schema"]
  end

  subgraph Data["Data layer"]
  PG[("PostgreSQL 16")]
  end

  UI -->|"fetch /api/*<br/>Bearer token"| P
  P --> FE
  P --> API
  UI -.->|"generated hooks"| RQ
  RQ -.-> OAS
  API --> ZOD
  API --> DB
  DB --> PG
  OAS --> ZOD
  OAS --> RQ
```

**Layer responsibilities**

| Layer | Package / path | Role |
|--------|----------------|------|
| UI | `artifacts/maverick` | Pages, layout, auth hook, charts |
| API | `artifacts/api-server` | Express 5 routes, auth middleware, enrichment |
| Contract | `lib/api-spec/openapi.yaml` | Single source of truth for REST API |
| Codegen | `lib/api-zod`, `lib/api-client-react` | Do not edit `generated/` files |
| Database | `lib/db` | Drizzle schema, migrations via `drizzle-kit push` |

---

## Application flow

### Authentication and request flow

```mermaid
sequenceDiagram
  actor User
  participant UI as Maverick UI
  participant LS as localStorage
  participant API as Express /api
  participant DB as PostgreSQL

  User->>UI: Open app
  alt Not logged in
    UI->>User: /login
    User->>UI: email + password
    UI->>API: POST /api/auth/login
    API->>DB: Verify user + password hash
    API-->>UI: token + user
    UI->>LS: Save maverick_token
  end

  UI->>API: GET /api/auth/me (Bearer token)
  API-->>UI: Current user
  UI->>User: Protected routes (Dashboard, Batches, …)

  loop Protected API calls
    UI->>API: /api/* + Authorization Bearer
    API->>API: verifyToken + role guard
    API->>DB: Query / mutate
    API-->>UI: JSON response
  end
```

### High-level user journey

```mermaid
flowchart LR
  A[Login] --> B[Dashboard KPIs]
  B --> C[Batches]
  C --> D[Candidates]
  D --> E[Attendance]
  D --> F[Assessments]
  F --> G[Toppers WCS ranking]
  D --> H[Feedback]
  B --> I[Notifications]
  A --> J[Users / Audit / Reports<br/>Admin & Coordinator]
```

**Auth model:** Stateless **Base64 JSON tokens** (not JWT). The frontend stores the token in `localStorage` under `maverick_token` and sends `Authorization: Bearer <token>` on API calls. Auth0 is used for the sign-in flow; the Auth0 access token is exchanged once for the local Base64 API token via `POST /api/auth/exchange`.

**AI layer:** A separate **Python / FastAPI** service (`services/ai/`) hosts the AI features (feedback analysis, notification copy, chatbot SQL+summary, CrewAI agent runs). It calls **Azure OpenAI GPT-4.1** via `langchain-openai` and `litellm`. The Node API proxies `/api/ai/*` to the FastAPI service using a shared internal token.

---

## Key features

- **Autonomous Batch Monitoring Agent** — rule-driven background agent that scans every running batch on a schedule (or on demand), evaluates 8 health rules, creates `monitoring_alerts`, and fans out plain-text emails to trainer + coordinator (admin sees the dashboard, not the emails). Idempotent per `(batch, candidate, kind, day)`. Per-role scope on the dashboard. Console transport for dev, nodemailer for prod. See [Autonomous Batch Monitoring Agent](#autonomous-batch-monitoring-agent).
- **Coordinator Copilot** — single conversational AI surface (slide-over from the header or full-screen at `/copilot`) that turns plain-English questions into safe `SELECT` queries against Supabase via Azure OpenAI GPT-4.1. Uses **live schema introspection** so the prompt can't drift from the DB, **RAG context** from `match_rag`, **per-caller batch-scope** enforcement (admin / coordinator / trainer), **SSE token streaming**, **table / number / bar** result rendering, **CSV export**, **Show-SQL toggle**, 👍/👎 feedback, and per-session tokens + INR cost tracking. Replaces the legacy AI Chatbot page. See [Coordinator Copilot](#coordinator-copilot).
- **Role-based dashboards** — Admin, Coordinator, Trainer views with KPIs, attendance trends, pipeline funnel, recent activity.
- **Batch lifecycle management** — create, assign trainers, status transitions (`planned → active → completed`).
- **Candidate pipeline** — profile management with status flow (`active → discontinued / cleared / offered / onboarded`).
- **Attendance** — daily roster marking, bulk CSV upload, CSV export.
- **Assessments** — sprint reviews, coding rounds, API tests, project evaluations, all weighted.
- **Toppers leaderboard** — Weighted Composite Score (WCS) ranking across assessment categories (see `replit.md`).
- **Feedback & sentiment** — collect candidate feedback, AI-powered sentiment analysis (Azure OpenAI GPT-4.1).
- **AI chatbot (RAG)** — natural-language Q&A over training data using SQL generation + text embeddings.
- **AI notification copywriting** — auto-drafted notification messages via GPT-4.1.
- **CrewAI agents** — multi-agent workflows for higher-level training operations.
- **Notifications center** — per-user alerts with read/unread state.
- **Users & RBAC** — Admin, Coordinator, Trainer roles, gated routes and APIs.
- **Audit log** — system-wide action timeline.
- **Reports** — admin/coordinator reporting surfaces.
- **Auth0 sign-in** with stateless Base64 API tokens (exchanged at `/api/auth/exchange`).
- **OpenAPI-first** contract → generated Zod schemas + TanStack Query React hooks (Orval).

---

## Techniques used

| Area | Technique |
|------|-----------|
| Architecture | Monorepo with **pnpm workspaces**; three runtime layers (Node API · React UI · Python AI) |
| Contract-first API | **OpenAPI 3** spec is the single source of truth; **Orval** generates Zod schemas + React Query hooks |
| Validation | **Zod** schemas shared between server and client (`@workspace/api-zod`) |
| Data access | **Drizzle ORM** with typed schema, migrations via `drizzle-kit push` |
| Auth | **Auth0** SPA login → exchanged for stateless **Base64 JSON** API tokens, sent as `Bearer` |
| API patterns | **Express 5** with role guards, request-scoped Pino logging, response enrichment middleware |
| Frontend state | **TanStack Query v5** with auto-generated hooks, optimistic updates |
| UI system | **React 19 + Vite 7**, **Tailwind CSS 4**, **shadcn/ui** primitives on Radix, **Recharts** for analytics |
| Routing | `wouter` (tiny client router) with role-gated routes |
| AI integration | **Azure OpenAI GPT-4.1** via **LangChain + litellm**; **CrewAI** multi-agent runs; RAG over Supabase data |
| Service isolation | Node API ↔ FastAPI communicate via shared `x-internal-token` header (defense-in-depth) |
| Secrets | Local `.env` files in dev; **Azure Key Vault** in production (auto-overrides plain env vars) |
| Observability | **Pino** structured logs (Node); optional **Sentry** in FastAPI |
| Build | **esbuild** bundles the API; **Vite** builds the SPA to static `dist/public`; FastAPI runs under **uvicorn** |
| Deployment | **Replit Autoscale** with artifact-based service definitions (`artifact.toml`) |

---

## Tech stack

| Area | Technology |
|------|------------|
| Runtime | Node.js **24** (see `.replit`); Python **3.12** for the AI service |
| Package manager | **pnpm** workspaces (required; npm/yarn blocked); **pip** for the AI service |
| Language | TypeScript **5.9**; Python 3.12 |
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Recharts, wouter, Auth0 |
| API | Express 5, Pino logging |
| AI service | FastAPI, LangChain, **Azure OpenAI GPT-4.1**, CrewAI, Supabase client |
| Database | PostgreSQL **16** (Supabase), Drizzle ORM |
| Validation | Zod (`@workspace/api-zod`) |
| Client data | TanStack Query v5 (generated hooks) |
| API codegen | Orval from OpenAPI |

---

## Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| **Node.js** | 20+ locally; **24** on Replit (`nodejs-24` module) |
| **pnpm** | 9+ — install globally: `npm install -g pnpm` |
| **Python** | **3.12** (only needed if you want to run the AI service locally) |
| **PostgreSQL** | 15+ locally, or hosted (Neon, Supabase, Railway, Replit DB) |
| **Azure OpenAI** | A deployment of **GPT-4.1** (and optionally a text-embedding deployment) for the AI service |
| **Git** | To clone the repository |

---

## Download and install

### 1. Clone the repository

```bash
git clone https://github.com/<your-org>/Maverick-Platform-training-Management-System.git
cd Maverick-Platform-training-Management-System
```

Or download a ZIP from GitHub (**Code → Download ZIP**), extract it, and open the folder in your editor.

### 2. Install dependencies

This project **must** use **pnpm** (enforced in root `package.json`):

```bash
pnpm install
```

### 3. Configure environment variables

See [Configuration and secrets](#configuration-and-secrets). At minimum you need **`DATABASE_URL`**.

### 4. Apply the database schema

```bash
pnpm --filter @workspace/db run push
```

### 5. Start the application

You need **three processes** to run the full platform locally: the **Node API** (port 8080), the **Vite frontend** (port 5173) and the **Python AI service** (port 9000). The AI service is only required for the chatbot, feedback analysis, notification copy, and CrewAI agent endpoints — the rest of the UI works without it. See [Run locally](#run-locally-windows--macos--linux) or [Run on Replit](#run-on-replit).

---

## Configuration and secrets

The Node API needs `DATABASE_URL`, the frontend needs Auth0 credentials, and the Python AI service needs **Azure OpenAI** credentials. Everything else is optional.

### What to configure

**Root `.env` (Node API + db)**

| Variable | Required | Used by | Description |
|----------|----------|---------|-------------|
| **`DATABASE_URL`** | **Yes** | `lib/db`, Drizzle | PostgreSQL connection string |
| **`PORT`** | **Yes** | API server & Vite | Listen port (see [ports table](#default-ports-and-routing)) |
| **`BASE_PATH`** | **Yes** (frontend) | Maverick Vite app | URL base path (usually `/`) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Optional | Server-side admin ops | Used when the Node side talks to Supabase APIs |
| `NODE_ENV` | Optional | API, Vite | `development` or `production` |
| `LOG_LEVEL` | Optional | API logger | Default `info` |

**`artifacts/maverick/.env` (frontend / Auth0)**

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_AUTH0_DOMAIN` | **Yes** | Auth0 tenant domain |
| `VITE_AUTH0_CLIENT_ID` | **Yes** | Auth0 SPA client id |
| `VITE_AUTH0_AUDIENCE` | **Yes** | Auth0 API audience |

**`services/ai/.env` (Python AI service)**

| Variable | Required | Description |
|----------|----------|-------------|
| **`AZURE_OPENAI_ENDPOINT`** | **Yes** | e.g. `https://<resource>.openai.azure.com/` |
| **`AZURE_OPENAI_API_KEY`** | **Yes** | Azure OpenAI key |
| **`AZURE_OPENAI_DEPLOYMENT`** | **Yes** | GPT-4.1 deployment name (default `gpt-4.1`) |
| **`AZURE_OPENAI_API_VERSION`** | **Yes** | e.g. `2024-12-01-preview` |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Optional | Embedding deployment for chatbot RAG (default `text-embedding-ada-002`) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | **Yes** | The AI service reads/writes via the Supabase Python client |
| `INTERNAL_SHARED_SECRET` | **Yes** | Shared header (`x-internal-token`) between Node API and AI service |
| `NODE_API_URL` | Optional | Default `http://localhost:8080` |
| `KEY_VAULT_URL` | Optional | If set, Azure Key Vault overrides plain env vars in prod |
| `SENTRY_DSN` | Optional | FastAPI Sentry instrumentation |

### Where to add configuration

#### On Replit (recommended for this template)

1. Open your Repl and enable the **PostgreSQL** module (`.replit` includes `postgresql-16`).
2. Replit usually injects **`DATABASE_URL`** when the database is provisioned. Confirm it under **Tools → Secrets** (or **Database** panel).
3. Add any extra secrets in **Tools → Secrets** (same as environment variables for the Repl).
4. Service-specific ports are defined in Replit artifacts (you normally do **not** set these manually on Replit):
   - `artifacts/api-server/.replit-artifact/artifact.toml` → `PORT=8080`
   - `artifacts/maverick/.replit-artifact/artifact.toml` → `PORT=19174`, `BASE_PATH=/`
5. Click **Run** (workflow name: **`Project`**, from `.replit` `[workflows] runButton = "Project"`). Replit starts the API and frontend via artifact services.

After a git merge, Replit runs `scripts/post-merge.sh` (install + `pnpm --filter db push`) automatically (`.replit` `[postMerge]`).

#### Local development

Create a **`.env` file in the repository root** (same folder as `package.json`):

```env
# Required — PostgreSQL
DATABASE_URL=postgres://user:password@localhost:5432/maverick

# API server (terminal 1)
PORT=8080
NODE_ENV=development

# Frontend (terminal 2) — use a different PORT than the API
PORT=5173
BASE_PATH=/
```

> **Note:** There is no committed `.env.example` in the repo yet; copy the block above into `.env` and adjust values. Never commit real passwords to Git.

**Windows PowerShell** (per terminal session):

```powershell
$env:DATABASE_URL = "postgres://user:password@localhost:5432/maverick"
$env:PORT = "8080"
$env:NODE_ENV = "development"
```

For the frontend terminal, set `$env:PORT = "5173"` and `$env:BASE_PATH = "/"`.

**macOS / Linux:**

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/maverick"
export PORT=8080
export NODE_ENV=development
```

---

## Run on Replit

Settings from [`.replit`](.replit):

| Setting | Value |
|---------|--------|
| Node module | `nodejs-24` |
| Database module | `postgresql-16` |
| Workspace stack | `PNPM_WORKSPACE` |
| Run button workflow | `Project` |
| Deployment | `autoscale`, router `application` |
| Post-build | `pnpm store prune` (CI mode) |

**Steps**

1. Import or open the Repl.
2. Wait for `pnpm install` (and post-merge DB push if applicable).
3. Ensure **PostgreSQL** is provisioned and `DATABASE_URL` is set.
4. Press **Run** → starts API (`/api` on port **8080**) and web UI (port **19174**, exposed as external **3000** in `.replit` ports).
5. Open the web preview; API calls go to `/api` through the Replit proxy.

**Deployment:** Use Replit **Deployments**; production builds are defined in each artifact’s `artifact.toml` (API: esbuild bundle; frontend: static `dist/public`).

---

## Run locally (Windows / macOS / Linux)

> ✅ **Verified working locally** on Windows 10 + PowerShell 5.1, Node 24, Python 3.12 on 2026-05-24. All three layers (API · Frontend · AI) brought up successfully against Supabase Postgres + Azure OpenAI GPT-4.1.

The platform runs as **three independent processes**. Open one PowerShell terminal per service from the repo root.

### Quick reference — three layers, three commands (Windows PowerShell)

| # | Layer | Port | Command (run from repo root, one per terminal) |
|---|-------|------|------------------------------------------------|
| 1 | **Node API** (`@workspace/api-server`) | **8080** | `Get-Content .env \| Where-Object {$_ -match '^[A-Z]'} \| ForEach-Object { $p=$_ -split '=',2; [Environment]::SetEnvironmentVariable($p[0],$p[1],'Process') }; pnpm --filter @workspace/api-server run build; pnpm --filter @workspace/api-server run start` |
| 2 | **React Frontend** (`@workspace/maverick`, Vite) | **5173** | `$env:PORT="5173"; $env:BASE_PATH="/"; pnpm --filter @workspace/maverick run dev` |
| 3 | **Python AI Service** (FastAPI / Azure OpenAI GPT-4.1) | **9000** | `& services/ai/.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --app-dir services/ai` |

Health checks (after each service is up):

```powershell
Invoke-WebRequest http://localhost:8080/api/healthz   # {"status":"ok"}
Invoke-WebRequest http://localhost:5173/              # Vite HTML (200)
Invoke-WebRequest http://localhost:9000/healthz       # {"ok":true,"env":"development"}
```

Open the app at **http://localhost:5173**.

---

### Terminal 1 — Node API server (port 8080)

The packaged `dev` script uses Unix `export`, so on Windows we load `.env` ourselves and run `build` + `start` directly:

```powershell
# From repo root
Get-Content .env | Where-Object {$_ -match '^[A-Z]'} | ForEach-Object {
  $p = $_ -split '=',2
  [Environment]::SetEnvironmentVariable($p[0], $p[1], 'Process')
}
$env:NODE_ENV = "development"
$env:PORT     = "8080"

pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

On macOS / Linux / Git Bash the bundled script works as-is:

```bash
pnpm --filter @workspace/api-server run dev
```

### Terminal 2 — React frontend (port 5173)

```powershell
$env:PORT      = "5173"
$env:BASE_PATH = "/"
pnpm --filter @workspace/maverick run dev
```

The Vite dev server proxies `/api` → `http://localhost:8080` (configured in `artifacts/maverick/vite.config.ts`). Open **http://localhost:5173**.

### Terminal 3 — Python AI service (port 9000, Azure OpenAI GPT-4.1)

The chatbot, feedback analysis, notification copy, and CrewAI agent runs live in a FastAPI service in `services/ai/`.

```powershell
# First-time setup only
cd services/ai
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\..

# Make sure services/ai/.env has AZURE_OPENAI_*, SUPABASE_*, INTERNAL_SHARED_SECRET

# Run (from repo root)
& services/ai/.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --app-dir services/ai
```

macOS / Linux equivalent:

```bash
cd services/ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 9000
```

Health check: `GET http://localhost:9000/healthz`. Interactive docs at `http://localhost:9000/docs`. All `/ai/*` routes require the `x-internal-token` header that matches `INTERNAL_SHARED_SECRET`.

### API proxy for local dev

The frontend expects the API at **`/api`**. On Replit, the proxy handles this. Locally you may need a Vite proxy or to open the API directly at `http://localhost:8080/api`. If requests fail with 404, add a dev proxy in `artifacts/maverick/vite.config.ts` or use a tool like `vite` `server.proxy` pointing `/api` → `http://localhost:8080`.

### First-time database

```bash
pnpm --filter @workspace/db run push
```

Create users through the **Users** admin UI after logging in with an account you insert into the database, or add seed data yourself (a `seed` script is referenced in `replit.md` but is not present in `@workspace/db` at this time).

---

## Default ports and routing

From [`.replit`](.replit) and [Replit artifacts](artifacts/):

| Service | Local port | Path | External (Replit) |
|---------|------------|------|-------------------|
| API Server | **8080** | `/api` | 8080 |
| Maverick UI | **19174** | `/` | 3000 |
| Mockup sandbox (optional) | **8081** | `/__mockup` | 80 |

**Routing (development on Replit)**

- `/api/*` → Express API (`artifacts/api-server`)
- `/*` → Vite dev server (`artifacts/maverick`)

Health check (production): `GET /api/healthz`

---

## Project structure

```
Maverick-Platform-training-Management-System/
├── .replit                    # Replit modules, ports, workflows, deployment
├── artifacts/
│   ├── api-server/            # Express API (@workspace/api-server)
│   │   └── src/routes/        # auth, batches, candidates, attendance, …
│   ├── maverick/              # Main React app (@workspace/maverick)
│   │   └── src/pages/         # Dashboard, Batches, Candidates, …
│   └── mockup-sandbox/        # UI mockups (optional, /__mockup)
├── lib/
│   ├── api-spec/openapi.yaml  # API contract — edit this, then codegen
│   ├── api-zod/               # Generated Zod schemas
│   ├── api-client-react/      # Generated React Query hooks
│   └── db/src/schema/         # Drizzle tables (users, batches, …)
├── scripts/post-merge.sh      # Replit: install + db push after merge
├── package.json               # Root scripts (typecheck, build)
├── pnpm-workspace.yaml
└── replit.md                  # Extended dev notes (WCS toppers, gotchas)
```

---

## Coordinator Copilot

The single conversational AI surface in Maverick. There is **one** UI — a 420 px slide-over from the right edge (full-width on mobile) — and **two triggers** that open it:

- The **Copilot** button in the top header (visible on every page).
- The **Coordinator Copilot** entry in the left sidebar.

There is intentionally no dedicated `/copilot` page. The previous full-page route was removed because two surfaces for the same feature duplicated state and confused users about where to start; the slide-over keeps the user's current page context visible while they ask.

The Copilot answers two kinds of questions:

- **Data mode** — *"how many candidates are running this month?"*, *"top 5 candidates by assessment score"*. Generates a safe `SELECT` against Supabase and renders the result as a single number, a Recharts bar chart, or a table.
- **Help mode** — *"how do I create a new batch?"*, *"where do I mark attendance?"*. Returns a numbered list of steps and a **"Take me there →"** button that uses `wouter` to navigate to the right page in the platform. No SQL is run.

This feature **replaces the old AI Chatbot page**. The legacy `/api/ai/chatbot/query` endpoint now returns HTTP 410 with a migration hint; the RAG helper that the chatbot used has been ported into the Copilot so nothing was lost.

**How it works**

```
User question
   ↓
React CopilotPanel  →  POST /api/copilot/query  (Express, port 8080)
                          ↓  forwards with x-internal-token + req.userId
                      POST /copilot/query        (FastAPI, port 9000)
                          ↓
            1) Schema card is built from information_schema (cached for the
               process lifetime — no more drift between the prompt and DB).
            2) Platform guide is appended — every route + how to perform
               common tasks, so the model can answer "how do I X" questions.
            3) RAG: top-5 embedding chunks pulled from Supabase `match_rag`
               and prepended for grounding (best-effort).
            4) Batch-scope hint: caller's allowed batch_ids are resolved
               (admin → unrestricted; coordinator → batches they own;
               trainer → batches via batch_trainers; unknown → empty deny).
            5) GPT-4.1 plans → {mode: "data"|"help", ...}.
            6a) DATA: sql_validator.py blocks non-whitelisted SELECTs,
                _enforce_scope_in_sql() requires a batch_id from the
                allow-list when scoped tables are touched, psycopg2 runs
                the SQL with SET LOCAL statement_timeout = 5000, then
                GPT-4.1 narrates the rows token-by-token via SSE.
            6b) HELP: no SQL is run. The server returns steps + an
                allow-listed navigate_to route. The UI renders a Help card
                with a "Take me there →" button.
            7) audit_logs + copilot_usage rows written (no SQL in audit
               details — it would leak into Recent Activity).
                          ↓
             SSE: event: meta → event: token (×N) → event: done
                          ↓
             Panel renders chart_type / mode:
               "help"   → ordered list of steps + "Take me there" button
               "number" → big centered figure
               "table"  → HTML table (first 50 rows, with CSV export ≥ 10 rows)
               "bar"    → Recharts BarChart
             Per-bubble extras: 👍/👎 feedback, clickable follow-up chips.
             Header: Clear chat (trash icon).
             SQL and token-cost are intentionally hidden from end users
             (still tracked server-side for admin via /usage-stats).
```

**Endpoints**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/copilot/query` | NL → SQL → execute → stream narrative (SSE) |
| POST | `/api/copilot/narrate` | 150-word executive summary for one batch |
| POST | `/api/copilot/feedback` | Thumbs-up/down logger (writes `copilot_usage.helpful`) |
| GET  | `/api/copilot/usage-stats` | Today's tokens, INR cost, top 5 queries (admin only) |

**Safety — three layers**

1. **Static validator** (`services/ai/app/utils/sql_validator.py`):
   - Must start with `SELECT`.
   - Blocks `DROP / DELETE / UPDATE / INSERT / TRUNCATE / ALTER / CREATE / EXEC / EXECUTE` as whole-word matches (so `updated_at` is fine).
   - Rejects any `FROM` / `JOIN` target outside `{batches, candidates, attendance, assessments, feedback, audit_logs, users}`.
   - Rejects multi-statement input.
2. **Per-caller batch scope** (`_resolve_batch_scope` + `_enforce_scope_in_sql`):
   - Admin → no restriction.
   - Coordinator → batches where `coordinator_id = user_id`.
   - Trainer → batches via `batch_trainers.trainer_id = user_id`.
   - Unknown / no-batches → any SQL touching `attendance / candidates / assessments / feedback` is refused with `"caller has no batch access"`.
3. **Postgres `SET LOCAL statement_timeout = 5000`** caps execution at 5 s.

**Schema introspection** — the column list in the planning prompt is built at first use by querying `information_schema.columns` for the whitelisted tables. Hand-curated **business rules** (enum values, naming gotchas, attendance-percent formula, date-filter idioms) live alongside in `BUSINESS_RULES` because the DB can't describe those. This kills the class of bug where the prompt and the live schema drift apart.

**Platform-aware help mode** — when the model classifies a question as a how-to / navigation question (e.g. *"How do I create a new batch?"*), it returns a JSON shape with `mode: "help"`, an ordered `steps` array, and a `navigate_to` URL (allow-listed client-side against the real route table — see `HelpCard` in `CopilotPanel.tsx`). The panel renders a "Take me there →" button that uses `wouter` to jump to the right page and closes the slide-over so the user lands unobstructed. Audit rows are written as `copilot.help` (no SQL involved) for the dedicated `/audit` admin page.

**Activity feed hygiene** — `audit_logs` records every Copilot interaction, but the Dashboard's **Recent Activity** card filters them out (`entityType !== 'copilot'`). That card is for *real* coordinator work — creating batches, marking attendance, importing candidates — and "asked a question" is noise there. The full Copilot trail is still visible to admins on `/audit`.

**RAG context** — when Supabase has a `match_rag` RPC available, the user's question is embedded with the same Azure embedding deployment used by the legacy chatbot, the top 5 matching chunks are pulled, and the joined text is prepended to the system prompt for grounding. Failure is silent — RAG is best-effort, never blocks the request.

**Data tables**

- `copilot_usage` — per-call ledger (query text, generated SQL, row count, prompt / completion / total tokens, estimated INR cost, helpful flag). Migration: [`lib/db/migrations/0002_copilot_usage.sql`](lib/db/migrations/0002_copilot_usage.sql), applied with `python scripts/apply_copilot_migration.py`.
- `audit_logs` — every Copilot call writes `action='copilot.query'` (or `.rejected` / `.timeout` / `.narrate`) with the query, SQL, row count, and user id in the details JSON.

**Cost model** — `total_tokens / 1000 × 0.166` INR (GPT-4.1 at ≈ $0.002 per 1 K tokens × 83 INR/USD). The panel footer shows running `Session: X tokens · ₹Y.YY`. The admin-only `usage-stats` endpoint surfaces today's totals and top 5 queries.

**Suggested starter queries** (shown as chips when the conversation is empty):

1. "Which batches have attendance below 80% this week?"
2. "Who are the top 5 candidates in the current batch?"
3. "Generate a summary for this batch"
4. "Show attendance trends for the past month"

**Tests** — `pytest services/ai/tests` runs 8 tests: 6 SQL-validator unit tests + 2 router auth-gate tests. All pass.

**Files**

| Path | Role |
|------|------|
| `services/ai/app/utils/sql_validator.py` | Safety validator (whitelist + keyword block) |
| `services/ai/app/routers/copilot.py` | FastAPI router (`/copilot/*`) — schema introspection, RAG, batch-scope, SSE |
| `services/ai/tests/test_sql_validator.py` | Validator unit tests |
| `services/ai/tests/test_copilot_router.py` | Router 401 tests |
| `lib/db/migrations/0002_copilot_usage.sql` | `copilot_usage` table |
| `scripts/apply_copilot_migration.py` | One-shot migration runner |
| `artifacts/api-server/src/routes/copilot.ts` | Node proxy (SSE pipe + admin RBAC) |
| `artifacts/maverick/src/components/CopilotPanel.tsx` | React slide-over panel |
| `artifacts/maverick/src/components/layout/Header.tsx` | Hosts the **Copilot** button |

---

## Autonomous Batch Monitoring Agent

A rule-driven agent that scans every running batch on a schedule (or on demand), creates `monitoring_alerts` rows when health metrics breach thresholds, and fans out emails to the trainer + coordinator. Per spec, **admins see everything in the dashboard but are NOT emailed by default**. Coordinators can trigger an on-demand scan; admins additionally control thresholds and the email log.

**Routes**

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| POST | `/api/monitoring/run` | admin, coordinator | Trigger an on-demand scan. Inserts an `agent_runs` row, runs the 8 rules across all `running` batches, creates alerts, fans out emails. |
| GET  | `/api/monitoring/alerts` | all | Scoped alert inbox (`?status=open&severity=HIGH&kind=…&batchId=…`). |
| PATCH | `/api/monitoring/alerts/:id` | all (own scope) | `{action: "acknowledge"\|"resolve"\|"dismiss"}` |
| GET  | `/api/monitoring/batch-risk` | all | Per-batch risk summary from `batch_risk_summary` view, scoped to the caller. |
| GET  | `/api/monitoring/batch-risk/:id` | all | Drill-down: batch + summary + last 50 alerts. |
| GET  | `/api/monitoring/config` | all | Read thresholds + scheduler cron. |
| PATCH | `/api/monitoring/config` | admin | Update thresholds + scheduler config. |
| GET  | `/api/monitoring/email-log` | admin | Every email the agent dispatched. |
| POST | `/internal/email/send` | x-internal-token | Used by the Python AI service to render-and-send via the Node email pipeline. |
| POST | `/internal/monitoring/scan` | x-internal-token | Used by the Python AI fallback path to delegate a scan to Node. |

**The 8 rules**

1. `attendance_not_uploaded` — no attendance row for today.
2. `low_attendance_pct` — 14-day batch attendance below `attendance_batch_threshold_pct` (default 75 %).
3. `attendance_drop` — last-7-days vs prior-7-days drop above `attendance_drop_threshold_pct` (default 10 %).
4. `low_clearance_rate` — assessment pass rate below `clearance_threshold_pct` (default 60 %). CRITICAL severity.
5. `assessment_overdue` — assessment scheduled but no upload past the deadline.
6. `continuous_absence` — candidate absent for `consecutive_absence_days` (default 3) days in a row.
7. `low_individual_attendance` — candidate 14-day attendance below `attendance_candidate_threshold_pct` (default 70 %).
8. `low_assessment_marks` — latest assessment score below `assessment_pass_threshold_pct` (default 40 %).

**Idempotency** — the engine refuses to create a second open alert for the same `(batch_id, candidate_id, alert_kind, day)` tuple. Running the scan twice in a row produces **0 new alerts** on the second pass (verified in smoke test #5).

**Scheduler** — disabled by default. `ENABLE_MONITORING_SCHEDULER=true` boots the cron loop, which reads its expression from `monitoring_config.scheduler_cron` (default `0 11 * * *`). The scheduler prefers the Python `/ai/agent/run` path and falls back to the Node rule engine if AI is unreachable. Requires `node-cron` (already in `artifacts/api-server/package.json`).

**Email transport** — `lib/email.ts` uses **nodemailer** when SMTP env vars are set; otherwise a **console transport** that pretty-prints the email to stdout. Every send (success OR failure) is persisted to `monitoring_email_log` with the provider tag.

**Recipient rules** (`monitoring_config`)

| Flag | Default | Effect |
|------|---------|--------|
| `email_trainer` | true | Trainers assigned to the batch via `batch_trainers` get every alert for that batch. |
| `email_coordinator` | true | The batch's `coordinator_id` gets every alert. |
| `email_admin` | **false** | Admins are NOT emailed by default — they see everything in the UI. Flip to true if needed. |

**AI summary** — v1 uses a deterministic composer in `composeBatchSummary()` so demos are byte-stable. A follow-up will optionally pipe the per-batch report through `/ai/agent/run` for a real LLM summary.

**Frontend**

- Compact **Monitoring** card on the main Dashboard (worst risk level + open-alert count + "View →" link).
- Full page at **`/monitoring`** with four tabs: Overview, Alerts inbox, Email log (admin), Config (admin).
- Drill-down at **`/monitoring/batch/:batchId`**.
- Sidebar entry "Monitoring" with the `ShieldAlert` icon, visible to all 3 roles.

**Files**

| Path | Role |
|------|------|
| `lib/db/migrations/0003_batch_monitoring_agent.sql` | 3 tables + view + 5 functions + RLS policies |
| `lib/db/src/schema/monitoring.ts` | Drizzle schema |
| `scripts/apply_monitoring_migration.py` | One-shot migration runner |
| `artifacts/api-server/src/lib/email.ts` | nodemailer + console fallback; writes to `monitoring_email_log` |
| `artifacts/api-server/src/lib/monitoring-engine.ts` | The 8 rules + `runMonitoringScan()` |
| `artifacts/api-server/src/lib/monitoring-recipients.ts` | Trainer / coordinator / admin resolver |
| `artifacts/api-server/src/lib/monitoring-templates.ts` | Plain-text email templates |
| `artifacts/api-server/src/lib/scheduler.ts` | node-cron loop, opt-in via env |
| `artifacts/api-server/src/routes/monitoring.ts` | 8 user-facing REST endpoints |
| `artifacts/api-server/src/routes/internal.ts` | `x-internal-token` routes for the Python AI service |
| `artifacts/maverick/src/lib/monitoring-api.ts` | TanStack Query hooks |
| `artifacts/maverick/src/pages/Monitoring.tsx` | Main page (4 tabs) |
| `artifacts/maverick/src/pages/BatchRiskDetail.tsx` | Drill-down |
| `artifacts/maverick/src/components/monitoring/{AlertCard,BatchRiskCard,RiskBadge}.tsx` | UI primitives |

**Env vars**

| Var | Default | Effect |
|---|---|---|
| `ENABLE_MONITORING_SCHEDULER` | unset | `true` starts the cron loop at boot |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | unset | If set, real emails via nodemailer; otherwise console transport |
| `AI_SERVICE_URL` | `http://localhost:9000` | Used by `scheduler.ts` when it prefers the Python LLM agent |
| `AI_INTERNAL_TOKEN` / `INTERNAL_SHARED_SECRET` | `smoke-test-secret-1234567890` | Shared secret for `/internal/*` routes |
| `AI_AGENT_TIMEOUT_MS` | 90000 | Scheduler's AI call timeout |

**Demo flow for judges**

1. Open `/monitoring`. The Overview tab shows per-batch risk cards.
2. Click **Run scan now** (top right). A toast reports e.g. *"1 batch scanned, 1 new alert, 3 emails sent"*.
3. Switch to **Alerts** tab — the new alert appears with Acknowledge / Resolve / Dismiss buttons.
4. Click a batch card on Overview → drill-down at `/monitoring/batch/:id` shows the batch's full alert history + current health metrics.
5. As **admin**, open **Email log** tab — every fanned-out email is listed (recipient + role + subject + provider).
6. As **admin**, open **Config** tab — adjust thresholds; the next scan picks them up.
7. Run scan a second time → digest reports **0 new alerts** (idempotency).

**Rollback**

```bash
# Drop the 3 tables + view + 4 functions added by 0003 — leaves the rest
# of the DB untouched.
psql "$DATABASE_URL" <<'SQL'
DROP VIEW IF EXISTS batch_risk_summary;
DROP TABLE IF EXISTS monitoring_alerts, monitoring_email_log, monitoring_config CASCADE;
DROP FUNCTION IF EXISTS batch_attendance_drop_pct(int) CASCADE;
DROP FUNCTION IF EXISTS candidate_attendance_pct(int, int) CASCADE;
DROP FUNCTION IF EXISTS batch_candidates_below_attendance(int, numeric, int) CASCADE;
DROP FUNCTION IF EXISTS batch_candidates_low_assessment(int, numeric) CASCADE;
DROP FUNCTION IF EXISTS batch_trainer_emails(int) CASCADE;
SQL
# Then: git revert <V4 merge commit> on the app side.
```

**Known limitations**

1. RLS policies in migration 0003 are installed but bypassed at runtime — the api-server connects with the service-role connection string, so the policies are defense-in-depth for any direct PostgREST consumers, not the app itself.
2. The `aiSummary` field on each alert/digest is composed deterministically; piping through the FastAPI service for a real LLM narrative is a follow-up.
3. SMTP not configured → emails go through the console transport. They're still logged with `provider='console'` and visible on the Email log tab.

---

## V5 — Trainer Intelligence, AI Scoring, Feedback Intelligence, Demo Test Suite

V5 adds four orthogonal features to the platform. Every one of them is **additive only** — no existing table, route, or component was modified; only new migrations (`0004_trainer_scores.sql`, `0005_feedback_intelligence.sql`), new routes (`/api/trainers/*`, `/api/trainer-scoring/*`, `/api/feedback-intelligence/*`), and new FastAPI routers (`trainer_scoring`, `feedback_intelligence`) were added.

### Feature 1 — Trainer Intelligence Graph

A 3-tier SVG network at `/trainers/:id` showing trainer → batches → candidates with hover tooltips, click-to-highlight per batch, and 4 summary KPI tiles. Pure SVG layout (no D3, no new packages — recharts and shadcn/ui only).

| Path | Role |
|---|---|
| `GET /api/trainers/:trainerId/graph` | All roles via auth middleware; returns `{trainer, nodes, edges, summary}` |
| `artifacts/api-server/src/routes/trainers.ts` | Drizzle query: trainer → batch_trainers → batches → candidates, with attendance % per batch and AVG(score/max_score)*100 per candidate |
| `artifacts/maverick/src/components/TrainerGraph.tsx` | Color-coded SVG (trainer=blue / batch status / candidate score band) |
| `artifacts/maverick/src/pages/TrainerDetail.tsx` | Page mount, admin + coordinator only |
| `artifacts/maverick/src/pages/Users.tsx` | BrainCircuit icon next to each trainer row → `/trainers/:id` |

### Feature 2 — AI Trainer Scoring Engine

GPT-4.1 scores a trainer's effectiveness on a per-batch basis using attendance %, assessment pass rate, and feedback samples. Persists to `trainer_scores` (UPSERT on `(trainer_id, batch_id)`) and writes an `audit_logs` row per scoring. UI is a recharts donut + 3 horizontal sub-score bars + reasoning + strengths/improvements columns + Re-score button.

| Path | Role |
|---|---|
| `lib/db/migrations/0004_trainer_scores.sql` | New table — id uuid PK, trainer_id+batch_id FK to users/batches, scores + jsonb breakdown |
| `services/ai/app/routers/trainer_scoring.py` | `POST /trainer-scoring/score`, `GET /trainer-scoring/score/{trainer_id}/{batch_id}` |
| `artifacts/api-server/src/routes/trainer-scoring.ts` | Node proxy (auth gate + x-internal-token fan-out) |
| `artifacts/maverick/src/components/TrainerScoreCard.tsx` | Donut + bars + reasoning + strengths/improvements + Re-score |

### Feature 3 — Feedback Intelligence Engine

GPT-4.1 extracts themes, an overall sentiment, a sentiment score, and prioritized recommended actions from a batch's feedback. Persists to a NEW table `feedback_intelligence` (kept separate from the legacy `feedback_analysis` from migration 0001 — the project rule is "do not modify existing tables").

Empty states surfaced cleanly:
- Never analysed → `Analyze Feedback` CTA
- < 2 feedback rows → amber alert *"Add at least 2 feedback entries to enable AI analysis"*
- analyzing → *"Analyzing feedback with AI…"* with pulse animation

| Path | Role |
|---|---|
| `lib/db/migrations/0005_feedback_intelligence.sql` | id uuid PK · UNIQUE(batch_id) · themes / recommended_actions jsonb |
| `services/ai/app/routers/feedback_intelligence.py` | `POST /feedback-intelligence/analyze`, `GET /feedback-intelligence/analysis/{batch_id}` |
| `artifacts/api-server/src/routes/feedback-intelligence.ts` | Node proxy |
| `artifacts/maverick/src/components/FeedbackIntelligenceCard.tsx` | Summary + sentiment badge + themes grid + recommended actions list |
| `artifacts/maverick/src/pages/BatchDetail.tsx` | Card appended at the bottom (no existing tabs/sections removed) |

### Feature 4 — Demo Test Suite for the Monitoring Agent

Three TypeScript scripts under `scripts/src/` that seed a self-contained scenario the monitoring agent will fire on, trigger a scan, and clean up afterwards. Uses `pg` directly (the same driver Drizzle uses), no new packages.

```bash
pnpm run demo:seed           # inserts 1 coordinator + 1 batch + 5 candidates + 35 attendance + 1 overdue assessment
pnpm run demo:trigger        # POSTs /api/monitoring/run, prints the test report
pnpm run demo:cleanup        # default mark mode — prepends "[ARCHIVED]" to demo rows (safe)
pnpm run demo:cleanup:delete # hard delete in FK-safe order
```

Trigger output captures: alerts created (across all 8 monitoring rules), emails fanned out (provider tag + per-recipient), `agent_runs` count (monitoring agent's audit trail), and SMTP misconfiguration warnings. Saves inserted IDs to `scripts/demo-test-ids.json` so the trigger and cleanup scripts can locate the same rows.

---

## Running locally — secret-key checklist

The platform needs **three** env files (none committed to git). After cloning, copy each `.env.example` to `.env` in the same directory and fill in real values:

| File | Vars |
|---|---|
| `.env` (repo root) | `DATABASE_URL`, `PORT`, `NODE_ENV`, `INTERNAL_SHARED_SECRET` / `AI_INTERNAL_TOKEN` (same value), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` |
| `services/ai/.env` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` (e.g. `gpt-4.1`), `AZURE_OPENAI_API_VERSION` (e.g. `2024-12-01-preview`), `AZURE_OPENAI_EMBEDDING_DEPLOYMENT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `INTERNAL_SHARED_SECRET` (must match root) |
| `artifacts/maverick/.env` | `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` |

**Once env files are in place:**

```powershell
# DB migrations (first-time only)
python scripts/apply_copilot_migration.py
python scripts/apply_monitoring_migration.py
python scripts/apply_trainer_scores_migration.py
python scripts/apply_feedback_intelligence_migration.py

# Terminal 1 — Node API
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start

# Terminal 2 — Frontend
$env:PORT="5173"; $env:BASE_PATH="/"
pnpm --filter @workspace/maverick run dev

# Terminal 3 — Python AI service
cd services/ai
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 9000
```

**Verify:** `http://localhost:8080/api/healthz` → `{"status":"ok"}`, `http://localhost:5173/` → 200, `http://localhost:9000/healthz` → `{"ok":true}`.

---

## Product modules

| Module | Description |
|--------|-------------|
| **Dashboard** | KPIs, attendance trends, pipeline charts, activity feed |
| **Batches** | CRUD, trainer assignment, status lifecycle |
| **Candidates** | Profiles and status (active → discontinued / cleared / offered / onboarded) |
| **Attendance** | Daily roster, bulk CSV, export |
| **Assessments** | Sprint reviews, coding, API tests, project evaluations |
| **Toppers** | Weighted Composite Score (WCS) leaderboard — see `replit.md` |
| **Feedback** | Satisfaction tracking with sentiment |
| **Notifications** | Per-user alerts |
| **Users** | RBAC: admin, coordinator, trainer |
| **Audit logs** | System-wide action timeline |
| **Reports** | Admin / coordinator reporting |

**Roles**

| Role | Typical access |
|------|----------------|
| Admin | Full access including Users |
| Coordinator | Settings, audit, reports |
| Trainer | Operational modules (batches, attendance, etc.) |

---

## Development commands

```bash
pnpm run typecheck                              # Typecheck libs + artifacts
pnpm run build                                  # Build all packages
pnpm --filter @workspace/api-spec run codegen   # Regenerate Zod + React hooks from OpenAPI
pnpm --filter @workspace/db run push            # Push schema to PostgreSQL (dev)
```

**After changing `lib/api-spec/openapi.yaml`:** run `codegen`, then restart the API workflow.

**After changing `lib/db/src/schema/*`:** run `db push`.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `DATABASE_URL must be set` | Set `DATABASE_URL` in Replit Secrets or local `.env` |
| `PORT environment variable is required` | Set `PORT` before starting API or Vite |
| `Use pnpm instead` | Install pnpm; do not use `npm install` at root |
| API changes not reflected | API `dev` rebuilds on start — restart the process |
| `/api` 404 locally | Add Vite proxy to port 8080 or use Replit |
| Type errors after API change | Run `pnpm --filter @workspace/api-spec run codegen` |

For deeper architecture notes (WCS formula, date handling, enrichment pattern), see **[replit.md](replit.md)**.

---

## License

MIT — see repository license file if present.
