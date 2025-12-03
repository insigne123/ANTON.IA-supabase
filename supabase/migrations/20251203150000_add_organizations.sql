-- Create organizations table
create table if not exists organizations (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create organization_members table
create table if not exists organization_members (
  organization_id uuid references organizations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (organization_id, user_id)
);

-- Add organization_id to existing tables
alter table leads add column if not exists organization_id uuid references organizations(id);
alter table enriched_leads add column if not exists organization_id uuid references organizations(id);
alter table contacted_leads add column if not exists organization_id uuid references organizations(id);
alter table campaigns add column if not exists organization_id uuid references organizations(id);

-- Enable RLS on new tables
alter table organizations enable row level security;
alter table organization_members enable row level security;

-- Policies for organizations
create policy "Members can view their organizations"
  on organizations for select
  using (
    auth.uid() in (
      select user_id from organization_members where organization_id = id
    )
  );

create policy "Owners can update their organizations"
  on organizations for update
  using (
    auth.uid() in (
      select user_id from organization_members where organization_id = id and role = 'owner'
    )
  );

-- Policies for organization_members
create policy "Members can view members of their organizations"
  on organization_members for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- Backfill: Create default organization for existing users and migrate data
do $$
declare
  u record;
  org_id uuid;
begin
  for u in select id, email from auth.users loop
    -- Check if user already has an org (skip if so)
    if not exists (select 1 from organization_members where user_id = u.id) then
      -- Create Org
      insert into organizations (name) values (split_part(u.email, '@', 1) || '''s Org') returning id into org_id;
      
      -- Add Member
      insert into organization_members (organization_id, user_id, role) values (org_id, u.id, 'owner');
      
      -- Migrate Data
      update leads set organization_id = org_id where user_id = u.id and organization_id is null;
      update enriched_leads set organization_id = org_id where user_id = u.id and organization_id is null;
      update contacted_leads set organization_id = org_id where user_id = u.id and organization_id is null;
      update campaigns set organization_id = org_id where user_id = u.id and organization_id is null;
    end if;
  end loop;
end $$;

-- Update RLS for LEADS
drop policy if exists "Users can view their own leads" on leads;
drop policy if exists "Users can insert their own leads" on leads;
drop policy if exists "Users can update their own leads" on leads;
drop policy if exists "Users can delete their own leads" on leads;

create policy "Org members can view leads"
  on leads for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can insert leads"
  on leads for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can update leads"
  on leads for update
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can delete leads"
  on leads for delete
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- Update RLS for ENRICHED_LEADS
drop policy if exists "Users can view their own enriched leads" on enriched_leads;
-- (Assuming similar policies existed, dropping blindly might fail if names differ, but usually safe to create new ones if we use distinct names or replace)
-- Better to create new ones.

create policy "Org members can view enriched leads"
  on enriched_leads for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can insert enriched leads"
  on enriched_leads for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can update enriched leads"
  on enriched_leads for update
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can delete enriched leads"
  on enriched_leads for delete
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- Update RLS for CONTACTED_LEADS
create policy "Org members can view contacted leads"
  on contacted_leads for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can insert contacted leads"
  on contacted_leads for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can update contacted leads"
  on contacted_leads for update
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

-- Update RLS for CAMPAIGNS
create policy "Org members can view campaigns"
  on campaigns for select
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can insert campaigns"
  on campaigns for insert
  with check (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can update campaigns"
  on campaigns for update
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );

create policy "Org members can delete campaigns"
  on campaigns for delete
  using (
    organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  );
