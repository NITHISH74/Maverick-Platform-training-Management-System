import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { runAgentTrigger } from '../jobs/agentTrigger.job';
import { sendNotification } from '../services/email.service';

const r = Router();

function checkInternal(req: any, res: any, next: any) {
  if (req.header('x-internal-token') !== env.INTERNAL_SHARED_SECRET)
    return res.status(401).end();
  next();
}

r.use(checkInternal);

r.post('/agent/run', async (_req, res) => {
  await runAgentTrigger();
  res.json({ ok: true });
});

// Allows the FastAPI CrewAI agent to dispatch emails through the AI-generated pipeline
r.post('/email/send', async (req, res, next) => {
  try {
    const Schema = z.object({
      type: z.string(),
      to: z.string().email(),
      recipientName: z.string(),
      context: z.record(z.any()).default({}),
      urgencyLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
      cc: z.array(z.string().email()).optional(),
      relatedBatch: z.number().optional(),
      relatedCandidate: z.number().optional(),
    });
    await sendNotification(Schema.parse(req.body));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
