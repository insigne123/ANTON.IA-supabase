-- Create lead_responses table for engagement tracking
CREATE TABLE IF NOT EXISTS lead_responses (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    lead_id uuid REFERENCES leads(id),
    email_message_id text, /* ID from provider */
    type text CHECK (type IN ('open', 'click', 'reply')),
    content text, /* Body of reply */
    sentiment text, /* AI analysis */
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE lead_responses ENABLE ROW LEVEL SECURITY;

-- Add tracking fields to contacted_leads
ALTER TABLE contacted_leads
ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
ADD COLUMN IF NOT EXISTS engagement_score integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS evaluation_status text CHECK (evaluation_status IN ('pending', 'qualified', 'disqualified', 'action_required')) DEFAULT 'pending';

-- Update antonia_tasks type check
ALTER TABLE antonia_tasks 
DROP CONSTRAINT IF EXISTS antonia_tasks_type_check;

ALTER TABLE antonia_tasks 
ADD CONSTRAINT antonia_tasks_type_check 
CHECK (type IN ('GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT_INITIAL', 'EVALUATE', 'CONTACT_CAMPAIGN', 'REPORT', 'ALERT', 'CONTACT'));
/* Note: 'CONTACT' kept for backward compatibility */

-- Policy for lead_responses (Organization based)
CREATE POLICY "Users can view responses for their organization" ON lead_responses
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM leads
            WHERE leads.id = lead_responses.lead_id
            AND leads.organization_id = (
                SELECT organization_id FROM organization_members 
                WHERE user_id = auth.uid() 
                LIMIT 1
            )
        )
    );
