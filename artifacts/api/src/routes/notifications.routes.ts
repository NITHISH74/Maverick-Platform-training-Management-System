import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';
import { sendNotification } from '../services/email.service';

const r = Router();
r.use(checkJwt, attachUser);

r.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('notifications_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.post('/send', requireRole('admin', 'coordinator'), async (req, res, next) => {
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
    const args = Schema.parse(req.body);
    await sendNotification(args);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
