-- Operational state is separate from the immutable audience/content review.
create table public.bulk_campaign_attempts (
  draft_id uuid primary key references public.messaging_drafts(id) on delete cascade,
  campaign_id uuid not null references public.bulk_campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null check (state in ('retry_wait','attention','sent')),
  code text not null,
  message text not null,
  retry_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  check ((state = 'retry_wait') = (retry_at is not null))
);
create index bulk_campaign_attempts_campaign_idx on public.bulk_campaign_attempts(campaign_id);
alter table public.bulk_campaign_attempts enable row level security;
create policy bulk_campaign_attempts_owner_read on public.bulk_campaign_attempts for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_campaign_attempts.organization_id and om.user_id = auth.uid()
  ));
revoke all on public.bulk_campaign_attempts from anon, authenticated;
grant select on public.bulk_campaign_attempts to authenticated;
grant all on public.bulk_campaign_attempts to service_role;

create function public.record_bulk_campaign_attempt_v1(
  p_campaign_id uuid, p_draft_id uuid, p_state text, p_code text, p_message text, p_retry_at timestamptz
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.bulk_campaigns%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_campaign from public.bulk_campaigns where id = p_campaign_id for key share;
  -- Retention may have removed the batch while the provider was responding.
  if not found then return; end if;
  if not exists(select 1 from public.messaging_drafts where id = p_draft_id and bulk_campaign_id = p_campaign_id
    and organization_id = v_campaign.organization_id and user_id = v_campaign.user_id) then
    raise exception 'BULK_CAMPAIGN_ATTEMPT_SCOPE_MISMATCH';
  end if;
  insert into public.bulk_campaign_attempts(draft_id,campaign_id,organization_id,user_id,state,code,message,retry_at)
    values(p_draft_id,p_campaign_id,v_campaign.organization_id,v_campaign.user_id,p_state,left(p_code,120),left(p_message,1000),p_retry_at)
    on conflict(draft_id) do update set
      attempt_count = bulk_campaign_attempts.attempt_count + 1,
      state = case when excluded.state = 'retry_wait' and bulk_campaign_attempts.attempt_count >= 4 then 'attention' else excluded.state end,
      code = excluded.code,
      message = case when excluded.state = 'retry_wait' and bulk_campaign_attempts.attempt_count >= 4
        then 'No se pudo continuar tras varios intentos. Revisa la conexión y el estado del contacto.' else excluded.message end,
      retry_at = case when excluded.state = 'retry_wait' and bulk_campaign_attempts.attempt_count >= 4 then null else excluded.retry_at end,
      updated_at = now()
    -- A slow failed contender must never overwrite a confirmed success.
    where bulk_campaign_attempts.state <> 'sent';
end;
$$;
revoke all on function public.record_bulk_campaign_attempt_v1(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_bulk_campaign_attempt_v1(uuid,uuid,text,text,text,timestamptz) to service_role;

create function public.retry_bulk_campaign_attempt_v1(p_campaign_id uuid, p_draft_id uuid, p_user_id uuid, p_organization_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id
  ) then raise exception 'not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-campaign:' || p_campaign_id::text,0));
  if not exists(select 1 from public.bulk_campaigns where id=p_campaign_id and organization_id=p_organization_id
    and user_id=p_user_id and status='approved') then raise exception 'BULK_CAMPAIGN_NOT_APPROVED'; end if;
  if exists(select 1 from public.outbound_dispatches where draft_id=p_draft_id and status <> 'deferred') then
    raise exception 'BULK_CAMPAIGN_DELIVERY_NOT_RETRYABLE';
  end if;
  -- Only transient checks may be retried. A recipient block or changed review requires a new review.
  delete from public.bulk_campaign_attempts where campaign_id=p_campaign_id and draft_id=p_draft_id
    and organization_id=p_organization_id and user_id=p_user_id and state <> 'sent'
    and code not in ('BULK_CAMPAIGN_CONTACT_BLOCKED','BULK_CAMPAIGN_ALREADY_CONTACTED','BULK_CAMPAIGN_REVIEW_CHANGED','BULK_CAMPAIGN_NOT_FOUND','recipient_suppressed');
  if not found then raise exception 'BULK_CAMPAIGN_DELIVERY_NOT_RETRYABLE'; end if;
end;
$$;
revoke all on function public.retry_bulk_campaign_attempt_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retry_bulk_campaign_attempt_v1(uuid,uuid,uuid,uuid) to service_role;
