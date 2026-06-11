import { Router, type IRouter, type Request, type Response } from "express";
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
import { writeAudit } from "../lib/rbac";

const router: IRouter = Router();

// ----------------------------------------------------------------------------
// PDF passthrough — F3 (AI PDF reports)
//
// CSV / JSON is the default. When the client passes ?format=pdf we:
//   1. Build the same row set we would have returned as JSON.
//   2. POST it to the AI service /reports/pdf (which narrates with GPT and
//      renders the PDF via reportlab).
//   3. Stream the PDF bytes straight back to the browser.
//   4. Write a `report_downloaded` audit row.
//
// AI service URL + internal token follow the pattern from routes/ai.ts and
// routes/copilot.ts. PDF mode is centralised in `maybeRenderPdf` so each
// report endpoint stays one line away from its existing JSON behaviour.
// ----------------------------------------------------------------------------

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";

type ReportType = "attendance" | "assessment" | "topper" | "consolidated";

async function maybeRenderPdf(
  req: Request,
  res: Response,
  reportType: ReportType,
  rows: unknown[],
  extra: { batchName?: string | null; filters?: Record<string, unknown> } = {},
): Promise<boolean> {
  if (req.query.format !== "pdf") return false;

  try {
    const upstream = await fetch(`${AI_BASE}/reports/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        report_type: reportType,
        rows,
        batch_name: extra.batchName ?? null,
        filters: extra.filters ?? null,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(502).json({
        error: "AI service failed to generate PDF",
        detail: text.slice(0, 500),
      });
      return true;
    }

    const filename = `${reportType}-report.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    // Forward the upstream AI-generated flag so the UI could surface it
    // later (e.g. "AI summary unavailable — used deterministic fallback").
    const aiFlag = upstream.headers.get("x-ai-generated");
    if (aiFlag) res.setHeader("X-AI-Generated", aiFlag);

    const reader = upstream.body?.getReader();
    if (!reader) {
      res.end();
    } else {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    }

    await writeAudit({
      actorId: req.userId,
      action: "report_downloaded",
      entityType: "report",
      entityId: null,
      details: {
        report_type: reportType,
        format: "pdf",
        row_count: rows.length,
        role: req.userRole,
        filters: extra.filters ?? null,
        batch_name: extra.batchName ?? null,
        ai_generated: aiFlag === "1",
      },
    });
    return true;
  } catch (e: unknown) {
    res.status(502).json({
      error: "AI service unreachable",
      detail: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}

// Look up a batch name once per PDF request — small extra query, lets the
// PDF cover page show "Batch: Java-01" instead of just "All batches".
async function batchNameOrNull(batchId: number | undefined): Promise<string | null> {
  if (!batchId) return null;
  const [b] = await db
    .select({ name: batchesTable.name })
    .from(batchesTable)
    .where(eq(batchesTable.id, batchId));
  return b?.name ?? null;
}

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

  if (await maybeRenderPdf(req, res, "attendance", enriched, {
    batchName: await batchNameOrNull(batchId),
    filters: { startDate, endDate },
  })) return;

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

  if (await maybeRenderPdf(req, res, "assessment", rows, {
    batchName: await batchNameOrNull(batchId),
  })) return;

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

  if (await maybeRenderPdf(req, res, "topper", enriched, {
    batchName: await batchNameOrNull(batchId),
  })) return;

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

  if (await maybeRenderPdf(req, res, "consolidated", rows, {
    batchName: await batchNameOrNull(batchId),
    filters: { status },
  })) return;

  res.json(rows);
});

export default router;
