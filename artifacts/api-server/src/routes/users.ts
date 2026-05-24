import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, GetUserParams, UpdateUserParams, DeleteUserParams, ListUsersQueryParams } from "@workspace/api-zod";
import { authMiddleware } from "../middlewares/auth";
import { hashPassword } from "./auth";

const router: IRouter = Router();

function serializeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

router.get("/users", authMiddleware, async (req, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  let query = db.select().from(usersTable);
  const users = await (params.success && params.data.role
    ? db.select().from(usersTable).where(eq(usersTable.role, params.data.role))
    : db.select().from(usersTable));
  res.json(users.map(serializeUser));
});

router.post("/users", authMiddleware, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Supabase has no password_hash column. Users are created lazily on first
  // Auth0 sign-in via /auth/exchange; until that happens we still want this
  // endpoint to land a row so admins can pre-create coordinators/trainers.
  // We mint a synthetic auth0_sub keyed on email — the real one will overwrite
  // it the first time that user signs in (auth0_sub is updated by exchange via
  // ON CONFLICT-style upsert on email — see auth.ts).
  const { password: _ignored, ...rest } = parsed.data;
  void _ignored; void hashPassword;
  const auth0Sub = `pending|${rest.email.toLowerCase()}`;
  const [user] = await db.insert(usersTable).values({ ...rest, auth0Sub }).returning();
  res.status(201).json(serializeUser(user));
});

router.get("/users/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(serializeUser(user));
});

router.patch("/users/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(serializeUser(user));
});

router.delete("/users/:id", authMiddleware, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
