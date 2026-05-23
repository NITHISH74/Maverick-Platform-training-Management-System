import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { supabase } from '../config/supabase';
import { audit } from '../services/audit.service';

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });
const r = Router();
r.use(checkJwt, attachUser);

const RowSchema = z.object({
  employee_id: z.string(),
  attend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['present', 'absent', 'leave', 'holiday']),
});

r.get('/', async (req, res, next) => {
  try {
    const { batch_id, attend_date } = req.query;
    let q = supabase.from('attendance').select('*');
    if (batch_id) q = q.eq('batch_id', batch_id as string);
    if (attend_date) q = q.eq('attend_date', attend_date as string);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.post('/', requireRole('admin', 'coordinator', 'trainer'), async (req, res, next) => {
  try {
    const Schema = z.object({
      candidate_id: z.number().int(),
      batch_id: z.number().int(),
      attend_date: z.string(),
      status: z.enum(['present', 'absent', 'leave', 'holiday']),
    });
    const parsed = Schema.parse(req.body);
    const { data, error } = await supabase.from('attendance').upsert(
      { ...parsed, marked_by: req.user!.id, source: 'manual' },
      { onConflict: 'candidate_id,attend_date' }
    ).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.post('/upload', requireRole('admin', 'coordinator', 'trainer'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const batchId = Number(req.body.batch_id);
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);

    const { data: cands } = await supabase.from('candidates').select('id,employee_id').eq('batch_id', batchId);
    const candMap = new Map<string, number>((cands ?? []).map(c => [c.employee_id, c.id]));

    const valid: any[] = []; const errors: any[] = [];
    for (const [i, raw] of rows.entries()) {
      const p = RowSchema.safeParse(raw);
      if (!p.success) { errors.push({ row: i + 2, issue: p.error.message }); continue; }
      const candId = candMap.get(p.data.employee_id);
      if (!candId) { errors.push({ row: i + 2, issue: 'Unknown employee_id' }); continue; }
      valid.push({
        candidate_id: candId, batch_id: batchId,
        attend_date: p.data.attend_date, status: p.data.status,
        marked_by: req.user!.id, source: 'excel',
      });
    }
    const CHUNK = 1000;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { error } = await supabase.from('attendance').upsert(valid.slice(i, i + CHUNK), { onConflict: 'candidate_id,attend_date' });
      if (error) throw error;
    }
    await audit(req.user, 'bulk_upload', 'attendance', batchId, `Uploaded ${valid.length} attendance rows`);
    res.json({ inserted: valid.length, errors });
  } catch (e) { next(e); }
});

export default r;
