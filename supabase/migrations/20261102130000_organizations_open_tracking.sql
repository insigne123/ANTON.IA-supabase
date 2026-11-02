-- Plan de uso M4 (2 Nov 2026): an organization's owners and administrators may measure the opens of the emails their people send
-- one by one from ANTON.IA (Redactar). Off by default. It adds only the open pixel (/api/tracking/open?dispatch=), the same one
-- outbound dispatches already record into contacted_leads.opened_at and email_events; links are never rewritten by it. Written by
-- the server after checking the person's role (src/lib/server/open-tracking.ts).
alter table public.organizations
  add column if not exists open_tracking_enabled boolean not null default false;

comment on column public.organizations.open_tracking_enabled is
  'Measure opens (pixel only, no click tracking) of the emails sent one by one from ANTON.IA. Off by default; set by owners and admins through the server.';

notify pgrst, 'reload schema';
