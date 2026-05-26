/**
 * AI Trainer Scoring — Node proxy.
 *
 * Same pattern as routes/copilot.ts and routes/ai.ts: authMiddleware verifies
 * the user's Bearer token, then we forward to FastAPI with the shared
 * x-internal-token header. No business logic lives here — all of it is in
 * services/ai/app/routers/trainer_scoring.py.
 *
 * Deviation note: the feature spec says "valid Auth0 JWT". The existing
 * authMiddleware verifies the project's Base64 token (issued after Auth0
 * sign-in via /api/auth/exchange) — same pattern as routes/copilot.ts.
 */

import { Router, type IRouter } from "express";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";

// ---------------------------------------------------------------------------
// POST /api/trainer-scoring/score
// ---------------------------------------------------------------------------
router.post("/trainer-scoring/score", authMiddleware, async (req, res): Promise<void> => {
  try {
    const upstream = await fetch(`${AI_BASE}/trainer-scoring/score`, {
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

// ---------------------------------------------------------------------------
// GET /api/trainer-scoring/score/:trainerId/:batchId
// ---------------------------------------------------------------------------
router.get("/trainer-scoring/score/:trainerId/:batchId", authMiddleware, async (req, res): Promise<void> => {
  const { trainerId, batchId } = req.params;
  try {
    const upstream = await fetch(
      `${AI_BASE}/trainer-scoring/score/${encodeURIComponent(trainerId)}/${encodeURIComponent(batchId)}`,
      {
        method: "GET",
        headers: { "x-internal-token": INTERNAL_TOKEN },
      },
    );
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

export default router;
