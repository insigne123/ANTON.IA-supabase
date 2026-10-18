-- One more kind of opportunity work: «fit», the requirements of a report read against the company's tender profile
-- (opportunity_requirement_fit). It belongs to one opportunity, so whoever can read it may ask for it.
alter table public.opportunity_jobs drop constraint if exists opportunity_jobs_kind_check;
alter table public.opportunity_jobs add constraint opportunity_jobs_kind_check
  check (kind in ('criteria','tenders','hiring','posts','evaluate','research','chat','offer','demand','assistant','profile','fit'));

notify pgrst, 'reload schema';
