/**
 * Demo Test Seed (Feature 4) — inserts a self-contained scenario the
 * monitoring agent will fire alerts for, then writes every inserted id
 * to scripts/demo-test-ids.json so the trigger + cleanup scripts can
 * find the same rows.
 *
 * Deviations from the spec template (schema adapters — table shapes were
 * already locked by migration 0001 and the rule is "do not modify existing
 * tables"):
 *   * users — no `metadata` / `notes` column; we prefix full_name with
 *     "DEMO_TEST · " for human visibility AND seed a synthetic auth0_sub
 *     so the user is unique and discoverable.
 *   * batches — needs batch_code (unique), program, end_date, capacity. We
 *     fill those with deterministic demo values.
 *   * candidates — no metadata column; we encode the marker into
 *     employee_id ("DEMO-001"…"DEMO-005").
 *   * attendance — status enum 'present'|'absent'|'leave' (no boolean
 *     `present`, no `cut_off_missed`); we map "present=false" -> status
 *     'absent' and "present=true" -> 'present'. The 3-day-consecutive-
 *     absence monitoring rule fires on the absence pattern alone.
 *   * assessments — assessment_type enum ('sprint'|'api'|'project'); "Sprint
 *     Review" maps to 'sprint'. We leave uploaded_date NULL with a past
 *     scheduled_date so the engine's `assessment_overdue` rule fires.
 *
 * Idempotent-ish: re-running first deletes any prior demo rows whose IDs
 * are still in demo-test-ids.json, then re-seeds. Safe to call repeatedly.
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

const repoRoot = resolve(import.meta.dirname ?? __dirname, "..", "..");
const idsFile = resolve(repoRoot, "scripts", "demo-test-ids.json");

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
  candidateIds: number[];
  attendanceIds: number[];
  assessmentIds: number[];
  trainerId: number | null;
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
  // Delete in FK-safe order. Use IF EXISTS / coalesce on missing ids.
  if (prior.attendanceIds?.length)
    await client.query(`DELETE FROM attendance WHERE id = ANY($1::bigint[])`, [prior.attendanceIds]);
  if (prior.assessmentIds?.length)
    await client.query(`DELETE FROM assessments WHERE id = ANY($1::int[])`, [prior.assessmentIds]);
  if (prior.candidateIds?.length)
    await client.query(`DELETE FROM candidates WHERE id = ANY($1::int[])`, [prior.candidateIds]);
  if (prior.batchId) {
    // batch_trainers has FK on batch_id; clear first
    await client.query(`DELETE FROM batch_trainers WHERE batch_id = $1`, [prior.batchId]);
    await client.query(`DELETE FROM batches WHERE id = $1`, [prior.batchId]);
  }
  if (prior.coordinatorId)
    await client.query(`DELETE FROM users WHERE id = $1`, [prior.coordinatorId]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await client.connect();
  console.log("[demo-seed] connected");

  // 0. Wipe any previous demo run so this is repeatable.
  const prior = await loadExistingIds();
  if (prior) {
    console.log("[demo-seed] previous demo IDs found — cleaning up first");
    await cleanupPrior(prior);
  }

  // 1. Coordinator user
  const coordRes = await client.query(
    `INSERT INTO users (auth0_sub, full_name, email, role, is_active)
     VALUES ($1, $2, $3, 'coordinator', true)
     RETURNING id`,
    [
      `demo|nithishwarsenthilkumaran-${Date.now()}`,
      "DEMO_TEST · Demo Test Coordinator",
      `nithishwarsenthilkumaran+demo${Date.now()}@gmail.com`,
    ],
  );
  const coordinatorId = coordRes.rows[0].id as number;
  console.log("[demo-seed] coordinator id =", coordinatorId);

  // 2. Optional trainer (use first existing role='trainer' user, otherwise null)
  const trainerRow = await client.query(
    `SELECT id FROM users WHERE role = 'trainer' AND is_active = true ORDER BY id LIMIT 1`,
  );
  const trainerId = trainerRow.rows[0]?.id ?? null;

  // 3. Demo batch (status 'running' lowercase — enum requirement)
  const batchRes = await client.query(
    `INSERT INTO batches (batch_code, name, program, start_date, end_date, status, capacity, coordinator_id)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7)
     RETURNING id`,
    [
      `DEMO_${Date.now()}`,
      "DEMO_TEST_BATCH_001",
      "Demo Test Program",
      daysAgoIso(30),
      daysAgoIso(-60),
      30,
      coordinatorId,
    ],
  );
  const batchId = batchRes.rows[0].id as number;
  console.log("[demo-seed] batch id =", batchId, "(trainer:", trainerId, ")");

  // 4. Wire the trainer into batch_trainers so the monitoring agent's
  //    recipient resolver can fan out emails to them.
  if (trainerId != null) {
    await client.query(
      `INSERT INTO batch_trainers (batch_id, trainer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [batchId, trainerId],
    );
  }

  // 5. Five demo candidates
  const candidateIds: number[] = [];
  for (let i = 1; i <= 5; i++) {
    const r = await client.query(
      `INSERT INTO candidates (employee_id, full_name, email, status, batch_id)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [`DEMO-${String(i).padStart(3, "0")}`, `Demo Candidate ${i}`, `demo${i}@maverick.local`, batchId],
    );
    candidateIds.push(r.rows[0].id);
  }
  console.log("[demo-seed] candidate ids =", candidateIds);

  // 6. Attendance — past 7 days
  //    Days 1-4 (i.e. 4, 5, 6, 7 days ago) -> absent     (triggers 3-day consecutive absence rule)
  //    Days 5-7 (i.e. 1, 2, 3 days ago)    -> present
  //
  //    NB: "1-4 absent, 5-7 present" in the spec means the OLDEST 4 days
  //    are absent and the MOST RECENT 3 are present. The monitoring engine's
  //    `continuous_absence` rule looks at the LAST N attendance rows ordered
  //    by attend_date DESC. To still trigger it we instead make the MOST
  //    RECENT 3 days absent and the older 4 days present — guaranteed alert.
  const attendanceIds: number[] = [];
  for (const cId of candidateIds) {
    for (let day = 1; day <= 7; day++) {
      const date = daysAgoIso(day);
      // day 1, 2, 3 (the most recent) are absent so the engine catches them
      const status = day <= 3 ? "absent" : "present";
      const r = await client.query(
        `INSERT INTO attendance (candidate_id, batch_id, attend_date, status, source)
         VALUES ($1, $2, $3, $4, 'demo-seed')
         RETURNING id`,
        [cId, batchId, date, status],
      );
      attendanceIds.push(Number(r.rows[0].id));
    }
  }
  console.log("[demo-seed] attendance rows inserted:", attendanceIds.length);

  // 7. Overdue assessment for Demo Candidate 1 (low score = triggers
  //    low_assessment_marks; uploaded_date null + past scheduled_date =
  //    triggers assessment_overdue)
  const assessmentIds: number[] = [];
  const a = await client.query(
    `INSERT INTO assessments (batch_id, candidate_id, title, assessment_type, scheduled_date, score, max_score, uploaded_date)
     VALUES ($1, $2, $3, 'sprint', $4, 0, 100, NULL)
     RETURNING id`,
    [batchId, candidateIds[0], "DEMO_TEST Sprint Review", daysAgoIso(2)],
  );
  assessmentIds.push(Number(a.rows[0].id));
  console.log("[demo-seed] assessment ids =", assessmentIds);

  // 8. Persist IDs
  const ids: SeededIds = {
    coordinatorId,
    batchId,
    candidateIds,
    attendanceIds,
    assessmentIds,
    trainerId,
  };
  writeFileSync(idsFile, JSON.stringify(ids, null, 2));
  console.log("\nDemo test data inserted. IDs:");
  console.log(JSON.stringify(ids, null, 2));
  console.log(`\nIDs saved to ${idsFile}`);

  await client.end();
}

main().catch(async (e) => {
  console.error("[demo-seed] FAILED:", e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
