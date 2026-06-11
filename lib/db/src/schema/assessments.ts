import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";

// Maps to Supabase `public.assessments`. Each row is ONE score for ONE
// candidate's ONE assessment. There is no separate `assessment_scores`
// table — for backwards-compat we expose `assessmentScoresTable` as an
// alias to the same physical table.
export const assessmentsTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  title: text("title").notNull(),
  // Supabase column is `assessment_type` (Postgres enum; read as text).
  type: text("assessment_type").notNull(),
  scheduledDate: text("scheduled_date").notNull(),
  maxScore: numeric("max_score", { precision: 10, scale: 2 }).notNull().default("100"),
  score: numeric("score", { precision: 10, scale: 2 }).notNull(),
  passed: boolean("passed"),
  uploadedDate: text("uploaded_date"),
  uploadedBy: integer("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Legacy alias — same physical table. `assessmentId` here just mirrors the
// row id (since each row IS a score). `remarks` surfaces the title.
export const assessmentScoresTable = pgTable("assessments", {
  id: serial("id").primaryKey(),
  assessmentId: integer("id"),
  candidateId: integer("candidate_id"),
  score: numeric("score", { precision: 10, scale: 2 }).notNull(),
  remarks: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssessmentSchema = createInsertSchema(assessmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessmentsTable.$inferSelect;

export const insertAssessmentScoreSchema = createInsertSchema(assessmentScoresTable).omit({ id: true, createdAt: true });
export type InsertAssessmentScore = z.infer<typeof insertAssessmentScoreSchema>;
export type AssessmentScore = typeof assessmentScoresTable.$inferSelect;
