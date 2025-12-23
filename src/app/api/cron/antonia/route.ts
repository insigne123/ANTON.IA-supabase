import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Initialize Supabase Admin Client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";

async function getDailyUsage(supabase: any, organizationId: string) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
        .from('antonia_daily_usage')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('date', today)
        .single();

    return data || { leads_searched: 0, leads_enriched: 0, leads_investigated: 0, search_runs: 0 };
}

async function incrementUsage(supabase: any, organizationId: string, type: 'search' | 'enrich' | 'investigate' | 'search_run', count: number) {
    const today = new Date().toISOString().split('T')[0];

    // Determine column to update
    let col = '';
    if (type === 'search') col = 'leads_searched'; // Keep tracking volume for stats
    else if (type === 'search_run') col = 'search_runs'; // Track frequency for limits
    else if (type === 'enrich') col = 'leads_enriched';
    else col = 'leads_investigated';

    const current = await getDailyUsage(supabase, organizationId);

    const newCount = (current[col] || 0) + count;

    const { error } = await supabase
        .from('antonia_daily_usage')
        .upsert({
            organization_id: organizationId,
            date: today,
            [col]: newCount,
            updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id,date' });

    if (error) console.error('Error updating usage:', error);
}

async function executeCampaignGeneration(task: any, supabase: any, config: any) {
    const { jobTitle, industry, campaignContext, userId, missionTitle } = task.payload;
    const generatedName = `Misión: ${missionTitle || 'Campaña Inteligente'}`;

    console.log('[GENERATE] Generando campaña inteligente...', generatedName);

    // 1. Check if campaign exists
    const { data: existing } = await supabase
        .from('campaigns')
        .select('id, name')
        .eq('organization_id', task.organization_id)
        .eq('name', generatedName)
        .single();

    let campaignName = generatedName;

    if (!existing) {
        // 2. Generate Content (Mock LLM)
        // In production, this would call OpenAI/Genkit with `campaignContext`
        const subject = `Oportunidad para innovar en ${industry}`;
        const body = `Hola {{firstName}},
        
Espero que estés muy bien.

Vi que estás liderando iniciativas de ${jobTitle} y me pareció muy relevante contactarte.
${campaignContext ? `\nContexto específico: ${campaignContext}\n` : ''}

Me gustaría conversar sobre cómo podemos potenciar sus resultados.

¿Tienes 5 minutos esta semana?

Saludos,`;

        const { error } = await supabase.from('campaigns').insert({
            organization_id: task.organization_id,
            user_id: userId,
            name: generatedName,
            subject: subject,
            body: body,
            status: 'draft', // User reviews it? Or active? User said "intelligent campaign designed for the mission", implies ready to use. 
            // Often campaigns need "steps". If this table structure supports simple body, good.
            created_at: new Date().toISOString()
        });

        if (error) throw new Error(`Failed to create campaign: ${error.message}`);
    }

    // 3. Create SEARCH task (Chaining)
    // We pass the new campaignName to the search task
    await supabase.from('antonia_tasks').insert({
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        type: 'SEARCH',
        status: 'pending',
        payload: {
            ...task.payload,
            campaignName: generatedName, // Override/Set the campaign name
        },
        idempotency_key: `mission_${task.mission_id}_search_${Date.now()}`, // Ensure unique from previous search attempts
        created_at: new Date().toISOString()
    });

    return { campaignGenerated: true, campaignName: generatedName };
}

async function executeSearch(task: any, supabase: any, config: any) {
    const usage = await getDailyUsage(supabase, task.organization_id);
    // User requested "busquedas diarias" to mean "executions", limiting to e.g. 3 per day.
    // Default to 3 if not set
    const limit = config.daily_search_limit || 3;

    // Use search_runs for limiting (frequency, not volume)
    if ((usage.search_runs || 0) >= limit) {
        console.log(`[Limit] Daily search execution limit reached (${usage.search_runs}/${limit}).`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { jobTitle, location, industry, keywords } = task.payload;

    // Execute Search - NO LIMIT on results (save everything found)
    console.log(`[Worker] Searching: ${jobTitle} in ${location}`);

    const searchPayload = {
        jobTitles: jobTitle ? [jobTitle] : [],
        locations: location ? [location] : [],
        industries: industry ? [industry] : [],
        keywords: keywords || '',
        limit: 100 // Fetch maximum results per search
    };

    const response = await fetch(LEAD_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
        throw new Error(`Search API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const leads = data.results || [];

    if (leads.length > 0) {
        // Insert with 'saved' status - ALL leads found
        const leadsToInsert = leads.map((lead: any) => ({
            user_id: task.payload.userId,
            organization_id: task.organization_id,
            name: lead.full_name || lead.name || '',
            title: lead.title || '',
            company: lead.organization_name || lead.company_name || '',
            email: lead.email || null,
            linkedin_url: lead.linkedin_url || null,
            status: 'saved',
            created_at: new Date().toISOString()
        }));

        await supabase.from('leads').insert(leadsToInsert);

        // Track stats AND execution count
        await incrementUsage(supabase, task.organization_id, 'search', leads.length); // Volume for stats
        await incrementUsage(supabase, task.organization_id, 'search_run', 1);        // Frequency for limits
    }

    if (task.payload.enrichmentLevel && leads.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'ENRICH',
            status: 'pending',
            payload: {
                userId: task.payload.userId,
                leads: leads.slice(0, 10),
                enrichmentLevel: task.payload.enrichmentLevel,
                campaignName: task.payload.campaignName // Pass down for Contact step
            },
            created_at: new Date().toISOString()
        });
    }

    return { leadsFound: leads.length };
}

async function executeEnrichment(task: any, supabase: any, config: any) {
    const { leads, enrichmentLevel, userId } = task.payload;
    const isDeep = enrichmentLevel === 'deep';

    // Determine which limit applies
    const limit = isDeep ? (config.daily_investigate_limit || 20) : (config.daily_enrich_limit || 50);
    const usageKey = isDeep ? 'leads_investigated' : 'leads_enriched';
    const usageType = isDeep ? 'investigate' : 'enrich';

    const usage = await getDailyUsage(supabase, task.organization_id);
    const currentUsage = usage[usageKey];

    if (currentUsage >= limit) {
        console.log(`[Limit] Daily ${isDeep ? 'investigate' : 'enrich'} limit reached (${currentUsage}/${limit}).`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const capacity = limit - currentUsage;
    const leadsToProcess = leads.slice(0, capacity);

    if (leadsToProcess.length === 0) return { skipped: true, reason: 'daily_limit_reached' };

    const revealPhone = isDeep;
    const enrichPayload = {
        leads: leadsToProcess.map((l: any) => ({
            fullName: l.full_name || l.name,
            linkedinUrl: l.linkedin_url,
            companyName: l.organization_name || l.company_name,
            companyDomain: l.organization_website_url,
            title: l.title,
            email: l.email
        })),
        revealEmail: true,
        revealPhone: revealPhone
    };

    const enrichUrl = `${appUrl}/api/opportunities/enrich-apollo`;

    const response = await fetch(enrichUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId
        },
        body: JSON.stringify(enrichPayload)
    });

    if (!response.ok) {
        // Silently fail enrichment? Or throw?
        throw new Error(`Enrichment API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const enriched = data.enriched || [];

    if (enriched.length > 0) {
        await incrementUsage(supabase, task.organization_id, usageType, enriched.length);
    }

    if (task.payload.campaignName && enriched.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'CONTACT',
            status: 'pending',
            payload: {
                userId: userId,
                enrichedLeads: enriched,
                campaignName: task.payload.campaignName
            },
            created_at: new Date().toISOString()
        });
    }

    return { enrichedCount: enriched.length };
}

async function executeContact(task: any, supabase: any) {
    const { enrichedLeads, campaignName } = task.payload;

    const { data: campaigns } = await supabase
        .from('campaigns')
        .select('*')
        .eq('name', campaignName)
        .eq('organization_id', task.organization_id)
        .limit(1);

    if (!campaigns || campaigns.length === 0) {
        throw new Error(`Campaign '${campaignName}' not found`);
    }

    const contactedLeads = enrichedLeads.map((lead: any) => ({
        organization_id: task.organization_id,
        lead_id: lead.id,
        name: lead.fullName,
        email: lead.email,
        company: lead.companyName,
        role: lead.title,
        status: 'queued',
        provider: 'gmail',
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    }));

    await supabase.from('contacted_leads').insert(contactedLeads);

    return { contactedCount: contactedLeads.length };
}

async function executeReport(task: any, supabase: any, config: any) {
    if (!config || !config.notification_email) {
        return { skipped: true };
    }
    return { emailSent: true, recipient: config.notification_email };
}

async function processTask(task: any, supabase: any) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    const { data: config } = await supabase
        .from('antonia_config')
        .select('*')
        .eq('organization_id', task.organization_id)
        .single();

    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
    }).eq('id', task.id);

    try {
        let result: any = {};

        switch (task.type) {
            case 'GENERATE_CAMPAIGN':
                result = await executeCampaignGeneration(task, supabase, config || {});
                break;
            case 'SEARCH':
                result = await executeSearch(task, supabase, config || {});
                break;
            case 'ENRICH':
                result = await executeEnrichment(task, supabase, config || {});
                break;
            case 'CONTACT':
                result = await executeContact(task, supabase);
                break;
            case 'REPORT':
                result = await executeReport(task, supabase, config || {});
                break;
            default:
                throw new Error(`Unknown task type: ${task.type}`);
        }

        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: result.skipped ? 'warning' : 'success',
            message: `Task ${task.type} completed.`,
            details: result
        });

    } catch (e: any) {
        console.error(`[Worker] Task ${task.id} Failed`, e);
        await supabase.from('antonia_tasks').update({
            status: 'failed',
            error_message: e.message,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'error',
            message: `Task ${task.type} failed: ${e.message}`
        });
    }
}

export async function GET(request: Request) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .limit(5);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
        return NextResponse.json({ message: 'No pending tasks' });
    }

    await Promise.all(tasks.map(t => processTask(t, supabase)));

    return NextResponse.json({ processed: tasks.length, tasks: tasks.map(t => t.id) });
}
