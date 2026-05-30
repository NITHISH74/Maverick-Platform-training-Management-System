/**
 * Attendance demo seed (V7) — inserts a self-contained batch the V6/V7
 * notification heartbeat will fire BOTH attendance alerts for:
 *
 *   * Feature 1 (attendance cut-off missed): the batch has NO attendance row
 *     for *today*, so once the configured due_time (10:00 IST) has passed the
 *     hourly heartbeat emails the trainer (CC coordinator + escalation inbox).
 *   * Feature 2 (3-day consecutive absence): the demo candidate's most recent
 *     attendance rows are all 'absent', so the heartbeat emails the coordinator
 *     (CC escalation inbox).
 *
 * The coordinator's email is the real escalation address so the demo emails
 * actually land in an inbox you can check.
 *
 * Schema adapters (these tables were locked by migrations 0001/0007 — the rule
 * is "do not modify existing tables"):
 *   * users    — no metadata column; role is the Postgres user_role enum.
 *   * batches  — needs batch_code (unique), program, capacity, dates.
 *   * candidates — "present=false" maps to attendance.status='absent'.
 *   * attendance — column is attend_date (not date); status enum, source text.
 *
 * Idempotent: re-running first deletes the prior demo rows recorded in
 * scripts/demo-attendance-ids.json, then re-seeds. Safe to call repeatedly.
 *
 * Run with:  pnpm demo:attendance:seed
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// ---------------------------------------------------------------------------
// Bootstrap: load DATABASE_URL from .env (project convention)
// ---------------------------------------------------------------------------

function loadDotenv(): void {
  const root = resolve(import.meta.dirname ?? __dirname, "..", "..");
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [k, ...v] = trimmed.split("=");
    if (!process.env[k!.trim()]) process.env[k!.trim()] = v.join("=").trim();
  }
}
loadDotenv();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const ESCALATION_CC = process.env.NOTIFICATION_CC ?? "nithishwarsenthilkumaran@gmail.com";

const repoRoot = resolve(import.meta.dirname ?? __dirname, "..", "..");
const idsFile = resolve(repoRoot, "scripts", "demo-attendance-ids.json");

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
// Helpers
// ---------------------------------------------------------------------------

interface SeededIds {
  coordinatorId: number;
  batchId: number;
  candidateId: number;
  attendanceIds: number[];
  attendanceSettingsId: string | null;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function loadExistingIds(): Promise<SeededIds | null> {
  if (!existsSync(idsFile)) return null;
  try {
    return JSON.parse(readFileSync(idsFile, "utf-8")) as SeededIds;
  } catch {
    return null;
  }
}

async function cleanupPrior(prior: SeededIds): Promise<void> {
  // Delete in FK-safe order.
  if (prior.attendanceIds?.length)
    await client.query(`DELETE FROM attendance WHERE id = ANY($1::bigint[])`, [prior.attendanceIds]);
  if (prior.batchId) {
    await client.query(`DELETE FROM attendance_settings WHERE batch_id = $1`, [prior.batchId]);
  }
  if (prior.candidateId)
    await client.query(`DELETE FROM candidates WHERE id = $1`, [prior.candidateId]);
  if (prior.batchId) {
    await client.query(`DELETE FROM batch_trainers WHERE batch_id = $1`, [prior.batchId]);
    await client.query(`DELETE FROM batches WHERE id = $1`, [prior.batchId]);
  }
  // Leave the coordinator user in place (email is unique → reused via upsert).
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await client.connect();
  console.log("[attendance-demo] connected");

  // 0. Wipe any previous demo run so this is repeatable.
  const prior = await loadExistingIds();
  if (prior) {
    console.log("[attendance-demo] previous demo IDs found — cleaning up first");
    await cleanupPrior(prior);
  }

  // 1. Coordinator user "Nithish Demo" with the real escalation email so the
  //    demo emails actually arrive. Upsert on the unique email column.
  const coordRes = await client.query(
    `INSERT INTO users (auth0_sub, full_name, email, role, is_active)
     VALUES ($1, $2, $3, 'coordinator', true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'coordinator', is_active = true
     RETURNING id`,
    [`demo|attendance-coordinator`, "Nithish Demo", ESCALATION_CC],
  );
  const coordinatorId = coordRes.rows[0].id as number;
  console.log("[attendance-demo] coordinator id =", coordinatorId, `(${ESCALATION_CC})`);

  // 2. Demo batch — running, no trainer assigned (so the cut-off email falls
  //    back to the coordinator), starts 30 days ago, ends 30 days from now.
  const batchRes = await client.query(
    `INSERT INTO batches (batch_code, name, program, start_date, end_date, status, capacity, coordinator_id, attendance_cutoff_time)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, '10:00')
     RETURNING id`,
    [
      `DEMO_ATT_${Date.now()}`,
      "DEMO_ATTENDANCE_BATCH",
      "DEMO_TEST_DATA",
      daysAgoIso(30),
      daysAgoIso(-30),
      30,
      coordinatorId,
    ],
  );
  const batchId = batchRes.rows[0].id as number;
  console.log("[attendance-demo] batch id =", batchId);

  // 3. attendance_settings — due 10:00 IST, alerts enabled. Upsert per batch.
  const settingsRes = await client.query(
    `INSERT INTO attendance_settings (batch_id, due_time, due_timezone, enabled, updated_by)
     VALUES ($1, '10:00:00', 'Asia/Kolkata', true, $2)
     ON CONFLICT (batch_id) DO UPDATE SET due_time = '10:00:00', enabled = true, updated_by = EXCLUDED.updated_by
     RETURNING id`,
    [batchId, coordinatorId],
  );
  const attendanceSettingsId = (settingsRes.rows[0]?.id as string) ?? null;
  console.log("[attendance-demo] attendance_settings id =", attendanceSettingsId);

  // 4. One demo candidate (also reachable at the escalation email).
  const candRes = await client.query(
    `INSERT INTO candidates (employee_id, full_name, email, status, batch_id)
     VALUES ($1, $2, $3, 'active', $4)
     RETURNING id`,
    [`DEMO_ATT-001`, "Nithish Demo Candidate", ESCALATION_CC, batchId],
  );
  const candidateId = candRes.rows[0].id as number;
  console.log("[attendance-demo] candidate id =", candidateId);

  // 5. Attendance — the most recent 4 days (1–4 days ago) all ABSENT.
  //    Today is intentionally left EMPTY so the cut-off rule also fires.
  //      - last 3 absent rows           → Feature 2 (consecutive absence)
  //      - no attendance row for today  → Feature 1 (cut-off missed)
  const attendanceIds: number[] = [];
  for (let day = 1; day <= 4; day++) {
    const r = await client.query(
      `INSERT INTO attendance (candidate_id, batch_id, attend_date, status, source)
       VALUES ($1, $2, $3, 'absent', 'attendance-demo-seed')
       RETURNING id`,
      [candidateId, batchId, daysAgoIso(day)],
    );
    attendanceIds.push(Number(r.rows[0].id));
  }
  console.log("[attendance-demo] attendance rows inserted:", attendanceIds.length, "(all absent)");

  // 6. Persist IDs.
  const ids: SeededIds = {
    coordinatorId,
    batchId,
    candidateId,
    attendanceIds,
    attendanceSettingsId,
  };
  writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  console.log("\nAttendance demo data inserted. IDs:");
  console.log(JSON.stringify(ids, null, 2));
  console.log(`\nIDs saved to ${idsFile}`);
  console.log(
    "\nTo fire the alerts now (without waiting for the hourly cron), call the " +
    "internal notifications trigger or restart the API with ENABLE_MONITORING_SCHEDULER=true.",
  );

  await client.end();
}

main().catch(async (e) => {
  console.error("[attendance-demo] FAILED:", e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
