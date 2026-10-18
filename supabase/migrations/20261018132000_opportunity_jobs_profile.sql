-- One more kind of opportunity work: «profile», the AI's suggestions for the company's tender profile
-- (opportunity_tender_profile), read from «Perfil», the website and the workspace offer. Admins ask for it.
alter table public.opportunity_jobs drop constraint if exists opportunity_jobs_kind_check;
alter table public.opportunity_jobs add constraint opportunity_jobs_kind_check
  check (kind in ('criteria','tenders','hiring','posts','evaluate','research','chat','offer','demand','assistant','profile'));

notify pgrst, 'reload schema';
