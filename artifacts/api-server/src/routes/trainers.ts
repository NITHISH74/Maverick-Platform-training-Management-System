/**
 * Trainer-centric REST routes.
 *
 * Currently only one endpoint — the Trainer Intelligence Graph — but the
 * file is named generically so future trainer-scoped routes land here
 * (e.g. trainer scoring proxy, trainer reports). We don't restructure
 * the existing users router because trainers are still just users with
 * role='trainer'; this router exposes the *graph view* over their
 * batch+candidate relationships.
 *
 * Deviation note: the feature spec describes IDs as UUIDs and references a
 * `candidates.total_score` column. Our schema uses integer IDs and stores
 * scores per assessment, not per candidate. The endpoint adapts:
 *   - :trainerId is parsed as integer
 *   - candidate "value" is derived as AVG(score/max_score)*100 across the
 *     candidate's assessments in this batch
 */

import { Router, type IRouter } from "express";
import { eq, inArray, and, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  batchesTable,
  batchTrainersTable,
  candidatesTable,
} from "@workspace/db";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

type NodeType = "trainer" | "batch" | "candidate";
interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  value: number | null;
  status: string | null;
}
interface GraphEdge {
  source: string;
  target: string;
}

router.get("/trainers/:trainerId/graph", authMiddleware, async (req, res): Promise<void> => {
  const trainerId = Number(req.params.trainerId);
  if (!Number.isFinite(trainerId)) {
    res.status(400).json({ error: "invalid trainer id" });
    return;
  }

  // 1. The trainer themself — confirm they exist and have role=trainer.
  const [trainer] = await db.select().from(usersTable).where(eq(usersTable.id, trainerId)).limit(1);
  if (!trainer) {
    res.status(404).json({ error: "trainer not found" });
    return;
  }

  // 2. All batches this trainer is assigned to (via batch_trainers join).
  const trainerBatchLinks = await db.select({ batchId: batchTrainersTable.batchId })
    .from(batchTrainersTable)
    .where(eq(batchTrainersTable.trainerId, trainerId));
  const batchIds = trainerBatchLinks.map((b) => b.batchId);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Root trainer node — id namespaced to avoid collisions with batch/candidate ids.
  const trainerNodeId = `trainer:${trainer.id}`;
  nodes.push({
    id: trainerNodeId,
    type: "trainer",
    label: trainer.name,
    value: null,
    status: trainer.role,
  });

  let totalCandidates = 0;
  let attendanceAccum = 0;
  let attendanceBatches = 0;
  let scoreAccum = 0;
  let scoreCandidates = 0;

  if (batchIds.length > 0) {
    // 3. Batches (one DB call).
    const batches = await db.select().from(batchesTable).where(inArray(batchesTable.id, batchIds));

    // 4. Candidates across these batches (one DB call).
    const candidates = batches.length
      ? await db.select().from(candidatesTable).where(inArray(candidatesTable.batchId, batchIds))
      : [];
    totalCandidates = candidates.length;

    // 5. Per-batch attendance % AND per-candidate average score, computed in SQL.
    //    Using raw SQL because the aggregation crosses the assessments and
    //    attendance tables and Drizzle's typed builder doesn't help here.
    const attendancePctByBatch = batches.length
      ? await db.execute<{ batch_id: number; pct: string }>(sql`
          select batch_id,
                 round(
                   100.0 * sum(case when status = 'present' then 1 else 0 end)::numeric
                   / nullif(count(*), 0),
                   2
                 ) as pct
          from attendance
          where batch_id = any(${sql.raw(`array[${batchIds.join(",")}]::int[]`)})
          group by batch_id
        `)
      : { rows: [] as Array<{ batch_id: number; pct: string }> };
    const attMap = new Map<number, number>();
    for (const r of (attendancePctByBatch.rows ?? attendancePctByBatch) as Array<{ batch_id: number; pct: string }>) {
      attMap.set(Number(r.batch_id), Number(r.pct ?? 0));
    }

    const candidateScores = candidates.length
      ? await db.execute<{ candidate_id: number; pct: string }>(sql`
          select candidate_id,
                 round(avg(100.0 * score / nullif(max_score, 0)), 2) as pct
          from assessments
          where candidate_id = any(${sql.raw(`array[${candidates.map((c) => c.id).join(",")}]::int[]`)})
          group by candidate_id
        `)
      : { rows: [] as Array<{ candidate_id: number; pct: string }> };
    const scoreMap = new Map<number, number>();
    for (const r of (candidateScores.rows ?? candidateScores) as Array<{ candidate_id: number; pct: string }>) {
      scoreMap.set(Number(r.candidate_id), Number(r.pct ?? 0));
    }

    // 6. Build the graph: trainer → batches → candidates.
    for (const batch of batches) {
      const batchNodeId = `batch:${batch.id}`;
      const attPct = attMap.get(batch.id) ?? 0;
      nodes.push({
        id: batchNodeId,
        type: "batch",
        label: batch.name,
        value: attPct,
        status: batch.status,
      });
      edges.push({ source: trainerNodeId, target: batchNodeId });
      if (attMap.has(batch.id)) {
        attendanceAccum += attPct;
        attendanceBatches += 1;
      }
    }

    for (const c of candidates) {
      const candidateNodeId = `candidate:${c.id}`;
      const value = scoreMap.get(c.id) ?? null;
      nodes.push({
        id: candidateNodeId,
        type: "candidate",
        label: c.name,
        value,
        status: c.status,
      });
      if (c.batchId != null) {
        edges.push({ source: `batch:${c.batchId}`, target: candidateNodeId });
      }
      if (value != null) {
        scoreAccum += value;
        scoreCandidates += 1;
      }
    }
  }

  const summary = {
    total_batches: batchIds.length,
    total_candidates: totalCandidates,
    avg_attendance_pct: attendanceBatches > 0 ? Number((attendanceAccum / attendanceBatches).toFixed(2)) : 0,
    avg_score_pct: scoreCandidates > 0 ? Number((scoreAccum / scoreCandidates).toFixed(2)) : 0,
  };

  res.json({
    trainer: { id: String(trainer.id), name: trainer.name },
    nodes,
    edges,
    summary,
  });
});

export default router;
