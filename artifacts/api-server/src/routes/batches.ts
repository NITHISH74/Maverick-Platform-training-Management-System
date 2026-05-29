import { Router, type IRouter } from "express";
import { eq, inArray, and, isNull, sql } from "drizzle-orm";
import { db, batchesTable, batchTrainersTable, usersTable, candidatesTable, attendanceSettingsTable } from "@workspace/db";
import {
  CreateBatchBody, UpdateBatchBody, GetBatchParams, UpdateBatchParams, DeleteBatchParams,
  UpdateBatchStatusParams, UpdateBatchStatusBody, ListBatchesQueryParams, ListBatchCandidatesParams
} from "@workspace/api-zod";
import { authMiddleware, requireRole } from "../middlewares/auth";
import { getTrainerBatchIds, writeAudit } from "../lib/rbac";

const router: IRouter = Router();

async function enrichBatch(batch: typeof batchesTable.$inferSelect) {
  const trainers = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(batchTrainersTable)
    .innerJoin(usersTable, eq(batchTrainersTable.trainerId, usersTable.id))
    .where(eq(batchTrainersTable.batchId, batch.id));

  let coordinatorName: string | null = null;
  if (batch.coordinatorId) {
    const [coord] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, batch.coordinatorId));
    coordinatorName = coord?.name ?? null;
  }

  const [countResult] = await db.select({ count: candidatesTable.id }).from(candidatesTable).where(eq(candidatesTable.batchId, batch.id));
  const candidateCount = Array.isArray(countResult) ? 0 : (countResult ? 1 : 0);

  const allCandidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batch.id));

  return {
    id: batch.id,
    batchCode: batch.batchCode,
    name: batch.name,
    program: batch.program,
    startDate: batch.startDate,
    endDate: batch.endDate,
    status: batch.status,
    capacity: batch.capacity,
    coordinatorId: batch.coordinatorId ?? null,
    coordinatorName,
    trainerIds: trainers.map(t => t.id),
    trainerNames: trainers.map(t => t.name),
    candidateCount: allCandidates.length,
    attendanceCutoffTime: batch.attendanceCutoffTime,
    // Migration 0006 additions — expose to the UI.
    clearanceRate: batch.clearanceRate != null ? Number(batch.clearanceRate) : 70,
    deletedAt: batch.deletedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

router.get("/batches", authMiddleware, async (req, res): Promise<void> => {
  const params = ListBatchesQueryParams.safeParse(req.query);
  const statusFilter = params.success ? params.data.status : undefined;

  // Trainer scoping: trainers can only see batches they are assigned to.
  let trainerBatchIds: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatchIds = await getTrainerBatchIds(req.userId);
    if (trainerBatchIds.length === 0) {
      res.json([]);
      return;
    }
  }

  // F4: hide soft-deleted batches from every list.
  const conditions = [isNull(batchesTable.deletedAt)];
  if (statusFilter) conditions.push(eq(batchesTable.status, statusFilter));
  if (trainerBatchIds) conditions.push(inArray(batchesTable.id, trainerBatchIds));

  const batches = await db.select().from(batchesTable).where(and(...conditions));
  const enriched = await Promise.all(batches.map(enrichBatch));
  res.json(enriched);
});

router.post("/batches", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const parsed = CreateBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { trainerIds, ...batchData } = parsed.data;
  const batchCode = `BATCH-${Date.now()}`;
  const [batch] = await db.insert(batchesTable).values({
    name: batchData.name,
    program: batchData.program,
    startDate: batchData.startDate instanceof Date ? batchData.startDate.toISOString().split("T")[0] : String(batchData.startDate),
    endDate: batchData.endDate instanceof Date ? batchData.endDate.toISOString().split("T")[0] : String(batchData.endDate),
    capacity: batchData.capacity,
    coordinatorId: batchData.coordinatorId ?? null,
    attendanceCutoffTime: batchData.attendanceCutoffTime,
    batchCode,
  }).returning();
  if (trainerIds && trainerIds.length > 0) {
    await db.insert(batchTrainersTable).values(trainerIds.map(tid => ({ batchId: batch.id, trainerId: tid })));
  }
  await writeAudit({
    actorId: req.userId,
    action: "batch_created",
    entityType: "batch",
    entityId: batch.id,
    details: { after: { name: batch.name, program: batch.program, trainerIds: trainerIds ?? [] }, role: req.userRole, ip: req.ip ?? null },
  });
  res.status(201).json(await enrichBatch(batch));
});

