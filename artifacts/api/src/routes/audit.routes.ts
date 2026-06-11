import { Router } from 'express';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser, requireRole('admin', 'coordinator'));

r.get('/', async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.query;
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (entity_type) q = q.eq('entity_type', entity_type as string);
    if (entity_id) q = q.eq('entity_id', entity_id as string);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

export default r;
