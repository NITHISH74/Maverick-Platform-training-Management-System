import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, feedbackTable, batchesTable, candidatesTable } from "@workspace/db";
import { SubmitFeedbackBody, TriggerFeedbackEmailBody, ListFeedbackQueryParams, GetFeedbackSummaryQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

function deriveSentiment(rating: number | null | undefined): string | null {
  if (rating == null) return null;
  if (rating >= 4) return "positive";
  if (rating >= 3) return "neutral";
  return "negative";
}

// Supabase feedback has a much simpler shape (response_text + rating). The
// legacy API exposed contentRating/trainerRating/overallRating/comments/
// sentiment — we synthesise those from the single `rating` for backwards
// compat so old clients keep parsing the response.
async function enrichFeedback(f: typeof feedbackTable.$inferSelect) {
  const [batch] = await db.select({ name: batchesTable.name }).from(batchesTable).where(eq(batchesTable.id, f.batchId));
  const [candidate] = f.candidateId
    ? await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, f.candidateId))
    : [undefined];
  const rating = f.rating ?? null;
  return {
    id: f.id,
    batchId: f.batchId,
    batchName: batch?.name ?? null,
    candidateId: f.candidateId,
    candidateName: candidate?.name ?? null,
    contentRating: rating,
    trainerRating: rating,
    overallRating: rating,
    comments: f.responseText,
    sentiment: deriveSentiment(rating),
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
  const rating = parsed.data.overallRating ?? Math.round(((parsed.data.contentRating ?? 0) + (parsed.data.trainerRating ?? 0)) / 2);
  const responseText = parsed.data.comments ?? "";
  const [record] = await db.insert(feedbackTable).values({
    batchId: parsed.data.batchId,
    candidateId: parsed.data.candidateId ?? null,
    trainerId: null,
    rating,
    responseText,
  }).returning();
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
  const rated = records.filter(r => r.rating != null);
  const avg = rated.length > 0 ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length : 0;
  const sentiments = rated.map(r => deriveSentiment(r.rating));
  res.json({
    batchId: batchId ?? 0,
    totalResponses,
    avgContentRating: Math.round(avg * 10) / 10,
    avgTrainerRating: Math.round(avg * 10) / 10,
    avgOverallRating: Math.round(avg * 10) / 10,
    positiveCount: sentiments.filter(s => s === "positive").length,
    neutralCount: sentiments.filter(s => s === "neutral").length,
    negativeCount: sentiments.filter(s => s === "negative").length,
  });
});

export default router;
