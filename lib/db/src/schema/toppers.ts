import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";

export const topperConfigTable = pgTable("topper_config", {
  id: serial("id").primaryKey(),
  assessmentWeight: numeric("assessment_weight", { precision: 5, scale: 2 }).notNull().default("60"),
  projectWeight: numeric("project_weight", { precision: 5, scale: 2 }).notNull().default("30"),
  attendanceWeight: numeric("attendance_weight", { precision: 5, scale: 2 }).notNull().default("10"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const topperResultsTable = pgTable("topper_results", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  candidateId: integer("candidate_id").notNull().references(() => candidatesTable.id),
  rank: integer("rank").notNull(),
  totalScore: numeric("total_score", { precision: 10, scale: 4 }).notNull(),
  assessmentScore: numeric("assessment_score", { precision: 10, scale: 4 }),
  projectScore: numeric("project_score", { precision: 10, scale: 4 }),
  attendanceScore: numeric("attendance_score", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTopperConfigSchema = createInsertSchema(topperConfigTable).omit({ id: true, updatedAt: true });
export type InsertTopperConfig = z.infer<typeof insertTopperConfigSchema>;
export type TopperConfig = typeof topperConfigTable.$inferSelect;

export const insertTopperResultSchema = createInsertSchema(topperResultsTable).omit({ id: true, createdAt: true });
export type InsertTopperResult = z.infer<typeof insertTopperResultSchema>;
export type TopperResult = typeof topperResultsTable.$inferSelect;
