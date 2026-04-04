-- Create unsubscribed_emails table
CREATE TABLE IF NOT EXISTS public.unsubscribed_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Ensure unique constraint: an email is blocked for a specific user OR a specific org
    CONSTRAINT unique_unsubscribe_entry UNIQUE NULLS NOT DISTINCT (email, user_id, organization_id)
);

-- Enable RLS
ALTER TABLE public.unsubscribed_emails ENABLE ROW LEVEL SECURITY;

-- Indexes for fast lookup during send
CREATE INDEX idx_unsubscribed_emails_email ON public.unsubscribed_emails(email);
CREATE INDEX idx_unsubscribed_emails_user_id ON public.unsubscribed_emails(user_id);
CREATE INDEX idx_unsubscribed_emails_org_id ON public.unsubscribed_emails(organization_id);

-- RLS Policies

-- 1. View Policies
CREATE POLICY "Users can view their own unsubscribes" ON public.unsubscribed_emails
    FOR SELECT USING (
        auth.uid() = user_id
    );

CREATE POLICY "Users can view their org unsubscribes" ON public.unsubscribed_emails
    FOR SELECT USING (
        organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        )
    );

-- 2. Insert Policies (Admins/Users managing their list)
-- Note: The actual "Unsubscribe" action from the email link will likely use the service role key 
-- to bypass RLS, or we can allow public insert if we validate a token. 
-- For now, we restrict to authenticated users managing their list.

CREATE POLICY "Users can insert their own unsubscribes" ON public.unsubscribed_emails
    FOR INSERT WITH CHECK (
        auth.uid() = user_id
    );

CREATE POLICY "Users can insert their org unsubscribes" ON public.unsubscribed_emails
    FOR INSERT WITH CHECK (
        organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        )
    );

-- 3. Delete Policies (Re-subscribe / Unblock)
CREATE POLICY "Users can delete their own unsubscribes" ON public.unsubscribed_emails
    FOR DELETE USING (
        auth.uid() = user_id
    );

CREATE POLICY "Users can delete their org unsubscribes" ON public.unsubscribed_emails
    FOR DELETE USING (
        organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid() AND role IN ('admin', 'owner')
        )
    );
