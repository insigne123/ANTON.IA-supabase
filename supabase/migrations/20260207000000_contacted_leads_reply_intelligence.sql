-- Reply intelligence for contacted_leads (safe / additive)

alter table public.contacted_leads
  add column if not exists reply_preview text,
  add column if not exists last_reply_text text,
  add column if not exists reply_intent text,
  add column if not exists reply_sentiment text,
  add column if not exists reply_confidence numeric,
  add column if not exists reply_summary text,
  add column if not exists campaign_followup_allowed boolean default true,
  add column if not exists campaign_followup_reason text;
