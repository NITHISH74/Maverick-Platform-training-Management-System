import { Router, type IRouter } from "express";
import { eq, isNull, and, sql, inArray } from "drizzle-orm";
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

// =============================================================
// F2 — Batch comparison (grouped by program).
// Returns one row per `program`, aggregating attendance %, latest-
// assessment %, clearance rate, and the "best batch" by composite
// score (attendance + assessment + clearance).
// =============================================================
router.get("/dashboard/batch-comparison", authMiddleware, async (_req, res): Promise<void> => {
  // Pull all live (non-deleted) batches once.
  const batches = await db.select().from(batchesTable).where(isNull(batchesTable.deletedAt));
  if (batches.length === 0) {
    res.json({ programs: [] });
    return;
  }
  const batchIds = batches.map((b) => b.id);

  // Aggregate metrics per batch — single trip to the DB each.
  const attPerBatch = await db.execute<{ batch_id: number; pct: string }>(sql`
    SELECT batch_id,
           ROUND(100.0 * SUM(CASE WHEN status='present' THEN 1 ELSE 0 END)::numeric
                 / NULLIF(COUNT(*), 0), 2) AS pct
    FROM attendance
    WHERE batch_id = ANY(${sql.raw(`ARRAY[${batchIds.join(",")}]::int[]`)})
    GROUP BY batch_id
  `);
  const attMap = new Map<number, number>();
  for (const r of (attPerBatch.rows ?? attPerBatch) as Array<{ batch_id: number; pct: string }>) {
    attMap.set(Number(r.batch_id), Number(r.pct ?? 0));
  }

  const scorePerBatch = await db.execute<{ batch_id: number; pct: string; passed: string }>(sql`
    SELECT batch_id,
           ROUND(AVG(100.0 * score / NULLIF(max_score, 0)), 2) AS pct,
           ROUND(100.0 * SUM(CASE WHEN passed THEN 1 ELSE 0 END)::numeric
                 / NULLIF(COUNT(*), 0), 2) AS passed
    FROM assessments
    WHERE batch_id = ANY(${sql.raw(`ARRAY[${batchIds.join(",")}]::int[]`)})
    GROUP BY batch_id
  `);
  const scoreMap = new Map<number, number>();
  const passMap = new Map<number, number>();
  for (const r of (scorePerBatch.rows ?? scorePerBatch) as Array<{ batch_id: number; pct: string; passed: string }>) {
    scoreMap.set(Number(r.batch_id), Number(r.pct ?? 0));
    passMap.set(Number(r.batch_id), Number(r.passed ?? 0));
  }

  const candCounts = await db.execute<{ batch_id: number; count: string }>(sql`
    SELECT batch_id, COUNT(*)::text AS count FROM candidates
    WHERE batch_id = ANY(${sql.raw(`ARRAY[${batchIds.join(",")}]::int[]`)})
    GROUP BY batch_id
  `);
  const candMap = new Map<number, number>();
  for (const r of (candCounts.rows ?? candCounts) as Array<{ batch_id: number; count: string }>) {
    candMap.set(Number(r.batch_id), Number(r.count ?? 0));
  }

  // Group by the program field (or first word of batch name as fallback).
  const groups = new Map<string, typeof batches>();
  for (const b of batches) {
    const key = (b.program || b.name.split(/\s+/)[0] || "Other").trim();
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }

  const programs = Array.from(groups.entries()).map(([program, group]) => {
    let attSum = 0, attN = 0, scoreSum = 0, scoreN = 0, passSum = 0, passN = 0;
    let totalCandidates = 0;
    let best: { id: number; name: string; composite: number } | null = null;
    for (const b of group) {
      const a = attMap.get(b.id);
      const s = scoreMap.get(b.id);
      const p = passMap.get(b.id);
      if (a != null) { attSum += a; attN++; }
      if (s != null) { scoreSum += s; scoreN++; }
      if (p != null) { passSum += p; passN++; }
      totalCandidates += candMap.get(b.id) ?? 0;
      // Composite score for "best batch" — equal-weight, fall back to 0
      // when any signal is missing.
      const composite = (a ?? 0) + (s ?? 0) + (p ?? 0);
      if (!best || composite > best.composite) {
        best = { id: b.id, name: b.name, composite };
      }
    }
    return {
      program,
      batch_count: group.length,
      total_candidates: totalCandidates,
      avg_attendance_pct: attN > 0 ? Number((attSum / attN).toFixed(2)) : 0,
      avg_score_pct: scoreN > 0 ? Number((scoreSum / scoreN).toFixed(2)) : 0,
      clearance_rate: passN > 0 ? Number((passSum / passN).toFixed(2)) : 0,
      best_batch: best ? { id: String(best.id), name: best.name } : null,
    };
  });

  // Stable ordering — descending by avg_score_pct so the strongest
  // program is at the top of the chart/table.
  programs.sort((a, b) => b.avg_score_pct - a.avg_score_pct);

  res.json({ programs });
});

// =============================================================
// F1.C — per-batch attendance % for the current week, used to
// render the horizontal bar chart on the dashboard. Single trip
// to the DB; date math in SQL.
// =============================================================
router.get("/dashboard/attendance-by-batch", authMiddleware, async (_req, res): Promise<void> => {
  const rows = await db.execute<{ batch_id: number; batch_name: string; pct: string }>(sql`
    SELECT b.id AS batch_id, b.name AS batch_name,
           COALESCE(ROUND(100.0 * SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END)::numeric
                          / NULLIF(COUNT(a.id), 0), 1), 0) AS pct
    FROM batches b
    LEFT JOIN attendance a
      ON a.batch_id = b.id
     AND a.attend_date::date >= (NOW() - INTERVAL '7 days')::date
    WHERE b.deleted_at IS NULL
      AND b.status != 'closed'
    GROUP BY b.id, b.name
    ORDER BY b.name
  `);
  const list = ((rows.rows ?? rows) as Array<{ batch_id: number; batch_name: string; pct: string }>).map((r) => ({
    batchId: Number(r.batch_id),
    batchName: r.batch_name,
    attendancePct: Number(r.pct ?? 0),
  }));
  res.json(list);
});

// =============================================================
// F1.D — clearance-rate summary per batch (admin/coordinator view).
// =============================================================
router.get("/dashboard/clearance-summary", authMiddleware, async (_req, res): Promise<void> => {
  const rows = await db.execute<{ batch_id: number; name: string; threshold: string; actual: string | null }>(sql`
    SELECT b.id AS batch_id, b.name, b.clearance_rate::text AS threshold,
           CASE
             WHEN COUNT(a.id) = 0 THEN NULL
             ELSE ROUND(100.0 * SUM(CASE WHEN a.passed THEN 1 ELSE 0 END)::numeric
                       / NULLIF(COUNT(a.id), 0), 2)::text
           END AS actual
    FROM batches b
    LEFT JOIN assessments a ON a.batch_id = b.id
    WHERE b.deleted_at IS NULL
    GROUP BY b.id, b.name, b.clearance_rate
    ORDER BY b.name
  `);
  const list = ((rows.rows ?? rows) as Array<{ batch_id: number; name: string; threshold: string; actual: string | null }>).map((r) => ({
    batchId: Number(r.batch_id),
    batchName: r.name,
    threshold: Number(r.threshold ?? 70),
    actual: r.actual == null ? null : Number(r.actual),
  }));
  res.json(list);
});

export default router;
