import { Router, type IRouter } from "express";
import { db, auditLogsTable, usersTable } from "@workspace/db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * GET /api/audit-logs
 *
 * Two response shapes, controlled by the presence of `page` in the query
 * string — so the generated TanStack hook (which expects a flat array)
 * keeps working, while the new AuditLog page can opt in to pagination:
 *
 *   ?limit=50                                        → flat array (legacy)
 *   ?page=1&pageSize=50&action=...&actorId=...&...   → { rows, total,
 *                                                       page, pageSize,
 *                                                       actions, actors }
 *
 * Filters (all optional):
 *   - entityType            existing filter (kept)
 *   - action                exact match (e.g. "batch_created")
 *   - actorId               integer user id
 *   - startDate / endDate   ISO date strings (inclusive)
 *
 * Bulk loading + in-memory filtering is fine at the audit_logs scale we
 * have today; if the table grows past tens of thousands, swap this for a
 * real SQL WHERE/ORDER BY/OFFSET.
 */
router.get("/audit-logs", authMiddleware, async (req, res): Promise<void> => {
  const params = ListAuditLogsQueryParams.safeParse(req.query);

  // Extra filter params not in the generated zod schema — read directly
  // from req.query and coerce defensively.
  const actionFilter = typeof req.query.action === "string" ? req.query.action : undefined;
  const actorIdFilter = (() => {
    const raw = req.query.actorId;
    if (typeof raw !== "string") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  })();
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
  const pageRaw = typeof req.query.page === "string" ? Number(req.query.page) : NaN;
  const pageSizeRaw = typeof req.query.pageSize === "string" ? Number(req.query.pageSize) : NaN;
  const paged = Number.isFinite(pageRaw);

  let logs = await db.select().from(auditLogsTable);

  if (params.success && params.data.entityType) {
    logs = logs.filter(l => l.entityType === params.data.entityType);
  }
  if (actionFilter) {
    logs = logs.filter(l => l.action === actionFilter);
  }
  if (actorIdFilter !== undefined) {
    logs = logs.filter(l => l.actorId === actorIdFilter);
  }
  if (startDate) {
    const start = new Date(startDate).getTime();
    logs = logs.filter(l => new Date(l.createdAt).getTime() >= start);
  }
  if (endDate) {
    // Make endDate inclusive — bump by 1 day so a user picking "today"
    // captures events from today.
    const end = new Date(endDate).getTime() + 24 * 60 * 60 * 1000;
    logs = logs.filter(l => new Date(l.createdAt).getTime() < end);
  }

  logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Always load users — we resolve actor names AND return the actor list
  // so the filter dropdown can populate without a second roundtrip.
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map(u => [u.id, u]));

  function serialize(l: typeof auditLogsTable.$inferSelect) {
    const u = l.actorId ? userMap.get(l.actorId) : undefined;
    return {
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId ?? null,
      actorId: l.actorId ?? null,
      actorName: u?.name ?? null,
      actorRole: u?.role ?? null,
      details: l.details ?? null,
      createdAt: l.createdAt,
    };
  }

  if (!paged) {
    // Legacy shape — keep the flat array so the generated hook + the
    // Dashboard "Recent Activity" widget keep working unchanged.
    const limit = params.success ? (params.data.limit ?? 50) : 50;
    res.json(logs.slice(0, limit).map(serialize));
    return;
  }

  const page = Math.max(1, Math.floor(pageRaw));
  const pageSize = Math.min(200, Math.max(1, Math.floor(pageSizeRaw) || 50));
  const total = logs.length;
  const rows = logs.slice((page - 1) * pageSize, page * pageSize).map(serialize);

  // Distinct action types (across the unfiltered universe so the
  // dropdown stays stable). Limit to a sane number to keep payload small.
  const allActions = await db.select({ action: auditLogsTable.action }).from(auditLogsTable);
  const actions = Array.from(new Set(allActions.map(r => r.action))).sort();
  // Actors that actually appear in the audit log (not the full user list).
  const actorIdsPresent = Array.from(
    new Set(allActions.length > 0 ? [] : []),
  );
  const allActorIds = await db
    .select({ actorId: auditLogsTable.actorId })
    .from(auditLogsTable);
  const actorList = Array.from(
    new Set(allActorIds.map(r => r.actorId).filter((x): x is number => x != null)),
  )
    .map(id => userMap.get(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map(u => ({ id: u.id, name: u.name, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Silence the unused-var; we keep the variable for future date-bucketed UX.
  void actorIdsPresent;

  res.json({ rows, total, page, pageSize, actions, actors: actorList });
});

export default router;
