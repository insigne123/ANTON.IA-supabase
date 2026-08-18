-- Ordinary negative replies stop follow-up for their lead/thread, but are not global opt-outs.
delete from public.unsubscribed_emails
where reason = 'reply:negative';
