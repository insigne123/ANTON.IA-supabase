-- Migration: Add mission_id to leads table
-- Purpose: Link leads to the mission that found them to enable queueing

DO $$ 
BEGIN
    -- Add mission_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'mission_id') THEN
        ALTER TABLE leads ADD COLUMN mission_id UUID REFERENCES antonia_missions(id);
    END IF;

    -- Create index for performance
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'leads' AND indexname = 'leads_mission_id_status_idx') THEN
        CREATE INDEX leads_mission_id_status_idx ON leads(mission_id, status);
    END IF;

    -- Add a comment
    COMMENT ON COLUMN leads.mission_id IS 'Reference to the Antonia Mission that found this lead';

END $$;
