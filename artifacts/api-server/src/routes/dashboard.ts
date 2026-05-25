import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, batchesTable, candidatesTable, attendanceTable, assessmentsTable, feedbackTable, auditLogsTable, notificationsTable } from "@workspace/db";
import { GetBatchMetricsQueryParams, GetAttendanceTrendsQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/summary", authMiddleware, async (req, res): Promise<void> => {
  const [allBatches, allCandidates, allUsers, allNotifications, allFeedback] = await Promise.all([
    db.select().from(batchesTable),
    db.select().from(candidatesTable),
    db.select().from(usersTable),
    db.select().from(notificationsTable).where(eq(notificationsTable.isRead, false)),
    db.select().from(feedbackTable),
  ]);

  const runningBatches = allBatches.filter(b => b.status === "running");
  const allAttendance = await db.select().from(attendanceTable);
  const totalAttendanceDays = allAttendance.length;
  const presentDays = allAttendance.filter(a => a.status === "present").length;
  const avgAttendancePercent = totalAttendanceDays > 0 ? Math.round((presentDays / totalAttendanceDays) * 100) : 0;

  // Supabase: each assessments row already carries score + passed (+ max_score).
  const allAssessments = await db.select().from(assessmentsTable);
  let clearanceRate = 0;
  if (allAssessments.length > 0) {
    const passed = allAssessments.filter(a => {
      if (a.passed != null) return a.passed;
      const max = Number(a.maxScore) || 100;
      return (Number(a.score) / max) >= 0.5;
    }).length;
    clearanceRate = Math.round((passed / allAssessments.length) * 100);
  }

  res.json({
    totalBatches: allBatches.length,
    runningBatches: runningBatches.length,
    plannedBatches: allBatches.filter(b => b.status === "planned").length,
    completedBatches: allBatches.filter(b => b.status === "completed" || b.status === "closed").length,
    totalCandidates: allCandidates.length,
    activeCandidates: allCandidates.filter(c => c.status === "active").length,
    discontinuedCandidates: allCandidates.filter(c => c.status === "discontinued").length,
    clearedCandidates: allCandidates.filter(c => c.status === "cleared").length,
    offeredCandidates: allCandidates.filter(c => c.status === "offered").length,
    onboardedCandidates: allCandidates.filter(c => c.status === "onboarded").length,
    totalTrainers: allUsers.filter(u => u.role === "trainer").length,
    totalCoordinators: allUsers.filter(u => u.role === "coordinator").length,
    avgAttendancePercent,
    assessmentClearanceRate: clearanceRate,
    pendingFeedback: 0,
    activeAlerts: allNotifications.filter(n => n.userId === req.userId && !n.isRead).length,
  });
});

router.get("/dashboard/batch-metrics", authMiddleware, async (req, res): Promise<void> => {
  const params = GetBatchMetricsQueryParams.safeParse(req.query);
  const batches = params.success && params.data.batchId
    ? await db.select().from(batchesTable).where(eq(batchesTable.id, params.data.batchId))
    : await db.select().from(batchesTable);

  const metrics = await Promise.all(batches.map(async (batch) => {
    const candidates = await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batch.id));
    const attendance = await db.select().from(attendanceTable).where(eq(attendanceTable.batchId, batch.id));
    const presentCount = attendance.filter(a => a.status === "present").length;
    const attendancePercent = attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0;

    // Supabase: each assessments row already carries score + max_score.
    const assessments = await db.select().from(assessmentsTable).where(eq(assessmentsTable.batchId, batch.id));
    let assessmentAvgScore = 0;
    if (assessments.length > 0) {
      const pcts = assessments.map(a => {
        const max = Number(a.maxScore) || 100;
        return (Number(a.score) / max) * 100;
      });
      assessmentAvgScore = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      candidateCount: candidates.length,
      attendancePercent,
      assessmentAvgScore,
      status: batch.status,
    };
  }));

  res.json(metrics);
});

