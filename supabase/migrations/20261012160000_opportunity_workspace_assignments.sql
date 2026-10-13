-- Opportunity management is additive. Legacy data and the shared CRM are preserved.
alter table public.commercial_opportunities drop constraint commercial_opportunities_kind_check;
alter table public.commercial_opportunities add constraint commercial_opportunities_kind_check
  check (kind in ('hiring','tender','compra_agil','project','private','linkedin_post'));
create unique index commercial_opportunities_tenant_id_idx on public.commercial_opportunities(organization_id,id);

create table public.opportunity_work (
  organization_id uuid not null references public.organizations(id),
  opportunity_id uuid primary key,
  revision bigint not null default 0 check (revision >= 0),
  state text not null default 'unassigned' check (state in ('unassigned','assigned','working','blocked','submitted','won','lost','archived')),
  team_id uuid references public.organization_reporting_groups(id),
  responsible_id uuid references auth.users(id),
  assigned_by uuid references auth.users(id),
  objective text not null default '' check (length(objective)<=2000),
  due_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create table public.opportunity_participants (
  organization_id uuid not null, opportunity_id uuid not null, user_id uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(), primary key(opportunity_id,user_id),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create index opportunity_participants_user_idx on public.opportunity_participants(organization_id,user_id,opportunity_id);
create table public.opportunity_activity (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
  actor_id uuid references auth.users(id), kind text not null check(length(kind) between 1 and 60),
  body text not null check(length(body)<=8000), data jsonb not null default '{}' check(pg_column_size(data)<=16384),
  event_key text, created_at timestamptz not null default now(),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade,
  unique(organization_id,event_key)
);
create table public.opportunity_notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
  user_id uuid not null references auth.users(id), title text not null check(length(title)<=500),
  assignment_revision bigint, kind text not null default 'assignment' check(kind in ('assignment','report','task')), event_key text,
  read_at timestamptz, created_at timestamptz not null default now(),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade,
  unique(opportunity_id,user_id,assignment_revision), unique(organization_id,user_id,event_key)
);
create table public.opportunity_tasks (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
  title text not null check(length(title) between 2 and 500), owner_id uuid references auth.users(id), due_at timestamptz,
  status text not null default 'pending' check(status in ('pending','working','done','blocked')),
  evidence text not null default '' check(length(evidence)<=4000), created_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create table public.opportunity_contact_links (
  organization_id uuid not null, opportunity_id uuid not null, contact_id text not null check(length(contact_id) between 1 and 200),
  linked_by uuid references auth.users(id), created_at timestamptz not null default now(), primary key(opportunity_id,contact_id),
  foreign key (organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);

create function public.opportunity_can_read(p_org uuid,p_user uuid,p_opportunity uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=p_user
    and (m.role in ('admin','owner') or exists(select 1 from public.opportunity_participants p
      where p.organization_id=p_org and p.opportunity_id=p_opportunity and p.user_id=p_user)))
    and exists(select 1 from public.commercial_opportunities o where o.organization_id=p_org and o.id=p_opportunity);
$$;

create function public.opportunity_assign(p_org uuid,p_actor uuid,p_id uuid,p_revision bigint,p_team uuid,
  p_users uuid[],p_responsible uuid,p_objective text,p_due timestamptz) returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision bigint; v_title text;
begin
  if not public.is_organization_admin(p_org,p_actor) then raise exception 'OPPORTUNITY_ADMIN_REQUIRED' using errcode='42501'; end if;
  select title into v_title from public.commercial_opportunities where organization_id=p_org and id=p_id for update;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND' using errcode='P0002'; end if;
  if p_users is null or cardinality(p_users)>50 or coalesce(length(p_objective),0)>2000 then raise exception 'OPPORTUNITY_INVALID_ASSIGNMENT'; end if;
  if p_team is not null and not exists(select 1 from public.organization_reporting_groups where organization_id=p_org and id=p_team and is_active)
    then raise exception 'OPPORTUNITY_INVALID_TEAM'; end if;
  if exists(select 1 from unnest(p_users) u where not exists(select 1 from public.organization_members where organization_id=p_org and user_id=u))
    or (p_responsible is not null and not p_responsible=any(p_users)) then raise exception 'OPPORTUNITY_INVALID_MEMBER'; end if;
  insert into public.opportunity_work(organization_id,opportunity_id) values(p_org,p_id) on conflict do nothing;
  select revision into v_revision from public.opportunity_work where organization_id=p_org and opportunity_id=p_id for update;
  if v_revision<>p_revision then raise exception 'OPPORTUNITY_REVISION_CONFLICT' using errcode='40001'; end if;
  delete from public.opportunity_participants where organization_id=p_org and opportunity_id=p_id;
  insert into public.opportunity_participants(organization_id,opportunity_id,user_id)
    select p_org,p_id,u from (select distinct unnest(p_users) u) s;
  update public.opportunity_work set revision=v_revision+1,team_id=p_team,responsible_id=p_responsible,assigned_by=p_actor,
    objective=coalesce(p_objective,''),due_at=p_due,updated_at=now(),
    state=case when coalesce(cardinality(p_users),0)=0 then 'unassigned' when state='unassigned' then 'assigned' else state end
    where organization_id=p_org and opportunity_id=p_id;
  insert into public.opportunity_notifications(organization_id,opportunity_id,user_id,title,assignment_revision)
    select p_org,p_id,u,'Oportunidad asignada: '||left(v_title,470),v_revision+1 from (select distinct unnest(p_users) u) s;
  insert into public.opportunity_activity(organization_id,opportunity_id,actor_id,kind,body,data)
    values(p_org,p_id,p_actor,'assignment','Equipo de trabajo actualizado',jsonb_build_object('revision',v_revision+1,'users',p_users,'team',p_team,'responsible',p_responsible));
  return v_revision+1;
end $$;

do $$ declare t text; begin
  foreach t in array array['opportunity_work','opportunity_participants','opportunity_activity','opportunity_notifications','opportunity_tasks','opportunity_contact_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
revoke all on function public.opportunity_can_read(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.opportunity_assign(uuid,uuid,uuid,bigint,uuid,uuid[],uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.opportunity_can_read(uuid,uuid,uuid) to service_role;
grant execute on function public.opportunity_assign(uuid,uuid,uuid,bigint,uuid,uuid[],uuid,text,timestamptz) to service_role;
notify pgrst,'reload schema';
