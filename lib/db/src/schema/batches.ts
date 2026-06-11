import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const batchesTable = pgTable("batches", {
  id: serial("id").primaryKey(),
  batchCode: text("batch_code").notNull().unique(),
  name: text("name").notNull(),
  program: text("program").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("planned"),
  capacity: integer("capacity").notNull().default(30),
  coordinatorId: integer("coordinator_id").references(() => usersTable.id),
  attendanceCutoffTime: text("attendance_cutoff_time").notNull().default("10:00"),
  modifiedBy: integer("modified_by"),
  // Added by migration 0006 — coordinator-set per-batch passing threshold (%).
  clearanceRate: numeric("clearance_rate", { precision: 5, scale: 2 }).notNull().default("70.00"),
  // Soft-delete marker. All batch reads must filter `deleted_at IS NULL`.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const batchTrainersTable = pgTable("batch_trainers", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batchesTable.id),
  trainerId: integer("trainer_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBatchSchema = createInsertSchema(batchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBatch = z.infer<typeof insertBatchSchema>;
export type Batch = typeof batchesTable.$inferSelect;
