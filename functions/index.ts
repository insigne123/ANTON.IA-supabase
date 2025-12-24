import * as functions from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Hardcoded URLs for Cloud Functions
const APP_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
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
        .select('id, name, settings') // Changed to get settings where subject/body usually live, OR direct columns if that's schema.
        // Looking at line 65/66 in the original file, it inserts into 'subject' and 'body' COLUMNS directly.
        // So I should select them.
        .select('id, name, subject, body')
        .eq('organization_id', task.organization_id)
        .eq('name', generatedName)
        .maybeSingle();

    let subject = existing?.subject || '';
    let body = existing?.body || '';

    if (!existing) {
        subject = `Oportunidad para innovar en ${industry}`;
        body = `Hola {{firstName}},\n\nEspero que estés muy bien.\n\nVi que estás liderando iniciativas de ${jobTitle} y me pareció muy relevante contactarte.\n${campaignContext ? `\nContexto específico: ${campaignContext}\n` : ''}\nMe gustaría conversar sobre cómo podemos potenciar sus resultados.\n\n¿Tienes 5 minutos esta semana?\n\nSaludos,`;

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

    return {
        campaignGenerated: true,
        campaignName: generatedName,
        subjectPreview: subject,
        bodyPreview: body.substring(0, 150) + '...'
    };
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
        headers: {
            'Content-Type': 'application/json'
        },
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

    return {
        leadsFound: leads.length,
        searchCriteria: { jobTitle, location, industry, keywords },
        sampleLeads: leads.slice(0, 5).map((l: any) => ({ name: l.full_name || l.name, company: l.organization_name || l.company_name, title: l.title }))
    };
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

    const appUrl = APP_URL;
    console.log(`[ENRICH] Using appUrl: ${appUrl}`);

    if (!appUrl) {
        console.error('[ENRICH] APP_URL not configured!');
        throw new Error('APP_URL environment variable not configured');
    }

    // Map leads to the format expected by the API
    const leadsFormatted = leadsToEnrich.map(lead => ({
        fullName: lead.name || lead.full_name,
        title: lead.title,
        companyName: lead.organization?.name || lead.organization_name || lead.company_name,
        linkedinUrl: lead.linkedin_url,
        sourceOpportunityId: lead.id
    }));

    console.log(`[ENRICH] Calling enrichment API with ${leadsFormatted.length} leads`);

    try {
        const response = await fetch(`${appUrl}/api/opportunities/enrich-apollo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-user-id': userId
            },
            body: JSON.stringify({
                leads: leadsFormatted,
                revealEmail: true,
                revealPhone: enrichmentLevel === 'premium'
            })
        });

        console.log(`[ENRICH] API response status: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log(`[ENRICH] Successfully enriched ${data.enriched?.length || 0} leads`);

            const enrichedLeads = data.enriched || [];
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

            return {
                enrichedCount: enrichedLeads.length,
                enrichedLeadsSummary: enrichedLeads.map((l: any) => ({
                    name: l.fullName || l.name,
                    company: l.companyName || l.organization?.name,
                    emailFound: !!l.email,
                    linkedinFound: !!(l.linkedinUrl || l.linkedin_url)
                }))
            };
        } else {
            const errorText = await response.text();
            console.error(`[ENRICH] API error: ${response.status} - ${errorText}`);
            return { enrichedCount: 0, error: errorText };
        }
    } catch (e) {
        console.error('[ENRICH] Failed to enrich leads:', e);
        return { enrichedCount: 0, error: String(e) };
    }
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

    const appUrl = APP_URL;
    const investigatedLeads = [];

    for (const lead of leadsToInvestigate) {
        try {
            console.log(`[INVESTIGATE] Investigating lead:`, {
                name: lead.fullName || lead.full_name,
                company: lead.companyName || lead.company_name
            });

            const response = await fetch(`${appUrl}/api/research/n8n`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    id: lead.id,
                    fullName: lead.fullName || lead.full_name || lead.name,
                    title: lead.title,
                    email: lead.email,
                    linkedinUrl: lead.linkedinUrl || lead.linkedin_url,
                    companyName: lead.companyName || lead.company_name || lead.organization?.name,
                    companyDomain: lead.companyDomain || lead.company_domain
                })
            });

            console.log(`[INVESTIGATE] API response status: ${response.status}`);

            if (response.ok) {
                const data = await response.json();
                investigatedLeads.push({ ...lead, research: data });
                console.log(`[INVESTIGATE] Successfully investigated lead`);
            } else {
                const errorText = await response.text();
                console.error(`[INVESTIGATE] API error: ${response.status} - ${errorText}`);
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

    return {
        investigatedCount: investigatedLeads.length,
        investigations: investigatedLeads.map((l: any) => ({
            name: l.fullName || l.name || l.full_name,
            company: l.companyName || l.company_name || l.organization?.name,
            summarySnippet: l.research?.summary ? l.research.summary.substring(0, 100) + '...' : 'No summary available'
        }))
    };
}

