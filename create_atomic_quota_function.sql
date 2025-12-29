-- Create atomic increment function for daily usage
-- This prevents race conditions when multiple tasks update quotas simultaneously

CREATE OR REPLACE FUNCTION increment_daily_usage(
    p_organization_id uuid,
    p_date date,
    p_leads_searched int DEFAULT 0,
    p_search_runs int DEFAULT 0,
    p_leads_enriched int DEFAULT 0,
    p_leads_investigated int DEFAULT 0
) RETURNS void AS $$
BEGIN
    INSERT INTO antonia_daily_usage (
        organization_id,
        date,
        leads_searched,
        search_runs,
        leads_enriched,
        leads_investigated,
        updated_at
    ) VALUES (
        p_organization_id,
        p_date,
        p_leads_searched,
        p_search_runs,
        p_leads_enriched,
        p_leads_investigated,
        NOW()
    )
    ON CONFLICT (organization_id, date)
    DO UPDATE SET
        leads_searched = antonia_daily_usage.leads_searched + p_leads_searched,
        search_runs = antonia_daily_usage.search_runs + p_search_runs,
        leads_enriched = antonia_daily_usage.leads_enriched + p_leads_enriched,
        leads_investigated = antonia_daily_usage.leads_investigated + p_leads_investigated,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_daily_usage TO authenticated;
GRANT EXECUTE ON FUNCTION increment_daily_usage TO service_role;

-- Function created successfully!
-- It will be used automatically by Cloud Functions via RPC call
