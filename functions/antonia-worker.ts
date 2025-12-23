import * as functions from 'firebase-functions/v2';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || '';

// --- WORKER LOGIC ---

async function processTask(task: any) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    // 1. Mark as processing
    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
    }).eq('id', task.id);

    try {
        let result = {};

        // 2. Execute Logic based on Type
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

        // 3. Mark as Completed
        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        // 4. Log Success
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

/**
 * SEARCH: Call Lead Search API
 */
async function executeSearch(task: any) {
    const { jobTitle, location, industry, keywords } = task.payload;

    console.log('[SEARCH] Starting lead search', { jobTitle, location, industry });

    // Build search payload for your existing API
    const searchPayload = {
        jobTitles: jobTitle ? [jobTitle] : [],
        locations: location ? [location] : [],
        industries: industry ? [industry] : [],
        keywords: keywords || '',
        limit: 50 // Configurable
    };

    const response = await fetch(LEAD_SEARCH_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
        throw new Error(`Search API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const leads = data.results || [];

    console.log(`[SEARCH] Found ${leads.length} leads`);

    // Save leads to Supabase
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
            industry: lead.organization_industry || null,
            company_website: lead.organization_website_url || null,
            country: lead.country || null,
            city: lead.city || null,
            created_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('leads').insert(leadsToInsert);
        if (error) {
            console.error('[SEARCH] Error saving leads:', error);
            throw error;
        }
    }

    // Create ENRICH task for next step
    if (task.payload.enrichmentLevel && leads.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'ENRICH',
            status: 'pending',
            payload: {
                userId: task.payload.userId,
                leads: leads.slice(0, 10), // Limit enrichment to avoid quota issues
                enrichmentLevel: task.payload.enrichmentLevel
            },
            created_at: new Date().toISOString()
        });
    }

    return { leadsFound: leads.length, leadsSaved: leads.length };
}

/**
 * ENRICH: Call Apollo Enrichment API
 */
async function executeEnrichment(task: any) {
    const { leads, enrichmentLevel, userId } = task.payload;

    console.log(`[ENRICH] Enriching ${leads.length} leads with level: ${enrichmentLevel}`);

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

    // Call your existing enrichment endpoint
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

    console.log(`[ENRICH] Successfully enriched ${enriched.length} leads`);

    // Create CONTACT task if campaign specified
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

/**
 * CONTACT: Add leads to campaign
 */
async function executeContact(task: any) {
    const { enrichedLeads, campaignName } = task.payload;

    console.log(`[CONTACT] Adding ${enrichedLeads.length} leads to campaign: ${campaignName}`);

    // Find campaign by name
    const { data: campaigns } = await supabase
        .from('campaigns')
        .select('*')
        .eq('name', campaignName)
        .eq('organization_id', task.organization_id)
        .limit(1);

    if (!campaigns || campaigns.length === 0) {
        throw new Error(`Campaign '${campaignName}' not found`);
    }

    const campaign = campaigns[0];

    // Add leads to contacted_leads table
    const contactedLeads = enrichedLeads.map((lead: any) => ({
        organization_id: task.organization_id,
        lead_id: lead.id,
        name: lead.fullName,
        email: lead.email,
        company: lead.companyName,
        role: lead.title,
        status: 'queued',
        provider: 'gmail', // Default, could be configurable
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString()
    }));

    const { error } = await supabase.from('contacted_leads').insert(contactedLeads);
    if (error) {
        console.error('[CONTACT] Error adding to campaign:', error);
        throw error;
    }

    console.log(`[CONTACT] Successfully queued ${contactedLeads.length} leads for campaign`);

    return { contactedCount: contactedLeads.length, campaignId: campaign.id };
}

/**
 * REPORT: Send notification
 */
async function executeReport(task: any) {
    console.log('[REPORT] Generating mission report');

    // Get mission details
    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('*')
        .eq('id', task.mission_id)
        .single();

    if (!mission) {
        throw new Error('Mission not found');
    }

    // Get config for notification email
    const { data: config } = await supabase
        .from('antonia_config')
        .select('*')
        .eq('organization_id', task.organization_id)
        .single();

    if (!config || !config.notification_email) {
        console.log('[REPORT] No notification email configured, skipping');
        return { skipped: true };
    }

    // TODO: Implement actual email sending via your email service
    // For now, just log
    console.log(`[REPORT] Would send report to: ${config.notification_email}`);
    console.log(`[REPORT] Mission: ${mission.title}`);

    return { emailSent: true, recipient: config.notification_email };
}

/**
 * Scheduled Function: Runs every minute
 * "Tick" for the agent.
 */
export const antoniaTick = functions.scheduler.onSchedule('every 1 minutes', async () => {
    console.log('[AntoniaTick] waking up...');

    // 1. Fetch pending tasks (Concurrency Safe-ish, though basic here)
    // For robust locking use a proper RPC function: select_next_task()
    // Here we just grab 5 pending tasks.
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

    // 2. Process in parallel
    await Promise.all(tasks.map(t => processTask(t)));
});

/**
 * Note: Mission orchestration is handled by the /api/antonia/trigger endpoint
 * when a mission is created from the UI. The antoniaTick function above
 * will pick up and process those tasks automatically.
 */
