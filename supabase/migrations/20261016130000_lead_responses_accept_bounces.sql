-- Production carries a check on lead_responses.type from before this repository's migrations (open, click, reply); no
-- migration here creates it. ingest_inbound_reply_core_v1 writes a bounce there as 'bounce', so in production every bounce
-- failed on lead_responses_type_check: the bounce was not recorded, the contact was not marked failed, and reply sync
-- retried it on every pass (116 failed calls in 24 h, 16 Oct 2026). The check now names the types that are written, in
-- production and in a database built from here.

alter table public.lead_responses drop constraint if exists lead_responses_type_check;
alter table public.lead_responses
  add constraint lead_responses_type_check check (type in ('open', 'click', 'reply', 'bounce'));
