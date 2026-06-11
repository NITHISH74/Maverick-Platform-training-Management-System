import { Router, type IRouter } from "express";
import { authMiddleware } from "../middlewares/auth";

const router: IRouter = Router();

const AI_BASE = process.env.AI_SERVICE_URL ?? "http://localhost:9000";
const INTERNAL_TOKEN =
  process.env.AI_INTERNAL_TOKEN ?? "smoke-test-secret-1234567890";

/**
 * Proxy to the Python AI service. The browser hits this with the user's
 * Bearer token (authMiddleware verifies it); we then forward the request to
 * the AI service with the internal shared secret header.
 *
 * Routes:
 *   POST /api/ai/feedback/analyze
 *   POST /api/ai/notifications/generate
 *   POST /api/ai/agent/run
 *   GET  /api/ai/agent/tasks
 *   GET  /api/ai/agent/digest
 *
 * NOTE: The /api/ai/chatbot/query route was retired when the AI Chatbot
 * feature was merged into the Coordinator Copilot. Use /api/copilot/query
 * instead — see routes/copilot.ts.
 */
async function proxy(req: any, res: any, method: "GET" | "POST"): Promise<void> {
  const subpath = req.path.replace(/^\/ai/, "");
  const url = new URL(`${AI_BASE}/ai${subpath}`);
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") url.searchParams.set(k, v);
  }

  try {
    const upstream = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-internal-token": INTERNAL_TOKEN,
      },
      body: method === "POST" ? JSON.stringify(req.body ?? {}) : undefined,
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
}

// /ai/chatbot/query retired — see /api/copilot/query. We keep a 410 here so
// any stale client code surfaces the migration clearly instead of 502'ing.
router.post("/ai/chatbot/query", authMiddleware, (_req, res) => {
  res.status(410).json({
    error: "endpoint_retired",
    detail: "The AI Chatbot has been merged into the Coordinator Copilot. Use POST /api/copilot/query instead.",
  });
});
router.post("/ai/feedback/analyze", authMiddleware, (req, res) => proxy(req, res, "POST"));
router.post("/ai/notifications/generate", authMiddleware, (req, res) => proxy(req, res, "POST"));
router.post("/ai/agent/run", authMiddleware, (req, res) => proxy(req, res, "POST"));
router.get("/ai/agent/tasks", authMiddleware, (req, res) => proxy(req, res, "GET"));
router.get("/ai/agent/digest", authMiddleware, (req, res) => proxy(req, res, "GET"));

export default router;
