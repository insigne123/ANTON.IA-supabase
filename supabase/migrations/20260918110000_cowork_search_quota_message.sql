-- Fase 1 (CW-06): la cuota diaria agotada merece su propio mensaje.
-- El worker informa p_payload.reason = 'quota_exhausted'; el resto conserva
-- el mensaje generico de resultado incierto sin reintento automatico.
create or replace function public.cowork_finish_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_success boolean,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  update public.cowork_search_proposals set status=case when p_success then 'completed' else 'failed' end where run_id=r.id and status='executing';
  if not found then return false; end if;
  -- Retain cancellation; in-flight provider results must not revive the run.
  if r.status<>'waiting_approval' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_success then
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload) values(r.id,r.user_id,r.organization_id,'tool.completed',p_payload);
  end if;
  update public.cowork_runs set status=case when p_success then 'completed' else 'failed' end,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,case when p_success then 'run.completed' else 'run.failed' end,
      case when p_success then jsonb_build_object('reply','Búsqueda terminada. Revisa los contactos encontrados; todavía no se han guardado en tu base.','document',null)
        when coalesce(p_payload->>'reason','')='quota_exhausted'
        then '{"message":"Se alcanzó el cupo diario de búsquedas externas. Se renueva mañana; mientras tanto puedes trabajar con tus contactos guardados o revisar borradores. No se consumió una búsqueda adicional."}'::jsonb
        else '{"message":"No pudimos confirmar el resultado de la búsqueda. No se reintentará automáticamente."}'::jsonb end);
  return true;
end; $$;
revoke all on function public.cowork_finish_search(uuid,uuid,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_finish_search(uuid,uuid,uuid,boolean,jsonb) to service_role;
