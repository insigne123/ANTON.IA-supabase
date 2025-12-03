-- Add missing columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS company_name text,
ADD COLUMN IF NOT EXISTS company_domain text,
ADD COLUMN IF NOT EXISTS signatures jsonb DEFAULT '{}'::jsonb;

-- Update RLS policies to ensure users can update these columns
-- (Existing update policy should cover it as it uses USING(auth.uid() = id))
