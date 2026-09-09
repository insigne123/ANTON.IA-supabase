-- Patch the deployed revision RPC forward-only. A new draft's provenance trigger
-- must see the replacement audience BEFORE create_messaging_draft_v1 runs.
-- Both writes remain inside the same transaction and the same campaign lock.
do $migration$
declare
  v_source text;
  v_anchor text := '  for v_item in select value from jsonb_array_elements(p_drafts) loop';
begin
  select pg_get_functiondef('public.revise_bulk_campaign_pending_v1(uuid,uuid,uuid,integer,text,text,jsonb,jsonb,jsonb)'::regprocedure)
    into v_source;
  if position(v_anchor in v_source) = 0 then
    raise exception 'BULK_REVISION_FUNCTION_DRIFT';
  end if;
  v_source := replace(v_source, v_anchor,
    '  update public.bulk_campaigns set recipients = p_recipients, status = ''draft'', approved_at = null where id = p_id;
' || v_anchor);
  execute v_source;
end;
$migration$;

-- Partial batches keep sent/in-flight messages frozen even after re-entering
-- draft review. The general save endpoint must not replace those identities.
create function public.guard_bulk_campaign_frozen_messages_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_person jsonb;
  v_message jsonb;
  v_replacement jsonb;
  v_index bigint;
begin
  if old.recipients is not distinct from new.recipients then return new; end if;
  for v_person in select value from jsonb_array_elements(old.recipients) loop
    for v_message, v_index in select value, ordinality from jsonb_array_elements(v_person->'messages') with ordinality loop
      if exists(select 1 from public.outbound_dispatches where draft_id = (v_message->>'draftId')::uuid
          and status in ('sent','pending','sending','unknown','failed'))
        or exists(select 1 from public.bulk_campaign_attempts where draft_id = (v_message->>'draftId')::uuid and state = 'sent') then
        select r->'messages'->((v_index - 1)::integer) into v_replacement
          from jsonb_array_elements(new.recipients) r where r->>'email' = v_person->>'email';
        if v_replacement is distinct from v_message then
          raise exception 'INVALID_REVISE_LOCKED' using errcode = '23514';
        end if;
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_bulk_campaign_frozen_messages_v1() from public, anon, authenticated;
create trigger bulk_campaign_frozen_messages before update of recipients on public.bulk_campaigns
  for each row execute function public.guard_bulk_campaign_frozen_messages_v1();
