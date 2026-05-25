import { Router, type IRouter } from "express";
import { authMiddleware, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";

/**
 * Coordinator Copilot — Node proxy.
 *
 * The browser hits /api/copilot/* with the user's local Base64 Bearer token
 * (authMiddleware verifies it). We forward to the FastAPI service with the
 * shared internal-token header, just like routes/ai.ts.
 *
 * Deviation note: the spec says "valid Auth0 JWT". The existing
 * authMiddleware verifies the project's Base64 token (which is itself issued
 * after Auth0 sign-in via /api/auth/exchange) — we follow the existing
 * pattern rather than introducing a parallel JWT verifier.
 */

router.post("/copilot/query", authMiddleware, async (req, res): Promise<void> => {
  try {
    const upstream = await fetch(`${AI_BASE}/copilot/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        ...(req.body ?? {}),
        // Override user_id from the decoded token — clients can't spoof it.
        // userId is an integer in the DB; the upstream coerces to UUID where
        // possible and stores the raw value in audit details otherwise.
        user_id: req.userId != null ? String(req.userId) : undefined,
        stream: true,
      }),
    });

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Pipe the SSE bytes straight through to the browser.
    const reader = upstream.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e: unknown) {
    res.status(502).json({
      error: "AI service unreachable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/copilot/narrate", authMiddleware, async (req, res): Promise<void> => {
  try {
    const upstream = await fetch(`${AI_BASE}/copilot/narrate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e: unknown) {
    res.status(502).json({
      error: "AI service unreachable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/copilot/feedback", authMiddleware, async (req, res): Promise<void> => {
  try {
    const upstream = await fetch(`${AI_BASE}/copilot/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        ...(req.body ?? {}),
        user_id: req.userId != null ? String(req.userId) : undefined,
      }),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    res.send(text);
  } catch (e: unknown) {
    res.status(502).json({
      error: "AI service unreachable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

router.get(
  "/copilot/usage-stats",
  authMiddleware,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    try {
      const upstream = await fetch(`${AI_BASE}/copilot/usage`, {
        method: "GET",
        headers: { "x-internal-token": INTERNAL_TOKEN },
      });
      const text = await upstream.text();
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct) res.setHeader("content-type", ct);
      res.send(text);
    } catch (e: unknown) {
      res.status(502).json({
        error: "AI service unreachable",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

export default router;
