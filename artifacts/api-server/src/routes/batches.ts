import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, batchesTable, batchTrainersTable, usersTable, candidatesTable } from "@workspace/db";
import {
  CreateBatchBody, UpdateBatchBody, GetBatchParams, UpdateBatchParams, DeleteBatchParams,
  UpdateBatchStatusParams, UpdateBatchStatusBody, ListBatchesQueryParams, ListBatchCandidatesParams
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

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
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

router.get("/batches", authMiddleware, async (req, res): Promise<void> => {
  const params = ListBatchesQueryParams.safeParse(req.query);
  const batches = await (params.success && params.data.status
    ? db.select().from(batchesTable).where(eq(batchesTable.status, params.data.status))
    : db.select().from(batchesTable));
  const enriched = await Promise.all(batches.map(enrichBatch));
  res.json(enriched);
});

router.post("/batches", authMiddleware, async (req, res): Promise<void> => {
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
  res.status(201).json(await enrichBatch(batch));
});

router.get("/batches/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, params.data.id));
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.json(await enrichBatch(batch));
});

router.patch("/batches/:id", authMiddleware, async (req, res): Promise<void> => {
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
  const [batch] = await db.update(batchesTable).set(updateData).where(eq(batchesTable.id, params.data.id)).returning();
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
  res.json(await enrichBatch(batch));
});

router.delete("/batches/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteBatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [batch] = await db.delete(batchesTable).where(eq(batchesTable.id, params.data.id)).returning();
  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/batches/:id/status", authMiddleware, async (req, res): Promise<void> => {
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

router.get("/batches/:id/candidates", authMiddleware, async (req, res): Promise<void> => {
  const params = ListBatchCandidatesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, params.data.id));
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, params.data.id));
  res.json(candidates.map(c => ({
    ...c,
    batchName: batch?.name ?? null,
  })));
});

export default router;
