/**
 * Public-facing routes for the autonomous batch monitoring agent.
 *
 *   GET    /api/monitoring/alerts             List alerts (filter by status/kind/severity/batch)
 *   PATCH  /api/monitoring/alerts/:id         Update an alert (acknowledge / resolve / dismiss)
 *   GET    /api/monitoring/batch-risk         All batches with their current risk summary
 *   GET    /api/monitoring/batch-risk/:id     Risk drill-down for one batch
 *   GET    /api/monitoring/config             Read the monitoring thresholds
 *   PATCH  /api/monitoring/config             (admin) Update thresholds + scheduler config
 *   GET    /api/monitoring/email-log          (admin) See every email sent by the agent
 *   POST   /api/monitoring/run                (admin/coordinator) Trigger an on-demand scan
 *
 * Role rules:
 *   - admin       — full access
 *   - coordinator — read access to their own batches' alerts/risk; can trigger runs
 *   - trainer     — read-only access to alerts for batches they teach
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  monitoringAlertsTable,
  monitoringEmailLogTable,
  monitoringConfigTable,
  batchesTable,
  candidatesTable,
  batchTrainersTable,
  type MonitoringConfig,
} from "@workspace/db";
import { authMiddleware, requireRole } from "../middlewares/auth";
import { runMonitoringScan } from "../lib/monitoring-engine";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers — scope filtering for non-admin users
// ---------------------------------------------------------------------------

async function visibleBatchIds(req: Request): Promise<number[] | null> {
  // null = "all batches" (admin). Number[] = "only these batches".
  if (req.userRole === "admin") return null;
  if (req.userRole === "coordinator") {
    const rows = await db.select({ id: batchesTable.id }).from(batchesTable)
      .where(eq(batchesTable.coordinatorId, req.userId!));
    return rows.map((r) => r.id);
  }
  if (req.userRole === "trainer") {
    const rows = await db.select({ id: batchTrainersTable.batchId }).from(batchTrainersTable)
      .where(eq(batchTrainersTable.trainerId, req.userId!));
    return rows.map((r) => r.id);
  }
  return [];
}

// ---------------------------------------------------------------------------
// GET /api/monitoring/alerts
// ---------------------------------------------------------------------------
router.get("/monitoring/alerts", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { status, severity, kind, batchId } = req.query as Record<string, string | undefined>;
  const conds = [] as ReturnType<typeof eq>[];
  if (status) conds.push(eq(monitoringAlertsTable.status, status));
  if (severity) conds.push(eq(monitoringAlertsTable.severity, severity));
  if (kind) conds.push(eq(monitoringAlertsTable.alertKind, kind));
  if (batchId) conds.push(eq(monitoringAlertsTable.batchId, Number(batchId)));

  const scope = await visibleBatchIds(req);
  if (scope != null) {
    if (scope.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(monitoringAlertsTable.batchId, scope));
  }

  const rows = await db.select().from(monitoringAlertsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(monitoringAlertsTable.createdAt))
    .limit(200);

  // Hydrate batch/candidate names (one-shot lookup so we don't N+1 query).
  const batchIdSet = [...new Set(rows.map((r) => r.batchId).filter(Boolean) as number[])];
  const candIdSet = [...new Set(rows.map((r) => r.candidateId).filter(Boolean) as number[])];
  const batchesMap = batchIdSet.length
    ? Object.fromEntries((await db.select().from(batchesTable).where(inArray(batchesTable.id, batchIdSet))).map((b) => [b.id, b]))
    : {};
  const candidatesMap = candIdSet.length
    ? Object.fromEntries((await db.select().from(candidatesTable).where(inArray(candidatesTable.id, candIdSet))).map((c) => [c.id, c]))
    : {};

  res.json(rows.map((r) => ({
    ...r,
    batchCode: r.batchId ? batchesMap[r.batchId]?.batchCode ?? null : null,
    batchName: r.batchId ? batchesMap[r.batchId]?.name ?? null : null,
    candidateName: r.candidateId ? candidatesMap[r.candidateId]?.name ?? null : null,
  })));
});

// ---------------------------------------------------------------------------
// PATCH /api/monitoring/alerts/:id — acknowledge / resolve / dismiss
// ---------------------------------------------------------------------------
router.patch("/monitoring/alerts/:id", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const action = req.body?.action as string | undefined;
  if (!action || !["acknowledge", "resolve", "dismiss"].includes(action)) {
    res.status(400).json({ error: "action must be acknowledge | resolve | dismiss" });
    return;
  }

  const updates: Partial<typeof monitoringAlertsTable.$inferInsert> = {};
  const now = new Date();
  if (action === "acknowledge") {
    updates.status = "acknowledged";
    updates.acknowledgedBy = req.userId!;
    updates.acknowledgedAt = now;
  } else if (action === "resolve") {
    updates.status = "resolved";
    updates.resolvedBy = req.userId!;
    updates.resolvedAt = now;
  } else {
    updates.status = "dismissed";
    updates.resolvedBy = req.userId!;
    updates.resolvedAt = now;
  }

  const [row] = await db.update(monitoringAlertsTable).set(updates)
    .where(eq(monitoringAlertsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "alert not found" });
    return;
  }
  res.json(row);
});

// ---------------------------------------------------------------------------
// GET /api/monitoring/batch-risk — risk summary, all visible batches
// ---------------------------------------------------------------------------
router.get("/monitoring/batch-risk", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const scope = await visibleBatchIds(req);
  if (scope != null && scope.length === 0) {
    res.json([]);
    return;
  }

  // Pull the full view and post-filter in JS.
  // Why not a WHERE batch_id = ANY(${scope}::int[])? Drizzle's sql tag
  // splats JS arrays into positional params, which Postgres rejects as
  // "ANY((1,2,3)::int[])" — invalid syntax. The batch list is small
  // (tens, not millions), so a JS filter is the safe cross-version path.
  const result = await db.execute(sql`
    select * from batch_risk_summary
    order by critical_alerts desc, high_alerts desc, attendance_pct_14d asc
  `);
  const raw = ((result.rows ?? result) as Record<string, unknown>[]);
  const rows = scope == null ? raw : raw.filter((r) => scope.includes(Number(r.batch_id)));
  res.json(rows.map((r) => ({
    batchId: Number(r.batch_id),
    batchCode: String(r.batch_code),
    batchName: String(r.batch_name),
    program: String(r.program),
    status: String(r.status),
    coordinatorId: r.coordinator_id == null ? null : Number(r.coordinator_id),
    activeCandidates: Number(r.active_candidates),
    attendancePct: Number(r.attendance_pct_14d),
    attendanceDropPct: Number(r.attendance_drop_pct),
    clearancePct: Number(r.clearance_pct),
    openAlerts: Number(r.open_alerts),
    criticalAlerts: Number(r.critical_alerts),
    highAlerts: Number(r.high_alerts),
    riskLevel: computeRisk(Number(r.critical_alerts), Number(r.high_alerts), Number(r.open_alerts)),
  })));
});

function computeRisk(crit: number, high: number, open: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (crit > 0) return "CRITICAL";
  if (high > 0) return "HIGH";
  if (open > 0) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// GET /api/monitoring/batch-risk/:id — drill-down
// ---------------------------------------------------------------------------
router.get("/monitoring/batch-risk/:id", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const batchId = Number(req.params.id);
  if (!Number.isFinite(batchId)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const scope = await visibleBatchIds(req);
  if (scope != null && !scope.includes(batchId)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId)).limit(1);
  if (!batch) {
    res.status(404).json({ error: "batch not found" });
    return;
  }
  const alerts = await db.select().from(monitoringAlertsTable)
    .where(eq(monitoringAlertsTable.batchId, batchId))
    .orderBy(desc(monitoringAlertsTable.createdAt))
    .limit(50);

  const summaryRes = await db.execute(sql`select * from batch_risk_summary where batch_id = ${batchId}`);
  const summary = ((summaryRes.rows ?? summaryRes) as Record<string, unknown>[])[0] ?? null;

  // Hydrate candidate names
  const cids = [...new Set(alerts.map((a) => a.candidateId).filter(Boolean) as number[])];
  const cMap = cids.length
    ? Object.fromEntries((await db.select().from(candidatesTable).where(inArray(candidatesTable.id, cids))).map((c) => [c.id, c]))
    : {};

  res.json({
    batch: {
      id: batch.id,
      batchCode: batch.batchCode,
      name: batch.name,
      program: batch.program,
      status: batch.status,
      coordinatorId: batch.coordinatorId,
    },
    summary: summary
      ? {
          activeCandidates: Number(summary.active_candidates),
          attendancePct: Number(summary.attendance_pct_14d),
          attendanceDropPct: Number(summary.attendance_drop_pct),
          clearancePct: Number(summary.clearance_pct),
          openAlerts: Number(summary.open_alerts),
          criticalAlerts: Number(summary.critical_alerts),
          highAlerts: Number(summary.high_alerts),
          riskLevel: computeRisk(Number(summary.critical_alerts), Number(summary.high_alerts), Number(summary.open_alerts)),
        }
      : null,
    alerts: alerts.map((a) => ({
      ...a,
      candidateName: a.candidateId ? cMap[a.candidateId]?.name ?? null : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/monitoring/config
// ---------------------------------------------------------------------------
router.get("/monitoring/config", authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  const [cfg] = await db.select().from(monitoringConfigTable).where(eq(monitoringConfigTable.id, 1)).limit(1);
  res.json(cfg ?? null);
});

// ---------------------------------------------------------------------------
// PATCH /api/monitoring/config (admin)
// ---------------------------------------------------------------------------
router.patch("/monitoring/config", authMiddleware, requireRole("admin"), async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const updates: Partial<MonitoringConfig> = {};
  const fields: Array<keyof MonitoringConfig> = [
    "attendanceBatchThresholdPct",
    "attendanceDropThresholdPct",
    "attendanceCandidateThresholdPct",
    "assessmentPassThresholdPct",
    "clearanceThresholdPct",
    "consecutiveAbsenceDays",
    "assessmentOverdueDays",
    "emailTrainer",
    "emailCoordinator",
    "emailAdmin",
    "schedulerEnabled",
    "schedulerCron",
  ];
  for (const f of fields) {
    if (body[f] !== undefined) (updates as Record<string, unknown>)[f] = body[f];
  }
  (updates as Record<string, unknown>).updatedBy = req.userId!;

  const [row] = await db.update(monitoringConfigTable).set(updates as never)
    .where(eq(monitoringConfigTable.id, 1))
    .returning();
  res.json(row);
});

// ---------------------------------------------------------------------------
// GET /api/monitoring/email-log (admin)
// ---------------------------------------------------------------------------
router.get("/monitoring/email-log", authMiddleware, requireRole("admin"), async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.select().from(monitoringEmailLogTable)
    .orderBy(desc(monitoringEmailLogTable.createdAt))
    .limit(200);
  res.json(rows);
});

// ---------------------------------------------------------------------------
// POST /api/monitoring/run — trigger an on-demand scan
// ---------------------------------------------------------------------------
router.post("/monitoring/run", authMiddleware, requireRole("admin", "coordinator"), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await runMonitoringScan({ triggeredBy: `user:${req.userId}` });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "scan failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
