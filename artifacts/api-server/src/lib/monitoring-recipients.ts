/**
 * Recipient resolver for the monitoring agent.
 *
 * Given a batch and the config flags, returns the list of users
 * who should receive an email for an alert. Admins are explicitly
 * NOT included by default (per the feature spec): they see everything
 * in the dashboard but don't get trigger emails.
 */
import { eq } from "drizzle-orm";
import { db, usersTable, batchesTable, batchTrainersTable, monitoringConfigTable } from "@workspace/db";

export interface Recipient {
  userId: number;
  email: string;
  fullName: string;
  role: string; // 'trainer' | 'coordinator' | 'admin'
}

export async function getMonitoringConfig() {
  const [cfg] = await db.select().from(monitoringConfigTable).where(eq(monitoringConfigTable.id, 1)).limit(1);
  return cfg;
}

export async function resolveBatchRecipients(batchId: number): Promise<Recipient[]> {
  const cfg = await getMonitoringConfig();
  if (!cfg) return [];

  const out: Recipient[] = [];
  const [batch] = await db.select().from(batchesTable).where(eq(batchesTable.id, batchId)).limit(1);
  if (!batch) return [];

  // Trainers
  if (cfg.emailTrainer) {
    const links = await db.select().from(batchTrainersTable).where(eq(batchTrainersTable.batchId, batchId));
    for (const link of links) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, link.trainerId)).limit(1);
      if (u && u.isActive) {
        out.push({ userId: u.id, email: u.email, fullName: u.name, role: u.role });
      }
    }
  }

  // Coordinator
  if (cfg.emailCoordinator && batch.coordinatorId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, batch.coordinatorId)).limit(1);
    if (u && u.isActive) {
      out.push({ userId: u.id, email: u.email, fullName: u.name, role: u.role });
    }
  }

  // Admins (explicitly opt-in — per spec admins do NOT receive emails by default)
  if (cfg.emailAdmin) {
    const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
    for (const u of admins) {
      if (u.isActive) {
        out.push({ userId: u.id, email: u.email, fullName: u.name, role: "admin" });
      }
    }
  }

  // De-dupe by email (a coordinator who's also a trainer wouldn't get 2 emails).
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));
}
