import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, feedbackTable, batchesTable, candidatesTable, feedbackWindowsTable, usersTable } from "@workspace/db";
import { SubmitFeedbackBody, TriggerFeedbackEmailBody, ListFeedbackQueryParams, GetFeedbackSummaryQueryParams } from "@workspace/api-zod";
import { authMiddleware, requireRole } from "../middlewares/auth";
import { getTrainerBatchIds, writeAudit } from "../lib/rbac";
import { sendNotification, ESCALATION_CC } from "../lib/notify";

// Render a plain-text feedback template into an HTML email: escape, turn the
// MS Forms URL into a button, preserve line breaks, and append a due-date note.
function renderFeedbackHtml(textBody: string, msFormsLink: string, dueDate: string | null, dueTime: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeLink = esc(msFormsLink);
  const bodyHtml = esc(textBody)
    // Replace the raw link (or its placeholder) with a styled button.
    .replace(safeLink, `<a href="${safeLink}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;">Open Feedback Form</a>`)
    .replace(/\n/g, "<br />");
  const dueLine = dueDate
    ? `<p style="margin:16px 0;padding:10px 14px;background:#f3f4f6;border-radius:6px;"><strong>Due by:</strong> ${esc(dueDate)}${dueTime ? ` at ${esc(dueTime)}` : ""} IST</p>`
    : "";
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.6;">` +
    `<p>${bodyHtml}</p>` +
    dueLine +
    `<p style="margin-top:16px;">If the button above doesn't work, paste this link into your browser:<br />` +
    `<a href="${safeLink}">${safeLink}</a></p>` +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />` +
    `<p style="font-size:12px;color:#6b7280;">Sent via the Maverick Execution Platform.</p>` +
    `</div>`
  );
}

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
  if (!/^https:\/\//i.test(msFormsLink.trim())) { res.status(400).json({ error: "ms_forms_link must start with https://" }); return; }

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
    const personalisedHtml = renderFeedbackHtml(personalisedBody, msFormsLink, dueDate, dueTime);
    const r = await sendNotification({
      type: "feedback_request",
      to: c.email,
      cc: ESCALATION_CC,
      recipientName: c.name,
      subject: personalisedSubject,
      body: personalisedBody,
      html: personalisedHtml,
      batchId,
      candidateId: c.id,
      urgency: 1,
    });
    if (r.ok) sent++; else failed++;
  }

  // Upsert the window config so the page can show "last sent on …".
  const now = new Date();
  const [window] = await db.insert(feedbackWindowsTable).values({
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
  }).returning({ id: feedbackWindowsTable.id });

  await writeAudit({
    actorId: req.userId,
    action: "feedback_request_sent",
    entityType: "batch",
    entityId: batchId,
    details: { batch_name: batch.name, candidates: candidates.length, sent, failed, recipient_count: sent, ms_forms_link: msFormsLink },
  });

  res.json({ batchId, candidates: candidates.length, sent, failed, window_id: window?.id ?? null });
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
    ? await db.select({ id: candidatesTable.id, name: candidatesTable.name, candidateId: candidatesTable.candidateId })
        .from(candidatesTable).where(inArray(candidatesTable.id, candIds))
    : [];
  const candById = new Map(cands.map(c => [c.id, c]));

  const trainerIds = Array.from(new Set(records.map(r => r.trainerId).filter((x): x is number => x != null)));
  const trainers = trainerIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, trainerIds))
    : [];
  const trainerById = new Map(trainers.map(t => [t.id, t.name]));

  // Column headers map to the MS Form fields. The Supabase `feedback` table
  // stores one rating + response_text, so Session/Trainer Rating reuse the
  // single rating (same convention as the enrichFeedback() API response).
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["Candidate Name", "Candidate ID", "Trainer Name", "Session Rating", "Trainer Rating", "Overall Feedback", "Submitted At"];
  const lines = [header.map(escape).join(",")];
  for (const r of records) {
    const cand = r.candidateId ? candById.get(r.candidateId) : undefined;
    lines.push([
      cand?.name ?? (r.candidateId ? `#${r.candidateId}` : "Anonymous"),
      cand?.candidateId ?? "",
      r.trainerId ? (trainerById.get(r.trainerId) ?? `#${r.trainerId}`) : "",
      r.rating ?? "",
      r.rating ?? "",
      r.responseText ?? "",
      r.createdAt ? new Date(r.createdAt).toISOString() : "",
    ].map(escape).join(","));
  }
  const csv = lines.join("\n");
  const safeName = batch.name.replace(/[^a-z0-9_\-]+/gi, "_");
  const dateStr = new Date().toISOString().slice(0, 10);

  await writeAudit({
    actorId: req.userId,
    action: "feedback_responses_downloaded",
    entityType: "batch",
    entityId: batchId,
    details: { batch_name: batch.name, response_count: records.length, format: "csv" },
  });

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
