/**
 * Cron scheduler for the autonomous batch monitoring agent.
 *
 * The schedule is read from monitoring_config.scheduler_cron (default
 * "0 11 * * *" — 11:00 every day). When the cron fires, we try the
 * LLM-driven path (Python /ai/agent/run) first; if it errors or times
 * out, we fall back to the deterministic Node-side rule engine. This
 * mirrors the same fallback discipline the Python runner already uses
 * for its own LLM failures.
 *
 * We deliberately use node-cron (not setInterval) so the cron syntax
 * is the same syntax admins write in the config UI.
 */
import { logger } from "./logger";
import { runMonitoringScan } from "./monitoring-engine";
import { getMonitoringConfig } from "./monitoring-recipients";
import { runNotificationHeartbeat } from "./notification-jobs";
import { db, batchesTable } from "@workspace/db";
import { and, isNull, lt, ne, sql } from "drizzle-orm";
import { writeAudit } from "./rbac";

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN = process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";
const AI_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT_MS ?? 90_000);

let _cronTask: { stop: () => void } | null = null;
// V6: hourly notification heartbeat. Separate from the main monitoring
// scan because the cut-off / assessment-reminder jobs only need an
// hourly resolution and shouldn't wait for the daily scan window.
let _notifTask: { stop: () => void } | null = null;

async function invokeAiAgent(): Promise<{ ok: boolean; detail?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch(`${AI_BASE}/ai/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": INTERNAL_TOKEN },
      body: JSON.stringify({ run_id: `cron-${new Date().toISOString()}`, triggered_by: "cron" }),
      signal: controller.signal,
    });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

// F5: auto-close every non-deleted, non-closed batch whose end_date is
// already in the past. Exposed separately so it can be unit-tested in
// isolation. Returns the closed batch IDs for the caller's log.
export async function autoCloseExpiredBatches(): Promise<number[]> {
  try {
    const closed = await db.update(batchesTable)
      .set({ status: "closed" })
      .where(and(
        isNull(batchesTable.deletedAt),
        ne(batchesTable.status, "closed"),
        // text column — string-compare in ISO yyyy-mm-dd is correct
        lt(batchesTable.endDate, sql`CURRENT_DATE::text`),
      ))
      .returning({ id: batchesTable.id, name: batchesTable.name, endDate: batchesTable.endDate });
    for (const b of closed) {
      await writeAudit({
        actorId: null,
        action: "batch_auto_closed",
        entityType: "batch",
        entityId: b.id,
        details: { name: b.name, end_date: b.endDate, reason: "end_date < CURRENT_DATE" },
      });
    }
    if (closed.length > 0) {
      logger.info({ closedBatchIds: closed.map((b) => b.id) }, "scheduler: auto-closed expired batches");
    }
    return closed.map((b) => b.id);
  } catch (e) {
    logger.error({ err: e }, "scheduler: auto-close failed");
    return [];
  }
}

async function runOnce(): Promise<void> {
  logger.info("scheduler: scan starting");

  // F5: cheap daily auto-close BEFORE the monitoring scan — that way the
  // monitor doesn't try to scan a batch that's already past end_date.
  await autoCloseExpiredBatches();

  // Try LLM path first
  if (process.env.ENABLE_AI_AGENT !== "false") {
    const ai = await invokeAiAgent();
    if (ai.ok) {
      logger.info("scheduler: AI agent run completed");
      return;
    }
    logger.warn({ detail: ai.detail }, "scheduler: AI agent unavailable; falling back to Node rule engine");
  }

  // Fallback: Node rule engine
  try {
    const result = await runMonitoringScan({ triggeredBy: "scheduler" });
    logger.info({ result: { runId: result.runId, alertsCreated: result.alertsCreated, emailsSent: result.emailsSent } }, "scheduler: rule-engine scan completed");
  } catch (e) {
    logger.error({ err: e }, "scheduler: scan failed");
  }
}

/**
 * Start the cron loop. Idempotent — safe to call multiple times.
 * Will silently no-op if scheduler_enabled is false in monitoring_config.
 */
export async function startMonitoringScheduler(): Promise<void> {
  // Stop any prior task
  if (_cronTask) {
    _cronTask.stop();
    _cronTask = null;
  }

  let cronExpr = "0 11 * * *";
  let enabled = true;
  try {
    const cfg = await getMonitoringConfig();
    if (cfg) {
      cronExpr = cfg.schedulerCron;
      enabled = cfg.schedulerEnabled;
    }
  } catch (e) {
    // DB not ready yet — log and bail; the next boot will retry.
    logger.warn({ err: e }, "scheduler: monitoring_config not readable; scheduler not started");
    return;
  }

  if (!enabled) {
    logger.info("scheduler: disabled in monitoring_config; not starting");
    return;
  }

  let cron: typeof import("node-cron") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cron = (await import("node-cron")) as any;
  } catch (e) {
    logger.warn({ err: e }, "scheduler: node-cron not installed; scheduler not started");
    return;
  }

  if (!cron!.validate(cronExpr)) {
    logger.error({ cronExpr }, "scheduler: invalid cron expression; not starting");
    return;
  }

  _cronTask = cron!.schedule(cronExpr, () => {
    runOnce().catch((e) => logger.error({ err: e }, "scheduler: runOnce threw"));
  });
  logger.info({ cronExpr }, "scheduler: started");

  // V6: hourly notification heartbeat (cut-off, 3-day absence, +1d assessment).
  if (_notifTask) { _notifTask.stop(); _notifTask = null; }
  if (cron!.validate("0 * * * *")) {
    _notifTask = cron!.schedule("0 * * * *", () => {
      runNotificationHeartbeat().catch((e) => logger.error({ err: e }, "scheduler: notification heartbeat threw"));
    });
    logger.info("scheduler: hourly notification heartbeat started");
  }
}

/**
 * Manual one-off — exported so an admin endpoint or CLI can fire it.
 */
export async function runMonitoringNow(): Promise<void> {
  await runOnce();
}

/**
 * V6 on-demand trigger — runs the notification heartbeat without
 * waiting for the next hourly tick. Used by tests + the internal route.
 */
export async function runNotificationsNow(): Promise<void> {
  await runNotificationHeartbeat();
}
