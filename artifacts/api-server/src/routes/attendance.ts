import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, attendanceTable, candidatesTable, batchesTable } from "@workspace/db";
import {
  CreateAttendanceBody, BulkCreateAttendanceBody, UpdateAttendanceParams, UpdateAttendanceBody,
  ListAttendanceQueryParams, GetAttendanceSummaryQueryParams
} from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

async function enrichAttendance(a: typeof attendanceTable.$inferSelect) {
  let candidateName: string | null = null;
  if (a.candidateId) {
    const [c] = await db.select({ name: candidatesTable.name }).from(candidatesTable).where(eq(candidatesTable.id, a.candidateId));
    candidateName = c?.name ?? null;
  }
  return { ...a, candidateName };
}

router.get("/attendance", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAttendanceQueryParams.safeParse(req.query);
  let records: typeof attendanceTable.$inferSelect[];
  if (params.success) {
    const { batchId, date, candidateId } = params.data;
    const conditions: ReturnType<typeof eq>[] = [];
    if (batchId) conditions.push(eq(attendanceTable.batchId, batchId));
    if (date) conditions.push(eq(attendanceTable.date, date));
    if (candidateId) conditions.push(eq(attendanceTable.candidateId, candidateId));
    records = conditions.length > 0
      ? await db.select().from(attendanceTable).where(and(...conditions))
      : await db.select().from(attendanceTable);
  } else {
    records = await db.select().from(attendanceTable);
  }
  const enriched = await Promise.all(records.map(enrichAttendance));
  res.json(enriched);
});

router.post("/attendance", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const dateStr = parsed.data.date instanceof Date
    ? parsed.data.date.toISOString().split("T")[0]
    : String(parsed.data.date);
  const [record] = await db.insert(attendanceTable).values({
    candidateId: parsed.data.candidateId,
    batchId: parsed.data.batchId,
    date: dateStr,
    status: parsed.data.status,
    submittedById: req.userId ?? null,
  }).returning();
  res.status(201).json(await enrichAttendance(record));
});

router.post("/attendance/bulk", authMiddleware, async (req, res): Promise<void> => {
  const parsed = BulkCreateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { batchId, records } = parsed.data;
  const dateStr = parsed.data.date instanceof Date
    ? parsed.data.date.toISOString().split("T")[0]
    : String(parsed.data.date);
  const values = records.map(r => ({
    candidateId: r.candidateId,
    batchId,
    date: dateStr,
    status: r.status,
    submittedById: req.userId ?? null,
  }));
  const inserted = await db.insert(attendanceTable).values(values).returning();
  const enriched = await Promise.all(inserted.map(enrichAttendance));
  res.status(201).json(enriched);
});

router.get("/attendance/summary", authMiddleware, async (req, res): Promise<void> => {
  const params = GetAttendanceSummaryQueryParams.safeParse(req.query);
  const batchId = params.success ? params.data.batchId : undefined;

  const candidates = batchId
    ? await db.select().from(candidatesTable).where(eq(candidatesTable.batchId, batchId))
    : await db.select().from(candidatesTable);

  const summaries = await Promise.all(candidates.map(async (c) => {
    const records = batchId
      ? await db.select().from(attendanceTable).where(and(eq(attendanceTable.candidateId, c.id), eq(attendanceTable.batchId, batchId)))
      : await db.select().from(attendanceTable).where(eq(attendanceTable.candidateId, c.id));
    const totalDays = records.length;
    const presentDays = records.filter(r => r.status === "present").length;
    const absentDays = records.filter(r => r.status === "absent").length;
    const leaveDays = records.filter(r => r.status === "leave").length;
    const lateDays = records.filter(r => r.status === "late").length;
    const attendancePercent = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
    return { candidateId: c.id, candidateName: c.name, totalDays, presentDays, absentDays, leaveDays, lateDays, attendancePercent };
  }));
  res.json(summaries);
});

router.patch("/attendance/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateAttendanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [record] = await db.update(attendanceTable).set(parsed.data).where(eq(attendanceTable.id, params.data.id)).returning();
  if (!record) {
    res.status(404).json({ error: "Attendance record not found" });
    return;
  }
  res.json(await enrichAttendance(record));
});

router.get("/attendance/alerts", authMiddleware, async (req, res): Promise<void> => {
  const allAttendance = await db.select().from(attendanceTable);
  const candidates = await db.select().from(candidatesTable);
  const batches = await db.select().from(batchesTable);

  const alerts: {
    candidateId: number;
    candidateName: string;
    batchName: string;
    consecutiveAbsences: number;
    lastAbsenceDate: string;
  }[] = [];

  for (const candidate of candidates) {
    const records = allAttendance
      .filter(a => a.candidateId === candidate.id)
      .sort((a, b) => a.date.localeCompare(b.date));

    let consecutive = 0;
    let maxConsecutive = 0;
    let lastAbsenceDate = "";

    for (const r of records) {
      if (r.status === "absent") {
        consecutive++;
        lastAbsenceDate = r.date;
        if (consecutive > maxConsecutive) maxConsecutive = consecutive;
      } else {
        consecutive = 0;
      }
    }

    if (maxConsecutive >= 3) {
      const batch = batches.find(b => b.id === candidate.batchId);
      alerts.push({
        candidateId: candidate.id,
        candidateName: candidate.name,
        batchName: batch?.name ?? "N/A",
        consecutiveAbsences: maxConsecutive,
        lastAbsenceDate,
      });
    }
  }

  alerts.sort((a, b) => b.consecutiveAbsences - a.consecutiveAbsences);
  res.json(alerts);
});

export default router;
