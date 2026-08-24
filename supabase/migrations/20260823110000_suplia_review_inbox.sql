-- Durable, organization-scoped manual review items for SUPL.IA.

create table if not exists public.suplia_review_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type text not null,
  messaging_draft_id uuid references public.messaging_drafts(id) on delete cascade,
  antonia_report_id uuid references public.antonia_reports(id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  sender_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  summary text not null,
  status text not null default 'pending',
  severity text not null default 'normal',
  metadata jsonb not null default '{}'::jsonb,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suplia_review_items_type_check
    check (item_type in ('outbound_email', 'antonia_report')),
  constraint suplia_review_items_status_check
    check (status in ('pending', 'approved', 'dismissed', 'resolved')),
  constraint suplia_review_items_severity_check
    check (severity in ('normal', 'attention', 'critical')),
  constraint suplia_review_items_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint suplia_review_items_source_cardinality_check
    check (
      (item_type = 'outbound_email' and messaging_draft_id is not null and antonia_report_id is null)
      or (item_type = 'antonia_report' and antonia_report_id is not null and messaging_draft_id is null)
    )
);

create unique index if not exists suplia_review_items_messaging_draft_uidx
  on public.suplia_review_items(messaging_draft_id)
  where messaging_draft_id is not null;

create unique index if not exists suplia_review_items_antonia_report_uidx
  on public.suplia_review_items(antonia_report_id)
  where antonia_report_id is not null;

create index if not exists suplia_review_items_org_status_created_idx
  on public.suplia_review_items(organization_id, status, created_at desc);

create or replace function public.set_suplia_review_items_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suplia_review_items_set_updated_at on public.suplia_review_items;
create trigger suplia_review_items_set_updated_at
  before update on public.suplia_review_items
  for each row execute function public.set_suplia_review_items_updated_at();

alter table public.suplia_review_items enable row level security;

revoke all on table public.suplia_review_items from public, anon, authenticated;
grant select on table public.suplia_review_items to authenticated;
grant all on table public.suplia_review_items to service_role;

drop policy if exists "Organization members can read suplia review items" on public.suplia_review_items;
create policy "Organization members can read suplia review items"
  on public.suplia_review_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = suplia_review_items.organization_id
        and om.user_id = (select auth.uid())
    )
    and (
      (
        suplia_review_items.item_type = 'outbound_email'
        and suplia_review_items.sender_user_id = (select auth.uid())
      )
      or suplia_review_items.item_type = 'antonia_report'
    )
  );

drop policy if exists "Service role can manage suplia review items" on public.suplia_review_items;
create policy "Service role can manage suplia review items"
  on public.suplia_review_items
  for all to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
