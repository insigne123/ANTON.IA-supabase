ALTER TABLE enriched_opportunities 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Trigger for auto-update
CREATE OR REPLACE FUNCTION update_enriched_opportunities_modtime()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_enriched_opportunities_modtime ON enriched_opportunities;

CREATE TRIGGER tr_update_enriched_opportunities_modtime
BEFORE UPDATE ON enriched_opportunities
FOR EACH ROW
EXECUTE PROCEDURE update_enriched_opportunities_modtime();
