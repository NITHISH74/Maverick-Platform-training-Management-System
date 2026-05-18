import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, feedbackTable, batchesTable, candidatesTable } from "@workspace/db";
import { SubmitFeedbackBody, TriggerFeedbackEmailBody, ListFeedbackQueryParams, GetFeedbackSummaryQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

function computeSentiment(overallRating: number | null, contentRating: number, trainerRating: number): string {
  const avg = overallRating ?? ((contentRating + trainerRating) / 2);
  if (avg >= 4) return "positive";
  if (avg >= 3) return "neutral";
  return "negative";
}

async function enrichFeedback(f: typeof feedbackTable.$inferSelect) {
  const [batch] = await db.select({ name: batchesTable.name }).from(batchesTable).where(eq(batchesTable.id, f.batchId));
  const [candidate] = await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, f.candidateId));
  return {
    id: f.id,
    batchId: f.batchId,
    batchName: batch?.name ?? null,
    candidateId: f.candidateId,
    candidateName: candidate?.name ?? null,
    contentRating: f.contentRating,
    trainerRating: f.trainerRating,
    overallRating: f.overallRating ?? null,
    comments: f.comments ?? null,
    sentiment: f.sentiment ?? null,
    createdAt: f.createdAt,
  };
}

router.get("/feedback", authMiddleware, async (req, res): Promise<void> => {
  const params = ListFeedbackQueryParams.safeParse(req.query);
  const records = params.success && params.data.batchId
    ? await db.select().from(feedbackTable).where(eq(feedbackTable.batchId, params.data.batchId))
    : await db.select().from(feedbackTable);
  const enriched = await Promise.all(records.map(enrichFeedback));
  res.json(enriched);
});

router.post("/feedback", authMiddleware, async (req, res): Promise<void> => {
  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sentiment = computeSentiment(parsed.data.overallRating ?? null, parsed.data.contentRating, parsed.data.trainerRating);
  const [record] = await db.insert(feedbackTable).values({ ...parsed.data, sentiment, overallRating: parsed.data.overallRating ?? null }).returning();
  res.status(201).json(await enrichFeedback(record));
});

router.post("/feedback/trigger", authMiddleware, async (req, res): Promise<void> => {
  const parsed = TriggerFeedbackEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json({ success: true, message: `Feedback email triggered for batch ${parsed.data.batchId}` });
});

router.get("/feedback/summary", authMiddleware, async (req, res): Promise<void> => {
  const params = GetFeedbackSummaryQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const records = batchId
    ? await db.select().from(feedbackTable).where(eq(feedbackTable.batchId, batchId))
    : await db.select().from(feedbackTable);

  const totalResponses = records.length;
  const avgContentRating = totalResponses > 0 ? records.reduce((s, r) => s + r.contentRating, 0) / totalResponses : 0;
  const avgTrainerRating = totalResponses > 0 ? records.reduce((s, r) => s + r.trainerRating, 0) / totalResponses : 0;
  const avgOverallRating = totalResponses > 0 ? records.reduce((s, r) => s + (r.overallRating ?? ((r.contentRating + r.trainerRating) / 2)), 0) / totalResponses : 0;
  const positiveCount = records.filter(r => r.sentiment === "positive").length;
  const neutralCount = records.filter(r => r.sentiment === "neutral").length;
  const negativeCount = records.filter(r => r.sentiment === "negative").length;

  res.json({
    batchId: batchId ?? 0,
    totalResponses,
    avgContentRating: Math.round(avgContentRating * 10) / 10,
    avgTrainerRating: Math.round(avgTrainerRating * 10) / 10,
    avgOverallRating: Math.round(avgOverallRating * 10) / 10,
    positiveCount,
    neutralCount,
    negativeCount,
  });
});

export default router;
