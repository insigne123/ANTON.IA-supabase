-- Drop tables if they exist (to ensure clean schema with UUIDs)
DROP TABLE IF EXISTS public.campaign_steps CASCADE;
DROP TABLE IF EXISTS public.campaigns CASCADE;
DROP TABLE IF EXISTS public.saved_opportunities CASCADE;

-- Create saved_opportunities table
CREATE TABLE public.saved_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    company_name TEXT NOT NULL,
    company_linkedin_url TEXT,
    company_domain TEXT,
    location TEXT,
    published_at TIMESTAMP WITH TIME ZONE,
    posted_time TEXT,
    job_url TEXT NOT NULL,
    apply_url TEXT,
    description_snippet TEXT,
    work_type TEXT,
    contract_type TEXT,
    experience_level TEXT,
    source TEXT DEFAULT 'linkedin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create campaigns table
CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    excluded_lead_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create campaign_steps table
CREATE TABLE public.campaign_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL,
    offset_days INTEGER DEFAULT 0,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    attachments JSONB DEFAULT '[]', -- Stores array of {name, contentBytes, contentType}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.saved_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_steps ENABLE ROW LEVEL SECURITY;

-- RLS Policies for saved_opportunities
CREATE POLICY "Users can view their own or org opportunities" ON public.saved_opportunities
    FOR SELECT USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can insert their own or org opportunities" ON public.saved_opportunities
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can update their own or org opportunities" ON public.saved_opportunities
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can delete their own or org opportunities" ON public.saved_opportunities
    FOR DELETE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

-- RLS Policies for campaigns
CREATE POLICY "Users can view their own or org campaigns" ON public.campaigns
    FOR SELECT USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can insert their own or org campaigns" ON public.campaigns
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can update their own or org campaigns" ON public.campaigns
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

CREATE POLICY "Users can delete their own or org campaigns" ON public.campaigns
    FOR DELETE USING (
        auth.uid() = user_id OR 
        (organization_id IS NOT NULL AND organization_id IN (
            SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
        ))
    );

-- RLS Policies for campaign_steps (inherit access via campaign_id)
CREATE POLICY "Users can view steps of visible campaigns" ON public.campaign_steps
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_steps.campaign_id 
            AND (c.user_id = auth.uid() OR 
                (c.organization_id IS NOT NULL AND c.organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ))
            )
        )
    );

CREATE POLICY "Users can insert steps to visible campaigns" ON public.campaign_steps
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_steps.campaign_id 
            AND (c.user_id = auth.uid() OR 
                (c.organization_id IS NOT NULL AND c.organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ))
            )
        )
    );

CREATE POLICY "Users can update steps of visible campaigns" ON public.campaign_steps
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_steps.campaign_id 
            AND (c.user_id = auth.uid() OR 
                (c.organization_id IS NOT NULL AND c.organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ))
            )
        )
    );

CREATE POLICY "Users can delete steps of visible campaigns" ON public.campaign_steps
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.campaigns c 
            WHERE c.id = campaign_steps.campaign_id 
            AND (c.user_id = auth.uid() OR 
                (c.organization_id IS NOT NULL AND c.organization_id IN (
                    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
                ))
            )
        )
    );
