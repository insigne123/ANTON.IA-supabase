-- Recover the original updated_at trigger migration so a clean reset matches
-- the existing production table contract.

alter table public.enriched_opportunities
  add column if not exists updated_at timestamp with time zone default now();

create or replace function public.update_enriched_opportunities_modtime()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tr_update_enriched_opportunities_modtime
  on public.enriched_opportunities;
create trigger tr_update_enriched_opportunities_modtime
  before update on public.enriched_opportunities
  for each row
  execute function public.update_enriched_opportunities_modtime();
