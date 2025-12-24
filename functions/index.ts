import * as functions from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Define parameters for Firebase Functions v2
const APP_URL = functions.params.defineString('APP_URL', {
    default: 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app'
});

const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";

// Helper functions
async function getDailyUsage(supabase: SupabaseClient, organizationId: string) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
        .from('antonia_daily_usage')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('date', today)
        .single();

    return data || { leads_searched: 0, leads_enriched: 0, leads_investigated: 0, search_runs: 0 };
}

async function incrementUsage(supabase: SupabaseClient, organizationId: string, type: 'search' | 'enrich' | 'investigate' | 'search_run', count: number) {
    const today = new Date().toISOString().split('T')[0];

    let col = '';
    if (type === 'search') col = 'leads_searched';
    else if (type === 'search_run') col = 'search_runs';
    else if (type === 'enrich') col = 'leads_enriched';
    else col = 'leads_investigated';

    const current = await getDailyUsage(supabase, organizationId);
    const newCount = (current[col] || 0) + count;

    await supabase
        .from('antonia_daily_usage')
        .upsert({
            organization_id: organizationId,
            date: today,
            [col]: newCount,
            updated_at: new Date().toISOString()
        }, { onConflict: 'organization_id,date' });
}

// Task execution functions
async function executeCampaignGeneration(task: any, supabase: SupabaseClient, taskConfig: any) {
    const { jobTitle, industry, campaignContext, userId, missionTitle } = task.payload;
    const generatedName = `Misión: ${missionTitle || 'Campaña Inteligente'}`;

    console.log('[GENERATE] Generating campaign...', generatedName);

    const { data: existing } = await supabase
        .from('campaigns')
        .select('id, name')
        .eq('organization_id', task.organization_id)
        .eq('name', generatedName)
        .single();

    if (!existing) {
        const subject = `Oportunidad para innovar en ${industry}`;
        const body = `Hola {{firstName}},\n\nEspero que estés muy bien.\n\nVi que estás liderando iniciativas de ${jobTitle} y me pareció muy relevante contactarte.\n${campaignContext ? `\nContexto específico: ${campaignContext}\n` : ''}\nMe gustaría conversar sobre cómo podemos potenciar sus resultados.\n\n¿Tienes 5 minutos esta semana?\n\nSaludos,`;

        await supabase.from('campaigns').insert({
            organization_id: task.organization_id,
            user_id: userId,
            name: generatedName,
            subject: subject,
            body: body,
            status: 'draft',
            created_at: new Date().toISOString()
        });
    }

    // Chain to SEARCH task
    await supabase.from('antonia_tasks').insert({
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        type: 'SEARCH',
        status: 'pending',
        payload: {
            ...task.payload,
            campaignName: generatedName
        },
        created_at: new Date().toISOString()
    });

    return { campaignGenerated: true, campaignName: generatedName };
}

async function executeSearch(task: any, supabase: SupabaseClient, taskConfig: any) {
    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = taskConfig?.daily_search_limit || 3;

    if ((usage.search_runs || 0) >= limit) {
        console.log(`[SEARCH] Daily limit reached (${usage.search_runs}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { jobTitle, location, industry, keywords, companySize, userId } = task.payload;
    console.log('[SEARCH] Searching leads:', { jobTitle, location, industry });

    // Payload structure matching exactly what external API expects (based on nextjs route.ts)
    const searchPayload = {
        user_id: userId,
        titles: jobTitle ? [jobTitle] : [],
        company_location: location ? [location] : [],
        industry_keywords: industry ? [industry] : [],
        employee_range: companySize ? [companySize] : [],
        max_results: 100
    };

    console.log('[SEARCH] Sending payload:', JSON.stringify(searchPayload));

    const response = await fetch(LEAD_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[SEARCH] API Error Response:', errorText);
        throw new Error(`Search API failed: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const leads = data.results || data.leads || []; // Handle potentially different response structures

    if (leads.length > 0) {
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
        await incrementUsage(supabase, task.organization_id, 'search', leads.length);
        await incrementUsage(supabase, task.organization_id, 'search_run', 1);

        // Chain to ENRICH if configured
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
                    campaignName: task.payload.campaignName
                },
                created_at: new Date().toISOString()
            });
        }
    }

    return { leadsFound: leads.length };
}

async function executeEnrichment(task: any, supabase: SupabaseClient, taskConfig: any) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_enrich_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_enrich_limit || 10;

    if ((usage.leads_enriched || 0) >= limit) {
        console.log(`[ENRICH] Daily limit reached (${usage.leads_enriched}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, enrichmentLevel, campaignName } = task.payload;

    console.log(`[ENRICH] Task payload:`, JSON.stringify({
        leadsCount: leads?.length || 0,
        userId,
        enrichmentLevel,
        campaignName
    }));

    if (!leads || leads.length === 0) {
        console.log('[ENRICH] No leads to enrich in payload');
        return { enrichedCount: 0, skipped: true, reason: 'no_leads' };
    }

    const leadsToEnrich = leads.slice(0, limit - (usage.leads_enriched || 0));

    console.log(`[ENRICH] Enriching ${leadsToEnrich.length} leads`);

    const appUrl = APP_URL.value();
    console.log(`[ENRICH] Using appUrl: ${appUrl}`);

    if (!appUrl) {
        console.error('[ENRICH] APP_URL not configured!');
        throw new Error('APP_URL environment variable not configured');
    }

    const enrichedLeads = [];

    for (const lead of leadsToEnrich) {
        try {
            console.log(`[ENRICH] Enriching lead:`, {
                name: lead.full_name || lead.name,
                company: lead.organization_name || lead.company_name
            });

            const response = await fetch(`${appUrl}/api/opportunities/enrich-apollo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead: {
                        name: lead.full_name || lead.name,
                        title: lead.title,
                        company: lead.organization_name || lead.company_name,
                        linkedin_url: lead.linkedin_url
                    },
                    userId: userId,
                    enrichmentType: enrichmentLevel === 'premium' ? 'both' : 'email'
                })
            });

            console.log(`[ENRICH] API response status: ${response.status}`);

            if (response.ok) {
                const data = await response.json();
                enrichedLeads.push(data);
                console.log(`[ENRICH] Successfully enriched lead`);
            } else {
                const errorText = await response.text();
                console.error(`[ENRICH] API error: ${response.status} - ${errorText}`);
            }
        } catch (e) {
            console.error('[ENRICH] Failed to enrich lead:', e);
        }
    }

    console.log(`[ENRICH] Total enriched: ${enrichedLeads.length}`);

    await incrementUsage(supabase, task.organization_id, 'enrich', enrichedLeads.length);

    // Chain to INVESTIGATE if configured and we have enriched leads
    if (enrichedLeads.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'INVESTIGATE',
            status: 'pending',
            payload: {
                userId: userId,
                leads: enrichedLeads,
                campaignName: campaignName
            },
            created_at: new Date().toISOString()
        });
    }

    return { enrichedCount: enrichedLeads.length };
}

