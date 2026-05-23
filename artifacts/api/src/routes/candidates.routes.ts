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

const CandidateSchema = z.object({
  employee_id: z.string(),
  full_name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  batch_id: z.number().int().optional(),
  status: z.string().default('active'),
});

r.get('/', async (req, res, next) => {
  try {
    const batchId = req.query.batch_id;
    let q = supabase.from('candidates').select('*');
    if (batchId) q = q.eq('batch_id', batchId as string);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data });
  } catch (e) { next(e); }
});

r.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('candidates').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
});

r.post('/', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const parsed = CandidateSchema.parse(req.body);
    const { data, error } = await supabase.from('candidates').insert({ ...parsed, modified_by: req.user!.id }).select().single();
    if (error) throw error;
    await audit(req.user, 'create', 'candidate', data.id);
    res.status(201).json(data);
  } catch (e) { next(e); }
});

r.post('/upload', requireRole('admin', 'coordinator'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const batchId = Number(req.body.batch_id);
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);

    const valid: any[] = []; const errors: any[] = [];
    for (const [i, raw] of rows.entries()) {
      const p = CandidateSchema.safeParse({ ...raw, batch_id: batchId });
      if (!p.success) { errors.push({ row: i + 2, issue: p.error.message }); continue; }
      valid.push({ ...p.data, modified_by: req.user!.id });
    }
    const CHUNK = 500;
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { error } = await supabase.from('candidates').upsert(valid.slice(i, i + CHUNK), { onConflict: 'employee_id' });
      if (error) throw error;
    }
    await audit(req.user, 'bulk_upload', 'candidate', batchId, `Uploaded ${valid.length} candidates`);
    res.json({ inserted: valid.length, errors });
  } catch (e) { next(e); }
});

export default r;
