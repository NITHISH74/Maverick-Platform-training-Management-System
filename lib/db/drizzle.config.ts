import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: [
    "./src/schema/users.ts",
    "./src/schema/batches.ts",
    "./src/schema/candidates.ts",
    "./src/schema/attendance.ts",
    "./src/schema/assessments.ts",
    "./src/schema/toppers.ts",
    "./src/schema/feedback.ts",
    "./src/schema/notifications.ts",
    "./src/schema/audit.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
