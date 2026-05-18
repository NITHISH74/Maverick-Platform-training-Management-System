import crypto from "crypto";

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "maverick_salt").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: number, role: string): string {
  const payload = JSON.stringify({ userId, role, iat: Date.now() });
  return Buffer.from(payload).toString("base64");
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const payload = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    if (!payload.userId || !payload.role) return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}
