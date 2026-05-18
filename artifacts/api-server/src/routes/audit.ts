import { Router, type IRouter } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/audit-logs", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAuditLogsQueryParams.safeParse(req.query);
  let logs = await db.select().from(auditLogsTable);

  if (params.success && params.data.entityType) {
    logs = logs.filter(l => l.entityType === params.data.entityType);
  }
  const limit = params.success ? (params.data.limit ?? 50) : 50;
  logs = logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);

  const actorIds = [...new Set(logs.map(l => l.actorId).filter(Boolean))];
  const users = actorIds.length > 0 ? await db.select().from(usersTable) : [];

  res.json(logs.map(l => ({
    id: l.id,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId ?? null,
    actorId: l.actorId ?? null,
    actorName: l.actorId ? (users.find(u => u.id === l.actorId)?.name ?? null) : null,
    details: l.details ?? null,
    createdAt: l.createdAt,
  })));
});

export default router;