router.get("/dashboard/attendance-trends", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAttendanceTrendsQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;
  const days = params.success ? (params.data.days ?? 30) : 30;

  const allAttendance = batchId
    ? await db.select().from(attendanceTable).where(eq(attendanceTable.batchId, batchId))
    : await db.select().from(attendanceTable);

  const dateMap = new Map<string, { present: number; absent: number; leave: number; late: number; total: number }>();
  allAttendance.forEach(a => {
    if (!dateMap.has(a.date)) {
      dateMap.set(a.date, { present: 0, absent: 0, leave: 0, late: 0, total: 0 });
    }
    const entry = dateMap.get(a.date)!;
    entry.total++;
    if (a.status === "present") entry.present++;
    else if (a.status === "absent") entry.absent++;
    else if (a.status === "leave") entry.leave++;
    else if (a.status === "late") entry.late++;
  });

  const sortedDates = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days);

  res.json(sortedDates.map(([date, counts]) => ({
    date,
    presentCount: counts.present,
    absentCount: counts.absent,
    leaveCount: counts.leave,
    lateCount: counts.late,
    totalCount: counts.total,
  })));
});

/**
 * Render an audit-log row as a single human-readable sentence.
 *
 * Background: Copilot writes its details as a JSON blob ({ "query": ..., ... })
 * and a previous version of this route surfaced that blob verbatim. The raw
 * JSON leaked into the Dashboard's Recent Activity card. This formatter now
 * produces a sentence per action — Copilot rows show the natural-language
 * question, everything else falls back to a generic "<action> on <entity>".
 */
function formatActivity(log: { action: string; entityType: string; entityId: number | null; details: string | null }): string {
  const parseDetails = (): Record<string, unknown> | null => {
    if (!log.details) return null;
    try {
      return JSON.parse(log.details) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // Copilot actions all start with "copilot.".
  if (log.action.startsWith("copilot.")) {
    const d = parseDetails();
    const q = typeof d?.query === "string" ? (d.query as string) : null;
    const rowCount = typeof d?.row_count === "number" ? (d.row_count as number) : null;
    const trimmed = q && q.length > 100 ? `${q.slice(0, 100)}…` : q;
    if (log.action === "copilot.query" && trimmed) {
      return rowCount != null
        ? `Asked Copilot: "${trimmed}" — ${rowCount} row(s)`
        : `Asked Copilot: "${trimmed}"`;
    }
    if (log.action === "copilot.query.rejected" && trimmed) {
      return `Copilot blocked an unsafe query: "${trimmed}"`;
    }
    if (log.action === "copilot.query.timeout" && trimmed) {
      return `Copilot timed out on: "${trimmed}"`;
    }
    if (log.action === "copilot.narrate") {
      return `Generated a batch summary via Copilot`;
    }
    if (log.action === "copilot.help" && trimmed) {
      return `Asked Copilot (how-to): "${trimmed}"`;
    }
    return `Used Coordinator Copilot`;
  }

  // Generic fallback — never surface raw JSON.
  if (log.details) {
    const d = parseDetails();
    if (d && typeof d.summary === "string") return d.summary;
  }
  return `${log.action.replace(/_/g, " ")} on ${log.entityType}${log.entityId ? ` #${log.entityId}` : ""}`;
}

router.get("/dashboard/recent-activity", authMiddleware, async (req, res): Promise<void> => {
  const logs = await db.select().from(auditLogsTable);

  // The Dashboard "Recent Activity" feed surfaces real coordinator
  // activity — creating batches, marking attendance, updating candidates.
  // Copilot interactions ("asked a question") are noise here; they are
  // still recorded in audit_logs and visible on the dedicated /audit page
  // for admins/coordinators who need the security trail.
  const filtered = logs.filter(l => l.entityType !== "copilot");

  const sorted = filtered
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);
  const userIds = [...new Set(sorted.map(l => l.actorId).filter(Boolean))];
  const users = userIds.length > 0 ? await db.select().from(usersTable) : [];

  res.json(sorted.map(l => ({
    id: l.id,
    type: l.action,
    description: formatActivity(l),
    entityType: l.entityType,
    entityId: l.entityId ?? null,
    actorName: l.actorId ? (users.find(u => u.id === l.actorId)?.name ?? null) : null,
    createdAt: l.createdAt,
  })));
});

router.get("/dashboard/candidate-status-breakdown", authMiddleware, async (req, res): Promise<void> => {
  const candidates = await db.select().from(candidatesTable);
  const statusMap = new Map<string, number>();
  candidates.forEach(c => {
    statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
  });
  res.json(Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })));
});

export default router;
