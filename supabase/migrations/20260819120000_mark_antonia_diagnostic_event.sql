-- Preserve the known diagnostic search batch as a distinct, non-production signal.

alter table public.antonia_event_ledger
  drop constraint if exists antonia_event_ledger_confidence_check;

alter table public.antonia_event_ledger
  add constraint antonia_event_ledger_confidence_check
  check (source_confidence in ('observed', 'derived', 'backfill', 'unknown_actor', 'diagnostic_test'));

select set_config('app.antonia_event_ledger_redaction', 'on', true);

update public.antonia_event_ledger
set source_confidence = 'diagnostic_test'
where source_system = 'people_search_leads'
  and entity_type = 'search_batch'
  and entity_id = 'e4056d69-3a91-450a-b208-caa1b33b51dc';
