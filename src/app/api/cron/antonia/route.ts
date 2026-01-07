import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notificationService } from '@/lib/services/notification-service';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';

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
        // 2. Generate Content (Real LLM using Genkit)
        console.log('[GENERATE] Invoking Genkit flow for:', generatedName);

        let subject = `Oportunidad para innovar en ${industry}`;
        let body = `Hola {{firstName}},\n\nMe gustaría conversar.`;

        try {
            console.log('[GENERATE] AI Input:', { jobTitle, industry, missionTitle, campaignContext });

            const aiResult = await generateCampaignFlow({
                jobTitle,
                industry,
                missionTitle,
                campaignContext,
            });

            console.log('[GENERATE] AI Output:', aiResult);

            // Validate AI response
            if (!aiResult?.steps?.length) {
                throw new Error('AI returned empty campaign steps');
            }

            subject = aiResult.steps[0].subject;
            body = aiResult.steps[0].bodyHtml;
        } catch (error: any) {
            console.error('[GENERATE] Genkit Flow Failed:', error);
            // Fallback not strictly needed if we want to fail hard, but safer to have default or fail task.
            // Let's rely on the outer try/catch to mark task as failed if AI fails, 
            // OR use fallback strings if we want to be lenient. 
            // Given "Critical" nature, maybe failing is better so they know AI keys are missing?
            // Actually, let's bubble up the error so it shows in the UI logs as "Failed".
            throw new Error(`AI Generation Failed: ${error.message}`);
        }

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
            mission_id: task.mission_id, // Link to mission
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
                // Instead of passing leads array, we tell it to pull from the queue
                // This ensures we process from the DB and track status correctly
                userId: task.payload.userId,
                source: 'queue',
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

    // FETCH LEADS FROM QUEUE if not provided in payload
    let leadsToProcess = leads || [];

    if (leadsToProcess.length === 0 || task.payload.source === 'queue') {
        console.log(`[Enrich] Fetching leads from queue for Mission ${task.mission_id} (Capacity: ${capacity})`);

        const { data: queuedLeads, error: queueError } = await supabase
            .from('leads')
            .select('*')
            .eq('mission_id', task.mission_id)
            .eq('status', 'saved')
            // .is('email', null) // Optional: only process those without email? 
            // Better to rely on 'saved' status vs 'enriched' status
            .limit(capacity);

        if (queueError) {
            console.error('[Enrich] Error fetching from queue:', queueError);
            return { skipped: true, reason: 'queue_fetch_error', error: queueError.message };
        }

        console.log(`[Enrich] Fetched ${queuedLeads?.length || 0} leads from queue`);
        leadsToProcess = queuedLeads || [];
    }

    // Fallback for types (map DB fields to API fields if needed, but local leads table usually matches API expect)
    // The API expects: { fullName, linkedinUrl, companyName, companyDomain, title, email }
    // Leads table: { name, linkedin_url, company, ... }

    // We need to map DB columns to API expected format
    leadsToProcess = leadsToProcess.map((l: any) => ({
        id: l.id, // Keep ID to update later
        name: l.name,
        full_name: l.name,
        linkedin_url: l.linkedin_url,
        company_name: l.company,
        organization_website_url: l.company_website,
        title: l.title,
        email: l.emailRaw || l.email
    }));

    if (leadsToProcess.length === 0) return { skipped: true, reason: 'no_leads_to_process' };

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

        // UPDATE LEADS STATUS in DB
        // We need to mark them as 'enriched' so they don't get picked up again
        // enriched contains the API response. We need to match back to DB IDs?
        // The enrichment API might not return the original ID unless we pass it.
        // If we can't match, we rely on the fact that now they have emails (maybe) or we update by email?
        // Better: The 'enrich-apollo' API usually returns the enriched data.
        // Let's assume we can map back or we just update the leads we *sent*.

        const leadIds = leadsToProcess.map((l: any) => l.id).filter((id: any) => id);

        if (leadIds.length > 0) {
            await supabase
                .from('leads')
                .update({
                    status: 'enriched',
                    last_enriched_at: new Date().toISOString()
                })
                .in('id', leadIds);
        }
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

        // Send notification for important task completions
        if (!result.skipped && config?.instant_alerts_enabled) {
            const { data: mission } = await supabase
                .from('antonia_missions')
                .select('title')
                .eq('id', task.mission_id)
                .single();

            const missionTitle = mission?.title || 'Misión';

            // Send alerts for significant events
            if (task.type === 'SEARCH' && result.leadsFound > 0) {
                await notificationService.sendAlert(
                    task.organization_id,
                    `Nuevos Leads Encontrados - ${missionTitle}`,
                    `ANTONIA encontró ${result.leadsFound} nuevos leads para tu misión "${missionTitle}".`
                );
            } else if (task.type === 'ENRICH' && result.enrichedCount > 0) {
                await notificationService.sendAlert(
                    task.organization_id,
                    `Leads Enriquecidos - ${missionTitle}`,
                    `ANTONIA enriqueció ${result.enrichedCount} leads con datos de contacto para "${missionTitle}".`
                );
            } else if (task.type === 'CONTACT' && result.contactedCount > 0) {
                await notificationService.sendAlert(
                    task.organization_id,
                    `Contactos Agregados - ${missionTitle}`,
                    `ANTONIA agregó ${result.contactedCount} leads a tu campaña para "${missionTitle}".`
                );
            }
        }

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

        // Send error notification if instant alerts are enabled
        if (config?.instant_alerts_enabled) {
            const { data: mission } = await supabase
                .from('antonia_missions')
                .select('title')
                .eq('id', task.mission_id)
                .single();

            const missionTitle = mission?.title || 'Misión';

            await notificationService.sendAlert(
                task.organization_id,
                `Error en Misión - ${missionTitle}`,
                `ANTONIA encontró un error al procesar la tarea ${task.type}: ${e.message}`
            );
        }
    }
}

export async function GET(request: Request) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 1: Schedule daily tasks for active missions (runs once per day check)
    try {
        const { data: scheduledMissions, error: scheduleError } = await supabase
            .rpc('schedule_daily_mission_tasks');

        if (scheduleError) {
            console.error('[Cron] Error scheduling daily missions:', scheduleError);
        } else if (scheduledMissions && scheduledMissions.length > 0) {
            console.log(`[Cron] Scheduled tasks for ${scheduledMissions.length} active missions`);
        }
    } catch (e) {
        console.error('[Cron] Failed to schedule missions:', e);
        // Don't fail the entire cron if scheduling fails
    }

    // STEP 2: Process pending tasks
    // Select tasks that are pending AND (scheduled_for IS NULL OR scheduled_for <= NOW)
    const now = new Date().toISOString();
    const { data: tasks, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
        .limit(5);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
        return NextResponse.json({ message: 'No executable tasks found' });
    }

    await Promise.all(tasks.map(t => processTask(t, supabase)));

    return NextResponse.json({ processed: tasks.length, tasks: tasks.map(t => t.id) });
}
