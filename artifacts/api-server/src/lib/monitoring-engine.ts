/**
 * Autonomous batch monitoring rule engine.
 *
 * This is the Node-side workhorse of the monitoring agent. It encodes
 * all eight monitoring rules from the feature spec as pure, deterministic
 * SQL queries; it then writes monitoring_alerts rows and triggers emails
 * via the email service.
 *
 * Relationship to the Python CrewAI agent (services/ai):
 *   - The Python agent is the LLM-driven path. It calls into THIS engine
 *     via the Node API (or duplicates the logic in tools.py) so that the
 *     business rules live in one place.
 *   - When the LLM is unavailable, the scheduler invokes this engine
 *     directly — the same fallback pattern as services/ai/app/crew/runner.py
 *     uses for its rule-only mode.
 *
 * Idempotency: before creating a new alert we check whether an open
 * alert of the same kind already exists for the same batch (+ candidate
 * if applicable) on the same day. If so we skip it. This means running
 * the scheduler twice in a row does NOT create duplicate emails.
 */

import { eq, and, gte, lt, sql, isNull, desc } from "drizzle-orm";
// NOTE: agent_runs lives only in migration 0001 (no Drizzle table), so we
// use raw db.execute() to INSERT/UPDATE it. We must persist a real
// agent_runs row up front because monitoring_alerts.run_id has a FK to it.
import {
  db,
  batchesTable,
  candidatesTable,
  attendanceTable,
  assessmentsTable,
  monitoringAlertsTable,
  type MonitoringAlert,
  type InsertMonitoringAlert,
} from "@workspace/db";
import { logger } from "./logger";
import { sendMonitoringEmail } from "./email";
import { renderMonitoringEmail } from "./monitoring-templates";
import { resolveBatchRecipients, getMonitoringConfig } from "./monitoring-recipients";

export interface MonitorRunResult {
  runId: string;
  batchesScanned: number;
  alertsCreated: number;
  emailsSent: number;
  perBatch: BatchScanReport[];
  digest: string;
}

export interface BatchScanReport {
  batchId: number;
  batchCode: string;
  batchName: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  attendancePct: number;
  attendanceDropPct: number;
  clearancePct: number;
  alertsCreated: number;
  newAlerts: { kind: string; severity: string; title: string }[];
  aiSummary: string;
}

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function roll(severities: Severity[]): Severity {
  let max: Severity = "LOW";
  for (const s of severities) if (SEVERITY_RANK[s] > SEVERITY_RANK[max]) max = s;
  return max;
}

// ---------------------------------------------------------------------------
// Idempotency: same (batch, candidate, kind, day) → don't recreate.
// ---------------------------------------------------------------------------
async function alertAlreadyOpenToday(batchId: number, candidateId: number | null, kind: string): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const conds = [
    eq(monitoringAlertsTable.batchId, batchId),
    eq(monitoringAlertsTable.alertKind, kind),
    eq(monitoringAlertsTable.status, "open"),
    gte(monitoringAlertsTable.createdAt, startOfDay),
  ];
  if (candidateId != null) conds.push(eq(monitoringAlertsTable.candidateId, candidateId));
  else conds.push(isNull(monitoringAlertsTable.candidateId));

  const rows = await db.select({ id: monitoringAlertsTable.id })
    .from(monitoringAlertsTable)
    .where(and(...conds))
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Rule helpers — each returns "did we create the alert?"
// ---------------------------------------------------------------------------

async function createAlert(input: InsertMonitoringAlert): Promise<MonitoringAlert | null> {
  if (input.batchId == null) return null;
  const exists = await alertAlreadyOpenToday(input.batchId, input.candidateId ?? null, input.alertKind);
  if (exists) {
    logger.debug({ batchId: input.batchId, kind: input.alertKind }, "alert exists — skipping");
    return null;
  }
  const [row] = await db.insert(monitoringAlertsTable).values(input).returning();
  return row;
}

