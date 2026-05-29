import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, feedbackTable, batchesTable, candidatesTable, feedbackWindowsTable } from "@workspace/db";
import { SubmitFeedbackBody, TriggerFeedbackEmailBody, ListFeedbackQueryParams, GetFeedbackSummaryQueryParams } from "@workspace/api-zod";
import { authMiddleware, requireRole } from "../middlewares/auth";
import { getTrainerBatchIds, writeAudit } from "../lib/rbac";
import { sendNotification } from "../lib/notify";

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
  const requestedBatchId = params.success ? params.data.batchId : undefined;

  // Trainer scoping — only feedback for batches they're assigned to.
  let trainerBatches: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatches = await getTrainerBatchIds(req.userId);
    if (trainerBatches.length === 0) { res.json([]); return; }
    if (requestedBatchId && !trainerBatches.includes(requestedBatchId)) { res.json([]); return; }
  }

  const conditions = [];
  if (requestedBatchId) conditions.push(eq(feedbackTable.batchId, requestedBatchId));
  else if (trainerBatches) conditions.push(inArray(feedbackTable.batchId, trainerBatches));

  const records = conditions.length > 0
    ? await db.select().from(feedbackTable).where(and(...conditions))
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

// V6 F5: read the current feedback window config for a batch (if any).
router.get("/feedback/window/:batchId", authMiddleware, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid batchId" }); return; }
  const [row] = await db.select().from(feedbackWindowsTable).where(eq(feedbackWindowsTable.batchId, id));
  if (!row) { res.json(null); return; }
  res.json({
    batchId: row.batchId,
    msFormsLink: row.msFormsLink,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    subject: row.subject,
    bodyTemplate: row.bodyTemplate,
    sentAt: row.sentAt,
    sentBy: row.sentBy,
  });
});

// V6 F5: coordinator/admin sends the feedback collection email to every
// candidate in the batch. Persists the window config and writes one
// notifications_log row per send.
router.post("/feedback/send-request", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const batchId = Number(req.body?.batch_id ?? req.body?.batchId);
  const subject = typeof req.body?.subject === "string" ? req.body.subject : "";
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  const msFormsLink = typeof req.body?.ms_forms_link === "string" ? req.body.ms_forms_link : (typeof req.body?.msFormsLink === "string" ? req.body.msFormsLink : "");
  const dueDate = typeof req.body?.due_date === "string" ? req.body.due_date : (typeof req.body?.dueDate === "string" ? req.body.dueDate : null);
  const dueTime = typeof req.body?.due_time === "string" ? req.body.due_time : (typeof req.body?.dueTime === "string" ? req.body.dueTime : null);

  if (!Number.isFinite(batchId)) { res.status(400).json({ error: "batch_id required" }); return; }
  if (!subject.trim() || !body.trim()) { res.status(400).json({ error: "subject and body are required" }); return; }
  if (!msFormsLink.trim()) { res.status(400).json({ error: "ms_forms_link is required" }); return; }

  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  const candidates = await db.select().from(candidatesTable).where(and(eq(candidatesTable.batchId, batchId), eq(candidatesTable.status, "active")));

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.email) { failed++; continue; }
    const personalisedBody = body
      .replace(/\[Candidate Name\]/g, c.name)
      .replace(/\{candidate_name\}/g, c.name)
      .replace(/\[MS_FORMS_LINK\]/g, msFormsLink)
      .replace(/\{ms_forms_link\}/g, msFormsLink)
      .replace(/\[DUE_DATE\]/g, dueDate ?? "")
      .replace(/\[DUE_TIME\]/g, dueTime ?? "")
      .replace(/\[Batch Name\]/g, batch.name)
      .replace(/\{batch_name\}/g, batch.name);
    const personalisedSubject = subject
      .replace(/\[Batch Name\]/g, batch.name)
      .replace(/\[Candidate Name\]/g, c.name);
    const r = await sendNotification({
      type: "feedback_request",
      to: c.email,
      recipientName: c.name,
      subject: personalisedSubject,
      body: personalisedBody,
      batchId,
      candidateId: c.id,
      urgency: 1,
    });
    if (r.ok) sent++; else failed++;
  }

  // Upsert the window config so the page can show "last sent on …".
  const now = new Date();
  await db.insert(feedbackWindowsTable).values({
    batchId,
    msFormsLink,
    dueDate,
    dueTime,
    subject,
    bodyTemplate: body,
    sentAt: now,
    sentBy: req.userId ?? null,
  }).onConflictDoUpdate({
    target: feedbackWindowsTable.batchId,
    set: {
      msFormsLink,
      dueDate,
      dueTime,
      subject,
      bodyTemplate: body,
      sentAt: now,
      sentBy: req.userId ?? null,
      updatedAt: now,
    },
  });

  await writeAudit({
    actorId: req.userId,
    action: "feedback_request_sent",
    entityType: "batch",
    entityId: batchId,
    details: { batch_name: batch.name, candidates: candidates.length, sent, failed, ms_forms_link: msFormsLink },
  });

  res.json({ batchId, candidates: candidates.length, sent, failed });
});

