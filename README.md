# Maverick Execution Platform

Enterprise **Training Management System (TMS)** for running training programmes end to end: batches, candidates, trainers, attendance, assessments, toppers (leaderboards), feedback, notifications, reports, and audit logs. Role-based access supports **Admin**, **Coordinator**, and **Trainer** workflows.

---

## Table of contents

- [Architecture](#architecture)
- [Application flow](#application-flow)
- [Tech stack](#tech-stack)
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

**Auth model:** Stateless **Base64 JSON tokens** (not JWT). The frontend stores the token in `localStorage` under `maverick_token` and sends `Authorization: Bearer <token>` on API calls. There is **no separate third-party API key** (OpenAI, etc.) in this codebase.

---

## Tech stack

| Area | Technology |
|------|------------|
| Runtime | Node.js **24** (see `.replit`) |
| Package manager | **pnpm** workspaces (required; npm/yarn blocked) |
| Language | TypeScript **5.9** |
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Recharts, wouter |
| API | Express 5, Pino logging |
| Database | PostgreSQL **16**, Drizzle ORM |
| Validation | Zod (`@workspace/api-zod`) |
| Client data | TanStack Query v5 (generated hooks) |
| API codegen | Orval from OpenAPI |

---

## Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| **Node.js** | 20+ locally; **24** on Replit (`nodejs-24` module) |
| **pnpm** | 9+ — install globally: `npm install -g pnpm` |
| **PostgreSQL** | 15+ locally, or hosted (Neon, Supabase, Railway, Replit DB) |
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

You need **two processes** (API + frontend). See [Run locally](#run-locally-windows--macos--linux) or [Run on Replit](#run-on-replit).

---

## Configuration and secrets

This app does **not** use external AI or payment API keys. Configuration is **environment variables** for the database, ports, and optional logging.

### What to configure

| Variable | Required | Used by | Description |
|----------|----------|---------|-------------|
| **`DATABASE_URL`** | **Yes** | `lib/db`, Drizzle | PostgreSQL connection string |
| **`PORT`** | **Yes** | API server & Vite | Listen port (see [ports table](#default-ports-and-routing)) |
| **`BASE_PATH`** | **Yes** (frontend) | Maverick Vite app | URL base path (usually `/`) |
| `NODE_ENV` | Optional | API, Vite | `development` or `production` |
| `LOG_LEVEL` | Optional | API logger | Default `info` |
| `SESSION_SECRET` | Documented only | — | Mentioned in `replit.md` for future use; **auth currently uses stateless Base64 tokens** and does not read this variable |

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

### Terminal 1 — API server

```bash
# Set env vars first (see Configuration section)
pnpm --filter @workspace/api-server run dev
```

> On **Windows**, the package script uses `export NODE_ENV=development` (Unix-only). Either use **Git Bash**, **WSL**, or run build + start manually:
>
> ```powershell
> $env:NODE_ENV = "development"
> $env:PORT = "8080"
> pnpm --filter @workspace/api-server run build
> pnpm --filter @workspace/api-server run start
> ```

### Terminal 2 — Frontend

```bash
$env:PORT = "5173"          # PowerShell
$env:BASE_PATH = "/"        # PowerShell
pnpm --filter @workspace/maverick run dev
```

Open **http://localhost:5173** (or the port Vite prints).

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
