-- Two new kinds of opportunity work, run by the same worker and budget as the report:
--   offer:  the AI's draft of the technical and economic offer of a purchase with bases (opportunity_offer_drafts);
--   demand: what public bodies plan to buy that fits the workspace's offer, read from ChileCompra's Plan Anual de Compras
--           (opportunity_purchase_plan).
alter table public.opportunity_jobs drop constraint if exists opportunity_jobs_kind_check;
alter table public.opportunity_jobs add constraint opportunity_jobs_kind_check
  check (kind in ('criteria','tenders','hiring','posts','evaluate','research','chat','offer','demand'));

notify pgrst, 'reload schema';
