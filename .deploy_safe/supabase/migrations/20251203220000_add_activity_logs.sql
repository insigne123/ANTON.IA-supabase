-- Create activity_logs table
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL, -- e.g., 'created_lead', 'updated_campaign'
  entity_type text NOT NULL, -- e.g., 'lead', 'campaign'
  entity_id uuid, -- ID of the affected record
  metadata jsonb DEFAULT '{}'::jsonb, -- Extra details (e.g., old_status, new_status)
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Policies

-- View: Members can view logs for their organization
CREATE POLICY "Members can view org logs"
  ON activity_logs FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Insert: Authenticated users can insert logs for their organization
CREATE POLICY "Users can insert logs"
  ON activity_logs FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
