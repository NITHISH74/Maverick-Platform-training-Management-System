import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db, candidatesTable, batchesTable, attendanceTable,
  assessmentsTable, assessmentScoresTable, topperResultsTable,
} from "@workspace/db";
import {
  GetAttendanceReportQueryParams,
  GetAssessmentReportQueryParams,
  GetTopperReportQueryParams,
  GetConsolidatedReportQueryParams,
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/reports/attendance", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAttendanceReportQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const startDate = params.success ? params.data.startDate : undefined;
  const endDate = params.success ? params.data.endDate : undefined;

  let records = batchId
    ? await db.select().from(attendanceTable).where(eq(attendanceTable.batchId, batchId))
    : await db.select().from(attendanceTable);

  if (startDate) records = records.filter(r => r.date >= startDate);
  if (endDate) records = records.filter(r => r.date <= endDate);

  const candidates = await db.select().from(candidatesTable);
  const batches = await db.select().from(batchesTable);

  const enriched = records.map(r => {
    const candidate = candidates.find(c => c.id === r.candidateId);
    const batch = batches.find(b => b.id === r.batchId);
    return {
      candidateId: candidate?.candidateId ?? undefined,
      candidateName: candidate?.name ?? "Unknown",
      batchName: batch?.name ?? "Unknown",
      date: r.date,
      status: r.status,
      remarks: r.remarks ?? null,
    };
  });

  enriched.sort((a, b) => a.date.localeCompare(b.date));
  res.json(enriched);
});

router.get("/reports/assessments", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAssessmentReportQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;

  const assessments = batchId
    ? await db.select().from(assessmentsTable).where(eq(assessmentsTable.batchId, batchId))
    : await db.select().from(assessmentsTable);

  const allScores = await db.select().from(assessmentScoresTable);
  const candidates = await db.select().from(candidatesTable);
  const batches = await db.select().from(batchesTable);

  const rows = allScores
    .filter(s => assessments.some(a => a.id === s.assessmentId))
    .map(s => {
      const assessment = assessments.find(a => a.id === s.assessmentId);
      const candidate = candidates.find(c => c.id === s.candidateId);
      const batch = batches.find(b => b.id === assessment?.batchId);
      const maxScore = assessment ? Number(assessment.maxScore) : 100;
      const score = Number(s.score);
      return {
        candidateName: candidate?.name ?? "Unknown",
        batchName: batch?.name ?? "Unknown",
        assessmentTitle: assessment?.title ?? "Unknown",
        assessmentType: assessment?.type ?? "unknown",
        score,
        maxScore,
        percentage: maxScore > 0 ? Math.round((score / maxScore) * 100 * 10) / 10 : 0,
        scheduledDate: assessment?.scheduledDate ?? undefined,
      };
    });

  res.json(rows);
});

router.get("/reports/toppers", authMiddleware, async (req, res): Promise<void> => {
  const params = GetTopperReportQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;

  const results = batchId
    ? await db.select().from(topperResultsTable).where(eq(topperResultsTable.batchId, batchId))
    : await db.select().from(topperResultsTable);

  const candidates = await db.select().from(candidatesTable);
  const batches = await db.select().from(batchesTable);

  const enriched = results
    .sort((a, b) => a.rank - b.rank)
    .map(t => {
      const candidate = candidates.find(c => c.id === t.candidateId);
      const batch = batches.find(b => b.id === t.batchId);
      return {
        rank: t.rank,
        candidateName: candidate?.name ?? "Unknown",
        batchName: batch?.name ?? "Unknown",
        totalScore: Math.round(Number(t.totalScore) * 10) / 10,
        assessmentScore: t.assessmentScore ? Math.round(Number(t.assessmentScore) * 10) / 10 : null,
        projectScore: t.projectScore ? Math.round(Number(t.projectScore) * 10) / 10 : null,
        attendanceScore: t.attendanceScore ? Math.round(Number(t.attendanceScore) * 10) / 10 : null,
      };
    });

  res.json(enriched);
});

router.get("/reports/consolidated", authMiddleware, async (req, res): Promise<void> => {
  const params = GetConsolidatedReportQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const status = params.success ? params.data.status : undefined;

  let candidates = batchId
    ? await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batchId))
    : await db.select().from(candidatesTable);

  if (status) candidates = candidates.filter(c => c.status === status);

  const allAttendance = await db.select().from(attendanceTable);
  const allScores = await db.select().from(assessmentScoresTable);
  const allAssessments = await db.select().from(assessmentsTable);
  const batches = await db.select().from(batchesTable);

  const rows = candidates.map(c => {
    const batch = batches.find(b => b.id === c.batchId);
    const attendance = allAttendance.filter(a => a.candidateId === c.id);
    const attendancePct = attendance.length > 0
      ? Math.round((attendance.filter(a => a.status === "present").length / attendance.length) * 100 * 10) / 10
      : 0;
    const candidateScores = allScores.filter(s => s.candidateId === c.id);
    const avgScore = candidateScores.length > 0
      ? Math.round(candidateScores.reduce((sum, s) => {
          const assessment = allAssessments.find(a => a.id === s.assessmentId);
          const max = assessment ? Number(assessment.maxScore) : 100;
          return sum + (Number(s.score) / max) * 100;
        }, 0) / candidateScores.length * 10) / 10
      : 0;
    return {
      candidateId: c.candidateId ?? undefined,
      candidateName: c.name,
      batchName: batch?.name ?? "N/A",
      status: c.status,
      attendancePct,
      avgScore,
      joinedAt: c.joinedAt ?? null,
    };
  });

  res.json(rows);
});

export default router;