async function executeInvestigate(task: any, supabase: SupabaseClient) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_investigate_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_investigate_limit || 5;

    if ((usage.leads_investigated || 0) >= limit) {
        console.log(`[INVESTIGATE] Daily limit reached (${usage.leads_investigated}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, campaignName } = task.payload;
    const leadsToInvestigate = leads.slice(0, limit - (usage.leads_investigated || 0));

    console.log(`[INVESTIGATE] Investigating ${leadsToInvestigate.length} leads`);

    const appUrl = APP_URL.value();
    const investigatedLeads = [];

    for (const lead of leadsToInvestigate) {
        try {
            const response = await fetch(`${appUrl}/api/research/investigate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead: lead,
                    userId: userId
                })
            });

            if (response.ok) {
                const data = await response.json();
                investigatedLeads.push(data);
            }
        } catch (e) {
            console.error('[INVESTIGATE] Failed to investigate lead:', e);
        }
    }

    await incrementUsage(supabase, task.organization_id, 'investigate', investigatedLeads.length);

    // Chain to CONTACT if we have investigated leads
    if (investigatedLeads.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'CONTACT',
            status: 'pending',
            payload: {
                userId: userId,
                leads: investigatedLeads,
                campaignName: campaignName
            },
            created_at: new Date().toISOString()
        });
    }

    return { investigatedCount: investigatedLeads.length };
}

async function executeContact(task: any, supabase: SupabaseClient) {
    // Get mission limits
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('daily_contact_limit')
        .eq('id', task.mission_id)
        .single();

    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = mission?.daily_contact_limit || 3;

    // Count contacts sent today
    const today = new Date().toISOString().split('T')[0];
    const { count: contactsToday } = await supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', task.organization_id)
        .gte('contacted_at', `${today}T00:00:00Z`);

    if ((contactsToday || 0) >= limit) {
        console.log(`[CONTACT] Daily limit reached (${contactsToday}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, campaignName } = task.payload;
    const leadsToContact = leads.slice(0, limit - (contactsToday || 0));

    console.log(`[CONTACT] Contacting ${leadsToContact.length} leads`);

    // Get campaign details
    const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('organization_id', task.organization_id)
        .eq('name', campaignName)
        .single();

    if (!campaign) {
        throw new Error('Campaign not found');
    }

    const appUrl = APP_URL.value();
    let contactedCount = 0;

    // Extract subject and body from settings
    const subject = campaign.settings?.subject || 'Oportunidad de colaboración';
    const body = campaign.settings?.body || 'Hola,\n\nMe gustaría conversar contigo.\n\nSaludos,';

    for (const lead of leadsToContact) {
        try {
            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: lead.email,
                    subject: subject,
                    body: body,
                    leadId: lead.id,
                    campaignId: campaign.id,
                    userId: userId
                })
            });

            if (response.ok) {
                contactedCount++;
            }
        } catch (e) {
            console.error('[CONTACT] Failed to contact lead:', e);
        }
    }

    // Mark mission as completed if this was the last task
    await supabase
        .from('antonia_missions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', task.mission_id);

    return { contactedCount };
}

async function processTask(task: any, supabase: SupabaseClient) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
    }).eq('id', task.id);

    try {
        const { data: taskConfig } = await supabase
            .from('antonia_config')
            .select('*')
            .eq('organization_id', task.organization_id)
            .single();

        let result = {};

        switch (task.type) {
            case 'GENERATE_CAMPAIGN':
                result = await executeCampaignGeneration(task, supabase, taskConfig);
                break;
            case 'SEARCH':
                result = await executeSearch(task, supabase, taskConfig);
                break;
            case 'ENRICH':
                result = await executeEnrichment(task, supabase, taskConfig);
                break;
            case 'INVESTIGATE':
                result = await executeInvestigate(task, supabase);
                break;
            case 'CONTACT':
                result = await executeContact(task, supabase);
                break;
        }

        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'success',
            message: `Task ${task.type} completed successfully.`,
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

// Main scheduler function
export const antoniaTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
}, async (event) => {
    console.log('[AntoniaTick] waking up...');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase credentials');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .limit(5);

    if (error) {
        console.error('Error fetching tasks', error);
        return;
    }

    if (!tasks || tasks.length === 0) {
        console.log('[AntoniaTick] No pending tasks.');
        return;
    }

    console.log(`[AntoniaTick] Processing ${tasks.length} tasks`);
    await Promise.all(tasks.map(t => processTask(t, supabase)));
});
