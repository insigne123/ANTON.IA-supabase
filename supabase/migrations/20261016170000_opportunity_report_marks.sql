-- What the team marks on an opportunity's report: an item done, highlighted or with a note. One row per item of the
-- report (a requirement, a task, a date, a risk, a question, a step of the route), kept across new versions of the
-- report because the key comes from the item's own text. Read and written only through the server, like the tasks.
create table public.opportunity_report_marks (
  organization_id uuid not null,
  opportunity_id uuid not null,
  item_key text not null check (item_key ~ '^[a-z]{2,12}:[a-f0-9]{16}$'),
  done boolean not null default false,
  highlight boolean not null default false,
  note text not null default '' check (length(note) <= 2000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (opportunity_id, item_key),
  foreign key (organization_id, opportunity_id) references public.commercial_opportunities(organization_id, id) on delete cascade
);
create index opportunity_report_marks_org_idx on public.opportunity_report_marks (organization_id, opportunity_id);

alter table public.opportunity_report_marks enable row level security;
revoke all on public.opportunity_report_marks from public, anon, authenticated;
grant all on public.opportunity_report_marks to service_role;

notify pgrst, 'reload schema';
