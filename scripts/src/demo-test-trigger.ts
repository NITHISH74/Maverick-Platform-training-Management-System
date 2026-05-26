/**
 * Demo Test Trigger (Feature 4) — fires the monitoring agent against the
 * seeded demo batch and reports what happened.
 *
 * Path:
 *  1. Read scripts/demo-test-ids.json
 *  2. Mint a Base64 admin token (same shape lib/auth.ts emits — see
 *     artifacts/api-server/src/lib/auth.ts:generateToken)
 *  3. POST /api/monitoring/run on the Node API
 *  4. Query both notifications_log (legacy) AND monitoring_email_log (where
 *     the monitoring agent actually writes — see migration 0003) for rows
 *     touching the demo batch in the last 5 minutes
 *  5. Query audit_logs in the same window
 *  6. Print the required test report
 *
 * Deviation note: the spec says "notification_logs" but the live tables
 * are `notifications_log` (legacy generic notifier) and
 * `monitoring_email_log` (added by migration 0003 — the monitoring agent's
 * actual email ledger). We report both so the verdict is informative.
 *
 * Spec also asks to either call the agent function directly OR an HTTP
 * endpoint. We choose HTTP — /api/monitoring/run already exists, is
 * auth-gated, and ensures we exercise the exact same path the dashboard
 * "Run scan now" button does.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function loadDotenv(): void {
  const root = resolve(import.meta.dirname ?? __dirname, "..", "..");
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const [k, ...v] = t.split("=");
    if (!process.env[k!.trim()]) process.env[k!.trim()] = v.join("=").trim();
  }
}
loadDotenv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const repoRoot = resolve(import.meta.dirname ?? __dirname, "..", "..");
const idsFile = resolve(repoRoot, "scripts", "demo-test-ids.json");
const API_BASE = process.env.API_BASE ?? "http://localhost:8080";

interface SeededIds {
  coordinatorId: number;
  batchId: number;
  candidateIds: number[];
  attendanceIds: number[];
  assessmentIds: number[];
  trainerId: number | null;
}

if (!existsSync(idsFile)) {
  console.error(`[demo-trigger] ${idsFile} not found. Run \`npm run demo:seed\` first.`);
  process.exit(1);
}
const ids: SeededIds = JSON.parse(readFileSync(idsFile, "utf-8"));

// ---------------------------------------------------------------------------
// pg client (mirrors lib/db/src/index.ts SSL handling)
// ---------------------------------------------------------------------------

const rawUrl = DATABASE_URL;
const isRemote =
  /[?&]sslmode=(require|verify-ca|verify-full)/i.test(rawUrl) ||
  /@(?!localhost|127\.0\.0\.1)/i.test(rawUrl);
const url = rawUrl.replace(/([?&])sslmode=[^&]+&?/i, "$1").replace(/[?&]$/, "");
const client = new pg.Client({
  connectionString: url,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

// ---------------------------------------------------------------------------
// Token (same Base64 JSON shape as auth.ts:generateToken)
// ---------------------------------------------------------------------------

function adminToken(actorId: number): string {
  const payload = JSON.stringify({ userId: actorId, role: "admin", iat: Date.now() });
  return Buffer.from(payload, "utf-8").toString("base64");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ScanResult {
  runId: string;
  batchesScanned: number;
  alertsCreated: number;
  emailsSent: number;
  perBatch: Array<{ batchId: number; batchCode: string; riskLevel: string; alertsCreated: number; newAlerts: { kind: string; severity: string; title: string }[] }>;
  digest: string;
}

async function triggerScan(): Promise<ScanResult | { error: string }> {
  // Pick an admin actor id (first row with role='admin') so audit attribution
  // points at a real user.
  await client.connect();
  const adminRow = await client.query<{ id: number }>(`SELECT id FROM users WHERE role='admin' AND is_active LIMIT 1`);
  const actorId = adminRow.rows[0]?.id ?? 1;
  await client.end();

  const token = adminToken(actorId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const r = await fetch(`${API_BASE}/api/monitoring/run`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      signal: controller.signal,
    });
    if (!r.ok) return { error: `HTTP ${r.status}: ${await r.text()}` };
    return (await r.json()) as ScanResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPostScanState(): Promise<{
  monitoringAlerts: number;
  monitoringEmails: number;
  emailFailures: number;
  notificationsLog: number;
  auditLogs: number;
  agentRuns: number;
  emailProviders: string[];
  emailRecipients: string[];
  notifTypes: string[];
}> {
  const c2 = new pg.Client({ connectionString: url, ssl: isRemote ? { rejectUnauthorized: false } : undefined });
  await c2.connect();
  try {
    const since = `now() - interval '5 minutes'`;

    const alerts = await c2.query<{ kind: string }>(
      `SELECT alert_kind AS kind FROM monitoring_alerts
        WHERE batch_id = $1 AND created_at >= ${since}`,
      [ids.batchId],
    );
    const emails = await c2.query<{ status: string; provider: string | null; recipient_email: string }>(
      `SELECT mel.status, mel.provider, mel.recipient_email FROM monitoring_email_log mel
         JOIN monitoring_alerts ma ON ma.id = mel.alert_id
        WHERE ma.batch_id = $1 AND mel.created_at >= ${since}`,
      [ids.batchId],
    );
    const failures = emails.rows.filter((r) => r.status !== "sent").length;
    const emailProviders = Array.from(new Set(emails.rows.map((r) => r.provider ?? "—")));
    const emailRecipients = Array.from(new Set(emails.rows.map((r) => r.recipient_email)));

    const runs = await c2.query(
      `SELECT 1 FROM agent_runs WHERE started_at >= ${since}`,
    );

    const legacy = await c2.query<{ notif_type: string }>(
      `SELECT notif_type FROM notifications_log
        WHERE related_batch = $1 AND COALESCE(sent_at, created_at) >= ${since}`,
      [ids.batchId],
    );

    const audits = await c2.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE created_at >= ${since}
          AND (
            entity_id = $1
            OR details::text LIKE $2
            OR action LIKE 'monitor%'
            OR action LIKE 'copilot.help' AND 1=0  -- noise filter (no-op)
          )`,
      [ids.batchId, `%"batch_id":${ids.batchId}%`],
    );

    return {
      monitoringAlerts: alerts.rowCount ?? 0,
      monitoringEmails: emails.rowCount ?? 0,
      emailFailures: failures,
      notificationsLog: legacy.rowCount ?? 0,
      auditLogs: audits.rowCount ?? 0,
      agentRuns: runs.rowCount ?? 0,
      emailProviders,
      emailRecipients,
      notifTypes: Array.from(new Set([
        ...alerts.rows.map((r) => r.kind),
        ...legacy.rows.map((r) => r.notif_type),
      ])),
    };
  } finally {
    await c2.end();
  }
}

function reportSmtpConfig(): { hasSmtp: boolean; missing: string[] } {
  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((k) => !process.env[k]);
  return { hasSmtp: missing.length === 0, missing };
}

async function main(): Promise<void> {
  const scan = await triggerScan();
  const ok = !("error" in scan);

  console.log("\n---");
  console.log("DEMO TEST REPORT");
  console.log(`Batch: DEMO_TEST_BATCH_001 (id=${ids.batchId})`);
  console.log(`Monitoring triggered: ${ok ? "yes" : "no"}`);
  if (!ok) {
    console.log(`Trigger error: ${(scan as { error: string }).error}`);
  } else {
    const s = scan as ScanResult;
    console.log(`Scan digest: ${s.digest}`);
  }

  const state = await fetchPostScanState();
  console.log(`Notifications generated: ${state.monitoringAlerts} - [${state.notifTypes.join(", ")}]`);
  console.log(`Emails attempted: ${state.monitoringEmails} (providers: ${state.emailProviders.join(", ") || "—"})`);
  console.log(`Email recipients: ${state.emailRecipients.join(", ") || "—"}`);
  console.log(`Audit log entries: audit_logs=${state.auditLogs} · agent_runs=${state.agentRuns}`);
  console.log(`Email target: nithishwarsenthilkumaran@gmail.com`);
  console.log("---\n");

  if (state.monitoringAlerts === 0) {
    console.log("WARNING: No notifications generated. Check monitoring agent triggers.");
  }
  if (state.emailFailures > 0) {
    console.log("WARNING: Email delivery failed. Check email configuration.");
  }

  const smtp = reportSmtpConfig();
  if (!smtp.hasSmtp) {
    console.log(
      `\nSMTP not configured (missing: ${smtp.missing.join(", ")}). The email pipeline is using the console transport — see monitoring_email_log.provider='console'. To switch to real delivery set the env vars and restart the API.`,
    );
  }
}

main().catch((e) => {
  console.error("[demo-trigger] FAILED:", e);
  process.exit(1);
});
