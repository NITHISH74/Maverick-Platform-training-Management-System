import { pgTable, text, timestamp, integer, uuid, date, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { usersTable } from "./users";

// Coordinator-owned per-batch feedback request config — see migration 0007.
// Stores the MS Forms link & due window the coordinator emailed candidates.
export const feedbackWindowsTable = pgTable("feedback_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: integer("batch_id").notNull().unique().references(() => batchesTable.id, { onDelete: "cascade" }),
  msFormsLink: text("ms_forms_link"),
  dueDate: date("due_date"),
  dueTime: time("due_time"),
  subject: text("subject"),
  bodyTemplate: text("body_template"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentBy: integer("sent_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFeedbackWindowSchema = createInsertSchema(feedbackWindowsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFeedbackWindow = z.infer<typeof insertFeedbackWindowSchema>;
export type FeedbackWindow = typeof feedbackWindowsTable.$inferSelect;