// V6 F5: download all feedback for a batch as CSV.
router.get("/feedback/download/:batchId", authMiddleware, async (req, res): Promise<void> => {
  const batchId = Number(req.params.batchId);
  if (!Number.isFinite(batchId)) { res.status(400).json({ error: "invalid batchId" }); return; }

  // Trainer scoping
  if (req.userRole === "trainer" && req.userId) {
    const trainerBatches = await getTrainerBatchIds(req.userId);
    if (!trainerBatches.includes(batchId)) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId));
  if (!batch) { res.status(404).json({ error: "Batch not found" }); return; }

  const records = await db.select().from(feedbackTable).where(eq(feedbackTable.batchId, batchId));
  const candIds = Array.from(new Set(records.map(r => r.candidateId).filter((x): x is number => x != null)));
  const cands = candIds.length > 0
    ? await db.select({ id: candidatesTable.id, name: candidatesTable.name }).from(candidatesTable).where(inArray(candidatesTable.id, candIds))
    : [];
  const nameById = new Map(cands.map(c => [c.id, c.name]));

  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Candidate Name", "Submitted At", "Rating", "Sentiment", "Response"];
  const lines = [header.map(escape).join(",")];
  for (const r of records) {
    const sentiment = r.rating == null ? "" : r.rating >= 4 ? "positive" : r.rating >= 3 ? "neutral" : "negative";
    lines.push([
      r.candidateId ? (nameById.get(r.candidateId) ?? `#${r.candidateId}`) : "Anonymous",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
      r.rating ?? "",
      sentiment,
      r.responseText ?? "",
    ].map(escape).join(","));
  }
  const csv = lines.join("\n");
  const safeName = batch.name.replace(/[^a-z0-9_\-]+/gi, "_");
  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="feedback_${safeName}_${dateStr}.csv"`);
  res.send(csv);
});

router.get("/feedback/summary", authMiddleware, async (req, res): Promise<void> => {
  const params = GetFeedbackSummaryQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;

  // Trainer scoping
  let trainerBatches: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatches = await getTrainerBatchIds(req.userId);
    if (trainerBatches.length === 0) {
      res.json({ batchId: batchId ?? 0, totalResponses: 0, avgContentRating: 0, avgTrainerRating: 0, avgOverallRating: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0 });
      return;
    }
    if (batchId && !trainerBatches.includes(batchId)) {
      res.json({ batchId, totalResponses: 0, avgContentRating: 0, avgTrainerRating: 0, avgOverallRating: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0 });
      return;
    }
  }

  const records = batchId
    ? await db.select().from(feedbackTable).where(eq(feedbackTable.batchId, batchId))
    : trainerBatches
      ? await db.select().from(feedbackTable).where(inArray(feedbackTable.batchId, trainerBatches))
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
