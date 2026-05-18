import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";

export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  contentRating: integer("content_rating").notNull(),
  trainerRating: integer("trainer_rating").notNull(),
  overallRating: integer("overall_rating"),
  comments: text("comments"),
  sentiment: text("sentiment"), // positive | neutral | negative
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({ id: true, createdAt: true });
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;
