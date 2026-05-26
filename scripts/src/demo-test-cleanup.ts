/**
 * Demo Test Cleanup (Feature 4)
 *
 *   npm run demo:cleanup         (default → "mark" mode — safe)
 *   npm run demo:cleanup:delete  (irreversible — hard delete)
 *
 * The schema has no `metadata` column on most tables (rule: do not modify
 * existing tables), so "mark" mode rewrites the human-readable name fields
 * with an [ARCHIVED] prefix so the rows are still findable but visibly
 * archived.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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

interface SeededIds {
  coordinatorId: number;
  batchId: number;
  candidateIds: number[];
  attendanceIds: number[];
  assessmentIds: number[];
  trainerId: number | null;
}

if (!existsSync(idsFile)) {
  console.error(`[demo-cleanup] ${idsFile} not found. Nothing to clean.`);
  process.exit(0);
}
const ids: SeededIds = JSON.parse(readFileSync(idsFile, "utf-8"));

const rawUrl = DATABASE_URL;
const isRemote =
  /[?&]sslmode=(require|verify-ca|verify-full)/i.test(rawUrl) ||
  /@(?!localhost|127\.0\.0\.1)/i.test(rawUrl);
const url = rawUrl.replace(/([?&])sslmode=[^&]+&?/i, "$1").replace(/[?&]$/, "");
const client = new pg.Client({
  connectionString: url,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

async function markArchived(): Promise<void> {
  // Update name-like fields in-place. Idempotent: a second run is a no-op
  // because the prefix already exists.
  const tag = "[ARCHIVED]";
  const prefixIfMissing = (col: string) =>
    `${col} = CASE WHEN ${col} LIKE '${tag}%' THEN ${col} ELSE '${tag} ' || ${col} END`;

  if (ids.coordinatorId) {
    await client.query(`UPDATE users SET ${prefixIfMissing("full_name")} WHERE id = $1`, [ids.coordinatorId]);
  }
  if (ids.batchId) {
    await client.query(`UPDATE batches SET ${prefixIfMissing("name")} WHERE id = $1`, [ids.batchId]);
  }
  if (ids.candidateIds?.length) {
    await client.query(
      `UPDATE candidates SET ${prefixIfMissing("full_name")} WHERE id = ANY($1::int[])`,
      [ids.candidateIds],
    );
  }
  console.log(`[demo-cleanup] mark mode complete — rows tagged "${tag}".`);
}

async function hardDelete(): Promise<void> {
  // FK-safe order: attendance + assessments + batch_trainers → batches → candidates → users
  // (Some FKs cascade, but doing this explicitly keeps the script robust on
  // older Postgres versions where the cascade list was edited.)
  if (ids.attendanceIds?.length) {
    await client.query(`DELETE FROM attendance WHERE id = ANY($1::bigint[])`, [ids.attendanceIds]);
  }
  if (ids.assessmentIds?.length) {
    await client.query(`DELETE FROM assessments WHERE id = ANY($1::int[])`, [ids.assessmentIds]);
  }
  if (ids.batchId) {
    await client.query(`DELETE FROM monitoring_email_log WHERE alert_id IN (SELECT id FROM monitoring_alerts WHERE batch_id = $1)`, [ids.batchId]);
    await client.query(`DELETE FROM monitoring_alerts WHERE batch_id = $1`, [ids.batchId]);
    await client.query(`DELETE FROM batch_trainers WHERE batch_id = $1`, [ids.batchId]);
  }
  if (ids.candidateIds?.length) {
    await client.query(`DELETE FROM candidates WHERE id = ANY($1::int[])`, [ids.candidateIds]);
  }
  if (ids.batchId) {
    await client.query(`DELETE FROM batches WHERE id = $1`, [ids.batchId]);
  }
  if (ids.coordinatorId) {
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.coordinatorId]);
  }
  console.log("[demo-cleanup] delete mode complete — demo rows removed.");
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? "mark").toLowerCase();
  if (mode !== "mark" && mode !== "delete") {
    console.error(`[demo-cleanup] unknown mode "${mode}". Use "mark" (default) or "delete".`);
    process.exit(1);
  }
  await client.connect();
  try {
    if (mode === "delete") {
      await hardDelete();
    } else {
      await markArchived();
    }
    console.log("[demo-cleanup] IDs affected:");
    console.log(JSON.stringify(ids, null, 2));
  } finally {
    await client.end();
  }
}

main().catch(async (e) => {
  console.error("[demo-cleanup] FAILED:", e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
