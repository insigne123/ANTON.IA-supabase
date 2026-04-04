-- Create enriched_opportunities table to separate them from enriched_leads
CREATE TABLE IF NOT EXISTS public.enriched_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT,
    company_name TEXT,
    title TEXT,
    linkedin_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    data JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE public.enriched_opportunities ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own or org enriched opportunities" ON public.enriched_opportunities
    FOR SELECT USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can insert their own or org enriched opportunities" ON public.enriched_opportunities
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can update their own or org enriched opportunities" ON public.enriched_opportunities
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can delete their own or org enriched opportunities" ON public.enriched_opportunities
    FOR DELETE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );
