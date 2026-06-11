/**
 * V6 notification jobs — hourly heartbeat fired from lib/scheduler.ts.
 *
 * Three jobs share a single pass over the active batches so we don't
 * iterate the catalog more than once per hour:
 *
 *   1. attendance_cut_off_missed
 *        Per attendance_settings, if the due time has passed today AND
 *        no attendance row exists for this batch on this date, email the
 *        batch coordinator. notifications_log dedup key:
 *           (type=attendance_cut_off_missed, batch_id, sent_at::date=today)
 *
 *   2. consecutive_absence (per-candidate)
 *        The last 3 attendance records for a candidate are all 'absent'.
 *        notifications_log dedup key:
 *           (type=consecutive_absence, candidate_id, lastAbsenceDate)
 *        Encoded as `error_message` would be wrong — we use body_preview's
 *        first 32 chars (we put the streak signature there) to dedup.
 *        Simpler: we check that no row of this type exists for this
 *        candidate where sent_at >= lastAbsenceDate (i.e. on or after the
 *        last date of the current streak). One streak ⇒ one email.
 *
 *   3. assessment_reminder
 *        Any assessment whose scheduledDate is exactly +1 day from today.
 *        Email every candidate in the batch.
 *        notifications_log dedup key:
 *           (type=assessment_reminder, candidate_id, related_batch,
 *            sent_at::date=today)
 *
 * The monitoring agent (lib/monitoring-engine.ts) writes monitoring_alerts
 * for the same conditions; that channel is the in-app red-alert inbox.
 * THIS module is responsible for the EMAIL channel + notifications_log.
 * The two log tables are intentionally separate (audit log vs alert inbox).
 */

import { and, eq, gte, sql, desc, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  batchesTable,
  batchTrainersTable,
  candidatesTable,
  attendanceTable,
  assessmentsTable,
  attendanceSettingsTable,
  notificationsLogTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendNotification, createInAppNotification, ESCALATION_CC, type NotificationType } from "./notify";

