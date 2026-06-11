import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, candidatesTable, batchesTable } from "@workspace/db";
import {
  CreateCandidateBody, UpdateCandidateBody, GetCandidateParams, UpdateCandidateParams,
  DeleteCandidateParams, UpdateCandidateStatusParams, UpdateCandidateStatusBody, ListCandidatesQueryParams,
  BulkImportCandidatesBody,
} from "@workspace/api-zod";
import { authMiddleware, requireRole } from "../middlewares/auth";
import { getTrainerBatchIds, writeAudit } from "../lib/rbac";

const router: IRouter = Router();

async function enrichCandidate(c: typeof candidatesTable.$inferSelect) {
  let batchName: string | null = null;
  if (c.batchId) {
    const [batch] = await db.select({ name: batchesTable.name }).from(batchesTable).where(eq(batchesTable.id, c.batchId));
    batchName = batch?.name ?? null;
  }
  return { ...c, batchName };
}

router.get("/candidates", authMiddleware, async (req, res): Promise<void> => {
  const params = ListCandidatesQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const status = params.success ? params.data.status : undefined;

  // Trainer scoping: restrict to candidates in batches the trainer is assigned to.
  let trainerBatchIds: number[] | null = null;
  if (req.userRole === "trainer" && req.userId) {
    trainerBatchIds = await getTrainerBatchIds(req.userId);
    if (trainerBatchIds.length === 0) {
      res.json([]);
      return;
    }
    // If a specific batchId was requested, enforce it belongs to the trainer.
    if (batchId && !trainerBatchIds.includes(batchId)) {
      res.json([]);
      return;
    }
  }

  const conditions = [];
  if (batchId) conditions.push(eq(candidatesTable.batchId, batchId));
  if (status) conditions.push(eq(candidatesTable.status, status));
  if (trainerBatchIds && !batchId) conditions.push(inArray(candidatesTable.batchId, trainerBatchIds));

  const candidates = conditions.length > 0
    ? await db.select().from(candidatesTable).where(and(...conditions))
    : await db.select().from(candidatesTable);

  const enriched = await Promise.all(candidates.map(enrichCandidate));
  res.json(enriched);
});

router.post("/candidates", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const parsed = CreateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // college / degree / joinedAt are accepted in the request body for API
  // compatibility but Supabase doesn't store those, so they're dropped.
  const [candidate] = await db.insert(candidatesTable).values({
    candidateId: parsed.data.candidateId,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    batchId: parsed.data.batchId ?? null,
    status: "active",
  }).returning();
  await writeAudit({
    actorId: req.userId,
    action: "candidate_created",
    entityType: "candidate",
    entityId: candidate.id,
    details: { after: { name: candidate.name, email: candidate.email, batchId: candidate.batchId }, role: req.userRole, ip: req.ip ?? null },
  });
  res.status(201).json(await enrichCandidate(candidate));
});

router.get("/candidates/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [candidate] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, params.data.id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(await enrichCandidate(candidate));
});

