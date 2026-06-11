import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser);

r.get('/config/:batch_id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('topper_config').select('*').eq('batch_id', req.params.batch_id).maybeSingle();
    if (error) throw error;
    res.json(data ?? { attendance_weight: 20, sprint_weight: 25, api_weight: 25, project_weight: 30 });
  } catch (e) { next(e); }
});

r.put('/config/:batch_id', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const Schema = z.object({
      attendance_weight: z.number(), sprint_weight: z.number(),
      api_weight: z.number(), project_weight: z.number(),
    });
    const w = Schema.parse(req.body);
    if (w.attendance_weight + w.sprint_weight + w.api_weight + w.project_weight !== 100)
      return res.status(400).json({ error: 'weights must sum to 100' });
    const { data, error } = await supabase.from('topper_config').upsert({
      batch_id: Number(req.params.batch_id), ...w, modified_by: req.user!.id,
    }, { onConflict: 'batch_id' }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

r.get('/batch/:batch_id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('compute_toppers', { b_id: Number(req.params.batch_id) });
    if (error) return res.json([]);
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
