-- Create Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL, -- e.g., 'create_lead', 'update_campaign', 'invite_member'
  entity_type text NOT NULL, -- e.g., 'lead', 'campaign', 'member'
  entity_id uuid, -- ID of the affected entity
  details jsonb DEFAULT '{}'::jsonb, -- Extra info like "Changed status to Won"
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Policies
-- Members can view logs for their organization
CREATE POLICY "Members can view activity logs"
  ON activity_logs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Only system/services should insert logs, but for now we allow authenticated users to insert logs for their org
-- (In a stricter system, this might be done via triggers or RPCs, but client-side service logging is acceptable for this MVP)
CREATE POLICY "Members can insert activity logs"
  ON activity_logs FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';
