-- Audit T7 (1 Nov 2026): contacted_leads had nine overlapping access policies, each calling auth.uid() once per row, and the
-- index on mission_id twice. One policy per action now, with auth.uid() read once per query, and the same access as before:
-- a person reads, updates and deletes their own rows, and reads and updates the rows of the organizations they belong to.
-- One gap closes: «Users can insert their own contacted leads» let a person add a row of their own under an organization they
-- do not belong to, which its members would then see. A row is added only into an organization the person belongs to, or
-- with no organization.
drop policy if exists "Users can delete their own contacted leads" on public.contacted_leads;
drop policy if exists "Hybrid Insert: Own or Org Contacted Leads" on public.contacted_leads;
drop policy if exists "Org members can insert contacted leads" on public.contacted_leads;
drop policy if exists "Users can insert their own contacted leads" on public.contacted_leads;
drop policy if exists "Hybrid Access: Own or Org Contacted Leads" on public.contacted_leads;
drop policy if exists "Org members can view contacted leads" on public.contacted_leads;
drop policy if exists "Users can view their own contacted leads" on public.contacted_leads;
drop policy if exists "Org members can update contacted leads" on public.contacted_leads;
drop policy if exists "Users can update their own contacted leads" on public.contacted_leads;

create policy "contacted_leads_select" on public.contacted_leads for select
  using (user_id = (select auth.uid())
    or organization_id in (select m.organization_id from public.organization_members m where m.user_id = (select auth.uid())));

create policy "contacted_leads_insert" on public.contacted_leads for insert
  with check (organization_id in (select m.organization_id from public.organization_members m where m.user_id = (select auth.uid()))
    or (organization_id is null and user_id = (select auth.uid())));

create policy "contacted_leads_update" on public.contacted_leads for update
  using (user_id = (select auth.uid())
    or organization_id in (select m.organization_id from public.organization_members m where m.user_id = (select auth.uid())));

create policy "contacted_leads_delete" on public.contacted_leads for delete
  using (user_id = (select auth.uid()));

drop index if exists public.idx_contacted_leads_mission_id;
