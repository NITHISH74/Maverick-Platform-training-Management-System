import { Router } from 'express';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser);

r.get('/me', (req, res) => res.json(req.user));

r.get('/', requireRole('admin'), async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const Schema = z.object({
      auth0_sub: z.string(),
      email: z.string().email(),
      full_name: z.string(),
      role: z.enum(['admin', 'coordinator', 'trainer']),
    });
    const parsed = Schema.parse(req.body);
    const { data, error } = await supabase.from('users').insert({ ...parsed, modified_by: req.user!.id }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const Schema = z.object({
      role: z.enum(['admin', 'coordinator', 'trainer']).optional(),
      is_active: z.boolean().optional(),
      full_name: z.string().optional(),
    });
    const parsed = Schema.parse(req.body);
    const { data, error } = await supabase.from('users').update({ ...parsed, modified_by: req.user!.id }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
