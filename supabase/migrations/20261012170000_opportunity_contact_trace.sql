alter table public.opportunity_contact_links add column contact_table text not null default 'leads' check(contact_table in ('leads','enriched_leads'));
alter table public.opportunity_contact_links add column source_provider text;
alter table public.opportunity_contact_links add column source_provider_id text;
create table public.opportunity_search_observations (
 organization_id uuid not null, opportunity_id uuid not null, user_id uuid not null references auth.users(id),
 provider_id text not null check(length(provider_id) between 1 and 200), provider text not null,
 observed_at timestamptz not null default now(), primary key(opportunity_id,user_id,provider,provider_id),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
alter table public.opportunity_search_observations enable row level security;
revoke all on public.opportunity_search_observations from public,anon,authenticated;
grant all on public.opportunity_search_observations to service_role;
notify pgrst,'reload schema';
