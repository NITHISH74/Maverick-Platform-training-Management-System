/**
 * Email service for the autonomous batch monitoring agent.
 *
 * Design notes:
 *   - In production the platform expects SMTP creds via env vars
 *     (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM).
 *     If they're set, we use nodemailer.
 *   - In dev / demo, when no SMTP creds are configured, we use a
 *     "console transport" that just logs the email and persists it
 *     to monitoring_email_log with provider='console'. This means
 *     the entire monitoring flow is runnable end-to-end without
 *     any external dependencies.
 *   - Every send (success OR failure) is logged in monitoring_email_log.
 *
 * Recipient resolution: handled in monitoring-recipients.ts, not here.
 * This module only knows how to *deliver* a fully-resolved email.
 */

import { db, monitoringEmailLogTable, type InsertMonitoringEmailLog } from "@workspace/db";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  // Metadata for the audit log
  alertId?: number | null;
  recipientId?: number | null;
  recipientRole?: string | null;
}

export interface EmailSendResult {
  ok: boolean;
  provider: string;
  error?: string;
}

// Lazy-import nodemailer so the api-server boots cleanly even if
// nodemailer wasn't installed (it's listed as an optional dep).
let _transport: { sendMail: (m: { from: string; to: string; subject: string; text: string }) => Promise<unknown> } | null = null;
let _transportInitTried = false;

async function getSmtpTransport(): Promise<typeof _transport> {
  if (_transportInitTried) return _transport;
  _transportInitTried = true;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  try {
    // dynamic import keeps nodemailer optional
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodemailer: any = await import("nodemailer");
    _transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
    logger.info({ host }, "SMTP transport initialised");
  } catch (e) {
    logger.warn({ err: e }, "nodemailer not available — falling back to console transport");
    _transport = null;
  }
  return _transport;
}

async function deliverViaConsole(msg: EmailMessage): Promise<EmailSendResult> {
  // Pretty-print in a way the demo can grep for.
  logger.info(
    {
      to: msg.to,
      subject: msg.subject,
      role: msg.recipientRole,
      alertId: msg.alertId,
    },
    "[email/console] would send email",
  );
  // eslint-disable-next-line no-console
  console.log(
    `\n┌─ EMAIL (console transport) ────────────────────────────\n` +
      `│ To:      ${msg.to}\n` +
      `│ Subject: ${msg.subject}\n` +
      `│ Role:    ${msg.recipientRole ?? "-"}\n` +
      `│ AlertId: ${msg.alertId ?? "-"}\n` +
      `├────────────────────────────────────────────────────────\n` +
      msg.body.split("\n").map((l) => `│ ${l}`).join("\n") +
      `\n└────────────────────────────────────────────────────────\n`,
  );
  return { ok: true, provider: "console" };
}

async function deliverViaSmtp(msg: EmailMessage, t: NonNullable<typeof _transport>): Promise<EmailSendResult> {
  const from = process.env.SMTP_FROM ?? "maverick-monitor@example.com";
  try {
    await t.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.body });
    return { ok: true, provider: "smtp" };
  } catch (e) {
    return { ok: false, provider: "smtp", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Send a monitoring email. Always returns a result (never throws);
 * failures are logged but don't break the calling agent loop.
 */
export async function sendMonitoringEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const smtp = await getSmtpTransport();
  const result = smtp ? await deliverViaSmtp(msg, smtp) : await deliverViaConsole(msg);

  // Persist to audit log regardless of success/fail.
  try {
    const row: InsertMonitoringEmailLog = {
      alertId: msg.alertId ?? null,
      recipientId: msg.recipientId ?? null,
      recipientEmail: msg.to,
      recipientRole: msg.recipientRole ?? null,
      subject: msg.subject,
      body: msg.body,
      status: result.ok ? "sent" : "failed",
      provider: result.provider,
      errorMessage: result.error ?? null,
    };
    await db.insert(monitoringEmailLogTable).values(row);
  } catch (e) {
    logger.error({ err: e }, "Failed to write monitoring_email_log");
  }

  return result;
}
