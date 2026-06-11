import { pgTable, text, timestamp, integer, boolean, uuid, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { usersTable } from "./users";

// Per-batch attendance due-time config — see migration 0007.
// Drives the daily missed-cut-off email from lib/scheduler.ts.
export const attendanceSettingsTable = pgTable("attendance_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: integer("batch_id").notNull().unique().references(() => batchesTable.id, { onDelete: "cascade" }),
  dueTime: time("due_time").notNull().default("10:00:00"),
  dueTimezone: text("due_timezone").notNull().default("Asia/Kolkata"),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAttendanceSettingsSchema = createInsertSchema(attendanceSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAttendanceSettings = z.infer<typeof insertAttendanceSettingsSchema>;
export type AttendanceSettings = typeof attendanceSettingsTable.$inferSelect;
