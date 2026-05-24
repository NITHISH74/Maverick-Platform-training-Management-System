import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { batchesTable } from "./batches";

// Maps to Supabase `public.candidates`. Supabase doesn't have college /
// degree / joined_at columns, so they're omitted from the schema but kept
// as virtual fields in code that needs them (they'll be dropped silently
// on insert).
export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  candidateId: text("employee_id").notNull().unique(),
  name: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("active"),
  batchId: integer("batch_id").references(() => batchesTable.id),
  modifiedBy: integer("modified_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
