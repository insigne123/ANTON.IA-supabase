export type AntoniaExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AntoniaExceptionStatus = 'open' | 'approved' | 'resolved' | 'dismissed';

type CreateAntoniaExceptionInput = {
  organizationId: string;
  missionId?: string | null;
  taskId?: string | null;
  leadId?: string | null;
  category: string;
  severity?: AntoniaExceptionSeverity;
  status?: AntoniaExceptionStatus;
  title: string;
  description?: string;
  dedupeKey?: string | null;
  payload?: Record<string, any>;
};

export async function createAntoniaException(supabase: any, input: CreateAntoniaExceptionInput) {
  const row = {
    organization_id: input.organizationId,
    mission_id: input.missionId || null,
    task_id: input.taskId || null,
    lead_id: input.leadId || null,
    category: input.category,
    severity: input.severity || 'medium',
    status: input.status || 'open',
    title: input.title,
    description: input.description || null,
    dedupe_key: input.dedupeKey || null,
    payload: input.payload || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('antonia_exceptions')
    .insert(row)
    .select('*')
    .single();

  if (!error) return { ...data, __meta: { created: true } };

  if (String((error as any)?.code || '') === '23505' && row.dedupe_key) {
    const { data: existing } = await supabase
      .from('antonia_exceptions')
      .select('*')
      .eq('dedupe_key', row.dedupe_key)
      .eq('status', 'open')
      .maybeSingle();
    return existing ? { ...existing, __meta: { created: false } } : null;
  }

  console.error('[AntoniaException] create failed:', error);
  return null;
}
