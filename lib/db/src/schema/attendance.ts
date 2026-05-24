import { pgTable, text, timestamp, integer, bigserial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { candidatesTable } from "./candidates";
import { batchesTable } from "./batches";
import { usersTable } from "./users";

// Maps to Supabase `public.attendance`. JS property names kept the same;
// only the DB column mappings differ:
//   - `date` maps to `attend_date`
//   - `submittedById` maps to `marked_by`
//   - `remarks` is dropped (no such column in Supabase)
//   - `source` is added (defaults to 'manual')
export const attendanceTable = pgTable("attendance", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  date: text("attend_date").notNull(),
  status: text("status").notNull(),
  submittedById: integer("marked_by").references(() => usersTable.id),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
