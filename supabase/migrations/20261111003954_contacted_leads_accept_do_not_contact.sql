-- Production carries a check on contacted_leads.evaluation_status from before this repository's migrations (pending,
-- qualified, disqualified, action_required); no migration here creates it. Reply sync marks a contact 'do_not_contact' when
-- the person declines, asks to be removed or the address bounces for good, and ingest_inbound_reply_core_v1 writes that
-- value: in production those replies and hard bounces failed on contacted_leads_evaluation_status_check, nothing was
-- recorded, and reply sync retried them on every pass (about 240 failed calls in 24 h, 10 Nov 2026). The check now names
-- the values that are written, in production and in a database built from here. No existing value stops being valid.

alter table public.contacted_leads drop constraint if exists contacted_leads_evaluation_status_check;
alter table public.contacted_leads
  add constraint contacted_leads_evaluation_status_check
  check (evaluation_status in ('pending', 'qualified', 'disqualified', 'action_required', 'do_not_contact'));
