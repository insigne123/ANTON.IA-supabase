type CrmAutopilotUpdate = {
  organizationId: string;
  leadId?: string | null;
  stage?: string | null;
  notes?: string | null;
  nextAction?: string | null;
  nextActionType?: string | null;
  nextActionDueAt?: string | null;
  autopilotStatus?: string | null;
  lastAutopilotEvent?: string | null;
  meetingLink?: string | null;
};

function compact<T>(items: Array<T | null | undefined>): T[] {
  return items.filter(Boolean) as T[];
}

export async function syncLeadAutopilotToCrm(supabase: any, update: CrmAutopilotUpdate) {
  const leadId = String(update.leadId || '').trim();
  if (!leadId) return;

  const gids = compact([
    `lead_saved|${leadId}`,
    `lead_enriched|${leadId}`,
  ]);

  const payload = {
    organization_id: update.organizationId,
    updated_at: new Date().toISOString(),
  } as Record<string, any>;

  if (update.stage !== undefined) payload.stage = update.stage;
  if (update.notes !== undefined) payload.notes = update.notes;
  if (update.nextAction !== undefined) payload.next_action = update.nextAction;
  if (update.nextActionType !== undefined) payload.next_action_type = update.nextActionType;
  if (update.nextActionDueAt !== undefined) payload.next_action_due_at = update.nextActionDueAt;
  if (update.autopilotStatus !== undefined) payload.autopilot_status = update.autopilotStatus;
  if (update.lastAutopilotEvent !== undefined) payload.last_autopilot_event = update.lastAutopilotEvent;
  if (update.meetingLink !== undefined) payload.meeting_link = update.meetingLink;

  await Promise.all(gids.map(async (gid) => {
    const { error } = await supabase
      .from('unified_crm_data')
      .upsert({ id: gid, ...payload });
    if (error) {
      console.error('[crm-autopilot] failed to upsert', gid, error);
    }
  }));
}
