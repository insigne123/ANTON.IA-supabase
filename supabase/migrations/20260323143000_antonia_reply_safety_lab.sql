do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'antonia_config'
  ) then
    alter table public.antonia_config
      add column if not exists reply_autopilot_enabled boolean not null default false,
      add column if not exists reply_autopilot_mode text not null default 'draft_only',
      add column if not exists reply_approval_mode text not null default 'high_risk_only',
      add column if not exists reply_max_auto_turns integer not null default 2,
      add column if not exists auto_send_booking_replies boolean not null default false,
      add column if not exists allow_reply_attachments boolean not null default false;

    alter table public.antonia_config
      drop constraint if exists antonia_config_reply_autopilot_mode_check,
      add constraint antonia_config_reply_autopilot_mode_check
        check (reply_autopilot_mode in ('draft_only', 'shadow_mode', 'auto_safe', 'full_auto'));

    alter table public.antonia_config
      drop constraint if exists antonia_config_reply_approval_mode_check,
      add constraint antonia_config_reply_approval_mode_check
        check (reply_approval_mode in ('all_replies', 'high_risk_only', 'disabled'));

    alter table public.antonia_config
      drop constraint if exists antonia_config_reply_max_auto_turns_check,
      add constraint antonia_config_reply_max_auto_turns_check
        check (reply_max_auto_turns between 1 and 10);
  end if;
end $$;

create table if not exists public.antonia_reply_lab_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  mode text not null default 'policy',
  config_snapshot jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists antonia_reply_lab_runs_org_created_idx
  on public.antonia_reply_lab_runs(organization_id, created_at desc);

alter table public.antonia_reply_lab_runs enable row level security;

drop policy if exists "Org members can view reply lab runs" on public.antonia_reply_lab_runs;
create policy "Org members can view reply lab runs"
  on public.antonia_reply_lab_runs
  for select
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = antonia_reply_lab_runs.organization_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists "Org members can insert reply lab runs" on public.antonia_reply_lab_runs;
create policy "Org members can insert reply lab runs"
  on public.antonia_reply_lab_runs
  for insert
  with check (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = antonia_reply_lab_runs.organization_id
        and om.user_id = auth.uid()
    )
  );

notify pgrst, 'reload config';
