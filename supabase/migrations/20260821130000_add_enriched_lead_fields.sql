-- Keep the browser-facing enriched_leads contract aligned with the
-- consolidated Apollo enrichment response.
alter table public.enriched_leads
  add column if not exists phone_numbers jsonb,
  add column if not exists primary_phone text,
  add column if not exists enrichment_status text default 'completed';
