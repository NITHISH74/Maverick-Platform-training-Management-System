import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// SSL handling for hosted Postgres (Supabase, Neon, etc).
// - pg-connection-string v3 treats `sslmode=require` from the URL as
//   `verify-full`, which rejects Supabase's self-signed CA chain. We need
//   `rejectUnauthorized: false`, which is incompatible with verify-full.
// - Strip `sslmode=*` from the URL and pass ssl explicitly so our setting
//   wins.
const _rawUrl = process.env.DATABASE_URL;
const _isRemote =
  /[?&]sslmode=(require|verify-ca|verify-full)/i.test(_rawUrl) ||
  /@(?!localhost|127\.0\.0\.1)/i.test(_rawUrl);
const _url = _rawUrl.replace(/([?&])sslmode=[^&]+&?/i, "$1").replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString: _url,
  ssl: _isRemote ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
