import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, assessmentsTable, batchesTable, candidatesTable } from "@workspace/db";
import {
  CreateAssessmentBody, UpdateAssessmentBody, GetAssessmentParams, UpdateAssessmentParams,
  DeleteAssessmentParams, CreateAssessmentScoreBody, BulkCreateAssessmentScoresBody,
  UpdateAssessmentScoreParams, UpdateAssessmentScoreBody, ListAssessmentsQueryParams,
  ListAssessmentScoresQueryParams, BulkUploadAssessmentScoresBody,
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";
import { getTrainerBatchIds, writeAudit } from "../lib/rbac";

const router: IRouter = Router();

// In Supabase each row in `assessments` is one (candidate, assessment) score.
// We surface two API shapes off the same table:
//   GET /assessments         — deduplicated, one row per (batch, title, type)
//   GET /assessment-scores   — every raw row

async function enrichAssessment(a: typeof assessmentsTable.$inferSelect) {
  const [batch] = await db.select({ name: batchesTable.name }).from(batchesTable).where(eq(batchesTable.id, a.batchId));
  return {
    id: a.id,
    batchId: a.batchId,
    batchName: batch?.name ?? null,
    title: a.title,
    type: a.type,
    scheduledDate: a.scheduledDate,
    maxScore: Number(a.maxScore),
    description: null,
    uploadedBy: a.uploadedBy ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function enrichScore(s: typeof assessmentsTable.$inferSelect) {
  const [candidate] = await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, s.candidateId));
  const maxScore = Number(s.maxScore);
  const score = Number(s.score);
  const percentage = maxScore ? Math.round((score / maxScore) * 100) : null;
  return {
    id: s.id,
    assessmentId: s.id,
    assessmentTitle: s.title,
    assessmentType: s.type,
    candidateId: s.candidateId,
    candidateName: candidate?.name ?? null,
    score,
    maxScore,
    percentage,
    passed: s.passed,
    remarks: null,
    createdAt: s.createdAt,
  };
}

// GET /assessments returns a deduplicated assessment header view.
router.get("/assessments", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAssessmentsQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const typeFilter = params.success ? params.data.type : undefined;

  // Trainer scoping
  let trainerBatches: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatches = await getTrainerBatchIds(req.userId);
    if (trainerBatches.length === 0) { res.json([]); return; }
    if (batchId && !trainerBatches.includes(batchId)) { res.json([]); return; }
  }

  const conditions: ReturnType<typeof eq>[] = [];
  if (batchId) conditions.push(eq(assessmentsTable.batchId, batchId));
  else if (trainerBatches) conditions.push(inArray(assessmentsTable.batchId, trainerBatches));
  if (typeFilter) conditions.push(eq(assessmentsTable.type, typeFilter));

  const rows = conditions.length > 0
    ? await db.select().from(assessmentsTable).where(and(...conditions))
    : await db.select().from(assessmentsTable);

  // Dedupe to (batchId, title, type, scheduledDate) and keep the earliest id.
  const seen = new Map<string, typeof assessmentsTable.$inferSelect>();
  for (const r of rows) {
    const k = `${r.batchId}|${r.title}|${r.type}|${r.scheduledDate}`;
    const existing = seen.get(k);
    if (!existing || r.id < existing.id) seen.set(k, r);
  }
  const enriched = await Promise.all(Array.from(seen.values()).map(enrichAssessment));
  res.json(enriched);
});

// Creating an assessment really means: insert one row per candidate in the
// batch with score=0, uploadedBy=current user. Trainers can do this for their
// own batches; admin/coordinator unrestricted.
router.post("/assessments", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { batchId, title, type, scheduledDate, maxScore } = parsed.data;

  // Trainer must own the batch.
  if (req.userRole === "trainer" && req.userId) {
    const trainerBatches = await getTrainerBatchIds(req.userId);
    if (!trainerBatches.includes(batchId)) {
      res.status(403).json({ error: "Forbidden: batch not assigned to you" });
      return;
    }
  }

  // Look up all candidates in the batch so we can create one row per candidate.
  const batchCandidates = await db.select({ id: candidatesTable.id }).from(candidatesTable).where(eq(candidatesTable.batchId, batchId));
  if (batchCandidates.length === 0) {
    res.status(400).json({ error: "Batch has no candidates — add candidates before creating assessments." });
    return;
  }

  const scheduledDateStr = scheduledDate instanceof Date
    ? scheduledDate.toISOString().split("T")[0]
    : String(scheduledDate);
  const today = new Date().toISOString().split("T")[0];

  const values = batchCandidates.map(c => ({
    batchId,
    candidateId: c.id,
    title,
    type,
    scheduledDate: scheduledDateStr,
    maxScore: String(maxScore ?? 100),
    score: "0",
    passed: null as boolean | null,
    uploadedDate: today,
    uploadedBy: req.userId ?? null,
  }));
  const inserted = await db.insert(assessmentsTable).values(values).returning();
  const [firstRow] = inserted;

  await writeAudit({
    actorId: req.userId,
    action: "create",
    entityType: "assessment",
    entityId: firstRow.id,
    details: { batchId, title, type, scheduledDate: scheduledDateStr, candidateCount: inserted.length },
  });

  // Return the deduplicated header (one assessment, not N rows).
  res.status(201).json(await enrichAssessment(firstRow));
});

