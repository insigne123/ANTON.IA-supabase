-- «Contacto del día» by company (16 Nov 2026, docs/contacto-del-dia.md). Until now the finder searched people by role and forgot
-- everything from one day to the next. It now also keeps the companies of each customer (src/lib/server/lead-drop-accounts.ts):
--   customer_key  which customer of the organization the company was found and scored for (a hash of its roles, industries,
--                 places and sizes): a team with two different customers scores the same company apart;
--   domain        the company, by its site;
--   score, reason how much it would need what the team sells, 0 to 10, and why in one sentence, by the finder's model;
--   origin        «customer»: found in the customer's own industries; «expansion»: in an industry next to them, named in segment;
--   people_left   people worth offering it still had the last time it was opened; 0 means it ran out and rests for a month;
--   opened_at     the last time its people were brought.
--
-- The server alone reads and writes it (service_role), as the plans of the drops: row security is on with no policy. Forward-only
-- and inert on its own: without rows the finder searches as before and fills the table as it goes.
create table if not exists public.lead_drop_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_key text not null,
  domain text not null,
  name text not null default '',
  industry text,
  size integer,
  score smallint,
  reason text,
  origin text not null default 'customer',
  segment text,
  people_left integer,
  opened_at timestamptz,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_key, domain),
  constraint lead_drop_accounts_score_check check (score is null or score between 0 and 10),
  constraint lead_drop_accounts_origin_check check (origin in ('customer', 'expansion'))
);

alter table public.lead_drop_accounts enable row level security;
revoke all on table public.lead_drop_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.lead_drop_accounts to service_role;

comment on table public.lead_drop_accounts is
  'The companies the «Contacto del día» finder keeps for each customer of an organization: their score, and whether they still have people to offer. Server only.';
comment on column public.lead_drop_accounts.customer_key is
  'A hash of the customer (roles, industries, places, sizes) the company was found and scored for.';
comment on column public.lead_drop_accounts.people_left is
  'People worth offering the company still had the last time it was opened. 0: it ran out and rests for a month.';
