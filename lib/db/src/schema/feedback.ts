import { pgTable, text, timestamp, integer, bigserial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";
import { usersTable } from "./users";

// Maps to Supabase `public.feedback`. Simpler than the legacy shape — only
// response_text + a single rating + optional trainer_id. Legacy fields
// (contentRating, trainerRating, overallRating, comments, sentiment) are
// derived in the route layer for backwards compatibility.
export const feedbackTable = pgTable("feedback", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  candidateId: integer("candidate_id").references(() => candidatesTable.id),
  trainerId: integer("trainer_id").references(() => usersTable.id),
  responseText: text("response_text").notNull(),
  rating: integer("rating"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({ id: true, createdAt: true });
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;
