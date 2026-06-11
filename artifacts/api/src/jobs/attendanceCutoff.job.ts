import { supabase } from '../config/supabase';
import { sendNotification } from '../services/email.service';
import { logger } from '../utils/logger';

export async function runAttendanceCutoff() {
  const today = new Date().toISOString().slice(0, 10);

  const { data: batches, error } = await supabase
    .from('batches')
    .select('id, batch_code, name, coordinator_id, users:coordinator_id(email, full_name)')
    .eq('status', 'running');
  if (error) { logger.error({ error }, 'cut-off query failed'); return; }

  for (const b of batches ?? []) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', b.id)
      .eq('attend_date', today);

    if ((count ?? 0) === 0) {
      const u: any = (b as any).users;
      if (!u?.email) continue;
      await sendNotification({
        type: 'attendance_missing',
        to: u.email,
        recipientName: u.full_name,
        context: { batch_code: b.batch_code, batch_name: b.name, date: today },
        urgencyLevel: 2,
        relatedBatch: b.id,
      });
    }
  }
  logger.info({ count: batches?.length }, 'attendance cut-off complete');
}
