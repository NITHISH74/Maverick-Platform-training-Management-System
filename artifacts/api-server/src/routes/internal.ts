/**
 * Internal-only routes — authenticated by a shared secret header rather
 * than a user Bearer token. The Python AI service calls these.
 *
 *   POST /internal/email/send         Used by SendAINotificationTool
 *   POST /internal/monitoring/scan    Used by the Python scheduler if it wants
 *                                     to delegate the actual rule run to Node.
 *
 * Security: every route requires the `x-internal-token` header to match
 * the INTERNAL_SHARED_SECRET env var. This is the same secret model used
 * by routes/ai.ts when Node calls *into* Python; here we reverse the
 * direction.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sendMonitoringEmail } from "../lib/email";
import { runMonitoringScan } from "../lib/monitoring-engine";

const router: IRouter = Router();

const INTERNAL_TOKEN = process.env.AI_INTERNAL_TOKEN ?? process.env.INTERNAL_SHARED_SECRET ?? "smoke-test-secret-1234567890";

function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.header("x-internal-token");
  if (!token || token !== INTERNAL_TOKEN) {
    res.status(401).json({ error: "invalid internal token" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /internal/email/send
//
// Body shape (matches what services/ai/app/crew/tools.py:SendAINotificationTool sends):
//   {
//     "to": "trainer@example.com",
//     "subject": "...",
//     "body": "...",
//     "alert_id": 42,           // optional
//     "recipient_role": "trainer",
//     "recipient_id": 7,
//     // OR alternatively a structured payload that we'll render server-side:
//     "type": "low_attendance_pct",
//     "context": { ... }
//   }
//
// We accept either pre-rendered (subject+body) OR a kind+context that
// we'd render — the simpler pre-rendered path is what the Python tool
// uses now.
// ---------------------------------------------------------------------------
// Path is /email/send — mounted at /internal in app.ts, full URL becomes
// POST /internal/email/send. (Avoids the double-prefix bug.)
router.post("/email/send", internalAuth, async (req: Request, res: Response): Promise<void> => {
  const b = req.body ?? {};
  if (!b.to || !b.subject || !b.body) {
    res.status(400).json({ error: "to, subject, body are required" });
    return;
  }
  const result = await sendMonitoringEmail({
    to: String(b.to),
    subject: String(b.subject),
    body: String(b.body),
    alertId: b.alert_id ?? b.alertId ?? null,
    recipientId: b.recipient_id ?? b.recipientId ?? null,
    recipientRole: b.recipient_role ?? b.recipientRole ?? null,
  });
  res.json(result);
});

// ---------------------------------------------------------------------------
// POST /internal/monitoring/scan — invoke the rule engine directly.
// This is what the AI-side fallback path can call when CrewAI is unavailable.
// ---------------------------------------------------------------------------
// POST /internal/monitoring/scan — full URL after the /internal mount.
router.post("/monitoring/scan", internalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await runMonitoringScan({
      runId: req.body?.run_id,
      triggeredBy: req.body?.triggered_by ?? "ai-service",
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "scan failed", detail: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
