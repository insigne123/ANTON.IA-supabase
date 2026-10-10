-- Metadata only. Usage/report reads never call a provider or expose message bodies.
create table public.admin_usage_capture (
  singleton boolean primary key default true check(singleton),
  activity_from timestamptz not null default now(), credit_from timestamptz not null default now(), commercial_from timestamptz not null default now()
);
insert into public.admin_usage_capture(singleton) values(true);
create table public.app_usage_views (
  event_id uuid primary key, session_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, group_id uuid,
  module text not null check(module in ('home','search','contacts','research','email','campaigns','linkedin','crm','cowork','opportunities','settings','help','admin')),
  occurred_at timestamptz not null default clock_timestamp()
);
create index app_usage_views_scope_day on public.app_usage_views(organization_id,occurred_at,user_id);
create table public.admin_credit_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, group_id uuid,
  quota_day date not null, resource text not null check(resource in ('search','enrich','investigate')),
  delta integer not null check(delta<>0), mode text not null check(mode in ('user','team','hybrid','legacy')),
  occurred_at timestamptz not null default clock_timestamp()
);
create index admin_credit_movements_scope_day on public.admin_credit_movements(organization_id,quota_day,user_id);
create table public.admin_commercial_facts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, group_id uuid,
  source text not null, source_id text not null check(length(source_id) between 1 and 300),
  entity_key text not null, thread_key text, kind text not null, module text not null default 'email',
  intent text, status text not null, occurred_at timestamptz not null,
  unique(organization_id,source,source_id,kind,occurred_at)
);
create index admin_commercial_facts_scope_day on public.admin_commercial_facts(organization_id,occurred_at,user_id);
create index admin_commercial_facts_recipient on public.admin_commercial_facts(organization_id,entity_key,occurred_at);
alter table public.admin_usage_capture enable row level security;
alter table public.app_usage_views enable row level security;
alter table public.admin_credit_movements enable row level security;
alter table public.admin_commercial_facts enable row level security;
revoke all on public.admin_usage_capture,public.app_usage_views,public.admin_credit_movements,public.admin_commercial_facts from public,anon,authenticated;
grant select on public.admin_usage_capture,public.app_usage_views,public.admin_credit_movements,public.admin_commercial_facts to service_role;

create function public.admin_usage_time(p_value text) returns timestamptz language plpgsql stable set search_path='' as $$
begin
  if coalesce(p_value,'') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-9.]+(Z|[+-]\d{2}:\d{2})$' then return null; end if;
  return nullif(p_value,'')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end; $$;
revoke all on function public.admin_usage_time(text) from public,anon,authenticated;

create function public.admin_usage_member_names_v1(p_orgs uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(cardinality(p_orgs),0)>1000 then raise exception 'too many organizations' using errcode='22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',left(coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',split_part(email,'@',1)),160))),'[]'::jsonb)
    from auth.users u where exists(select 1 from public.organization_members m where m.user_id=u.id and m.organization_id=any(p_orgs)));
end; $$;
revoke all on function public.admin_usage_member_names_v1(uuid[]) from public,anon,authenticated;
grant execute on function public.admin_usage_member_names_v1(uuid[]) to service_role;

create function public.admin_usage_group(p_org uuid,p_user uuid) returns uuid language sql stable security definer set search_path='' as $$
  select group_id from public.organization_reporting_group_members
  where organization_id=p_org and user_id=p_user and is_primary and unassigned_at is null limit 1
$$;
create function public.admin_record_usage_view_v1(p_event uuid,p_session uuid,p_org uuid,p_user uuid,p_module text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user) then
    raise exception 'membership required' using errcode='42501'; end if;
  if p_module not in ('home','search','contacts','research','email','campaigns','linkedin','crm','cowork','opportunities','settings','help','admin') or p_event is null or p_session is null then
    raise exception 'invalid usage view' using errcode='22023'; end if;
  if exists(select 1 from public.app_usage_views where event_id=p_event and (organization_id<>p_org or user_id is distinct from p_user or module<>p_module or session_id<>p_session)) then
    raise exception 'idempotency conflict' using errcode='22023'; end if;
  if not exists(select 1 from public.app_usage_views where event_id=p_event) and
    (select count(*) from public.app_usage_views where organization_id=p_org and user_id=p_user and occurred_at>clock_timestamp()-interval '1 minute')>=60 then
    return false;
  end if;
  insert into public.app_usage_views(event_id,session_id,organization_id,user_id,group_id,module)
    values(p_event,p_session,p_org,p_user,public.admin_usage_group(p_org,p_user),p_module) on conflict(event_id) do nothing;
  return true;
end; $$;
create function public.admin_record_credit_movement(p_org uuid,p_user uuid,p_day date,p_resource text,p_delta integer,p_mode text,p_group uuid)
returns void language plpgsql security definer set search_path='' as $$
declare group_ref uuid:=p_group;
begin
  if group_ref is null and p_org is not null then
    if p_delta>0 then group_ref:=public.admin_usage_group(p_org,p_user);
    else
      -- A refund belongs to the original team. If there is ambiguity, retain
      -- company/person attribution without inventing a historical team.
      select case when count(distinct group_id)=1 then (array_agg(distinct group_id))[1] end into group_ref
      from public.admin_credit_movements where organization_id=p_org and user_id=p_user and quota_day=p_day and resource=p_resource and delta>0;
    end if;
  end if;
  insert into public.admin_credit_movements(organization_id,user_id,group_id,quota_day,resource,delta,mode)
  values(p_org,p_user,group_ref,p_day,p_resource,p_delta,p_mode);
end; $$;
revoke all on function public.admin_usage_group(uuid,uuid),public.admin_record_usage_view_v1(uuid,uuid,uuid,uuid,text),
  public.admin_record_credit_movement(uuid,uuid,date,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_record_usage_view_v1(uuid,uuid,uuid,uuid,text) to service_role;