async function fanOutEmail(alert: MonitoringAlert, batchCode: string, batchName: string, candidateName: string | null): Promise<number> {
  const recipients = await resolveBatchRecipients(alert.batchId!);
  let sent = 0;
  for (const r of recipients) {
    const { subject, body } = renderMonitoringEmail({
      kind: alert.alertKind,
      recipientName: r.fullName,
      recipientRole: r.role,
      batchCode,
      batchName,
      candidateName,
      metric: alert.metricValue != null ? Number(alert.metricValue) : null,
      threshold: alert.thresholdValue != null ? Number(alert.thresholdValue) : null,
      aiSummary: alert.aiSummary,
    });
    const result = await sendMonitoringEmail({
      to: r.email,
      subject,
      body,
      alertId: alert.id,
      recipientId: r.userId,
      recipientRole: r.role,
    });
    if (result.ok) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runMonitoringScan(opts: { runId?: string; triggeredBy?: string } = {}): Promise<MonitorRunResult> {
  const triggeredBy = opts.triggeredBy ?? "scheduler";

  // Persist an agent_runs row so the per-alert INSERTs satisfy the FK
  // (monitoring_alerts.run_id → agent_runs.id). Callers that already own
  // a runId (e.g. the Python CrewAI side) can pass it through.
  let runId: string;
  if (opts.runId) {
    runId = opts.runId;
  } else {
    const ins = await db.execute(sql`
      insert into agent_runs (triggered_by, status)
      values (${triggeredBy}, 'running')
      returning id::text as id
    `);
    const rows = (ins.rows ?? ins) as Array<{ id: string }>;
    runId = rows[0]?.id ?? cryptoUuid();
  }
  const cfg = await getMonitoringConfig();
  if (!cfg) throw new Error("monitoring_config row not found; did migration 0003 run?");

  const attendanceThreshold = Number(cfg.attendanceBatchThresholdPct);
  const dropThreshold = Number(cfg.attendanceDropThresholdPct);
  const candidateAttThreshold = Number(cfg.attendanceCandidateThresholdPct);
  const assessmentPassThreshold = Number(cfg.assessmentPassThresholdPct);
  const clearanceThreshold = Number(cfg.clearanceThresholdPct);
  const consecutiveDays = cfg.consecutiveAbsenceDays;

  const batches = await db.select().from(batchesTable).where(eq(batchesTable.status, "running"));
  logger.info({ runId, triggeredBy, batchCount: batches.length }, "monitor.scan.start");

  const perBatch: BatchScanReport[] = [];
  let totalAlerts = 0;
  let totalEmails = 0;

  for (const batch of batches) {
    const report: BatchScanReport = {
      batchId: batch.id,
      batchCode: batch.batchCode,
      batchName: batch.name,
      riskLevel: "LOW",
      attendancePct: 100,
      attendanceDropPct: 0,
      clearancePct: 100,
      alertsCreated: 0,
      newAlerts: [],
      aiSummary: "",
    };
    const severities: Severity[] = [];
    const today = todayIso();

    // --- 1. Attendance uploaded today? ---
    const attendanceToday = await db.select({ id: attendanceTable.id })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.batchId, batch.id), eq(attendanceTable.date, today)))
      .limit(1);
    if (attendanceToday.length === 0) {
      const alert = await createAlert({
        runId,
        batchId: batch.id,
        candidateId: null,
        alertKind: "attendance_not_uploaded",
        severity: "MEDIUM",
        title: `Attendance not uploaded for ${batch.batchCode}`,
        message: `No attendance record for ${batch.batchCode} on ${today}.`,
        aiSummary: null,
      });
      if (alert) {
        severities.push("MEDIUM");
        report.alertsCreated++;
        report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
        totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, null);
      }
    }

    // --- 2. Attendance percentage (last 14d) ---
    const att14 = await db.select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when status='present' then 1 else 0 end)::int`,
    }).from(attendanceTable).where(and(
      eq(attendanceTable.batchId, batch.id),
      gte(attendanceTable.date, isoDaysAgo(14)),
    ));
    const total14 = Number(att14[0]?.total ?? 0);
    const pres14 = Number(att14[0]?.present ?? 0);
    const attendancePct = total14 > 0 ? Math.round((pres14 / total14) * 1000) / 10 : 100;
    report.attendancePct = attendancePct;

    if (total14 > 0 && attendancePct < attendanceThreshold) {
      const alert = await createAlert({
        runId,
        batchId: batch.id,
        candidateId: null,
        alertKind: "low_attendance_pct",
        severity: "HIGH",
        title: `Low attendance: ${attendancePct}% in ${batch.batchCode}`,
        message: `Batch ${batch.batchCode} 14-day attendance is ${attendancePct}%, below threshold of ${attendanceThreshold}%.`,
        metricValue: String(attendancePct),
        thresholdValue: String(attendanceThreshold),
      });
      if (alert) {
        severities.push("HIGH");
        report.alertsCreated++;
        report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
        totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, null);
      }
    }

    // --- 3. Attendance DROP: last 7d vs prior 7d ---
    const drop = await computeAttendanceDrop(batch.id);
    report.attendanceDropPct = drop;
    if (drop >= dropThreshold) {
      const alert = await createAlert({
        runId,
        batchId: batch.id,
        candidateId: null,
        alertKind: "attendance_drop",
        severity: drop >= dropThreshold * 2 ? "CRITICAL" : "HIGH",
        title: `Attendance dropped ${drop}% in ${batch.batchCode}`,
        message: `Week-over-week attendance dropped by ${drop}% in batch ${batch.batchCode}.`,
        metricValue: String(drop),
        thresholdValue: String(dropThreshold),
      });
      if (alert) {
        severities.push(alert.severity as Severity);
        report.alertsCreated++;
        report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
        totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, null);
      }
    }

    // --- 4. Clearance rate ---
    const clearance = await computeClearance(batch.id);
    report.clearancePct = clearance;
    if (clearance < clearanceThreshold) {
      const alert = await createAlert({
        runId,
        batchId: batch.id,
        candidateId: null,
        alertKind: "low_clearance_rate",
        severity: "CRITICAL",
        title: `HIGH RISK clearance ${clearance}% in ${batch.batchCode}`,
        message: `Batch ${batch.batchCode} clearance rate is ${clearance}%, below ${clearanceThreshold}%.`,
        metricValue: String(clearance),
        thresholdValue: String(clearanceThreshold),
      });
      if (alert) {
        severities.push("CRITICAL");
        report.alertsCreated++;
        report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
        totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, null);
      }
    }

    // --- 5. Assessments overdue ---
    const overdue = await db.select().from(assessmentsTable).where(and(
      eq(assessmentsTable.batchId, batch.id),
      isNull(assessmentsTable.uploadedDate),
      lt(assessmentsTable.scheduledDate, today),
    ));
    if (overdue.length > 0) {
      const days = computeDaysSince(overdue[0].scheduledDate);
      const alert = await createAlert({
        runId,
        batchId: batch.id,
        candidateId: null,
        assessmentId: overdue[0].id,
        alertKind: "assessment_overdue",
        severity: "MEDIUM",
        title: `Assessment overdue by ${days}d in ${batch.batchCode}`,
        message: `Assessment "${overdue[0].title}" was scheduled ${overdue[0].scheduledDate}; not uploaded.`,
        metricValue: String(days),
      });
      if (alert) {
        severities.push("MEDIUM");
        report.alertsCreated++;
        report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
        totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, null);
      }
    }

    // --- 6. Per-candidate rules: continuous absence, low attendance, low marks ---
    const candidates = await db.select().from(candidatesTable).where(and(
      eq(candidatesTable.batchId, batch.id),
      eq(candidatesTable.status, "active"),
    ));
    for (const c of candidates) {
      // 6a. Continuous absence (3 most recent days all absent)
      const recent = await db.select().from(attendanceTable)
        .where(eq(attendanceTable.candidateId, c.id))
        .orderBy(desc(attendanceTable.date))
        .limit(consecutiveDays);
      if (recent.length === consecutiveDays && recent.every((a) => a.status === "absent")) {
        const alert = await createAlert({
          runId,
          batchId: batch.id,
          candidateId: c.id,
          alertKind: "continuous_absence",
          severity: "HIGH",
          title: `${c.name} absent ${consecutiveDays}+ days in ${batch.batchCode}`,
          message: `${c.name} has been absent for ${consecutiveDays} consecutive days.`,
          metricValue: String(consecutiveDays),
        });
        if (alert) {
          severities.push("HIGH");
          report.alertsCreated++;
          report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
          totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, c.name);
        }
      }

      // 6b. Per-candidate attendance %
      const cAtt = await db.select({
        total: sql<number>`count(*)::int`,
        present: sql<number>`sum(case when status='present' then 1 else 0 end)::int`,
      }).from(attendanceTable).where(and(
        eq(attendanceTable.candidateId, c.id),
        gte(attendanceTable.date, isoDaysAgo(14)),
      ));
      const cTot = Number(cAtt[0]?.total ?? 0);
      const cPres = Number(cAtt[0]?.present ?? 0);
      const cPct = cTot > 0 ? Math.round((cPres / cTot) * 1000) / 10 : 100;
      if (cTot >= 3 && cPct < candidateAttThreshold) {
        const alert = await createAlert({
          runId,
          batchId: batch.id,
          candidateId: c.id,
          alertKind: "low_individual_attendance",
          severity: "HIGH",
          title: `${c.name} at ${cPct}% attendance`,
          message: `${c.name} has ${cPct}% attendance, below ${candidateAttThreshold}%.`,
          metricValue: String(cPct),
          thresholdValue: String(candidateAttThreshold),
        });
        if (alert) {
          severities.push("HIGH");
          report.alertsCreated++;
          report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
          totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, c.name);
        }
      }

      // 6c. Low assessment marks (latest assessment under threshold)
      const latestAssessment = await db.select().from(assessmentsTable)
        .where(eq(assessmentsTable.candidateId, c.id))
        .orderBy(desc(assessmentsTable.scheduledDate), desc(assessmentsTable.id))
        .limit(1);
      if (latestAssessment.length > 0) {
        const a = latestAssessment[0];
        const max = Number(a.maxScore) || 100;
        const pct = max > 0 ? Math.round((Number(a.score) / max) * 1000) / 10 : 0;
        if (pct < assessmentPassThreshold) {
          const alert = await createAlert({
            runId,
            batchId: batch.id,
            candidateId: c.id,
            assessmentId: a.id,
            alertKind: "low_assessment_marks",
            severity: "HIGH",
            title: `${c.name} scored ${pct}% on ${a.title}`,
            message: `${c.name} scored ${pct}% on "${a.title}", below pass threshold of ${assessmentPassThreshold}%.`,
            metricValue: String(pct),
            thresholdValue: String(assessmentPassThreshold),
          });
          if (alert) {
            severities.push("HIGH");
            report.alertsCreated++;
            report.newAlerts.push({ kind: alert.alertKind, severity: alert.severity, title: alert.title });
            totalEmails += await fanOutEmail(alert, batch.batchCode, batch.name, c.name);
          }
        }
      }
    }

    // --- Compute final batch risk + AI-style summary ---
    report.riskLevel = severities.length === 0 ? "LOW" : roll(severities);
    report.aiSummary = composeBatchSummary(report);
    perBatch.push(report);
    totalAlerts += report.alertsCreated;

    logger.info({ batchCode: batch.batchCode, alerts: report.alertsCreated, risk: report.riskLevel }, "monitor.batch.done");
  }

  const digest = composeDigest(perBatch, totalAlerts, totalEmails);

  // Close out the agent_runs row so the governance timeline shows a
  // completed run. Best-effort — never block the response on this.
  if (!opts.runId) {
    try {
      await db.execute(sql`
        update agent_runs
           set status          = 'completed',
               completed_at    = now(),
               batches_scanned = ${perBatch.length},
               issues_found    = ${totalAlerts},
               actions_taken   = ${totalEmails}
         where id = ${runId}::uuid
      `);
    } catch (e) {
      logger.warn({ err: e, runId }, "monitor.scan.close failed");
    }
  }

  logger.info({ runId, totalAlerts, totalEmails, batchCount: perBatch.length }, "monitor.scan.done");
  return {
    runId,
    batchesScanned: perBatch.length,
    alertsCreated: totalAlerts,
    emailsSent: totalEmails,
    perBatch,
    digest,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cryptoUuid(): string {
  // Avoid pulling in node:crypto types — just use Math.random-based RFC4122 v4.
  // Good enough as an idempotency key; never used for security.
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
  return (
    hex(rnd(0xffffffff), 8) + "-" +
    hex(rnd(0xffff), 4) + "-" +
    "4" + hex(rnd(0x0fff), 3) + "-" +
    hex(0x8 + rnd(4), 1) + hex(rnd(0x0fff), 3) + "-" +
    hex(rnd(0xffffffff), 8) + hex(rnd(0xffff), 4)
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeDaysSince(dateStr: string): number {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

async function computeAttendanceDrop(batchId: number): Promise<number> {
  const seg = async (fromDays: number, toDays: number) => {
    const rows = await db.select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when status='present' then 1 else 0 end)::int`,
    }).from(attendanceTable).where(and(
      eq(attendanceTable.batchId, batchId),
      gte(attendanceTable.date, isoDaysAgo(fromDays)),
      lt(attendanceTable.date, isoDaysAgo(toDays)),
    ));
    const total = Number(rows[0]?.total ?? 0);
    const pres = Number(rows[0]?.present ?? 0);
    return total > 0 ? Math.round((pres / total) * 1000) / 10 : 100;
  };
  const recent = await seg(7, 0);
  const prior = await seg(14, 7);
  return Math.max(0, Math.round((prior - recent) * 10) / 10);
}

