-- Personal rows must remain unscoped. Organization rows must always belong to
-- an organization the caller is currently a member of.
drop policy if exists "Users can insert their own or org enriched opportunities"
  on public.enriched_opportunities;
create policy "Users can insert their own or org enriched opportunities"
  on public.enriched_opportunities
  for insert
  to authenticated
  with check (
    (
      organization_id is null
      and user_id = auth.uid()
    )
    or (
      organization_id is not null
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id = enriched_opportunities.organization_id
          and member.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can update their own or org enriched opportunities"
  on public.enriched_opportunities;
create policy "Users can update their own or org enriched opportunities"
  on public.enriched_opportunities
  for update
  to authenticated
  using (
    (
      organization_id is null
      and user_id = auth.uid()
    )
    or (
      organization_id is not null
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id = enriched_opportunities.organization_id
          and member.user_id = auth.uid()
      )
    )
  )
  with check (
    (
      organization_id is null
      and user_id = auth.uid()
    )
    or (
      organization_id is not null
      and exists (
        select 1
        from public.organization_members member
        where member.organization_id = enriched_opportunities.organization_id
          and member.user_id = auth.uid()
      )
    )
  );

-- This SECURITY DEFINER function has no tenant argument and cannot safely be
-- called with an end-user token. Runtime callers use the service role.
revoke all on function public.increment_contacted_count(text)
  from public, anon, authenticated;
grant execute on function public.increment_contacted_count(text)
  to service_role;

notify pgrst, 'reload schema';
