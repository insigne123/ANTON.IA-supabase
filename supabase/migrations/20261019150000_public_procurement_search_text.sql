-- «Mercado público», faster (1 of 2, 19 oct 2026). The functions folded every tender's name and category, row by row, to
-- compare them with the patterns: on the production database (free plan) «Contratos por vencer» took 18 s and the
-- competitors found by words 10 s, past the 8 s the API allows, so both failed. Folding costs more than comparing, so the
-- folded text is kept once per tender, and the next migration indexes it.
-- Name and category go joined by a line break: the patterns never hold one (likePatterns collapses whitespace), so a
-- pattern matches the joined text exactly when it matches the name or the category, as before. Postgres fills the column
-- on every write, the monthly load included. If public_procurement_fold ever changes, recompute it (update … set name = name).
-- About 21 MB (measured on a local copy with the 48 months, oct 2026). Adding it rewrites the table once: on its own
-- migration, so the database never holds the old copy, the new one and the index at the same time.

set local statement_timeout = '10min';

alter table public.public_procurement_tenders add column if not exists search_text text
  generated always as (public.public_procurement_fold(name) || E'\n' || public.public_procurement_fold(category)) stored;
