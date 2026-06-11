import { eq } from "drizzle-orm";
import { db, batchTrainersTable, auditLogsTable } from "@workspace/db";

/**
 * Returns the list of batch IDs that the given trainer is assigned to.
 * Used to scope reads/writes for users with role === "trainer".
 */
export async function getTrainerBatchIds(trainerId: number): Promise<number[]> {
  const rows = await db
    .select({ batchId: batchTrainersTable.batchId })
    .from(batchTrainersTable)
    .where(eq(batchTrainersTable.trainerId, trainerId));
  return rows.map(r => r.batchId);
}

/**
 * Writes an audit log row. Never throws — audit failures must not break the request.
 */
export async function writeAudit(params: {
  actorId: number | null | undefined;
  action: string;
  entityType: string;
  entityId?: number | null;
  details?: string | object | null;
}): Promise<void> {
  try {
    const detailsStr =
      params.details == null
        ? null
        : typeof params.details === "string"
        ? params.details
        : JSON.stringify(params.details);
    await db.insert(auditLogsTable).values({
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      actorId: params.actorId ?? null,
      details: detailsStr,
    });
  } catch (err) {
    // Audit must never break the parent request.
    // eslint-disable-next-line no-console
    console.error("writeAudit failed:", err);
  }
}
