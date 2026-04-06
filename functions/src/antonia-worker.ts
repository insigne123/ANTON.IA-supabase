import * as functions from 'firebase-functions';
import { createClient } from '@supabase/supabase-js';

// Environment variables from Firebase config
const config = functions.config();
const supabaseUrl = config.supabase?.url || process.env.SUPABASE_URL!;
const supabaseServiceKey = config.supabase?.service_key || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const appUrl = config.app?.url || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
const cronSecret = config.cron?.secret || process.env.CRON_SECRET || '';
const DEFAULT_LEAD_SEARCH_URL = "https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-search";
const LEAD_SEARCH_URL = process.env.ANTONIA_LEAD_SEARCH_URL || process.env.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL;
const internalApiSecret = config.internal?.api_secret || process.env.INTERNAL_API_SECRET || '';
const workerIngressSecret = config.worker?.tick_secret || process.env.ANTONIA_FIREBASE_TICK_SECRET || '';

function withInternalApiSecret(headers: Record<string, string>): Record<string, string> {
    const secret = String(internalApiSecret || '').trim();
    if (!secret) return headers;
    return { ...headers, 'x-internal-api-secret': secret };
}

function ensureInternalHeaders(headers: Record<string, string>, context: string): Record<string, string> {
    const enriched = withInternalApiSecret(headers);
    if (!String(enriched['x-internal-api-secret'] || '').trim()) {
        throw new Error(`${context}: INTERNAL_API_SECRET not configured`);
    }
    return enriched;
}

function hasResearchReadyForAutoContact(lead: any) {
    const research = lead?.research;
    if (!research || typeof research !== 'object') return false;

    const source = String(research?.source || '').trim().toLowerCase();
    if (['http_error', 'fallback', 'invalid_response'].includes(source)) return false;

    const summary = String(research?.summary || research?.overview || '').trim().toLowerCase();
    if (summary.startsWith('no se pudo completar la investigacion automatica')) return false;
    if (summary.startsWith('error parsing.')) return false;

    return Boolean(
        research?.overview ||
        (Array.isArray(research?.pains) && research.pains.length > 0) ||
        (Array.isArray(research?.opportunities) && research.opportunities.length > 0) ||
        research?.emailDraft?.body
    );
}

// Helper functions
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

