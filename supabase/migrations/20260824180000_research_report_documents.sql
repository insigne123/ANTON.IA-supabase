-- One validated report document per immutable canonical research snapshot.

create table if not exists public.research_report_documents (
  id uuid primary key default gen_random_uuid(),
  research_snapshot_id uuid not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,
  generation_method text not null,
  provider text not null,
  model text,
  prompt_version text not null,
  schema_version text not null,
  document jsonb not null,
  content_hash text not null,
  retryable boolean not null default false,
  error_code text,
  error_message text,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint research_report_documents_snapshot_scope_fk
    foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete cascade,
  constraint research_report_documents_status_check
    check (status in ('completed', 'partial')),
  constraint research_report_documents_generation_check
    check (generation_method in ('model', 'fallback')),
  constraint research_report_documents_provider_check
    check (provider = 'openai'),
  constraint research_report_documents_prompt_check
    check (length(trim(prompt_version)) between 1 and 160),
  constraint research_report_documents_schema_check
    check (schema_version = 'research-report-document/v1'),
  constraint research_report_documents_document_check
    check (jsonb_typeof(document) = 'object'),
  constraint research_report_documents_hash_check
    check (content_hash ~ '^[a-f0-9]{64}$'),
  unique (id, organization_id, user_id)
);

create index if not exists research_report_documents_scope_generated_idx
  on public.research_report_documents(organization_id, user_id, generated_at desc);

alter table public.research_report_documents enable row level security;

revoke all on table public.research_report_documents from public, anon, authenticated;
grant select on table public.research_report_documents to authenticated;
grant all on table public.research_report_documents to service_role;

create policy "Users can view scoped research report documents"
  on public.research_report_documents for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select om.organization_id
      from public.organization_members om
      where om.user_id = (select auth.uid())
    )
  );

notify pgrst, 'reload schema';
