import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser);

const Schema = z.object({
  batch_id: z.number().int(),
  candidate_id: z.number().int().optional(),
  trainer_id: z.number().int().optional(),
  response_text: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
});

r.get('/', async (req, res, next) => {
  try {
    const { batch_id } = req.query;
    let q = supabase.from('feedback').select('*').order('created_at', { ascending: false });
    if (batch_id) q = q.eq('batch_id', batch_id as string);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.post('/', async (req, res, next) => {
  try {
    const parsed = Schema.parse(req.body);
    const { data, error } = await supabase.from('feedback').insert(parsed).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.get('/analysis/:batch_id', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('feedback_analysis')
      .select('*')
      .eq('batch_id', req.params.batch_id)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
