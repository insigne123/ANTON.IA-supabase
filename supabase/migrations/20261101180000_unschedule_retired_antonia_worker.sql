-- The mission agent and its Cloud Function antoniaWorker were retired on 2026-10-01 (docs/retiro-agente-antonia.md),
-- but the pg_cron job «antonia-worker» kept calling that function every 5 minutes: 288 synchronous HTTP calls a day that
-- did nothing and held a database connection while they waited. Only the job goes; trigger_antonia_worker() stays so
-- nothing that still references it breaks.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'antonia-worker') then
    perform cron.unschedule('antonia-worker');
  end if;
end;
$$;
