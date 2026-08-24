-- Native research can finish with limited evidence without leaving the run queued.
alter table public.research_run_items
  drop constraint if exists research_run_items_status_check;

alter table public.research_run_items
  add constraint research_run_items_status_check check (
    status in ('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled')
  );

notify pgrst, 'reload schema';
