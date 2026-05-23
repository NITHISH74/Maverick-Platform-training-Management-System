import { supabase } from '../config/supabase';
import type { AuthUser } from '../middleware/auth';

export async function audit(actor: AuthUser | undefined, action: string, entityType: string, entityId: string | number, description?: string, metadata?: object) {
  await supabase.from('audit_log').insert({
    actor_id: actor?.id ?? null,
    actor_name: actor?.full_name ?? 'system',
    action, entity_type: entityType, entity_id: String(entityId),
    description, metadata,
  });
}
