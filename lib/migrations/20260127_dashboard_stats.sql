-- RPC for Dashboard Stats
-- Avoids client-side aggregation of thousands of rows

CREATE OR REPLACE FUNCTION get_dashboard_stats(p_organization_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_leads bigint;
    v_contacted_leads bigint;
    v_active_campaigns bigint;
    v_enriched_leads bigint;
BEGIN
    -- Count Total Leads (leads table)
    SELECT count(*) INTO v_total_leads
    FROM leads
    WHERE organization_id = p_organization_id;

    -- Count Enriched Leads (enriched_leads table)
    SELECT count(*) INTO v_enriched_leads
    FROM enriched_leads
    WHERE organization_id = p_organization_id;

    -- Count Contacted Leads (contacted_leads table)
    SELECT count(*) INTO v_contacted_leads
    FROM contacted_leads
    WHERE organization_id = p_organization_id;

    -- Count Active Campaigns
    SELECT count(*) INTO v_active_campaigns
    FROM campaigns
    WHERE organization_id = p_organization_id
    AND status = 'active';

    RETURN json_build_object(
        'total_leads', v_total_leads,
        'enriched_leads', v_enriched_leads,
        'contacted_leads', v_contacted_leads,
        'active_campaigns', v_active_campaigns,
        'generated_at', now()
    );
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_dashboard_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_stats(uuid) TO service_role;
