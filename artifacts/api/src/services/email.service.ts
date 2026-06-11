import { EmailClient } from '@azure/communication-email';
import { env } from '../config/env';
import { aiClient } from './ai.client';
import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';

const client = env.ACS_CONNECTION_STRING ? new EmailClient(env.ACS_CONNECTION_STRING) : null;

export interface SendArgs {
  type: string;
  to: string;
  recipientName: string;
  context: Record<string, unknown>;
  urgencyLevel?: 1 | 2 | 3;
  cc?: string[];
  relatedBatch?: number;
  relatedCandidate?: number;
}

function fallbackTemplate(a: SendArgs): { subject: string; body: string } {
  const map: Record<string, () => { subject: string; body: string }> = {
    attendance_missing: () => ({
      subject: 'Attendance pending',
      body: `Hi ${a.recipientName}, attendance has not been uploaded for ${a.context.batch_code ?? 'your batch'}. Please update before the cut-off. — Maverick TMS`,
    }),
    absence_3_days: () => ({
      subject: 'Repeated absence — action required',
      body: `Hi ${a.recipientName}, candidate ${a.context.candidate_name ?? ''} has been absent for 3 consecutive days. — Maverick TMS`,
    }),
    assessment_reminder: () => ({
      subject: 'Assessment upload due',
      body: `Hi ${a.recipientName}, please upload the ${a.context.assessment_title ?? 'pending'} assessment scores. — Maverick TMS`,
    }),
    feedback_request: () => ({
      subject: 'Your feedback matters',
      body: `Hi ${a.recipientName}, please share your feedback for the recent training session. — Maverick TMS`,
    }),
    upload_success: () => ({
      subject: 'Upload received',
      body: `Hi ${a.recipientName}, your upload for ${a.context.batch_code ?? 'the batch'} was processed successfully. — Maverick TMS`,
    }),
    agent_escalation: () => ({
      subject: 'Escalation: batch needs attention',
      body: `Hi ${a.recipientName}, the monitoring agent has flagged ${a.context.batch_code ?? 'a batch'} for ${a.context.reason ?? 'attention'}. — Maverick TMS`,
    }),
  };
  return map[a.type]?.() ?? { subject: 'Maverick notification', body: 'Please log in to check your dashboard.' };
}

export async function sendNotification(args: SendArgs) {
  let subject: string, body: string, aiGenerated = true;
  try {
    const r = await aiClient.post('/ai/notifications/generate', {
      type: args.type,
      recipient_name: args.recipientName,
      context: args.context,
      urgency_level: args.urgencyLevel ?? 1,
    }, { timeout: 8000 });
    subject = r.data.subject; body = r.data.body;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'AI notif fallback');
    aiGenerated = false;
    ({ subject, body } = fallbackTemplate(args));
  }

  const { data: log } = await supabase.from('notifications_log').insert({
    recipient_email: args.to,
    notif_type: args.type,
    subject, body,
    urgency_level: args.urgencyLevel ?? 1,
    ai_generated: aiGenerated,
    related_batch: args.relatedBatch,
    related_candidate: args.relatedCandidate,
  }).select().single();

  if (!client) {
    logger.warn('ACS not configured — email skipped (logged only)');
    return;
  }

  try {
    const poller = await client.beginSend({
      senderAddress: env.ACS_SENDER,
      recipients: { to: [{ address: args.to }], cc: args.cc?.map(a => ({ address: a })) },
      content: { subject, plainText: body },
    });
    await poller.pollUntilDone();
    await supabase.from('notifications_log').update({
      status: 'sent', sent_at: new Date().toISOString(),
    }).eq('id', log!.id);
  } catch (err: any) {
    await supabase.from('notifications_log').update({
      status: 'failed', error_message: err.message,
    }).eq('id', log!.id);
    throw err;
  }
}
