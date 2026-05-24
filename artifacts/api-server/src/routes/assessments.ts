import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assessmentsTable, batchesTable, candidatesTable } from "@workspace/db";
import {
  CreateAssessmentBody, UpdateAssessmentBody, GetAssessmentParams, UpdateAssessmentParams,
  DeleteAssessmentParams, CreateAssessmentScoreBody, BulkCreateAssessmentScoresBody,
  UpdateAssessmentScoreParams, UpdateAssessmentScoreBody, ListAssessmentsQueryParams,
  ListAssessmentScoresQueryParams, BulkUploadAssessmentScoresBody,
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

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
  let rows: typeof assessmentsTable.$inferSelect[];
  if (params.success) {
    const { batchId, type } = params.data;
    const conditions: ReturnType<typeof eq>[] = [];
    if (batchId) conditions.push(eq(assessmentsTable.batchId, batchId));
    if (type) conditions.push(eq(assessmentsTable.type, type));
    rows = conditions.length > 0
      ? await db.select().from(assessmentsTable).where(and(...conditions))
      : await db.select().from(assessmentsTable);
  } else {
    rows = await db.select().from(assessmentsTable);
  }
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

router.post("/assessments", authMiddleware, async (_req, res): Promise<void> => {
  // Creating "headers" doesn't map cleanly to Supabase's per-candidate row
  // shape; this endpoint is left as a no-op until the API contract is
  // rewritten for the new shape.
  void CreateAssessmentBody;
  res.status(501).json({ error: "Use /assessment-scores to insert per-candidate rows on Supabase." });
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
  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.scheduledDate !== undefined) updateData.scheduledDate = parsed.data.scheduledDate;
  if (parsed.data.maxScore !== undefined) updateData.maxScore = String(parsed.data.maxScore);
  const [row] = await db.update(assessmentsTable).set(updateData).where(eq(assessmentsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.json(await enrichAssessment(row));
});

router.delete("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(assessmentsTable).where(eq(assessmentsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/assessment-scores", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAssessmentScoresQueryParams.safeParse(req.query);
  let rows: typeof assessmentsTable.$inferSelect[];
  if (params.success) {
    const { assessmentId, candidateId, batchId } = params.data;
    const conditions: ReturnType<typeof eq>[] = [];
    if (assessmentId) conditions.push(eq(assessmentsTable.id, assessmentId));
    if (candidateId) conditions.push(eq(assessmentsTable.candidateId, candidateId));
    if (batchId) conditions.push(eq(assessmentsTable.batchId, batchId));
    rows = conditions.length > 0
      ? await db.select().from(assessmentsTable).where(and(...conditions))
      : await db.select().from(assessmentsTable);
  } else {
    rows = await db.select().from(assessmentsTable);
  }
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
