import pg from "pg";
const { Pool } = pg;
const url =
  "postgres://postgres:MbYuVzXO0ec5Mmpe@db.sohtevfosggoxhokxkix.supabase.co:5432/postgres?sslmode=require";
const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});
try {
  const r = await pool.query(
    'select "id","auth0_sub","full_name","email","role","is_active","modified_by","created_at","updated_at" from "users" where "users"."email" = $1',
    ["nithishwarsenthilkumaran@gmail.com"],
  );
  console.log("rows:", r.rowCount);
  console.log(r.rows[0]);
} catch (e) {
  console.log("ERROR code:", e.code, "message:", e.message);
  console.log("FULL:", e);
} finally {
  await pool.end();
}
