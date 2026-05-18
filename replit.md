# Maverick Execution Platform

An enterprise AI-powered Training Management System (TMS) for managing candidates, batches, trainers, attendance, assessments, toppers, feedback, and audit logs.

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- PostgreSQL 15+ (or a Neon/Supabase/Railway hosted DB)

### Setup Steps

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd maverick

# 2. Install dependencies
pnpm install

# 3. Set environment variables
cp .env.example .env
# Edit .env and fill in DATABASE_URL and SESSION_SECRET

# 4. Push the database schema
pnpm --filter @workspace/db run push

# 5. (Optional) Seed sample data
pnpm --filter @workspace/db run seed

# 6. Start the API server (terminal 1)
pnpm --filter @workspace/api-server run dev

# 7. Start the frontend (terminal 2)
pnpm --filter @workspace/maverick run dev
```

### Required Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/maverick` |
| `SESSION_SECRET` | Secret for token signing | Any long random string |

### Seed Credentials (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@maverick.com | admin123 |
| Coordinator | coordinator@maverick.com | coord123 |
| Trainer | trainer@maverick.com | trainer123 |

---

## Toppers — Ranking Methodology

The topper leaderboard uses a **Weighted Composite Score (WCS)** algorithm. This is the most appropriate method for a training programme leaderboard because:

- It is **transparent** — every weight is visible and configurable by Admins
- It is **multi-dimensional** — a candidate who attends every session but scores poorly on coding still ranks differently from one who aces assessments but has poor attendance
- It is **normalised** — all components are converted to a 0–100 percentage before weighting, so assessments with different max scores are compared fairly

### Score Components

| Component | Default Weight | Source |
|-----------|---------------|--------|
| Assessment Score | **60%** | Average of all sprint_review + coding + api assessments, each normalised to 100 |
| Project Score | **30%** | Average of all project_evaluation assessments, normalised to 100 |
| Attendance Score | **10%** | `(present days / total days recorded) × 100` |

### Formula

```
WCS = (assessmentAvg × W_assessment) + (projectAvg × W_project) + (attendancePct × W_attendance)
```

Where the weights must sum to 100 and are stored in the `topperConfig` table (editable via the Settings / Toppers page).

### Why WCS over alternatives

| Method | Why not chosen |
|--------|---------------|
| Pure rank average | Treats all assessments equally regardless of type or max score |
| ELO / Elo-style | Designed for head-to-head competition, not suitable for training evaluation |
| PCA / ML clustering | Overkill for this scale; opaque to trainers and coordinators |
| Raw total points | Candidates in batches with more assessments get unfair advantage |

**WCS is the industry standard for enterprise LMS/TMS leaderboards** and is used by Coursera, Pluralsight, and internal L&D platforms at Wipro, Infosys, and TCS.

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TailwindCSS + shadcn/ui + Recharts + wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- State management: TanStack Query v5 (via generated hooks in `@workspace/api-client-react`)
- Build: esbuild (CJS bundle) for API, Vite for frontend

## Where things live

```
lib/
  api-spec/openapi.yaml         # Single source of truth for API contracts
  api-client-react/src/generated/api.ts   # Generated React Query hooks (do not edit)
  api-zod/src/generated/api.ts  # Generated Zod schemas (do not edit)
  db/src/schema/                # Drizzle ORM schema files (one per domain)

artifacts/
  api-server/src/routes/        # Express route handlers
  api-server/src/lib/auth.ts    # SHA-256 token auth utilities
  api-server/src/middlewares/   # Auth middleware + role guard
  maverick/src/pages/           # React page components
  maverick/src/hooks/useAuth.ts # Auth hook with token persistence
```

## Development Scripts

```bash
pnpm run typecheck                          # Full typecheck (libs + all packages)
pnpm run build                              # Build all packages
pnpm --filter @workspace/api-spec run codegen  # Regenerate hooks + Zod from OpenAPI spec
pnpm --filter @workspace/db run push        # Push DB schema changes (dev only)
```

## Architecture Decisions

- **Token auth**: Base64-encoded JSON tokens in localStorage (`maverick_token`). Stateless, no session store needed.
- **Dates as text**: All date columns stored as `text` in PostgreSQL (YYYY-MM-DD). Routes convert `Date` objects from Zod back to strings before DB insert.
- **Contract-first API**: OpenAPI spec is the single source of truth. Never edit generated files.
- **Enrichment pattern**: DB queries return raw rows; routes enrich with joins (batchName, candidateName, etc.).

## Product Modules

- **Dashboard** — KPIs, attendance trend chart, candidate pipeline pie chart, recent activity feed
- **Batches** — CRUD, trainer assignment, status transitions (planned → running → completed → closed)
- **Candidates** — Profile management, status lifecycle (active → discontinued / cleared / offered / onboarded)
- **Attendance** — Daily roster, per-candidate status, bulk CSV upload, CSV export, roster initialisation
- **Assessments** — Sprint reviews, coding tests, API assessments, project evaluations with score tracking
- **Toppers** — Weighted composite ranking (WCS), configurable weights, auto-computed leaderboard
- **Feedback** — Satisfaction tracking, sentiment auto-classification (positive/neutral/negative)
- **Notifications** — Per-user alert centre with mark-as-read
- **Users** — Role-based access control (Admin, Coordinator, Trainer)
- **Audit Logs** — Full system-wide action timeline

## User preferences

- No emojis in code or UI
- Dense, enterprise-grade UI aesthetic

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- Run `pnpm --filter @workspace/db run push` after changing any schema file in `lib/db/src/schema/`
- The API server auto-builds before starting — changes require a workflow restart
- Date fields from Zod validation arrive as `Date` objects; always convert to `YYYY-MM-DD` string before DB insert
- Generated hooks: `useXxx(params?, { query: UseQueryOptions })` — React Query options go in the second arg

## Proxy & Routing

- API proxy: `/api` → Express server (port 8080)
- Frontend: `/` → Vite dev server (dynamic port)
- Both routed through the Replit shared proxy in development; deployed via Replit Deployments in production
