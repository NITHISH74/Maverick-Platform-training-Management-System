import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';
import { audit } from '../services/audit.service';

const r = Router();
r.use(checkJwt, attachUser);

const BatchSchema = z.object({
  batch_code: z.string().min(1),
  name: z.string().min(1),
  program: z.string().min(1),
  start_date: z.string(),
  end_date: z.string(),
  status: z.enum(['planned', 'running', 'completed', 'closed']).default('planned'),
  capacity: z.number().int().positive().default(30),
  coordinator_id: z.number().int().optional(),
  attendance_cutoff_time: z.string().default('10:00'),
});

r.get('/', async (req, res, next) => {
  try {
    let q = supabase.from('batches').select('*').order('created_at', { ascending: false });
    if (req.user!.role === 'coordinator') q = q.eq('coordinator_id', req.user!.id);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('batches').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).end();
    res.json(data);
  } catch (e) { next(e); }
});

r.post('/', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const parsed = BatchSchema.parse(req.body);
    const { data, error } = await supabase.from('batches').insert({ ...parsed, modified_by: req.user!.id }).select().single();
    if (error) throw error;
    await audit(req.user, 'create', 'batch', data.id, `Created batch ${data.batch_code}`);
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.patch('/:id', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const parsed = BatchSchema.partial().parse(req.body);
    const { data, error } = await supabase.from('batches').update({ ...parsed, modified_by: req.user!.id }).eq('id', req.params.id).select().single();
    if (error) throw error;
    await audit(req.user, 'update', 'batch', req.params.id, 'Updated batch');
    res.json(data);
  } catch (e) { next(e); }
});

r.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { error } = await supabase.from('batches').delete().eq('id', req.params.id);
    if (error) throw error;
    await audit(req.user, 'delete', 'batch', req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
});

r.post('/:id/trainers', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const { trainer_id } = z.object({ trainer_id: z.number().int() }).parse(req.body);
    const { data, error } = await supabase.from('batch_trainers').insert({ batch_id: Number(req.params.id), trainer_id }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});

export default r;
