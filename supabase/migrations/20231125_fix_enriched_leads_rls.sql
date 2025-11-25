-- Fix RLS for enriched_leads
alter table public.enriched_leads enable row level security;

drop policy if exists "Users can view their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can insert their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can update their own enriched leads" on public.enriched_leads;
drop policy if exists "Users can delete their own enriched leads" on public.enriched_leads;

create policy "Users can view their own enriched leads" on public.enriched_leads for select using (auth.uid() = user_id);
create policy "Users can insert their own enriched leads" on public.enriched_leads for insert with check (auth.uid() = user_id);
create policy "Users can update their own enriched leads" on public.enriched_leads for update using (auth.uid() = user_id);
create policy "Users can delete their own enriched leads" on public.enriched_leads for delete using (auth.uid() = user_id);

-- Ensure grants
grant all on table public.enriched_leads to authenticated;
grant all on table public.enriched_leads to service_role;
