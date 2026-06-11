import { Router } from 'express';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser, requireRole('admin', 'coordinator'));

r.get('/batch/:batch_id/attendance', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('attendance').select('*').eq('batch_id', req.params.batch_id);
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

r.get('/batch/:batch_id/assessments', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('assessments').select('*').eq('batch_id', req.params.batch_id);
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
