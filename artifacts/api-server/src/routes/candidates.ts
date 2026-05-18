import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, candidatesTable, batchesTable } from "@workspace/db";
import {
  CreateCandidateBody, UpdateCandidateBody, GetCandidateParams, UpdateCandidateParams,
  DeleteCandidateParams, UpdateCandidateStatusParams, UpdateCandidateStatusBody, ListCandidatesQueryParams,
  BulkImportCandidatesBody,
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

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
  let candidates: typeof candidatesTable.$inferSelect[];
  if (params.success) {
    const { batchId, status } = params.data;
    if (batchId && status) {
      candidates = await db.select().from(candidatesTable).where(and(eq(candidatesTable.batchId, batchId), eq(candidatesTable.status, status)));
    } else if (batchId) {
      candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batchId));
    } else if (status) {
      candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.status, status));
    } else {
      candidates = await db.select().from(candidatesTable);
    }
  } else {
    candidates = await db.select().from(candidatesTable);
  }
  const enriched = await Promise.all(candidates.map(enrichCandidate));
  res.json(enriched);
});

router.post("/candidates", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateCandidateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const joinedAt = parsed.data.joinedAt instanceof Date
    ? parsed.data.joinedAt.toISOString().split("T")[0]
    : (parsed.data.joinedAt ?? null);
  const [candidate] = await db.insert(candidatesTable).values({
    candidateId: parsed.data.candidateId,
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    batchId: parsed.data.batchId ?? null,
    college: parsed.data.college ?? null,
    degree: parsed.data.degree ?? null,
    joinedAt,
    status: "active",
  }).returning();
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

router.patch("/candidates/:id", authMiddleware, async (req, res): Promise<void> => {
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

router.delete("/candidates/:id", authMiddleware, async (req, res): Promise<void> => {
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
  res.sendStatus(204);
});

router.patch("/candidates/:id/status", authMiddleware, async (req, res): Promise<void> => {
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

router.post("/candidates/bulk-import", authMiddleware, async (req, res): Promise<void> => {
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
        college: c.college ?? null,
        degree: c.degree ?? null,
        batchId,
        joinedAt: new Date().toISOString().split("T")[0],
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