router.patch("/candidates/:id", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const params = UpdateCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Snapshot before so the audit row shows what actually changed.
  const [pre] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, params.data.id));
  const [candidate] = await db.update(candidatesTable).set(parsed.data).where(eq(candidatesTable.id, params.data.id)).returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  await writeAudit({
    actorId: req.userId,
    action: "candidate_updated",
    entityType: "candidate",
    entityId: candidate.id,
    details: {
      before: pre ? { name: pre.name, email: pre.email, status: pre.status, batchId: pre.batchId } : null,
      after: { name: candidate.name, email: candidate.email, status: candidate.status, batchId: candidate.batchId },
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  res.json(await enrichCandidate(candidate));
});

router.delete("/candidates/:id", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const params = DeleteCandidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [candidate] = await db.delete(candidatesTable).where(eq(candidatesTable.id, params.data.id)).returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  // Audit the removal so it can be reviewed in the audit log UI.
  await writeAudit({
    actorId: req.userId,
    action: "candidate_deleted",
    entityType: "candidate",
    entityId: candidate.id,
    details: {
      before: {
        candidateId: candidate.candidateId,
        name: candidate.name,
        email: candidate.email,
        batchId: candidate.batchId,
        status: candidate.status,
      },
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  res.sendStatus(204);
});

router.patch("/candidates/:id/status", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const params = UpdateCandidateStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCandidateStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [pre] = await db.select().from(candidatesTable).where(eq(candidatesTable.id, params.data.id));
  const [candidate] = await db.update(candidatesTable).set({ status: parsed.data.status }).where(eq(candidatesTable.id, params.data.id)).returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  await writeAudit({
    actorId: req.userId,
    action: "candidate_status_changed",
    entityType: "candidate",
    entityId: candidate.id,
    details: {
      before_status: pre?.status,
      after_status: candidate.status,
      name: candidate.name,
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  res.json(await enrichCandidate(candidate));
});

router.post("/candidates/bulk-import", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const parsed = BulkImportCandidatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { batchId, candidates } = parsed.data;

  // V6 F3: surface ALL duplicates instead of silently treating them as failures.
  // A duplicate = same name+batch OR same email+batch already on file.
  const existing = await db
    .select({ name: candidatesTable.name, email: candidatesTable.email })
    .from(candidatesTable)
    .where(eq(candidatesTable.batchId, batchId));
  const existingNames = new Set(existing.map(r => r.name.trim().toLowerCase()));
  const existingEmails = new Set(existing.map(r => (r.email ?? "").trim().toLowerCase()).filter(Boolean));

  // Also dedup WITHIN the upload — if the user uploads the same name twice
  // we want the second one in the duplicates list, not silently inserted.
  const seenInBatch = new Set<string>();

  let inserted = 0;
  const duplicates: { row: number; name: string; email: string; reason: string }[] = [];
  const errors: { row: number; name: string; reason: string }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const rowNum = i + 2; // header row + 1-indexed
    const nameKey = c.name.trim().toLowerCase();
    const emailKey = c.email.trim().toLowerCase();

    if (existingNames.has(nameKey) || seenInBatch.has(`n:${nameKey}`)) {
      duplicates.push({ row: rowNum, name: c.name, email: c.email, reason: "Candidate name already exists in this batch" });
      continue;
    }
    if (existingEmails.has(emailKey) || seenInBatch.has(`e:${emailKey}`)) {
      duplicates.push({ row: rowNum, name: c.name, email: c.email, reason: "Candidate email already exists in this batch" });
      continue;
    }
    try {
      await db.insert(candidatesTable).values({
        candidateId: c.candidateId,
        name: c.name,
        email: c.email,
        phone: c.phone ?? null,
        batchId,
        status: "active",
      });
      inserted++;
      seenInBatch.add(`n:${nameKey}`);
      seenInBatch.add(`e:${emailKey}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Postgres unique-violation surfaces as a duplicate, not a failure.
      if (/duplicate key|unique constraint/i.test(msg)) {
        duplicates.push({ row: rowNum, name: c.name, email: c.email, reason: "Already exists (unique constraint)" });
      } else {
        errors.push({ row: rowNum, name: c.name, reason: msg });
      }
    }
  }

  // F2: every bulk import logs one audit row covering the whole batch
  // upload — counts make it easy to spot accidental mass-inserts later.
  await writeAudit({
    actorId: req.userId,
    action: "candidate_bulk_uploaded",
    entityType: "batch",
    entityId: batchId,
    details: {
      inserted,
      duplicates: duplicates.length,
      errors: errors.length,
      attempted: candidates.length,
      role: req.userRole,
      ip: req.ip ?? null,
    },
  });
  // Back-compat: old client uses `failed` + `errors: string[]`. We keep both
  // shapes so the existing Candidates.tsx doesn't break while the new UI
  // reads `duplicates`.
  res.status(201).json({
    inserted,
    failed: errors.length,
    errors: errors.map(e => `Row ${e.row} (${e.name}): ${e.reason}`),
    duplicates,
  });
});

export default router;
