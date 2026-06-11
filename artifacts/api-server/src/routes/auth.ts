import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

// Decode a JWT payload without verifying the signature.
// Used only for exchanging Auth0 access tokens into our local Base64 token in dev.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Exchange an Auth0 access token for our stateless Base64 API token.
// Upserts a DB user keyed by email so the rest of the API (which expects
// numeric user IDs) keeps working.
router.post("/auth/exchange", async (req, res): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  const auth0Token = authHeader.slice(7);
  const payload = decodeJwtPayload(auth0Token);
  if (!payload) {
    res.status(401).json({ error: "Invalid Auth0 token" });
    return;
  }

  // Email may come from the access token (custom claim) or be supplied by the
  // frontend from the Auth0 user profile.
  const bodyEmail = typeof req.body?.email === "string" ? req.body.email : undefined;
  const bodyName = typeof req.body?.name === "string" ? req.body.name : undefined;
  const tokenEmail =
    (typeof payload["email"] === "string" && (payload["email"] as string)) ||
    (typeof payload["https://maverick/email"] === "string" &&
      (payload["https://maverick/email"] as string)) ||
    undefined;
  const email = (bodyEmail ?? tokenEmail)?.toLowerCase();
  if (!email) {
    res.status(400).json({
      error:
        "No email in Auth0 token or request body. Pass { email, name } in the POST body.",
    });
    return;
  }
  const name = bodyName ?? email.split("@")[0];

  // Upsert by email. Supabase users.auth0_sub is required; pull it from the
  // JWT `sub` claim.
  const auth0Sub =
    (typeof payload["sub"] === "string" && (payload["sub"] as string)) ||
    `auth0|${email}`;
  let [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    const [anyExisting] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    const role = anyExisting ? "trainer" : "admin";
    const [created] = await db
      .insert(usersTable)
      .values({ auth0Sub, email, name, role, isActive: true })
      .returning();
    user = created;
  }

  if (!user.isActive) {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  const token = generateToken(user.id, user.role);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  });
});

// Supabase users table has no password_hash column — authentication is
// delegated entirely to Auth0. This route is kept for API compatibility
// but now always returns 410 Gone.
router.post("/auth/login", async (_req, res): Promise<void> => {
  res.status(410).json({
    error:
      "Email/password login is disabled. Use /auth/exchange with an Auth0 access token instead.",
  });
});
// silence "unused" warning for legacy imports
void LoginBody; void verifyPassword;

router.post("/auth/logout", (_req, res): void => {
  res.json({ success: true });
});

router.get("/auth/me", authMiddleware, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
});

export { hashPassword };
export default router;
