import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = ["users","batches","batch_trainers","candidates","attendance","assessments","assessment_scores","topper_config","topper_results","feedback","notifications","audit_logs"];
for (const t of tables) {
  const r = await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`\n## ${t}`);
  for (const x of r.rows) console.log(`  ${x.column_name} ${x.data_type}${x.is_nullable==='NO'?' NOT NULL':''}${x.column_default?` DEFAULT ${x.column_default}`:''}`);
}
const e = await c.query(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid ORDER BY t.typname, e.enumsortorder`);
console.log("\n## enums");
const enums = {};
for (const row of e.rows) (enums[row.typname] = enums[row.typname] || []).push(row.enumlabel);
for (const [k,v] of Object.entries(enums)) console.log(`  ${k}: ${v.join(", ")}`);
await c.end();
