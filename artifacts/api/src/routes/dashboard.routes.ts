import { Router } from 'express';
import { checkJwt, attachUser } from '../middleware/auth';
import { supabase } from '../config/supabase';

const r = Router();
r.use(checkJwt, attachUser);

r.get('/summary', async (_req, res, next) => {
  try {
    const [cands, batches, alerts] = await Promise.all([
      supabase.from('candidates').select('id,status', { count: 'exact' }),
      supabase.from('batches').select('id,status', { count: 'exact' }),
      supabase.from('agent_tasks').select('id', { count: 'exact' }).eq('status', 'open'),
    ]);
    const candidates = cands.data ?? [];
    const batchesRows = batches.data ?? [];

    res.json({
      totalCandidates: candidates.length,
      activeCandidates: candidates.filter(c => c.status === 'active').length,
      clearedCandidates: candidates.filter(c => c.status === 'cleared').length,
      offeredCandidates: candidates.filter(c => c.status === 'offered').length,
      onboardedCandidates: candidates.filter(c => c.status === 'onboarded').length,
      discontinuedCandidates: candidates.filter(c => c.status === 'discontinued').length,
      totalBatches: batchesRows.length,
      runningBatches: batchesRows.filter(b => b.status === 'running').length,
      avgAttendancePercent: 0,
      activeAlerts: alerts.count ?? 0,
    });
  } catch (e) { next(e); }
});

r.get('/activity', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('audit_log').select('*').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    res.json((data ?? []).map(a => ({
      id: a.id, description: a.description ?? `${a.action} ${a.entity_type}`,
      createdAt: a.created_at, actorName: a.actor_name,
    })));
  } catch (e) { next(e); }
});

r.get('/candidate-status', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('candidates').select('status');
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const c of data ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1;
    res.json(Object.entries(counts).map(([status, count]) => ({ status, count })));
  } catch (e) { next(e); }
});

r.get('/attendance-trends', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('attendance_trend_days', { lookback: 14 });
    if (error) {
      // graceful — if RPC missing, return empty
      return res.json([]);
    }
    res.json(data);
  } catch (e) { next(e); }
});

export default r;