async function computeClearance(batchId: number): Promise<number> {
  const all = await db.select().from(assessmentsTable).where(eq(assessmentsTable.batchId, batchId));
  if (all.length === 0) return 100;
  let passed = 0;
  for (const a of all) {
    if (a.passed != null) {
      if (a.passed) passed++;
      continue;
    }
    const max = Number(a.maxScore) || 100;
    if (max > 0 && Number(a.score) / max >= 0.5) passed++;
  }
  return Math.round((passed / all.length) * 1000) / 10;
}

function composeBatchSummary(r: BatchScanReport): string {
  if (r.alertsCreated === 0) return `Batch ${r.batchCode} risk level LOW. No issues detected.`;
  const parts: string[] = [`Batch ${r.batchCode} risk level ${r.riskLevel}.`];

  // Group alerts by kind so the summary stays readable.
  const counts: Record<string, number> = {};
  for (const a of r.newAlerts) counts[a.kind] = (counts[a.kind] || 0) + 1;

  if (r.attendanceDropPct > 0) parts.push(`Attendance dropped by ${r.attendanceDropPct}%.`);
  if (counts["continuous_absence"]) parts.push(`${counts["continuous_absence"]} candidate${counts["continuous_absence"] > 1 ? "s" : ""} absent continuously.`);
  if (counts["low_assessment_marks"]) parts.push(`${counts["low_assessment_marks"]} candidate${counts["low_assessment_marks"] > 1 ? "s" : ""} scored below threshold.`);
  if (counts["low_individual_attendance"]) parts.push(`${counts["low_individual_attendance"]} candidate${counts["low_individual_attendance"] > 1 ? "s" : ""} with low attendance.`);
  if (counts["assessment_overdue"]) parts.push(`Assessment overdue.`);
  if (counts["attendance_not_uploaded"]) parts.push(`Attendance not uploaded today.`);
  if (counts["low_clearance_rate"]) parts.push(`Clearance rate critical.`);

  if (r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL") {
    parts.push(`Recommended action: Escalate to coordinator.`);
  } else if (r.riskLevel === "MEDIUM") {
    parts.push(`Recommended action: Send reminder.`);
  }
  return parts.join(" ");
}

function composeDigest(reports: BatchScanReport[], alerts: number, emails: number): string {
  const critical = reports.filter((r) => r.riskLevel === "CRITICAL").length;
  const high = reports.filter((r) => r.riskLevel === "HIGH").length;
  const clear = reports.filter((r) => r.riskLevel === "LOW").length;
  return (
    `Scanned ${reports.length} running batch${reports.length === 1 ? "" : "es"}. ` +
    `Found ${alerts} new alert${alerts === 1 ? "" : "s"} and sent ${emails} email${emails === 1 ? "" : "s"}. ` +
    `${critical} batch${critical === 1 ? "" : "es"} CRITICAL, ${high} HIGH, ${clear} clear. ` +
    (alerts > 0 ? `Coordinators have been notified.` : `All systems nominal.`)
  );
}
