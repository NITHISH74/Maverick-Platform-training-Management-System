import { pgTable, text, timestamp, integer, bigserial, smallint, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { batchesTable } from "./batches";
import { candidatesTable } from "./candidates";

// Maps to public.notifications_log (created in migration 0001, extended
// in 0007 with recipient_name + body_preview). Used as the canonical
// audit log for every email/notification the system attempts to send.
//
// notif_type is the discriminator. Known values:
//   attendance_cut_off_missed | consecutive_absence | upload_success
//   | assessment_reminder    | feedback_request    | escalation
export const notificationsLogTable = pgTable("notifications_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  recipientId: integer("recipient_id").references(() => usersTable.id),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  notifType: text("notif_type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyPreview: text("body_preview"),
  urgencyLevel: smallint("urgency_level").notNull().default(1),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  // 'sent' | 'failed' | 'queued' (called delivery_status in the V6 spec).
  status: text("status").notNull().default("queued"),
  relatedBatch: integer("related_batch").references(() => batchesTable.id),
  relatedCandidate: integer("related_candidate").references(() => candidatesTable.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationLogSchema = createInsertSchema(notificationsLogTable).omit({ id: true, createdAt: true });
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationsLogTable.$inferSelect;
