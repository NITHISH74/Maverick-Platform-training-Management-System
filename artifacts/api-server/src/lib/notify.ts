/**
 * Unified notification dispatcher for V6 features.
 *
 * Wraps the existing email transport (lib/email.ts → SMTP or console)
 * so a single call sends an email AND writes the required notifications_log
 * row with every column the V6 spec mandates:
 *   type, batch_id, recipient_email, recipient_name, subject,
 *   body_preview, sent_at, delivery_status, error_message.
 *
 * This is the ONE place email-style notifications get composed. Anything
 * sending a coordinator/candidate email should go through here so the log
 * coverage stays complete.
 *
 * In-app notifications (the bell icon) are a separate channel — see
 * createInAppNotification() at the bottom of this file.
 */

import { db, notificationsLogTable, notificationsTable, type InsertNotification, type InsertNotificationLog } from "@workspace/db";
import { sendMonitoringEmail } from "./email";
import { logger } from "./logger";

export type NotificationType =
  | "attendance_cut_off_missed"
  | "consecutive_absence"
  | "upload_success"
  | "assessment_reminder"
  | "feedback_request"
  | "escalation";

/**
 * Address CC'd on every automated alert / feedback email (the escalation
 * inbox). Configurable via NOTIFICATION_CC; defaults to the project owner so
 * the demo works out of the box even without env config.
 */
export const ESCALATION_CC = process.env.NOTIFICATION_CC ?? "nithishwarsenthilkumaran@gmail.com";

export interface SendNotificationInput {
  type: NotificationType;
  to: string;
  cc?: string | string[] | null;
  recipientName?: string | null;
  recipientId?: number | null;
  subject: string;
  body: string;
  html?: string | null;
  batchId?: number | null;
  candidateId?: number | null;
  urgency?: number; // 1 (info) — 5 (critical)
}

export interface SendNotificationResult {
  ok: boolean;
  logId?: number;
  error?: string;
}

/**
 * Send an email-style notification and persist a notifications_log row.
 * Never throws — failures land in the log with delivery_status='failed'.
 */
export async function sendNotification(input: SendNotificationInput): Promise<SendNotificationResult> {
  const delivery = await sendMonitoringEmail({
    to: input.to,
    cc: input.cc ?? null,
    subject: input.subject,
    body: input.body,
    html: input.html ?? null,
    recipientId: input.recipientId ?? null,
    recipientRole: null,
  });

  const row: InsertNotificationLog = {
    recipientId: input.recipientId ?? null,
    recipientEmail: input.to,
    recipientName: input.recipientName ?? null,
    notifType: input.type,
    subject: input.subject,
    body: input.body,
    bodyPreview: input.body.slice(0, 200),
    urgencyLevel: input.urgency ?? 1,
    aiGenerated: false,
    status: delivery.ok ? "sent" : "failed",
    relatedBatch: input.batchId ?? null,
    relatedCandidate: input.candidateId ?? null,
    sentAt: delivery.ok ? new Date() : null,
    errorMessage: delivery.error ?? null,
  };

  try {
    const [logged] = await db.insert(notificationsLogTable).values(row).returning({ id: notificationsLogTable.id });
    return { ok: delivery.ok, logId: logged?.id, error: delivery.error };
  } catch (e) {
    logger.error({ err: e, type: input.type, to: input.to }, "notifications_log insert failed");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Write a row to the in-app notifications inbox (the bell icon).
 * Only call this when there's a logged-in user the message is FOR.
 */
export async function createInAppNotification(input: {
  userId: number;
  title: string;
  message: string;
  type?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
}): Promise<void> {
  const row: InsertNotification = {
    userId: input.userId,
    title: input.title,
    message: input.message,
    type: input.type ?? "info",
    isRead: false,
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
  };
  try {
    await db.insert(notificationsTable).values(row);
  } catch (e) {
    logger.error({ err: e, userId: input.userId, type: input.type }, "notifications insert failed");
  }
}