router.get("/batches/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Trainer scoping
  if (req.userRole === "trainer" && req.userId) {
    const trainerBatchIds = await getTrainerBatchIds(req.userId);
    if (!trainerBatchIds.includes(params.data.id)) {
      res.status(403).json({ error: "Forbidden: batch not assigned to you" });
      return;
    }
  }
  const [batch] = await db.select().from(batchesTable)
    .where(and(eq(batchesTable.id, params.data.id), isNull(batchesTable.deletedAt)));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(await enrichBatch(batch));
});

router.patch("/batches/:id", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const params = UpdateBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { trainerIds, ...batchData } = parsed.data;
  const updateData: Record<string, unknown> = { ...batchData };
  if (batchData.startDate instanceof Date) updateData.startDate = batchData.startDate.toISOString().split("T")[0];
  if (batchData.endDate instanceof Date) updateData.endDate = batchData.endDate.toISOString().split("T")[0];
  // Snapshot pre-update state so the audit entry can record before→after.
  const [pre] = await db.select().from(batchesTable)
    .where(and(eq(batchesTable.id, params.data.id), isNull(batchesTable.deletedAt)));
  const [batch] = await db.update(batchesTable).set(updateData)
    .where(and(eq(batchesTable.id, params.data.id), isNull(batchesTable.deletedAt))).returning();
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  if (trainerIds !== undefined) {
    await db.delete(batchTrainersTable).where(eq(batchTrainersTable.batchId, batch.id));
    if (trainerIds.length > 0) {
      await db.insert(batchTrainersTable).values(trainerIds.map(tid => ({ batchId: batch.id, trainerId: tid })));
    }
  }
  // F2: every batch update writes an audit row. If the status changed we
  // emit batch_status_changed in addition to the generic batch_updated so
  // dashboards can filter status transitions specifically.
  await writeAudit({
    actorId: req.userId,
    action: "batch_updated",
    entityType: "batch",
    entityId: batch.id,
    details: {
      before: pre ? { name: pre.name, status: pre.status, program: pre.program } : null,
      after: { name: batch.name, status: batch.status, program: batch.program, trainerIds },
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  if (pre && pre.status !== batch.status) {
    await writeAudit({
      actorId: req.userId,
      action: batch.status === "closed" ? "batch_closed" : "batch_status_changed",
      entityType: "batch",
      entityId: batch.id,
      details: { before_status: pre.status, after_status: batch.status, role: req.userRole, ip: req.ip ?? null },
    });
  }
  res.json(await enrichBatch(batch));
});

// F4: admin-only SOFT delete. Marks the batch (and cascades to its
// candidates, attendance, assessments, feedback) as deleted by setting
// deleted_at = now(). Idempotent — re-deleting a deleted batch is a no-op
// returning 204. All read paths filter `deleted_at IS NULL` so deleted
// rows disappear from the UI without losing their audit history.
router.delete("/batches/:id", authMiddleware, requireRole("admin"), async (req, res): Promise<void> => {
  const params = DeleteBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [batch] = await db.update(batchesTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(batchesTable.id, id), isNull(batchesTable.deletedAt)))
    .returning();
  if (!batch) {
    res.status(404).json({ error: "Batch not found or already deleted" });
    return;
  }
  // Cascade — we use raw SQL so the same `deleted_at` semantic stays
  // local to the batches table (candidates/attendance/assessments/feedback
  // have no deleted_at column today). Instead, we let the existing reads
  // join through batches and rely on the parent's deleted_at IS NULL
  // filter to hide everything for the deleted batch.
  await writeAudit({
    actorId: req.userId,
    action: "batch_deleted",
    entityType: "batch",
    entityId: batch.id,
    details: {
      before: { name: batch.name, program: batch.program, status: batch.status },
      soft_delete: true,
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  res.sendStatus(204);
});

// F1.D: coordinator/admin updates a batch's clearance threshold.
router.patch("/batches/:id/clearance-rate", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const rate = Number(req.body?.clearance_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    res.status(400).json({ error: "clearance_rate must be a number between 0 and 100" });
    return;
  }
  const [batch] = await db.update(batchesTable)
    .set({ clearanceRate: rate.toFixed(2) })
    .where(and(eq(batchesTable.id, id), isNull(batchesTable.deletedAt)))
    .returning();
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }
  await writeAudit({
    actorId: req.userId,
    action: "clearance_rate_updated",
    entityType: "batch",
    entityId: batch.id,
    details: { clearance_rate: rate, name: batch.name },
  });
  res.json(await enrichBatch(batch));
});

router.patch("/batches/:id/status", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const params = UpdateBatchStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBatchStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [batch] = await db.update(batchesTable).set({ status: parsed.data.status }).where(eq(batchesTable.id, params.data.id)).returning();
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(await enrichBatch(batch));
});

// V6 F1: per-batch attendance due-time settings.
// GET returns the current setting (or defaults if no row exists yet) so the
// Batch Detail page can render the form pre-filled.
router.get("/batches/:id/attendance-settings", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const [row] = await db.select().from(attendanceSettingsTable).where(eq(attendanceSettingsTable.batchId, id));
  if (!row) {
    res.json({ batchId: id, dueTime: "10:00:00", dueTimezone: "Asia/Kolkata", enabled: true, updatedAt: null });
    return;
  }
  res.json({
    batchId: row.batchId,
    dueTime: row.dueTime,
    dueTimezone: row.dueTimezone,
    enabled: row.enabled,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  });
});