// Main worker function
export const antoniaWorker = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '1GB'
    })
    .https.onRequest(async (req, res) => {
        console.log('[ANTONIA Worker] Starting execution...');

        try {
            const providedBearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
            const providedSecret = String(req.get('x-cron-secret') || '').trim();
            if (workerIngressSecret && providedBearer !== workerIngressSecret && providedSecret !== workerIngressSecret) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (appUrl && cronSecret) {
                const delegateUrl = `${String(appUrl).replace(/\/$/, '')}/api/cron/antonia?skipFirebaseForward=1&forceBackupProcessing=1`;
                try {
                    const delegated = await fetch(delegateUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${cronSecret}`,
                            'x-cron-secret': cronSecret,
                            'x-antonia-source': 'firebase-worker-delegate',
                            'cache-control': 'no-store',
                        },
                    });
                    const bodyText = await delegated.text().catch(() => '');
                    if (delegated.ok) {
                        res.status(200).send(bodyText || JSON.stringify({ delegated: true }));
                        return;
                    }
                    console.error('[ANTONIA Worker] Delegate failed, using legacy fallback:', delegated.status, bodyText.slice(0, 300));
                } catch (delegateError) {
                    console.error('[ANTONIA Worker] Delegate request failed, using legacy fallback:', delegateError);
                }
            }

            const supabase = createClient(supabaseUrl, supabaseServiceKey);

            // Fetch pending tasks
            const { data: tasks, error: tasksError } = await supabase
                .from('antonia_tasks')
                .select('*')
                .eq('status', 'pending')
                .limit(5);

            if (tasksError) throw tasksError;

            console.log(`[Worker] Found ${tasks?.length || 0} pending tasks`);

            if (!tasks || tasks.length === 0) {
                res.json({ processed: 0, message: 'No pending tasks' });
                return;
            }

            const processed: string[] = [];

            for (const task of tasks) {
                try {
                    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

                    // Mark as processing
                    await supabase
                        .from('antonia_tasks')
                        .update({
                            status: 'processing',
                            processing_started_at: new Date().toISOString()
                        })
                        .eq('id', task.id);

                    // Get config
                    const { data: config } = await supabase
                        .from('antonia_config')
                        .select('*')
                        .eq('organization_id', task.organization_id)
                        .single();

                    let result: any = {};

                    // Process based on task type
                    switch (task.type) {
                        case 'SEARCH':
                            result = await executeSearch(task, supabase, config);
                            break;
                        case 'ENRICH':
                            result = await executeEnrichment(task, supabase, config);
                            break;
                        case 'CONTACT':
                            result = await executeContact(task, supabase);
                            break;
                        case 'GENERATE_CAMPAIGN':
                            result = await executeCampaignGeneration(task, supabase, config);
                            break;
                        default:
                            throw new Error(`Unknown task type: ${task.type}`);
                    }

                    // Mark as completed
                    await supabase
                        .from('antonia_tasks')
                        .update({
                            status: 'completed',
                            result: result,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', task.id);

                    // Log success
                    await supabase.from('antonia_logs').insert({
                        mission_id: task.mission_id,
                        organization_id: task.organization_id,
                        level: 'success',
                        message: `Task ${task.type} completed.`,
                        details: result,
                        created_at: new Date().toISOString()
                    });

                    processed.push(task.id);
                    console.log(`[Worker] Task ${task.id} completed successfully`);

                } catch (error: any) {
                    console.error(`[Worker] Task ${task.id} failed:`, error);

                    await supabase
                        .from('antonia_tasks')
                        .update({
                            status: 'failed',
                            error_message: error.message,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', task.id);

                    await supabase.from('antonia_logs').insert({
                        mission_id: task.mission_id,
                        organization_id: task.organization_id,
                        level: 'error',
                        message: `Task ${task.type} failed: ${error.message}`,
                        created_at: new Date().toISOString()
                    });
                }
            }

            res.json({
                success: true,
                processed: processed.length,
                tasks: processed
            });

        } catch (error: any) {
            console.error('[Worker] Fatal error:', error);
            res.status(500).json({ error: error.message });
        }
    });

// Task execution functions with complete chaining logic
async function executeCampaignGeneration(task: any, supabase: any, config: any) {
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

async function executeSearch(task: any, supabase: any, config: any) {
    const usage = await getDailyUsage(supabase, task.organization_id);
    const limit = config?.daily_search_limit || 3;

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
        seniorities: Array.isArray(task.payload?.seniorities) ? task.payload.seniorities : [],
        employee_range: companySize ? [companySize] : [],
        employee_ranges: companySize ? [companySize] : [],
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

async function executeEnrichment(task: any, supabase: any, config: any) {
    const { leads, enrichmentLevel, userId } = task.payload;
    const isDeep = enrichmentLevel === 'deep';
    const limit = isDeep ? (config?.daily_investigate_limit || 20) : (config?.daily_enrich_limit || 50);
    const usageKey = isDeep ? 'leads_investigated' : 'leads_enriched';
    const usageType = isDeep ? 'investigate' : 'enrich';

    const usage = await getDailyUsage(supabase, task.organization_id);
    const currentUsage = usage[usageKey] || 0;

    if (currentUsage >= limit) {
        console.log(`[ENRICH] Daily limit reached (${currentUsage}/${limit})`);
        return { skipped: true, reason: 'daily_limit_reached' };
    }

    const remaining = limit - currentUsage;
    const leadsToProcess = leads.slice(0, Math.min(remaining, leads.length));

    if (!appUrl) throw new Error('APP_URL not configured');

    const enrichUrl = `${appUrl}/api/opportunities/enrich-apollo`;
    const response = await fetch(enrichUrl, {
        method: 'POST',
        headers: ensureInternalHeaders({
            'Content-Type': 'application/json',
            'x-user-id': userId
        }, 'enrich'),
        body: JSON.stringify({
            leads: leadsToProcess.map((l: any) => ({
                fullName: l.full_name || l.name,
                linkedinUrl: l.linkedin_url,
                companyName: l.organization_name || l.company_name,
                title: l.title,
                email: l.email
            })),
            revealEmail: true,
            revealPhone: isDeep
        })
    });

    if (!response.ok) throw new Error(`Enrichment failed: ${response.statusText}`);

    const data = await response.json();
    if (data?.error) throw new Error(`Enrichment logical error: ${String(data.error)}`);
    const enriched = data.enriched || [];

    if (enriched.length > 0) {
        await incrementUsage(supabase, task.organization_id, usageType, enriched.length);

        // Chain to CONTACT if campaign configured
        if (task.payload.campaignName && enriched.length > 0) {
            const readyForContact = enriched.filter((lead: any) => hasResearchReadyForAutoContact(lead));
            if (readyForContact.length === 0) {
                console.warn('[ANTONIA Worker] Blocking automatic contact in legacy fallback worker: research not ready');
            }

            if (readyForContact.length > 0) {
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT',
                status: 'pending',
                payload: {
                    userId: userId,
                    enrichedLeads: readyForContact,
                    campaignName: task.payload.campaignName
                },
                created_at: new Date().toISOString()
            });
            }
        }
    }

    return { enrichedCount: enriched.length };
}

async function executeContact(task: any, supabase: any) {
    const { enrichedLeads, campaignName } = task.payload;
    const leadList = Array.isArray(enrichedLeads) ? enrichedLeads.filter((lead: any) => hasResearchReadyForAutoContact(lead)) : [];

    const candidateEmails = [...new Set(leadList.map((lead: any) => String(lead?.email || '').trim().toLowerCase()).filter(Boolean))];
    const candidateLeadIds = [...new Set(leadList.map((lead: any) => String(lead?.id || '').trim()).filter(Boolean))];
    const priorReplyRows: any[] = [];

    if (candidateEmails.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('lead_id, email, status, replied_at, reply_intent, last_reply_text')
            .eq('organization_id', task.organization_id)
            .in('email', candidateEmails);
        priorReplyRows.push(...(data || []));
    }

    if (candidateLeadIds.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('lead_id, email, status, replied_at, reply_intent, last_reply_text')
            .eq('organization_id', task.organization_id)
            .in('lead_id', candidateLeadIds);
        priorReplyRows.push(...(data || []));
    }

    const { data: campaigns } = await supabase
        .from('campaigns')
        .select('*')
        .eq('name', campaignName)
        .eq('organization_id', task.organization_id)
        .limit(1);

    if (!campaigns || campaigns.length === 0) {
        throw new Error(`Campaign '${campaignName}' not found`);
    }

    const hasPriorReply = (row: any) => Boolean(
        row?.replied_at ||
        row?.status === 'replied' ||
        row?.last_reply_text ||
        ['meeting_request', 'positive', 'negative', 'unsubscribe', 'auto_reply', 'neutral', 'delivery_failure'].includes(String(row?.reply_intent || '').trim().toLowerCase())
    );

    const contactedLeads = leadList
        .filter((lead: any) => {
            const leadId = String(lead?.id || '').trim().toLowerCase();
            const email = String(lead?.email || '').trim().toLowerCase();
            return !priorReplyRows.some((row: any) => hasPriorReply(row) && ((leadId && String(row?.lead_id || '').trim().toLowerCase() === leadId) || (email && String(row?.email || '').trim().toLowerCase() === email)));
        })
        .map((lead: any) => ({
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

    if (contactedLeads.length > 0) {
        await supabase.from('contacted_leads').insert(contactedLeads);
    }

    return { contactedCount: contactedLeads.length };
}
