import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { MarkNotificationReadParams, ListNotificationsQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/notifications", authMiddleware, async (req, res): Promise<void> => {
  const params = ListNotificationsQueryParams.safeParse(req.query);
  const unreadOnly = params.success ? params.data.unreadOnly : undefined;
  const notifications = unreadOnly
    ? await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, req.userId!), eq(notificationsTable.isRead, false)))
    : await db.select().from(notificationsTable).where(eq(notificationsTable.userId, req.userId!));
  res.json(notifications.map(n => ({
    id: n.id,
    userId: n.userId,
    title: n.title,
    message: n.message,
    type: n.type,
    isRead: n.isRead,
    relatedEntityType: n.relatedEntityType ?? null,
    relatedEntityId: n.relatedEntityId ?? null,
    createdAt: n.createdAt,
  })));
});

router.patch("/notifications/:id/read", authMiddleware, async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [notification] = await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.id, params.data.id)).returning();
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json({ ...notification, relatedEntityType: notification.relatedEntityType ?? null, relatedEntityId: notification.relatedEntityId ?? null });
});

router.patch("/notifications/read-all", authMiddleware, async (req, res): Promise<void> => {
  await db.update(notificationsTable).set({ isRead: true }).where(eq(notificationsTable.userId, req.userId!));
  res.json({ success: true, message: "All notifications marked as read" });
});

export default router;
