-- «Documentos de la empresa»: what tenders ask for again and again (F30, certificate of good standing, financial
-- statements, ISO certificates), kept once per workspace with their expiry. The files live in the private bucket
-- opportunity-documents under company/{organization}/; rows and files are read and written through the server only.
create table public.opportunity_company_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('f30','f30_1','vigencia','poder','estados_financieros','iso','otro')),
  label text not null check (length(label) between 2 and 200),
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null unique check (storage_path like 'company/%'),
  mime text not null,
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  expires_at date,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunity_company_documents_org_idx on public.opportunity_company_documents (organization_id, expires_at);

alter table public.opportunity_company_documents enable row level security;
revoke all on public.opportunity_company_documents from public, anon, authenticated;
grant all on public.opportunity_company_documents to service_role;

notify pgrst, 'reload schema';
