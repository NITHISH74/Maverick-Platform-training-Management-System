/**
 * Feedback Intelligence — Node proxy (Feature 3).
 *
 * Same pattern as routes/copilot.ts, routes/ai.ts, routes/trainer-scoring.ts.
 * authMiddleware verifies the Bearer token; we forward to FastAPI with the
 * shared x-internal-token header. No business logic lives here.
 */

import { Router, type IRouter } from "express";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";

router.post("/feedback-intelligence/analyze", authMiddleware, async (req, res): Promise<void> => {
  try {
    const upstream = await fetch(`${AI_BASE}/feedback-intelligence/analyze`, {
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

router.get("/feedback-intelligence/analysis/:batchId", authMiddleware, async (req, res): Promise<void> => {
  const { batchId } = req.params;
  try {
    const upstream = await fetch(
      `${AI_BASE}/feedback-intelligence/analysis/${encodeURIComponent(batchId)}`,
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
