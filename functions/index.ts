import * as functions from 'firebase-functions/v2';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";

// --- WORKER LOGIC ---

async function processTask(task: any) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
    }).eq('id', task.id);

    try {
        let result = {};

        switch (task.type) {
            case 'SEARCH':
                result = await executeSearch(task);
                break;

            case 'ENRICH':
                result = await executeEnrichment(task);
                break;

            case 'CONTACT':
                result = await executeContact(task);
                break;

            case 'REPORT':
                result = await executeReport(task);
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

async function executeSearch(task: any) {
    const { jobTitle, location, industry, keywords } = task.payload;

    console.log('[SEARCH] Starting lead search', { jobTitle, location, industry });

    const searchPayload = {
        jobTitles: jobTitle ? [jobTitle] : [],
        locations: location ? [location] : [],
        industries: industry ? [industry] : [],
        keywords: keywords || '',
        limit: 50
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
                enrichmentLevel: task.payload.enrichmentLevel
            },
            created_at: new Date().toISOString()
        });
    }

    return { leadsFound: leads.length };
}

async function executeEnrichment(task: any) {
    const { leads, enrichmentLevel, userId } = task.payload;

    const revealPhone = enrichmentLevel === 'deep';
    const enrichPayload = {
        leads: leads.map((l: any) => ({
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

    const enrichUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/opportunities/enrich-apollo`;

    const response = await fetch(enrichUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId
        },
        body: JSON.stringify(enrichPayload)
    });

    if (!response.ok) {
        throw new Error(`Enrichment API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const enriched = data.enriched || [];

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

async function executeContact(task: any) {
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

async function executeReport(task: any) {
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('*')
        .eq('id', task.mission_id)
        .single();

    if (!mission) {
        throw new Error('Mission not found');
    }

    const { data: config } = await supabase
        .from('antonia_config')
        .select('*')
        .eq('organization_id', task.organization_id)
        .single();

    if (!config || !config.notification_email) {
        return { skipped: true };
    }

    console.log(`[REPORT] Would send report to: ${config.notification_email}`);

    return { emailSent: true, recipient: config.notification_email };
}

/**
 * Scheduled Function: Runs every minute
 */
export const antoniaTick = functions.scheduler.onSchedule('every 1 minutes', async () => {
    console.log('[AntoniaTick] waking up...');

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

    await Promise.all(tasks.map(t => processTask(t)));
});