router.get("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.json(await enrichAssessment(row));
});

router.patch("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Look up the row first so we can apply ownership + scope rules.
  const [existing] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  // Trainer can only edit their own assessments.
  if (req.userRole === "trainer") {
    if (existing.uploadedBy !== req.userId) {
      res.status(403).json({ error: "Forbidden: you can only edit assessments you created" });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.scheduledDate !== undefined) updateData.scheduledDate = parsed.data.scheduledDate;
  if (parsed.data.maxScore !== undefined) updateData.maxScore = String(parsed.data.maxScore);

  // Apply update to all sibling rows that share the same assessment header,
  // so the dedup view stays consistent.
  await db.update(assessmentsTable).set(updateData).where(and(
    eq(assessmentsTable.batchId, existing.batchId),
    eq(assessmentsTable.title, existing.title),
    eq(assessmentsTable.type, existing.type),
    eq(assessmentsTable.scheduledDate, existing.scheduledDate),
  ));
  const [refreshed] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, params.data.id));
  res.json(await enrichAssessment(refreshed));
});

router.delete("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  // Trainer can only delete assessments they uploaded.
  if (req.userRole === "trainer") {
    if (existing.uploadedBy !== req.userId) {
      res.status(403).json({ error: "Forbidden: you can only delete assessments you created" });
      return;
    }
  }

  // Delete all sibling rows that make up this assessment.
  const deleted = await db.delete(assessmentsTable).where(and(
    eq(assessmentsTable.batchId, existing.batchId),
    eq(assessmentsTable.title, existing.title),
    eq(assessmentsTable.type, existing.type),
    eq(assessmentsTable.scheduledDate, existing.scheduledDate),
  )).returning();

  await writeAudit({
    actorId: req.userId,
    action: "delete",
    entityType: "assessment",
    entityId: existing.id,
    details: {
      batchId: existing.batchId,
      title: existing.title,
      type: existing.type,
      scheduledDate: existing.scheduledDate,
      rowsDeleted: deleted.length,
    },
  });

  res.sendStatus(204);
});

router.get("/assessment-scores", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAssessmentScoresQueryParams.safeParse(req.query);
  const assessmentId = params.success ? params.data.assessmentId : undefined;
  const candidateId = params.success ? params.data.candidateId : undefined;
  const batchId = params.success ? params.data.batchId : undefined;

  // Trainer scoping
  let trainerBatches: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatches = await getTrainerBatchIds(req.userId);
    if (trainerBatches.length === 0) { res.json([]); return; }
    if (batchId && !trainerBatches.includes(batchId)) { res.json([]); return; }
  }

  const conditions: ReturnType<typeof eq>[] = [];
  if (assessmentId) conditions.push(eq(assessmentsTable.id, assessmentId));
  if (candidateId) conditions.push(eq(assessmentsTable.candidateId, candidateId));
  if (batchId) conditions.push(eq(assessmentsTable.batchId, batchId));
  else if (trainerBatches) conditions.push(inArray(assessmentsTable.batchId, trainerBatches));

  const rows = conditions.length > 0
    ? await db.select().from(assessmentsTable).where(and(...conditions))
    : await db.select().from(assessmentsTable);
  const enriched = await Promise.all(rows.map(enrichScore));
  res.json(enriched);
});

router.post("/assessment-scores", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateAssessmentScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Without a reference row we can't fill batch_id / title / type. Leave for
  // the rewritten API.
  res.status(501).json({ error: "Per-candidate score insert not implemented on Supabase shape." });
});

router.post("/assessments/bulk-scores", authMiddleware, async (req, res): Promise<void> => {
  void BulkUploadAssessmentScoresBody;
  res.status(501).json({ error: "Bulk score insert not implemented on Supabase shape." });
});

router.post("/assessment-scores/bulk", authMiddleware, async (req, res): Promise<void> => {
  void BulkCreateAssessmentScoresBody;
  res.status(501).json({ error: "Bulk score insert not implemented on Supabase shape." });
});

router.patch("/assessment-scores/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateAssessmentScoreParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAssessmentScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.score !== undefined) updateData.score = String(parsed.data.score);
  const [row] = await db.update(assessmentsTable).set(updateData).where(eq(assessmentsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Score not found" });
    return;
  }
  res.json(await enrichScore(row));
});

export default router;
