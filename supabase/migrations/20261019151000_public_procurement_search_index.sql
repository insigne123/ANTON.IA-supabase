-- «Mercado público», faster (2 of 2, 19 oct 2026): a trigram index over search_text (the folded name and category) lets
-- LIKE '%…%' find the tenders that say the words first, and the three functions compare that column instead of folding
-- every row. «Contratos por vencer» also gets an index on the date a contract ends, so Postgres only rereads the contracts
-- that both say the words and end in the window. Measured on a local copy with the 48 months and 12 words (25): «Contratos
-- por vencer» from 3.6 s to 0.2 s (0.35 s), the competitors found by words from 1.2 s to 0.25 s (0.55 s), the market search
-- from 1.2 s to 0.1 s. The indexes take about 36 MB and 1 MB. The tenders are written only by the monthly load, so
-- building them without CONCURRENTLY blocks nobody.

set local statement_timeout = '10min';
set local maintenance_work_mem = '64MB';

create extension if not exists pg_trgm with schema extensions;

create index if not exists public_procurement_tenders_search_trgm_idx on public.public_procurement_tenders
  using gin (search_text extensions.gin_trgm_ops);
-- The same expression as public_procurement_expiring's ends_on, over the contracts it can return.
create index if not exists public_procurement_tenders_ends_idx on public.public_procurement_tenders
  (((awarded_on + make_interval(months => floor(duration_months)::int, days => round((duration_months - floor(duration_months)) * 30.4375)::int))::date))
  where status = 'adjudicada' and duration_months >= 6 and awarded_on is not null;

-- The same signatures (create or replace keeps their grants).
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
    and t.search_text like any(p_patterns)
  order by t.published_on desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;

-- Without the bounds on awarded_on it had: they let the planner, which plans these functions without knowing the dates,
-- walk every awarded tender by date instead of using the indexes. They added nothing: the history keeps 48 months, and a
-- contract of 6 months or more that ends by p_to was awarded before it.
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
  where t.search_text like any(p_patterns)
    and t.status = 'adjudicada' and t.duration_months >= 6 and t.awarded_on is not null
    and (t.awarded_on + make_interval(months => floor(t.duration_months)::int, days => round((t.duration_months - floor(t.duration_months)) * 30.4375)::int))::date between p_from and p_to
  group by t.id, a.name
  order by ends_on
  limit greatest(1, least(coalesce(p_limit, 400), 1000));
$$;

-- Counts by supplier first and looks up the names of the few it returns, not of every bid.
create or replace function public.public_procurement_top_winners(p_patterns text[], p_since date, p_limit integer default 12)
returns table (supplier_id integer, rut text, name text, wins integer, bids integer, awarded bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.rut, s.name, w.wins, w.bids, coalesce(w.awarded, 0)::bigint
  from (
    select b.supplier_id, count(*) filter (where b.selected)::int as wins, count(*)::int as bids, sum(b.awarded_amount) filter (where b.selected) as awarded
    from public.public_procurement_tenders t
    join public.public_procurement_bids b on b.tender_id = t.id
    where t.published_on >= p_since and t.search_text like any(p_patterns)
    group by b.supplier_id
    having count(*) filter (where b.selected) > 0
    order by 2 desc, 4 desc nulls last
    limit greatest(1, least(coalesce(p_limit, 12), 50))
  ) w
  join public.public_procurement_suppliers s on s.id = w.supplier_id
  order by w.wins desc, w.awarded desc nulls last;
$$;

analyze public.public_procurement_tenders;

notify pgrst, 'reload schema';