// Shared HTML wrapper so every alert email has a consistent look.
function htmlEmail(inner: string): string {
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5;">` +
    inner +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />` +
    `<p style="font-size:12px;color:#6b7280;">This is an automated alert from the Maverick Execution Platform.</p>` +
    `</div>`
  );
}

// Resolve the first assigned trainer for a batch (name + email), if any.
async function getBatchTrainer(batchId: number): Promise<{ id: number; name: string; email: string } | null> {
  const [t] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(batchTrainersTable)
    .innerJoin(usersTable, eq(usersTable.id, batchTrainersTable.trainerId))
    .where(eq(batchTrainersTable.batchId, batchId))
    .limit(1);
  return t && t.email ? { id: t.id, name: t.name, email: t.email } : null;
}

const IST_OFFSET_MINUTES = 330; // Asia/Kolkata = UTC+5:30

function todayIstIso(): string {
  const now = new Date(Date.now() + IST_OFFSET_MINUTES * 60_000);
  return now.toISOString().slice(0, 10);
}

function nowIstHHMM(): string {
  const now = new Date(Date.now() + IST_OFFSET_MINUTES * 60_000);
  return now.toISOString().slice(11, 16);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------
// 1. Attendance cut-off
// -------------------------------------------------------------------
export async function runAttendanceCutoffCheck(): Promise<{ batchesChecked: number; emailsSent: number }> {
  const today = todayIstIso();
  const nowHHMM = nowIstHHMM(); // "HH:MM"

  // Active (running) batches with their coordinator + settings.
  const rows = await db
    .select({
      batchId: batchesTable.id,
      batchName: batchesTable.name,
      batchCode: batchesTable.batchCode,
      coordinatorId: batchesTable.coordinatorId,
      cutoffTimeCol: batchesTable.attendanceCutoffTime,
      coordinatorName: usersTable.name,
      coordinatorEmail: usersTable.email,
      dueTime: attendanceSettingsTable.dueTime,
      enabled: attendanceSettingsTable.enabled,
    })
    .from(batchesTable)
    .leftJoin(usersTable, eq(usersTable.id, batchesTable.coordinatorId))
    .leftJoin(attendanceSettingsTable, eq(attendanceSettingsTable.batchId, batchesTable.id))
    .where(and(eq(batchesTable.status, "running"), isNull(batchesTable.deletedAt)));

  let emailsSent = 0;
  for (const r of rows) {
    if (r.enabled === false) continue;
    if (!r.coordinatorEmail) continue;

    // Resolve effective due time: attendance_settings → batches.attendance_cutoff_time → 10:00.
    const dueRaw = r.dueTime ?? (r.cutoffTimeCol ? `${r.cutoffTimeCol}:00` : "10:00:00");
    const dueHHMM = dueRaw.slice(0, 5);
    if (nowHHMM < dueHHMM) continue; // cut-off not reached yet today

    // Has any attendance been recorded for this batch today?
    const submitted = await db
      .select({ id: attendanceTable.id })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.batchId, r.batchId), eq(attendanceTable.date, today)))
      .limit(1);
    if (submitted.length > 0) continue;

    // Dedup: have we already emailed this coordinator for this batch today?
    const startOfDay = new Date(`${today}T00:00:00Z`);
    const alreadySent = await db
      .select({ id: notificationsLogTable.id })
      .from(notificationsLogTable)
      .where(and(
        eq(notificationsLogTable.notifType, "attendance_cut_off_missed"),
        eq(notificationsLogTable.relatedBatch, r.batchId),
        gte(notificationsLogTable.createdAt, startOfDay),
      ))
      .limit(1);
    if (alreadySent.length > 0) continue;

    // Recipient: the assigned trainer is primary (they submit attendance);
    // the coordinator + escalation inbox are CC'd. If no trainer is assigned
    // we fall back to emailing the coordinator directly.
    const trainer = await getBatchTrainer(r.batchId);
    const toEmail = trainer?.email ?? r.coordinatorEmail;
    const toName = trainer?.name ?? r.coordinatorName;
    const toId = trainer?.id ?? r.coordinatorId;
    const ccList = [
      ...(trainer ? [r.coordinatorEmail] : []), // coordinator only if not already the TO
      ESCALATION_CC,
    ].filter((e): e is string => !!e && e !== toEmail);

    const subject = `⚠️ Attendance Not Submitted — ${r.batchName} — ${today}`;
    const body =
      `Attendance has not been submitted for ${r.batchName} (${r.batchCode}) ` +
      `as of ${dueHHMM} IST on ${today}. Please submit attendance immediately via the Maverick TMS portal.`;
    const html = htmlEmail(
      `<h2 style="margin:0 0 12px;">Attendance Submission Reminder</h2>` +
      `<p>Hi ${toName ?? "there"},</p>` +
      `<p>The daily attendance for <strong>${r.batchName}</strong> (${r.batchCode}) has not been ` +
      `submitted as of <strong>${dueHHMM} IST</strong> today (${today}).</p>` +
      `<p>Please submit attendance immediately via the Maverick TMS portal.</p>` +
      `<p style="color:#6b7280;">If you have already submitted, please ignore this message.</p>`,
    );
    const result = await sendNotification({
      type: "attendance_cut_off_missed",
      to: toEmail,
      cc: ccList,
      recipientName: toName,
      recipientId: toId,
      subject,
      body,
      html,
      batchId: r.batchId,
      urgency: 3,
    });
    if (result.ok) {
      emailsSent++;
      if (r.coordinatorId) {
        await createInAppNotification({
          userId: r.coordinatorId,
          title: `Attendance missing — ${r.batchName}`,
          message: `No attendance recorded for ${r.batchName} by ${dueHHMM} IST today.`,
          type: "attendance_missing",
          relatedEntityType: "batch",
          relatedEntityId: r.batchId,
        });
      }
    }
  }

  return { batchesChecked: rows.length, emailsSent };
}

// -------------------------------------------------------------------
// 2. Consecutive absence (3-day streak)
// -------------------------------------------------------------------
export async function runConsecutiveAbsenceCheck(): Promise<{ candidatesChecked: number; emailsSent: number }> {
  const batches = await db
    .select({
      batchId: batchesTable.id,
      batchName: batchesTable.name,
      coordinatorId: batchesTable.coordinatorId,
      coordinatorName: usersTable.name,
      coordinatorEmail: usersTable.email,
    })
    .from(batchesTable)
    .leftJoin(usersTable, eq(usersTable.id, batchesTable.coordinatorId))
    .where(and(eq(batchesTable.status, "running"), isNull(batchesTable.deletedAt)));

  let candidatesChecked = 0;
  let emailsSent = 0;

  for (const b of batches) {
    if (!b.coordinatorEmail) continue;
    const candidates = await db
      .select({ id: candidatesTable.id, name: candidatesTable.name })
      .from(candidatesTable)
      .where(and(eq(candidatesTable.batchId, b.batchId), eq(candidatesTable.status, "active")));

    for (const c of candidates) {
      candidatesChecked++;
      const recent = await db
        .select()
        .from(attendanceTable)
        .where(eq(attendanceTable.candidateId, c.id))
        .orderBy(desc(attendanceTable.date))
        .limit(3);
      if (recent.length < 3) continue;
      if (!recent.every(r => r.status === "absent")) continue;

      const dates = recent.map(r => r.date).reverse(); // [d1,d2,d3] ascending
      const lastAbsence = dates[dates.length - 1];

      // Dedup-per-streak: have we already emailed for this candidate
      // since the last-absence date? If yes, this streak is already covered.
      const cutoff = new Date(`${lastAbsence}T00:00:00Z`);
      const already = await db
        .select({ id: notificationsLogTable.id })
        .from(notificationsLogTable)
        .where(and(
          eq(notificationsLogTable.notifType, "consecutive_absence"),
          eq(notificationsLogTable.relatedCandidate, c.id),
          gte(notificationsLogTable.createdAt, cutoff),
        ))
        .limit(1);
      if (already.length > 0) continue;

      const subject = `🚨 Absence Alert — ${c.name} — 3 Consecutive Days — ${b.batchName}`;
      const body =
        `${c.name} has been absent for 3 consecutive days ` +
        `(${dates.join(", ")}) in ${b.batchName}. Please follow up with the candidate at the earliest.`;
      const rows = dates
        .map(
          (d) =>
            `<tr><td style="padding:6px 12px;border:1px solid #e5e7eb;">${d}</td>` +
            `<td style="padding:6px 12px;border:1px solid #e5e7eb;color:#dc2626;">Absent</td></tr>`,
        )
        .join("");
      const html = htmlEmail(
        `<h2 style="margin:0 0 12px;">Consecutive Absence Alert</h2>` +
        `<p>Hi ${b.coordinatorName ?? "there"},</p>` +
        `<p>This is an automated alert to inform you that <strong>${c.name}</strong> has been absent ` +
        `for <strong>3 consecutive days</strong> in <strong>${b.batchName}</strong>.</p>` +
        `<table style="border-collapse:collapse;margin:12px 0;">` +
        `<thead><tr>` +
        `<th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left;">Date</th>` +
        `<th style="padding:6px 12px;border:1px solid #e5e7eb;text-align:left;">Status</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<p>Please follow up with the candidate at the earliest.</p>`,
      );
      const result = await sendNotification({
        type: "consecutive_absence",
        to: b.coordinatorEmail,
        cc: ESCALATION_CC,
        recipientName: b.coordinatorName,
        recipientId: b.coordinatorId,
        subject,
        body,
        html,
        batchId: b.batchId,
        candidateId: c.id,
        urgency: 3,
      });
      if (result.ok) emailsSent++;
    }
  }

  return { candidatesChecked, emailsSent };
}

