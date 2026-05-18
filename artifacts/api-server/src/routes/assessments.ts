import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assessmentsTable, assessmentScoresTable, batchesTable, candidatesTable } from "@workspace/db";
import { BulkUploadAssessmentScoresBody } from "@workspace/api-zod";
import {
  CreateAssessmentBody, UpdateAssessmentBody, GetAssessmentParams, UpdateAssessmentParams,
  DeleteAssessmentParams, CreateAssessmentScoreBody, BulkCreateAssessmentScoresBody,
  UpdateAssessmentScoreParams, UpdateAssessmentScoreBody, ListAssessmentsQueryParams,
  ListAssessmentScoresQueryParams
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

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
    description: a.description ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function enrichScore(s: typeof assessmentScoresTable.$inferSelect) {
  const [assessment] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, s.assessmentId));
  const [candidate] = await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, s.candidateId));
  const maxScore = assessment ? Number(assessment.maxScore) : null;
  const score = Number(s.score);
  const percentage = maxScore ? Math.round((score / maxScore) * 100) : null;
  return {
    id: s.id,
    assessmentId: s.assessmentId,
    assessmentTitle: assessment?.title ?? null,
    assessmentType: assessment?.type ?? null,
    candidateId: s.candidateId,
    candidateName: candidate?.name ?? null,
    score,
    maxScore,
    percentage,
    remarks: s.remarks ?? null,
    createdAt: s.createdAt,
  };
}

router.get("/assessments", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAssessmentsQueryParams.safeParse(req.query);
  let assessments: typeof assessmentsTable.$inferSelect[];
  if (params.success) {
    const { batchId, type } = params.data;
    const conditions: ReturnType<typeof eq>[] = [];
    if (batchId) conditions.push(eq(assessmentsTable.batchId, batchId));
    if (type) conditions.push(eq(assessmentsTable.type, type));
    assessments = conditions.length > 0
      ? await db.select().from(assessmentsTable).where(and(...conditions))
      : await db.select().from(assessmentsTable);
  } else {
    assessments = await db.select().from(assessmentsTable);
  }
  const enriched = await Promise.all(assessments.map(enrichAssessment));
  res.json(enriched);
});

router.post("/assessments", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const scheduledDate = parsed.data.scheduledDate instanceof Date
    ? parsed.data.scheduledDate.toISOString().split("T")[0]
    : String(parsed.data.scheduledDate);
  const [assessment] = await db.insert(assessmentsTable).values({
    batchId: parsed.data.batchId,
    title: parsed.data.title,
    type: parsed.data.type,
    scheduledDate,
    maxScore: String(parsed.data.maxScore ?? 100),
    description: parsed.data.description ?? null,
  }).returning();
  res.status(201).json(await enrichAssessment(assessment));
});

router.get("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [assessment] = await db.select().from(assessmentsTable).where(eq(assessmentsTable.id, params.data.id));
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.json(await enrichAssessment(assessment));
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
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.maxScore !== undefined) updateData.maxScore = String(parsed.data.maxScore);
  const [assessment] = await db.update(assessmentsTable).set(updateData).where(eq(assessmentsTable.id, params.data.id)).returning();
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.json(await enrichAssessment(assessment));
});

router.delete("/assessments/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [assessment] = await db.delete(assessmentsTable).where(eq(assessmentsTable.id, params.data.id)).returning();
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/assessment-scores", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAssessmentScoresQueryParams.safeParse(req.query);
  let scores: typeof assessmentScoresTable.$inferSelect[];
  if (params.success) {
    const { assessmentId, candidateId, batchId } = params.data;
    if (batchId) {
      const assessments = await db.select({ id: assessmentsTable.id }).from(assessmentsTable).where(eq(assessmentsTable.batchId, batchId));
      const ids = assessments.map(a => a.id);
      if (ids.length === 0) { res.json([]); return; }
      scores = await db.select().from(assessmentScoresTable);
      scores = scores.filter(s => ids.includes(s.assessmentId));
    } else if (assessmentId && candidateId) {
      scores = await db.select().from(assessmentScoresTable).where(and(eq(assessmentScoresTable.assessmentId, assessmentId), eq(assessmentScoresTable.candidateId, candidateId)));
    } else if (assessmentId) {
      scores = await db.select().from(assessmentScoresTable).where(eq(assessmentScoresTable.assessmentId, assessmentId));
    } else if (candidateId) {
      scores = await db.select().from(assessmentScoresTable).where(eq(assessmentScoresTable.candidateId, candidateId));
    } else {
      scores = await db.select().from(assessmentScoresTable);
    }
  } else {
    scores = await db.select().from(assessmentScoresTable);
  }
  const enriched = await Promise.all(scores.map(enrichScore));
  res.json(enriched);
});

router.post("/assessment-scores", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateAssessmentScoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [score] = await db.insert(assessmentScoresTable).values({ ...parsed.data, score: String(parsed.data.score) }).returning();
  res.status(201).json(await enrichScore(score));
});

router.post("/assessments/bulk-scores", authMiddleware, async (req, res): Promise<void> => {
  const parsed = BulkUploadAssessmentScoresBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { assessmentId, scores } = parsed.data;
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const s of scores) {
    try {
      await db.insert(assessmentScoresTable).values({
        assessmentId,
        candidateId: s.candidateId,
        score: String(s.score),
        remarks: s.remarks ?? null,
      });
      inserted++;
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`candidateId ${s.candidateId}: ${msg}`);
    }
  }

  res.status(201).json({ inserted, failed, errors });
});

router.post("/assessment-scores/bulk", authMiddleware, async (req, res): Promise<void> => {
  const parsed = BulkCreateAssessmentScoresBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { assessmentId, scores } = parsed.data;
  const values = scores.map(s => ({ assessmentId, candidateId: s.candidateId, score: String(s.score), remarks: s.remarks ?? null }));
  const inserted = await db.insert(assessmentScoresTable).values(values).returning();
  const enriched = await Promise.all(inserted.map(enrichScore));
  res.status(201).json(enriched);
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
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.score !== undefined) updateData.score = String(parsed.data.score);
  const [score] = await db.update(assessmentScoresTable).set(updateData).where(eq(assessmentScoresTable.id, params.data.id)).returning();
  if (!score) {
    res.status(404).json({ error: "Score not found" });
    return;
  }
  res.json(await enrichScore(score));
});

export default router;
