-- Reset Daily Quotas for Today (Testing Purpose Only)

-- 1. Reset Search, Enrichment, and Investigate Quotas
-- These are stored in 'antonia_daily_usage' table.
DELETE FROM antonia_daily_usage
WHERE date = CURRENT_DATE;

-- 2. Reset Contact Quota
-- Contact limits are calculated by counting rows in 'contacted_leads' created today.
-- WARNING: Deleting these records means ANTONIA will "forget" emails sent today were sent.
-- This allows you to re-test the sending limit, but use with caution on real leads.
DELETE FROM contacted_leads
WHERE created_at >= CURRENT_DATE;

-- Optional: If you want to see the current usage before/after
SELECT * FROM antonia_daily_usage WHERE date = CURRENT_DATE;
SELECT count(*) as today_contacts FROM contacted_leads WHERE created_at >= CURRENT_DATE;