// --- 4. EXECUTE INITIAL CONTACT (Personalized) ---
async function executeInitialContact(task: any, supabase: SupabaseClient) {
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
        .gte('created_at', `${today}T00:00:00Z`);

    if ((contactsToday || 0) >= limit) {
        console.log(`[CONTACT] Daily limit reached (${contactsToday}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const { leads, userId, campaignName } = task.payload;
    const leadsToContact = leads.slice(0, limit - (contactsToday || 0));

    console.log(`[CONTACT] Contacting ${leadsToContact.length} leads`);

    // Use default introduction template with research variables
    // Note: Campaign is ignored here as this is the initial research-based outreach
    const subject = 'Oportunidad de colaboración - {{company}}';
    const body = `Hola {{name}},

Estuve leyendo sobre {{company}} y vi que {{research.summary}}

Me pareció muy interesante y me gustaría conectar contigo para explorar posibles oportunidades de colaboración.

¿Tendrías disponibilidad para una breve conversación?

Saludos,`;

    console.log(`[CONTACT_INITIAL] Using research-based template`);

    const appUrl = APP_URL;
    let contactedCount = 0;

    for (const lead of leadsToContact) {
        try {
            // Replace template variables
            const personalizedSubject = subject
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || 'your company');

            const personalizedBody = body
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || 'your company')
                .replace(/\{\{title\}\}/g, lead.title || 'your role');

            console.log(`[CONTACT] Sending email to ${lead.email}`);

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    to: lead.email,
                    subject: personalizedSubject,
                    body: personalizedBody,
                    leadId: lead.id,
                    campaignId: null,
                    userId: userId
                })
            });

            console.log(`[CONTACT] API response status: ${response.status}`);

            if (response.ok) {
                contactedCount++;
                console.log(`[CONTACT] Successfully contacted lead`);
            } else {
                const errorText = await response.text();
                console.error(`[CONTACT] API error: ${response.status} - ${errorText}`);
            }
        } catch (e) {
            console.error('[CONTACT] Failed to contact lead:', e);
        }
    }

    // Do NOT mark mission as completed immediately. 
    // The mission continues with the evaluation phase.

    return {
        contactedCount,
        contactedList: leadsToContact.map((l: any) => ({
            name: l.fullName || l.full_name,
            email: l.email,
            company: l.companyName || l.company_name,
            status: 'sent'
        }))
    };
}
// --- 5. EXECUTE EVALUATION (AI Brain) ---
async function executeEvaluate(task: any, supabase: SupabaseClient) {
    // Determine which leads need evaluation
    // In a real scenario, this task would receive specific leads to evaluate
    // For now, let's assume the payload contains the leads to evaluate
    const { leads } = task.payload;
    let qualifiedCount = 0;

    for (const lead of leads) {
        // Fetch interaction history
        const { data: interactions } = await supabase
            .from('lead_responses')
            .select('*')
            .eq('lead_id', lead.id);

        const { data: contactedLead } = await supabase
            .from('contacted_leads')
            .select('engagement_score')
            .eq('lead_id', lead.id)
            .single();

        const score = contactedLead?.engagement_score || 0;
        const hasReplied = interactions?.some((i: any) => i.type === 'reply');

        console.log(`[EVALUATE] Leading ${lead.email} - Score: ${score}, Replied: ${hasReplied}`);

        // AI LOGIC PLACEHOLDER (To be replaced with actual LLM call)
        // Rule-based fallback for now:
        // 1. If replied -> Action Required (Manual)
        // 2. If Score > 3 (e.g. clicked or multiple opens) -> Qualified
        // 3. If Score <= 3 -> Disqualified (or wait)

        let newStatus = 'disqualified';

        if (hasReplied) {
            newStatus = 'action_required';
        } else if (score > 1) { // Low threshold for testing: > 1 open
            newStatus = 'qualified';
            qualifiedCount++;

            // Trigger Campaign Follow-up
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT_CAMPAIGN',
                status: 'pending',
                payload: {
                    leads: [lead],
                    userId: task.payload.userId,
                    campaignName: task.payload.campaignName
                },
                position: task.position + 1
            });
            console.log(`[EVALUATE] Lead qualified! Created CONTACT_CAMPAIGN task.`);
        }

        // Update status
        await supabase.from('contacted_leads').update({
            evaluation_status: newStatus
        }).eq('lead_id', lead.id);
    }

    return { evaluatedCount: leads.length, qualifiedCount };
}

// --- 6. EXECUTE CONTACT CAMPAIGN (Follow-up) ---
async function executeContactCampaign(task: any, supabase: SupabaseClient) {
    // This function sends the actual campaign sequence to QUALIFIED leads
    // Logic is similar to legacy executeContact but specific to campaigns

    // Reuse legacy logic for now, but ensure we mark as completed
    const result = await executeLegacyContact(task, supabase);

    // Complete the mission for this lead
    // Note: If we have multiple tasks per mission, we might need smarter completion logic
    // For single-flow missions, this is fine
    await supabase
        .from('antonia_missions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', task.mission_id);

    return result;
}

// Reuse legacy contact logic helper
async function executeLegacyContact(task: any, supabase: SupabaseClient) {
    const { leads, userId, campaignName } = task.payload;
    const appUrl = APP_URL;
    let contactedCount = 0;

    // Fetch Campaign
    const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('organization_id', task.organization_id)
        .eq('name', campaignName)
        .maybeSingle();

    const subject = campaign?.settings?.subject || 'Follow up';
    const body = campaign?.settings?.body || 'Just checking in...';

    for (const lead of leads) {
        try {
            console.log(`[CONTACT_CAMPAIGN] Sending campaign email to ${lead.email}`);
            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                },
                body: JSON.stringify({
                    to: lead.email,
                    subject: subject,
                    body: body,
                    leadId: lead.id,
                    campaignId: campaign?.id,
                    userId: userId,
                    metadata: { type: 'campaign_followup' }
                })
            });
            if (response.ok) contactedCount++;
        } catch (e) { console.error(e); }
    }
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
            case 'EVALUATE':
                result = await executeEvaluate(task, supabase);
                break;
            case 'CONTACT_CAMPAIGN':
                result = await executeContactCampaign(task, supabase);
                break;
            case 'CONTACT': // Legacy support
            case 'CONTACT_INITIAL':
                result = await executeInitialContact(task, supabase);
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

    // --- 1. PROCESS PENDING TASKS ---
    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .limit(5);

    if (error) {
        console.error('Error fetching tasks', error);
    } else if (tasks && tasks.length > 0) {
        console.log(`[AntoniaTick] Processing ${tasks.length} tasks`);
        await Promise.all(tasks.map(t => processTask(t, supabase)));
    }

    // --- 2. SCAN FOR EVALUATION (The Heartbeat) ---
    // Find leads contacted > 2 days ago (or > 5 mins for testing) with status 'pending'
    // For testing purposes, we'll use 5 minutes delay
    const checkTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: pendingLeads } = await supabase
        .from('contacted_leads')
        .select(`
                lead_id, 
                organization_id, 
                leads!inner ( id, email, organization_id )
            `)
        .eq('evaluation_status', 'pending')
        .lt('last_interaction_at', checkTime)
        .limit(10);

    if (pendingLeads && pendingLeads.length > 0) {
        console.log(`[AntoniaTick] Found ${pendingLeads.length} leads pending evaluation`);

        // Group by Organization to create tasks efficiently
        const orgGroups = groupBy(pendingLeads, 'organization_id');

        for (const orgId of Object.keys(orgGroups)) {
            // Find an active mission for this org (simplification: just find the latest active one)
            // ideally we should store mission_id in contacted_leads table
            const { data: mission } = await supabase
                .from('antonia_missions')
                .select('id, created_by')
                .eq('organization_id', orgId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (mission) {
                const leadsForOrg = orgGroups[orgId].map((pl: any) => pl.leads);

                // Create EVALUATE task
                await supabase.from('antonia_tasks').insert({
                    mission_id: mission.id,
                    organization_id: orgId,
                    type: 'EVALUATE',
                    status: 'pending',
                    payload: {
                        leads: leadsForOrg,
                        userId: mission.created_by,
                        campaignName: 'Smart Campaign' // Placeholder
                    }
                });
                console.log(`[AntoniaTick] Created EVALUATE task for Org ${orgId}`);

                // Update status to 'evaluating' to avoid double processing
                const leadIds = leadsForOrg.map((l: any) => l.id);
                await supabase
                    .from('contacted_leads')
                    .update({ evaluation_status: 'evaluating' }) // Temporary status
                    .in('lead_id', leadIds);
            }
        }
    }
});

// Helper for grouping
function groupBy(xs: any[], key: string) {
    return xs.reduce(function (rv, x) {
        (rv[x[key]] = rv[x[key]] || []).push(x);
        return rv;
    }, {});
}

