import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sqlFile = path.resolve("lib/db/drizzle/0000_maverick_core.sql");
const sql = readFileSync(sqlFile, "utf8");

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected to Supabase");

// Split on drizzle's statement breakpoint marker
const statements = sql.split(/-->\s*statement-breakpoint/).map(s => s.trim()).filter(Boolean);
console.log(`Applying ${statements.length} statements...`);

let created = 0, skipped = 0;
for (const stmt of statements) {
  try {
    await client.query(stmt);
    created++;
  } catch (e) {
    if (/already exists/i.test(e.message)) {
      skipped++;
    } else {
      console.error("FAIL on:", stmt.slice(0, 120));
      throw e;
    }
  }
}
console.log(`Schema: ${created} applied, ${skipped} already existed`);

// Insert seed users
const hash = (pw) => {
  return require("node:crypto").createHash("sha256").update(pw + "maverick_salt").digest("hex");
};
import("node:crypto").then(async ({ createHash }) => {
  const mkHash = (pw) => createHash("sha256").update(pw + "maverick_salt").digest("hex");
  const seeds = [
    { name: "Admin", email: "admin@maverick.com", role: "admin", pw: "admin123" },
    { name: "Coordinator", email: "coordinator@maverick.com", role: "coordinator", pw: "coord123" },
    { name: "Trainer", email: "trainer@maverick.com", role: "trainer", pw: "trainer123" },
  ];
  for (const s of seeds) {
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true`,
      [s.name, s.email, mkHash(s.pw), s.role]
    );
    console.log(`Seeded user: ${s.email}`);
  }
  await client.end();
  console.log("Done.");
});
