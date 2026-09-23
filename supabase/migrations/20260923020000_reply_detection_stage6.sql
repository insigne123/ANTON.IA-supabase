-- Stage 6 (detección y seguimiento de respuestas): cursor durable del barrido
-- por buzón, procedencia verificable en compromisos y vista por cuenta.
-- Forward-only, sin backfill: el barrido declara su ventana real y nunca
-- afirma cobertura total sin haberla completado.

-- 6.3 Cursor durable del barrido de historial por buzón. page_token guarda el
-- pageToken de Gmail o el nextLink de Graph (ambos generados por el servidor,
-- nunca entrada del cliente). Una ventana solo se declara completa cuando se
-- agota la paginación dentro de window_days.
create table if not exists public.cowork_mailbox_sweep_state (
  organization_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('gmail', 'outlook')),
  window_days integer not null default 30 check (window_days between 1 and 90),
  page_token text,
  window_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, provider)
);
alter table public.cowork_mailbox_sweep_state enable row level security;
revoke all on table public.cowork_mailbox_sweep_state from public, anon, authenticated;
grant all on table public.cowork_mailbox_sweep_state to service_role;

-- 6.5 Vista por cuenta: todos los hilos de una misma empresa normalizada.
create index if not exists contacted_leads_org_company_idx
  on public.contacted_leads (organization_id, lower(company));

-- 6.6 La procedencia del compromiso es opcional y la fija el servidor al
-- crearlo desde una respuesta observada; el cliente no puede inventarla.
-- origin: { replyEventKey, threadKey, derivedAt, derivedBy }.
create or replace function public.update_contacted_work(p_org uuid,p_user uuid,p_contact text,p_kind text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contacted_leads; v jsonb; due timestamptz; origin jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select * into c from public.contacted_leads where id=p_contact and organization_id=p_org and user_id=p_user for update;
  if not found then raise exception 'contact unavailable' using errcode='42501'; end if;
  if p_kind='commitment' then
    if jsonb_typeof(p_value)<>'object' or coalesce(p_value->>'kind','') not in ('call','meeting','reminder')
      or length(trim(coalesce(p_value->>'title',''))) not between 1 and 300 then raise exception 'invalid commitment'; end if;
    due := (p_value->>'dueAt')::timestamptz;
    if due is null or due<now() then raise exception 'choose a future date'; end if;
    origin := p_value->'origin';
    if origin is not null then
      if jsonb_typeof(origin)<>'object'
        or length(coalesce(origin->>'replyEventKey','')) not between 1 and 200
        or length(coalesce(origin->>'threadKey','')) not between 1 and 500
        or (origin->>'derivedAt')::timestamptz is null
        or length(coalesce(origin->>'derivedBy','')) not between 1 and 100 then raise exception 'invalid commitment origin'; end if;
      origin := jsonb_build_object('replyEventKey',origin->>'replyEventKey','threadKey',origin->>'threadKey',
        'derivedAt',(origin->>'derivedAt')::timestamptz,'derivedBy',origin->>'derivedBy');
    end if;
    v := jsonb_build_object('id',gen_random_uuid(),'kind',p_value->>'kind','title',trim(p_value->>'title'),'dueAt',due,'ownerId',p_user,'completedAt',null,'updatedAt',now(),'origin',origin);
  elsif p_kind='complete' then
    v := c.data->'commitment';
    if v is null or v->>'id' is distinct from p_value->>'id' then raise exception 'commitment changed'; end if;
    v := v || jsonb_build_object('completedAt',now(),'updatedAt',now());
    p_kind := 'commitment';
  elsif p_kind='advice' then
    if coalesce(p_value->>'replyId','') <> coalesce(c.reply_message_id,'') or c.replied_at is null then raise exception 'reply changed'; end if;
    v := p_value;
  elsif p_kind='replyDraft' then
    if length(coalesce(p_value->>'body',''))>12000 then raise exception 'reply too long'; end if;
    v := p_value;
  else raise exception 'invalid action'; end if;
  update public.contacted_leads set data=coalesce(data,'{}'::jsonb)||jsonb_build_object(p_kind,v) where id=p_contact;
  return v;
end; $$;
revoke all on function public.update_contacted_work(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.update_contacted_work(uuid,uuid,text,text,jsonb) to service_role;
