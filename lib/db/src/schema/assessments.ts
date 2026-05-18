import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";

export const assessmentsTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  title: text("title").notNull(),
  type: text("type").notNull(), // sprint_review | coding | api | project_evaluation
  scheduledDate: text("scheduled_date").notNull(), // yyyy-mm-dd
  maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull().default("100"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const assessmentScoresTable = pgTable("assessment_scores", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => assessmentsTable.id),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  score: numeric("score", { precision: 10, scale: 2 }).notNull(),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAssessmentSchema = createInsertSchema(assessmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessmentsTable.$inferSelect;

export const insertAssessmentScoreSchema = createInsertSchema(assessmentScoresTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssessmentScore = z.infer<typeof insertAssessmentScoreSchema>;
export type AssessmentScore = typeof assessmentScoresTable.$inferSelect;
