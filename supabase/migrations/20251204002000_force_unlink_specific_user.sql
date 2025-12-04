-- Force Unlink Leads for Specific User
-- This script forces ALL leads for the specified user to become "Personal" (organization_id = NULL).
-- This ensures they are visible regardless of which organization is currently selected.

DO $$
DECLARE
    target_user_id uuid := 'de3a3194-29b1-449a-828a-53608a7ebe47'; -- User ID from diagnostic
BEGIN
    -- 1. Leads
    UPDATE leads 
    SET organization_id = NULL 
    WHERE user_id = target_user_id;

    -- 2. Enriched Leads
    UPDATE enriched_leads 
    SET organization_id = NULL 
    WHERE user_id = target_user_id;

    -- 3. Contacted Leads
    UPDATE contacted_leads 
    SET organization_id = NULL 
    WHERE user_id = target_user_id;

    -- 4. Campaigns
    UPDATE campaigns 
    SET organization_id = NULL 
    WHERE user_id = target_user_id;

    RAISE NOTICE 'Unlinked data for user %', target_user_id;
END $$;
