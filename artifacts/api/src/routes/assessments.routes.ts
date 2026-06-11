import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser);

const Schema = z.object({
  candidate_id: z.number().int(),
  batch_id: z.number().int(),
  assessment_type: z.enum(['sprint', 'api', 'project']),
  title: z.string(),
  score: z.number(),
  max_score: z.number().default(100),
  scheduled_date: z.string(),
  uploaded_date: z.string().optional(),
});

r.get('/', async (req, res, next) => {
  try {
    const { batch_id, assessment_type, candidate_id } = req.query;
    let q = supabase.from('assessments').select('*');
    if (batch_id) q = q.eq('batch_id', batch_id as string);
    if (assessment_type) q = q.eq('assessment_type', assessment_type as string);
    if (candidate_id) q = q.eq('candidate_id', candidate_id as string);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.post('/', requireRole('admin', 'coordinator', 'trainer'), async (req, res, next) => {
  try {
    const parsed = Schema.parse(req.body);
    const { data, error } = await supabase.from('assessments').insert({
      ...parsed, uploaded_by: req.user!.id, uploaded_date: parsed.uploaded_date ?? new Date().toISOString().slice(0, 10),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.patch('/:id', requireRole('admin', 'coordinator', 'trainer'), async (req, res, next) => {
  try {
    const parsed = Schema.partial().parse(req.body);
    const { data, error } = await supabase.from('assessments').update(parsed).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
