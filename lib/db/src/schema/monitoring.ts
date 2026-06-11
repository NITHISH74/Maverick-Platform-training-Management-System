import { pgTable, text, serial, bigserial, timestamp, integer, numeric, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";
import { assessmentsTable } from "./assessments";

// ============================================================================
// monitoring_alerts — user-facing alert inbox surfaced by the batch monitoring
// agent. See lib/db/migrations/0003_batch_monitoring_agent.sql for the column
// docs and the alert_kind enum string list.
// ============================================================================
export const monitoringAlertsTable = pgTable("monitoring_alerts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: text("run_id"), // uuid — kept as text to avoid pulling in a uuid type
  batchId: integer("batch_id").references(() => batchesTable.id),
  candidateId: integer("candidate_id").references(() => candidatesTable.id),
  assessmentId: integer("assessment_id").references(() => assessmentsTable.id),
  alertKind: text("alert_kind").notNull(),
  severity: text("severity").notNull(), // LOW | MEDIUM | HIGH | CRITICAL
  title: text("title").notNull(),
  message: text("message").notNull(),
  aiSummary: text("ai_summary"),
  metricValue: numeric("metric_value", { precision: 10, scale: 2 }),
  thresholdValue: numeric("threshold_value", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("open"), // open | acknowledged | resolved | dismissed
  acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedBy: integer("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMonitoringAlertSchema = createInsertSchema(monitoringAlertsTable).omit({ id: true, createdAt: true });
export type InsertMonitoringAlert = z.infer<typeof insertMonitoringAlertSchema>;
export type MonitoringAlert = typeof monitoringAlertsTable.$inferSelect;

// ============================================================================
// monitoring_email_log — every email we attempted to send
// ============================================================================
export const monitoringEmailLogTable = pgTable("monitoring_email_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  alertId: bigint("alert_id", { mode: "number" }),
  recipientId: integer("recipient_id").references(() => usersTable.id),
  recipientEmail: text("recipient_email").notNull(),
  recipientRole: text("recipient_role"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("sent"), // sent | queued | failed
  provider: text("provider"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMonitoringEmailLogSchema = createInsertSchema(monitoringEmailLogTable).omit({ id: true, createdAt: true });
export type InsertMonitoringEmailLog = z.infer<typeof insertMonitoringEmailLogSchema>;
export type MonitoringEmailLog = typeof monitoringEmailLogTable.$inferSelect;

// ============================================================================
// monitoring_config — singleton config row (id = 1)
// ============================================================================
export const monitoringConfigTable = pgTable("monitoring_config", {
  id: serial("id").primaryKey(),
  attendanceBatchThresholdPct: numeric("attendance_batch_threshold_pct", { precision: 5, scale: 2 }).notNull().default("75"),
  attendanceDropThresholdPct: numeric("attendance_drop_threshold_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  attendanceCandidateThresholdPct: numeric("attendance_candidate_threshold_pct", { precision: 5, scale: 2 }).notNull().default("70"),
  assessmentPassThresholdPct: numeric("assessment_pass_threshold_pct", { precision: 5, scale: 2 }).notNull().default("40"),
  clearanceThresholdPct: numeric("clearance_threshold_pct", { precision: 5, scale: 2 }).notNull().default("60"),
  consecutiveAbsenceDays: integer("consecutive_absence_days").notNull().default(3),
  assessmentOverdueDays: integer("assessment_overdue_days").notNull().default(1),
  emailTrainer: boolean("email_trainer").notNull().default(true),
  emailCoordinator: boolean("email_coordinator").notNull().default(true),
  emailAdmin: boolean("email_admin").notNull().default(false),
  schedulerEnabled: boolean("scheduler_enabled").notNull().default(true),
  schedulerCron: text("scheduler_cron").notNull().default("0 11 * * *"),
  updatedBy: integer("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMonitoringConfigSchema = createInsertSchema(monitoringConfigTable).omit({ id: true, updatedAt: true });
export type InsertMonitoringConfig = z.infer<typeof insertMonitoringConfigSchema>;
export type MonitoringConfig = typeof monitoringConfigTable.$inferSelect;