// -------------------------------------------------------------------
// 3. Upcoming assessment reminder (24h before)
// -------------------------------------------------------------------
export async function runAssessmentReminderCheck(): Promise<{ assessmentsChecked: number; emailsSent: number }> {
  const target = addDaysIso(todayIstIso(), 1);

  // Dedupe at the per-(batch, title, scheduledDate) level by deduping
  // the assessments table on those keys (Supabase stores one row per
  // candidate per assessment — same approach as routes/assessments.ts).
  const rows = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.scheduledDate, target));

  const seenAssessments = new Map<string, typeof assessmentsTable.$inferSelect>();
  for (const r of rows) {
    const k = `${r.batchId}|${r.title}|${r.type}|${r.scheduledDate}`;
    if (!seenAssessments.has(k)) seenAssessments.set(k, r);
  }

  let emailsSent = 0;
  for (const a of seenAssessments.values()) {
    const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, a.batchId));
    if (!batch || batch.deletedAt) continue;

    const candidates = await db
      .select()
      .from(candidatesTable)
      .where(and(eq(candidatesTable.batchId, a.batchId), eq(candidatesTable.status, "active")));

    const startOfDay = new Date(`${todayIstIso()}T00:00:00Z`);
    for (const c of candidates) {
      if (!c.email) continue;
      // Dedup: did we email THIS candidate for THIS batch today?
      const already = await db
        .select({ id: notificationsLogTable.id })
        .from(notificationsLogTable)
        .where(and(
          eq(notificationsLogTable.notifType, "assessment_reminder"),
          eq(notificationsLogTable.relatedCandidate, c.id),
          eq(notificationsLogTable.relatedBatch, a.batchId),
          gte(notificationsLogTable.createdAt, startOfDay),
        ))
        .limit(1);
      if (already.length > 0) continue;

      const subject = `Upcoming Assessment Tomorrow — ${batch.name}`;
      const body =
        `You have a ${a.type} assessment ("${a.title}") tomorrow ${a.scheduledDate} ` +
        `for ${batch.name}. Please be prepared.`;
      const result = await sendNotification({
        type: "assessment_reminder",
        to: c.email,
        recipientName: c.name,
        recipientId: null,
        subject,
        body,
        batchId: a.batchId,
        candidateId: c.id,
        urgency: 2,
      });
      if (result.ok) emailsSent++;
    }
  }

  return { assessmentsChecked: seenAssessments.size, emailsSent };
}

// -------------------------------------------------------------------
// Combined heartbeat — called hourly from lib/scheduler.ts.
// -------------------------------------------------------------------
export async function runNotificationHeartbeat(): Promise<void> {
  try {
    const att = await runAttendanceCutoffCheck();
    const abs = await runConsecutiveAbsenceCheck();
    const asm = await runAssessmentReminderCheck();
    logger.info({ att, abs, asm }, "notification-heartbeat completed");
  } catch (e) {
    logger.error({ err: e }, "notification-heartbeat failed");
  }
}

// Re-export for tests / on-demand runs.
export const _exports = {
  runAttendanceCutoffCheck,
  runConsecutiveAbsenceCheck,
  runAssessmentReminderCheck,
  runNotificationHeartbeat,
};

// Silence unused-import warnings for symbols kept for clarity.
void isNotNull; void sql;
