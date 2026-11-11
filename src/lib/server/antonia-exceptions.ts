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

  const insert = (values: typeof row) => supabase.from('antonia_exceptions').insert(values).select('*').single();
  // antonia_exceptions.lead_id references public.leads, and a contact of «Por escribir» (enriched_leads) carries its own id.
  // The exception is what tells the team that someone answered, so it is kept without the link (the id stays in the payload)
  // instead of being lost: 4 positive replies had no exception on 11 Nov 2026, the day their replies started being recorded.
  const withoutLead = { ...row, lead_id: null, payload: { ...row.payload, leadRef: row.lead_id } };
  // Asked first, so the usual case is one clean insert: a refused one stays in the database log as an error, once per reply.
  let saved = true;
  if (row.lead_id) {
    const lead = await supabase.from('leads').select('id').eq('id', row.lead_id).maybeSingle();
    saved = Boolean(lead.error) || Boolean(lead.data);
  }
  let { data, error } = await insert(saved ? row : withoutLead);
  // The lead was deleted between the two, or could not be looked up: the same answer, one try later.
  if (saved && String((error as any)?.code || '') === '23503' && row.lead_id) {
    ({ data, error } = await insert(withoutLead));
  }

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
