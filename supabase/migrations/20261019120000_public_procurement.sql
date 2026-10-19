-- «Mercado público» (propuestas 9, 10 y 11, 19 oct 2026): who bought what, who bid and who won, from ChileCompra's open
-- data (one file per month, transparenciachc.blob.core.windows.net/lic-da/{año}-{mes}.zip). Public data, read only by the
-- server (service role), kept compact because the database is on the free plan (500 MB):
--   * the last 12 months: every tender and every bid;
--   * months 13 to 24: awarded tenders and their winning bids only, without their evaluation criteria;
--   * months 25 to 48: awarded tenders with contracts of 18 months or more (for «Contratos por vencer»), winners only.
-- scripts/load-public-procurement.mjs loads and ages the months; public_procurement_db_bytes() lets it stop before the
-- database grows too much. The 48 months take about 155 MB (measured on a local copy, oct 2026). Text is searched with
-- LIKE '%…%' over the folded name and category, which no btree helps: there are no indexes for it.

create table if not exists public.public_procurement_agencies (
  id integer primary key,                         -- CodigoOrganismo
  name text not null check (length(name) <= 300),
  name_key text not null,                         -- folded name, to match the buyer of an opportunity
  sector text check (sector is null or length(sector) <= 80),
  updated_at timestamptz not null default now()
);
create index if not exists public_procurement_agencies_name_key_idx on public.public_procurement_agencies (name_key);

create table if not exists public.public_procurement_suppliers (
  id serial primary key,
  rut text not null unique check (rut ~ '^[0-9]{1,9}-[0-9K]$'),
  name text not null check (length(name) <= 300),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_procurement_tenders (
  id bigint primary key,                          -- Codigo
  code text not null check (length(code) <= 40), -- CodigoExterno, e.g. 2429-27-LE26 (the file repeats a few with typos)
  name text not null check (length(name) <= 300),
  agency_id integer references public.public_procurement_agencies(id) on delete set null,
  region text check (region is null or length(region) <= 80),
  kind text check (kind is null or length(kind) <= 4),            -- LE, LP, L1, LR…
  status text not null check (status in ('adjudicada', 'cerrada', 'desierta', 'revocada', 'suspendida', 'publicada', 'otra')),
  currency text check (currency is null or length(currency) <= 4), -- CLP, UF, USD, EUR
  estimated_amount bigint check (estimated_amount is null or estimated_amount >= 0),
  awarded_amount bigint check (awarded_amount is null or awarded_amount >= 0),
  bidders smallint check (bidders is null or bidders >= 0),
  published_on date,
  closes_on date,
  awarded_on date,
  duration_months numeric(5, 1) check (duration_months is null or duration_months >= 0),
  category text check (category is null or length(category) <= 160),
  criteria text check (criteria is null or length(criteria) <= 300), -- names of the evaluation criteria, last 12 months only
  source_month date not null,
  bids_scope text not null default 'all' check (bids_scope in ('all', 'winners')),
  updated_at timestamptz not null default now()
);
create index if not exists public_procurement_tenders_agency_idx on public.public_procurement_tenders (agency_id, published_on desc);
create index if not exists public_procurement_tenders_awarded_idx on public.public_procurement_tenders (awarded_on) where status = 'adjudicada';
create index if not exists public_procurement_tenders_month_idx on public.public_procurement_tenders (source_month);

create table if not exists public.public_procurement_bids (
  tender_id bigint not null references public.public_procurement_tenders(id) on delete cascade,
  supplier_id integer not null references public.public_procurement_suppliers(id) on delete cascade,
  offered_amount bigint check (offered_amount is null or offered_amount >= 0),
  awarded_amount bigint check (awarded_amount is null or awarded_amount >= 0),
  selected boolean not null default false,
  primary key (tender_id, supplier_id)
);
create index if not exists public_procurement_bids_supplier_idx on public.public_procurement_bids (supplier_id);

create table if not exists public.public_procurement_loads (
  source_month date primary key,
  scope text not null check (scope in ('all', 'winners', 'long')),
  tenders integer not null default 0,
  bids integer not null default 0,
  source_modified text,
  loaded_at timestamptz not null default now()
);

-- The competitors a workspace follows (radar).
create table if not exists public.opportunity_competitors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  supplier_id integer not null references public.public_procurement_suppliers(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, supplier_id)
);

