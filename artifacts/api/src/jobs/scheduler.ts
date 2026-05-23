import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runAttendanceCutoff } from './attendanceCutoff.job';
import { runAgentTrigger } from './agentTrigger.job';

export function registerJobs() {
  // 10:00 AM IST — attendance cut-off
  cron.schedule('0 10 * * *', () => {
    runAttendanceCutoff().catch(e => logger.error({ err: e }, 'attendance cut-off failed'));
  }, { timezone: env.TZ });

  // Every 30 minutes — Batch Monitoring Agent (in addition to Azure Functions in prod)
  if (env.NODE_ENV !== 'production') {
    cron.schedule('*/30 * * * *', () => {
      runAgentTrigger().catch(e => logger.error({ err: e }, 'agent trigger failed'));
    }, { timezone: env.TZ });
  }

  logger.info('cron jobs registered');
}
