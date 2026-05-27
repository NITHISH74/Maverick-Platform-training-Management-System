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
    action: "create",
    entityType: "candidate",
    entityId: candidate.id,
    details: { name: candidate.name, email: candidate.email, batchId: candidate.batchId },
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
  const [candidate] = await db.update(candidatesTable).set(parsed.data).where(eq(candidatesTable.id, params.data.id)).returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
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
    action: "delete",
    entityType: "candidate",
    entityId: candidate.id,
    details: {
      candidateId: candidate.candidateId,
      name: candidate.name,
      email: candidate.email,
      batchId: candidate.batchId,
      status: candidate.status,
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
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
  const [candidate] = await db.update(candidatesTable).set({ status: parsed.data.status }).where(eq(candidatesTable.id, params.data.id)).returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(await enrichCandidate(candidate));
});

router.post("/candidates/bulk-import", authMiddleware, requireRole("admin", "coordinator"), async (req, res): Promise<void> => {
  const parsed = BulkImportCandidatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { batchId, candidates } = parsed.data;
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const c of candidates) {
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
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${c.candidateId}: ${msg}`);
    }
  }

  res.status(201).json({ inserted, failed, errors });
});

export default router;
