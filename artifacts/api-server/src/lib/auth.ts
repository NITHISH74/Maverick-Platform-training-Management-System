import crypto from "crypto";

// -----------------------------------------------------------------------------
// Local API token
//
// We issue our own short-lived, HMAC-signed token after exchanging an Auth0
// access token (see routes/auth.ts). The token is `base64url(payload).sig`
// where sig = HMAC-SHA256(payload, API_TOKEN_SECRET). Verification recomputes
// the signature with a timing-safe compare and rejects expired tokens, so a
// client cannot forge `{ userId, role }` the way the old unsigned base64
// scheme allowed.
// -----------------------------------------------------------------------------

// How long an issued token stays valid (seconds). 12h keeps a working day
// covered without forcing a mid-session re-auth.
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function getSecret(): string {
  const secret = process.env.API_TOKEN_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "API_TOKEN_SECRET must be set to a 16+ char random string in production.",
    );
  }
  // Dev-only fallback so local runs work without extra setup.
  return "dev-insecure-api-token-secret-do-not-use-in-prod";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payloadB64: string): string {
  return base64url(
    crypto.createHmac("sha256", getSecret()).update(payloadB64).digest(),
  );
}

export function generateToken(userId: number, role: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    userId,
    role,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });
  const payloadB64 = base64url(payload);
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const payloadB64 = token.slice(0, dot);
    const providedSig = token.slice(dot + 1);

    const expectedSig = sign(payloadB64);
    const a = Buffer.from(providedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    );
    if (!payload.userId || !payload.role) return null;
    if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Legacy password helpers — authentication is delegated to Auth0 and the
// /auth/login route is disabled (410 Gone). These are retained only because a
// couple of modules still import them; they are not used for live auth.
// -----------------------------------------------------------------------------
export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "maverick_salt").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}
