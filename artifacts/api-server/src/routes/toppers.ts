import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, topperConfigTable, topperResultsTable, batchesTable, candidatesTable, assessmentsTable, attendanceTable } from "@workspace/db";
import { ComputeToppersBody, UpdateTopperConfigBody, ListToppersQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

async function enrichTopperResult(t: typeof topperResultsTable.$inferSelect) {
  const [batch] = await db.select({ name: batchesTable.name }).from(batchesTable).where(eq(batchesTable.id, t.batchId));
  const [candidate] = await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, t.candidateId));
  return {
    id: t.id,
    batchId: t.batchId,
    batchName: batch?.name ?? null,
    candidateId: t.candidateId,
    candidateName: candidate?.name ?? null,
    rank: t.rank,
    totalScore: Number(t.totalScore),
    assessmentScore: t.assessmentScore ? Number(t.assessmentScore) : null,
    projectScore: t.projectScore ? Number(t.projectScore) : null,
    attendanceScore: t.attendanceScore ? Number(t.attendanceScore) : null,
    createdAt: t.createdAt,
  };
}

router.get("/toppers", authMiddleware, async (req, res): Promise<void> => {
  const params = ListToppersQueryParams.safeParse(req.query);
  const results = params.success && params.data.batchId
    ? await db.select().from(topperResultsTable).where(eq(topperResultsTable.batchId, params.data.batchId))
    : await db.select().from(topperResultsTable);
  const enriched = await Promise.all(results.map(enrichTopperResult));
  res.json(enriched.sort((a, b) => a.rank - b.rank));
});

router.post("/toppers/compute", authMiddleware, async (req, res): Promise<void> => {
  const parsed = ComputeToppersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { batchId } = parsed.data;
  const [config] = await db.select().from(topperConfigTable);
  // Supabase config has sprint + api weights; treat their sum as the
  // "assessment" weight to keep the legacy formula.
  const assessmentWeight = config
    ? (Number(config.sprintWeight ?? 0) + Number(config.apiWeight ?? 0)) / 100
    : 0.5;
  const projectWeight = config ? Number(config.projectWeight) / 100 : 0.3;
  const attendanceWeight = config ? Number(config.attendanceWeight) / 100 : 0.2;

  const candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batchId));
  const assessments = await db.select().from(assessmentsTable).where(eq(assessmentsTable.batchId, batchId));

  // In Supabase, each assessments row IS a per-candidate score, so filter
  // directly by candidate_id.
  const candidateScores = await Promise.all(candidates.map(async (c) => {
    const myAssessments = assessments.filter(a => a.candidateId === c.id);
    const nonProject = myAssessments.filter(a => a.type !== "project_evaluation");
    const project = myAssessments.filter(a => a.type === "project_evaluation");

    const pct = (a: typeof assessmentsTable.$inferSelect) => {
      const max = Number(a.maxScore) || 100;
      return (Number(a.score) / max) * 100;
    };
    const assessmentAvg = nonProject.length > 0
      ? nonProject.reduce((sum, a) => sum + pct(a), 0) / nonProject.length
      : 0;
    const projectAvg = project.length > 0
      ? project.reduce((sum, a) => sum + pct(a), 0) / project.length
      : 0;

    const attendanceRecords = await db.select().from(attendanceTable).where(eq(attendanceTable.candidateId, c.id));
    const batchAttendance = attendanceRecords.filter(r => r.batchId === batchId);
    const attendancePct = batchAttendance.length > 0
      ? (batchAttendance.filter(r => r.status === "present").length / batchAttendance.length) * 100
      : 0;

    const totalScore = (assessmentAvg * assessmentWeight) + (projectAvg * projectWeight) + (attendancePct * attendanceWeight);
    return { candidateId: c.id, assessmentScore: assessmentAvg, projectScore: projectAvg, attendanceScore: attendancePct, totalScore };
  }));

  candidateScores.sort((a, b) => b.totalScore - a.totalScore);

  await db.delete(topperResultsTable).where(eq(topperResultsTable.batchId, batchId));
  if (candidateScores.length > 0) {
    const values = candidateScores.map((s, i) => ({
      batchId,
      candidateId: s.candidateId,
      rank: i + 1,
      totalScore: String(s.totalScore),
      assessmentScore: String(s.assessmentScore),
      projectScore: String(s.projectScore),
      attendanceScore: String(s.attendanceScore),
    }));
    await db.insert(topperResultsTable).values(values);
  }

  const results = await db.select().from(topperResultsTable).where(eq(topperResultsTable.batchId, batchId));
  const enriched = await Promise.all(results.map(enrichTopperResult));
  res.json(enriched.sort((a, b) => a.rank - b.rank));
});

router.get("/topper-config", authMiddleware, async (_req, res): Promise<void> => {
  let [config] = await db.select().from(topperConfigTable);
  if (!config) {
    [config] = await db.insert(topperConfigTable).values({}).returning();
  }
  const assessmentWeight = Number(config.sprintWeight ?? 0) + Number(config.apiWeight ?? 0);
  res.json({
    id: config.id,
    assessmentWeight,
    sprintWeight: Number(config.sprintWeight ?? 0),
    apiWeight: Number(config.apiWeight ?? 0),
    projectWeight: Number(config.projectWeight),
    attendanceWeight: Number(config.attendanceWeight),
    updatedAt: config.updatedAt,
  });
});

router.patch("/topper-config", authMiddleware, async (req, res): Promise<void> => {
  const parsed = UpdateTopperConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let [config] = await db.select().from(topperConfigTable);
  if (!config) {
    [config] = await db.insert(topperConfigTable).values({}).returning();
  }
  const updateData: Record<string, string> = {};
  // Legacy clients send a single assessmentWeight; split it 50/50 across
  // sprint + api so the new weights still sum correctly.
  if (parsed.data.assessmentWeight !== undefined) {
    const half = parsed.data.assessmentWeight / 2;
    updateData.sprintWeight = String(half);
    updateData.apiWeight = String(half);
  }
  if (parsed.data.projectWeight !== undefined) updateData.projectWeight = String(parsed.data.projectWeight);
  if (parsed.data.attendanceWeight !== undefined) updateData.attendanceWeight = String(parsed.data.attendanceWeight);
  const [updated] = await db.update(topperConfigTable).set(updateData).where(eq(topperConfigTable.id, config.id)).returning();
  const assessmentWeight = Number(updated.sprintWeight ?? 0) + Number(updated.apiWeight ?? 0);
  res.json({
    id: updated.id,
    assessmentWeight,
    sprintWeight: Number(updated.sprintWeight ?? 0),
    apiWeight: Number(updated.apiWeight ?? 0),
    projectWeight: Number(updated.projectWeight),
    attendanceWeight: Number(updated.attendanceWeight),
    updatedAt: updated.updatedAt,
  });
});

export default router;