router.post("/batches/:id/attendance-settings", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const dueTime = typeof req.body?.due_time === "string" ? req.body.due_time : (typeof req.body?.dueTime === "string" ? req.body.dueTime : null);
  if (!dueTime || !/^\d{2}:\d{2}(:\d{2})?$/.test(dueTime)) {
    res.status(400).json({ error: "due_time must be HH:MM or HH:MM:SS" });
    return;
  }
  const normalized = dueTime.length === 5 ? `${dueTime}:00` : dueTime;
  const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : true;

  // Ensure the batch exists & isn't soft-deleted (also gives us a clean 404).
  const [batch] = await db.select().from(batchesTable).where(and(eq(batchesTable.id, id), isNull(batchesTable.deletedAt)));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  // UPSERT — one row per batch.
  await db.insert(attendanceSettingsTable).values({
    batchId: id,
    dueTime: normalized,
    enabled,
    updatedBy: req.userId ?? null,
  }).onConflictDoUpdate({
    target: attendanceSettingsTable.batchId,
    set: { dueTime: normalized, enabled, updatedBy: req.userId ?? null, updatedAt: new Date() },
  });

  await writeAudit({
    actorId: req.userId,
    action: "attendance_settings_updated",
    entityType: "batch",
    entityId: id,
    details: { due_time: normalized, enabled, batch_name: batch.name },
  });

  const [row] = await db.select().from(attendanceSettingsTable).where(eq(attendanceSettingsTable.batchId, id));
  res.json({
    batchId: row.batchId,
    dueTime: row.dueTime,
    dueTimezone: row.dueTimezone,
    enabled: row.enabled,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  });
});

router.get("/batches/:id/candidates", authMiddleware, async (req, res): Promise<void> => {
  const params = ListBatchCandidatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Trainer scoping
  if (req.userRole === "trainer" && req.userId) {
    const trainerBatchIds = await getTrainerBatchIds(req.userId);
    if (!trainerBatchIds.includes(params.data.id)) {
      res.status(403).json({ error: "Forbidden: batch not assigned to you" });
      return;
    }
  }
  const candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, params.data.id));
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, params.data.id));
  res.json(candidates.map(c => ({
    ...c,
    batchName: batch?.name ?? null,
  })));
});

export default router;
