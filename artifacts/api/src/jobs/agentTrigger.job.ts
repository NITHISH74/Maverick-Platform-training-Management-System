import axios from 'axios';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export async function runAgentTrigger() {
  const run_id = randomUUID();
  try {
    const r = await axios.post(
      `${env.AI_SERVICE_URL}/ai/agent/run`,
      { run_id, triggered_by: 'cron' },
      { headers: { 'x-internal-token': env.INTERNAL_SHARED_SECRET }, timeout: 90_000 }
    );
    logger.info({ run_id, ...r.data }, 'agent run complete');
    return r.data;
  } catch (e: any) {
    logger.error({ run_id, err: e.message }, 'agent trigger failed');
    throw e;
  }
}
