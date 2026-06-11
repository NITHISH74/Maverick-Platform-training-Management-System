import { Router } from 'express';
import { checkJwt, attachUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { aiClient } from '../services/ai.client';

const r = Router();
r.use(checkJwt, attachUser);

r.post('/feedback/analyze', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try { const out = await aiClient.post('/ai/feedback/analyze', req.body); res.json(out.data); }
  catch (e) { next(e); }
});

r.post('/chatbot/query', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const out = await aiClient.post('/ai/chatbot/query', { ...req.body, coordinator_id: req.user!.id });
    res.json(out.data);
  } catch (e) { next(e); }
});

r.post('/agent/run', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const out = await aiClient.post('/ai/agent/run', {
      run_id: crypto.randomUUID(), triggered_by: 'manual', coordinator_id: req.user!.id,
    });
    res.json(out.data);
  } catch (e) { next(e); }
});

r.get('/agent/tasks', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const status = req.query.status ?? 'open';
    const out = await aiClient.get(`/ai/agent/tasks`, { params: { coordinator_id: req.user!.id, status } });
    res.json(out.data);
  } catch (e) { next(e); }
});

r.patch('/agent/tasks/:id', requireRole('admin', 'coordinator'), async (req, res, next) => {
  try {
    const out = await aiClient.patch(`/ai/agent/tasks/${req.params.id}`, req.body);
    res.json(out.data);
  } catch (e) { next(e); }
});

r.get('/agent/digest', async (req, res, next) => {
  try {
    const out = await aiClient.get(`/ai/agent/digest`, { params: req.query });
    res.json(out.data);
  } catch (e) { next(e); }
});

export default r;