-- How big the database is, so the loader stops before the free plan's limit.
create or replace function public.public_procurement_db_bytes()
returns bigint language sql stable security definer set search_path = '' as $$
  select pg_database_size(current_database());
$$;

-- Half the names carry accents and half do not («VERIFICACIÓN», «VERIFICACION»): text is compared folded, lowercase and
-- without accents, and the patterns come folded the same way (src/lib/public-procurement/market.ts, likePatterns).
-- Without «set search_path» (it would keep the planner from inlining it into each row) and with pg_catalog spelled out.
create or replace function public.public_procurement_fold(p_text text)
returns text language sql immutable parallel safe as $$
  select pg_catalog.translate(pg_catalog.lower(coalesce(p_text, '')), 'áàâäãéèêëíìîïóòôöõúùûüñç', 'aaaaaeeeeiiiiooooouuuunc');
$$;

-- «Este organismo» and the market: the tenders whose name or category says one of the patterns, newest first, with their
-- buyer and their bids, in one round trip.
create or replace function public.public_procurement_search(p_patterns text[], p_agency_ids integer[], p_since date, p_limit integer default 300)
returns table (id bigint, code text, name text, status text, kind text, currency text, estimated_amount bigint, awarded_amount bigint, bidders smallint,
  published_on date, awarded_on date, duration_months numeric, category text, criteria text, agency text, bids jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, t.code, t.name, t.status, t.kind, t.currency, t.estimated_amount, t.awarded_amount, t.bidders, t.published_on, t.awarded_on,
    t.duration_months, t.category, t.criteria, a.name,
    coalesce((select jsonb_agg(jsonb_build_object('rut', s.rut, 'name', s.name, 'offered', b.offered_amount, 'awarded', b.awarded_amount, 'selected', b.selected))
      from public.public_procurement_bids b join public.public_procurement_suppliers s on s.id = b.supplier_id where b.tender_id = t.id), '[]'::jsonb)
  from public.public_procurement_tenders t
  left join public.public_procurement_agencies a on a.id = t.agency_id
  where t.published_on >= p_since
    and (p_agency_ids is null or t.agency_id = any(p_agency_ids))
    and (public.public_procurement_fold(t.name) like any(p_patterns) or public.public_procurement_fold(t.category) like any(p_patterns))
  order by t.published_on desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;

-- The radar's search by name, folded: «construcciones perez» finds «CONSTRUCCIONES PÉREZ LTDA».
create or replace function public.public_procurement_find_suppliers(p_pattern text, p_limit integer default 20)
returns table (id integer, rut text, name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.rut, s.name from public.public_procurement_suppliers s
  where public.public_procurement_fold(s.name) like p_pattern
  order by length(s.name), s.name
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

-- «Contratos por vencer»: awarded contracts whose estimated end (awarded_on + duration) falls between two dates, whose
-- name or category says one of the patterns (ILIKE, e.g. '%aseo%'), with who holds them.
create or replace function public.public_procurement_expiring(p_from date, p_to date, p_patterns text[], p_limit integer default 400)
returns table (tender_id bigint, code text, name text, agency text, region text, category text, awarded_on date,
  duration_months numeric, ends_on date, amount bigint, currency text, winner_rut text, winner_name text, winners integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.code, t.name, a.name, t.region, t.category, t.awarded_on, t.duration_months,
    (t.awarded_on + make_interval(months => floor(t.duration_months)::int, days => round((t.duration_months - floor(t.duration_months)) * 30.4375)::int))::date as ends_on,
    coalesce(t.awarded_amount, t.estimated_amount), t.currency,
    (array_agg(s.rut order by b.awarded_amount desc nulls last))[1], (array_agg(s.name order by b.awarded_amount desc nulls last))[1],
    count(s.id)::int
  from public.public_procurement_tenders t
  left join public.public_procurement_agencies a on a.id = t.agency_id
  left join public.public_procurement_bids b on b.tender_id = t.id and b.selected
  left join public.public_procurement_suppliers s on s.id = b.supplier_id
  where t.status = 'adjudicada' and t.duration_months >= 6 and t.awarded_on is not null
    and t.awarded_on >= p_from - interval '61 months' and t.awarded_on <= p_to
    and (t.awarded_on + make_interval(months => floor(t.duration_months)::int, days => round((t.duration_months - floor(t.duration_months)) * 30.4375)::int))::date between p_from and p_to
    and (public.public_procurement_fold(t.name) like any(p_patterns) or public.public_procurement_fold(t.category) like any(p_patterns))
  group by t.id, a.name
  order by ends_on
  limit greatest(1, least(coalesce(p_limit, 400), 1000));
$$;

-- The radar: who bids in the same tenders as one supplier, and how often each one won them.
create or replace function public.public_procurement_cobidders(p_supplier integer, p_since date, p_limit integer default 12)
returns table (supplier_id integer, rut text, name text, shared integer, their_wins integer)
language sql stable security definer set search_path = '' as $$
  select other.supplier_id, s.rut, s.name, count(*)::int, count(*) filter (where other.selected)::int
  from public.public_procurement_bids mine
  join public.public_procurement_tenders t on t.id = mine.tender_id and t.published_on >= p_since and t.bids_scope = 'all'
  join public.public_procurement_bids other on other.tender_id = mine.tender_id and other.supplier_id <> mine.supplier_id
  join public.public_procurement_suppliers s on s.id = other.supplier_id
  where mine.supplier_id = p_supplier
  group by other.supplier_id, s.rut, s.name
  order by count(*) desc, count(*) filter (where other.selected) desc
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

-- The radar without the company's own RUT: who wins most in the tenders whose name or category says the patterns.
create or replace function public.public_procurement_top_winners(p_patterns text[], p_since date, p_limit integer default 12)
returns table (supplier_id integer, rut text, name text, wins integer, bids integer, awarded bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.rut, s.name, count(*) filter (where b.selected)::int, count(*)::int, coalesce(sum(b.awarded_amount) filter (where b.selected), 0)::bigint
  from public.public_procurement_tenders t
  join public.public_procurement_bids b on b.tender_id = t.id
  join public.public_procurement_suppliers s on s.id = b.supplier_id
  where t.published_on >= p_since and (public.public_procurement_fold(t.name) like any(p_patterns) or public.public_procurement_fold(t.category) like any(p_patterns))
  group by s.id, s.rut, s.name
  having count(*) filter (where b.selected) > 0
  order by count(*) filter (where b.selected) desc, sum(b.awarded_amount) filter (where b.selected) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

do $$
declare t text;
begin
  foreach t in array array['public_procurement_agencies', 'public_procurement_suppliers', 'public_procurement_tenders',
    'public_procurement_bids', 'public_procurement_loads', 'opportunity_competitors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.public_procurement_suppliers_id_seq from public, anon, authenticated;
grant usage, select on sequence public.public_procurement_suppliers_id_seq to service_role;
revoke all on function public.public_procurement_db_bytes() from public, anon, authenticated;
grant execute on function public.public_procurement_db_bytes() to service_role;
revoke all on function public.public_procurement_fold(text) from public, anon, authenticated;
grant execute on function public.public_procurement_fold(text) to service_role;
revoke all on function public.public_procurement_search(text[], integer[], date, integer) from public, anon, authenticated;
grant execute on function public.public_procurement_search(text[], integer[], date, integer) to service_role;
revoke all on function public.public_procurement_find_suppliers(text, integer) from public, anon, authenticated;
grant execute on function public.public_procurement_find_suppliers(text, integer) to service_role;
revoke all on function public.public_procurement_expiring(date, date, text[], integer) from public, anon, authenticated;
grant execute on function public.public_procurement_expiring(date, date, text[], integer) to service_role;
revoke all on function public.public_procurement_cobidders(integer, date, integer) from public, anon, authenticated;
grant execute on function public.public_procurement_cobidders(integer, date, integer) to service_role;
revoke all on function public.public_procurement_top_winners(text[], date, integer) from public, anon, authenticated;
grant execute on function public.public_procurement_top_winners(text[], date, integer) to service_role;

-- Two more kinds of opportunity work: «winplan» («Cómo ganar» of one tender) and «contracts» («Contratos por vencer»).
alter table public.opportunity_jobs drop constraint if exists opportunity_jobs_kind_check;
alter table public.opportunity_jobs add constraint opportunity_jobs_kind_check
  check (kind in ('criteria','tenders','hiring','posts','evaluate','research','chat','offer','demand','assistant','profile','fit','winplan','contracts'));

notify pgrst, 'reload schema';
