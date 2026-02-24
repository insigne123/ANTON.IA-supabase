import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notificationService } from '@/lib/services/notification-service';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';
import * as uuid from 'uuid';

// [FIX #2] Initialize at runtime, not module-load (secrets may not be available at build time)
function getSupabaseCredentials() {
    return {
        url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
        key: process.env.SUPABASE_SERVICE_ROLE_KEY!
    };
}
const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";

function withInternalApiSecret(headers: Record<string, string>): Record<string, string> {
    const secret = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (!secret) return headers;
    return {
        ...headers,
        'x-internal-api-secret': secret,
    };
}

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

function getNextUtcDayStartIso() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5));
    return next.toISOString();
}

const BUSINESS_HOURS_START = 8;
const BUSINESS_HOURS_END = 18;
const DEFAULT_LEAD_TIMEZONE = 'America/Santiago';

const LEAD_TIMEZONE_RULES: Array<{ timeZone: string; tokens: string[] }> = [
    { timeZone: 'America/Argentina/Buenos_Aires', tokens: ['argentina', 'buenos aires', 'cordoba', 'rosario', 'mendoza'] },
    { timeZone: 'America/Santiago', tokens: ['chile', 'santiago', 'valparaiso'] },
    { timeZone: 'America/Bogota', tokens: ['colombia', 'bogota', 'medellin', 'cali'] },
    { timeZone: 'America/Lima', tokens: ['peru', 'lima'] },
    { timeZone: 'America/Mexico_City', tokens: ['mexico', 'mexico city', 'cdmx', 'guadalajara', 'monterrey'] },
    { timeZone: 'America/Sao_Paulo', tokens: ['brasil', 'brazil', 'sao paulo', 'rio de janeiro'] },
    { timeZone: 'America/Montevideo', tokens: ['uruguay', 'montevideo'] },
    { timeZone: 'America/Asuncion', tokens: ['paraguay', 'asuncion'] },
    { timeZone: 'America/La_Paz', tokens: ['bolivia', 'la paz'] },
    { timeZone: 'America/Guayaquil', tokens: ['ecuador', 'quito', 'guayaquil'] },
    { timeZone: 'America/Caracas', tokens: ['venezuela', 'caracas'] },
    { timeZone: 'Europe/Madrid', tokens: ['spain', 'espana', 'madrid', 'barcelona', 'valencia'] },
    { timeZone: 'America/Los_Angeles', tokens: ['los angeles', 'california', 'san francisco', 'seattle', 'las vegas'] },
    { timeZone: 'America/Denver', tokens: ['denver', 'phoenix', 'arizona', 'colorado'] },
    { timeZone: 'America/Chicago', tokens: ['chicago', 'houston', 'dallas', 'texas'] },
    { timeZone: 'America/New_York', tokens: ['new york', 'miami', 'florida', 'boston', 'washington', 'united states', 'estados unidos', 'usa'] },
];

type ZonedParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

function normalizeLocationForTimezone(value: string) {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9,\.\-\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveLeadTimeZone(rawLocation?: string | null) {
    const normalized = normalizeLocationForTimezone(String(rawLocation || ''));

    if (!normalized) {
        return { timeZone: DEFAULT_LEAD_TIMEZONE, matchedBy: 'fallback-empty' };
    }

    for (const rule of LEAD_TIMEZONE_RULES) {
        for (const token of rule.tokens) {
            if (normalized.includes(token)) {
                return { timeZone: rule.timeZone, matchedBy: token };
            }
        }
    }

    return { timeZone: DEFAULT_LEAD_TIMEZONE, matchedBy: 'fallback-default' };
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(date);

    const out: Record<string, number> = {};
    for (const p of parts) {
        if (p.type === 'year' || p.type === 'month' || p.type === 'day' || p.type === 'hour' || p.type === 'minute' || p.type === 'second') {
            out[p.type] = Number(p.value);
        }
    }

    return {
        year: out.year || date.getUTCFullYear(),
        month: out.month || (date.getUTCMonth() + 1),
        day: out.day || date.getUTCDate(),
        hour: out.hour || 0,
        minute: out.minute || 0,
        second: out.second || 0,
    };
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
    const zoned = getZonedParts(date, timeZone);
    const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    return Math.round((asUtc - date.getTime()) / 60000);
}

function toUtcIsoFromLocalDateTime(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): string {
    const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

    let offset = getTimeZoneOffsetMinutes(new Date(localAsUtcMs), timeZone);
    let targetMs = localAsUtcMs - (offset * 60000);

    const offsetAfter = getTimeZoneOffsetMinutes(new Date(targetMs), timeZone);
    if (offsetAfter !== offset) {
        offset = offsetAfter;
        targetMs = localAsUtcMs - (offset * 60000);
    }

    return new Date(targetMs).toISOString();
}

function addDaysToYmd(year: number, month: number, day: number, days: number) {
    const d = new Date(Date.UTC(year, month - 1, day + days));
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
    };
}

function computeLeadContactSchedule(lead: any, now: Date = new Date()) {
    const location = String(lead?.location || lead?.country || lead?.city || '').trim();
    const tz = resolveLeadTimeZone(location);
    const localNow = getZonedParts(now, tz.timeZone);

    if (localNow.hour >= BUSINESS_HOURS_START && localNow.hour < BUSINESS_HOURS_END) {
        return {
            scheduledFor: now.toISOString(),
            location: location || 'unknown',
            timeZone: tz.timeZone,
            matchedBy: tz.matchedBy,
            reason: 'within_business_hours',
        };
    }

    const scheduleTomorrow = localNow.hour >= BUSINESS_HOURS_END;
    const targetDate = addDaysToYmd(localNow.year, localNow.month, localNow.day, scheduleTomorrow ? 1 : 0);
    const targetMinute = Math.floor(Math.random() * 20);

    return {
        scheduledFor: toUtcIsoFromLocalDateTime(
            tz.timeZone,
            targetDate.year,
            targetDate.month,
            targetDate.day,
            BUSINESS_HOURS_START,
            targetMinute
        ),
        location: location || 'unknown',
        timeZone: tz.timeZone,
        matchedBy: tz.matchedBy,
        reason: scheduleTomorrow ? 'after_business_hours' : 'before_business_hours',
    };
}

async function incrementUsage(supabase: any, organizationId: string, type: 'search' | 'enrich' | 'investigate' | 'search_run' | 'contact', count: number) {
    const today = new Date().toISOString().split('T')[0];

    // [FIX #1] contacts are not tracked in antonia_daily_usage
    if (type === 'contact') return;

    // [FIX #1] Use atomic RPC to prevent race conditions (same as Firebase worker)
    const { error: rpcError } = await supabase.rpc('increment_daily_usage', {
        p_organization_id: organizationId,
        p_date: today,
        p_leads_searched: type === 'search' ? count : 0,
        p_search_runs: type === 'search_run' ? count : 0,
        p_leads_enriched: type === 'enrich' ? count : 0,
        p_leads_investigated: type === 'investigate' ? count : 0
    });

    if (rpcError) {
        console.error('[incrementUsage] RPC failed, using fallback:', rpcError);
        // Fallback to read-compute-write (non-atomic)
        let col = '';
        if (type === 'search') col = 'leads_searched';
        else if (type === 'search_run') col = 'search_runs';
        else if (type === 'enrich') col = 'leads_enriched';
        else if (type === 'investigate') col = 'leads_investigated';

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

        if (error) console.error('Error updating usage (fallback):', error);
    }
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
        .maybeSingle();

    let campaignName = generatedName;

    if (!existing) {
        // 2. Generate Content (Real LLM using Genkit)
        console.log('[GENERATE] Invoking Genkit flow for:', generatedName);

        let steps: Array<{ name: string; offsetDays: number; subject: string; bodyHtml: string }> = [];

        try {
            console.log('[GENERATE] AI Input:', { jobTitle, industry, missionTitle, campaignContext });

            const aiResult = await generateCampaignFlow({
                jobTitle,
                industry,
                missionTitle,
                campaignContext,
            });

            console.log('[GENERATE] AI Output:', aiResult);

            if (!aiResult?.steps?.length) {
                throw new Error('AI returned empty campaign steps');
            }

            steps = aiResult.steps;
        } catch (error: any) {
            console.error('[GENERATE] Genkit Flow Failed:', error);
            throw new Error(`AI Generation Failed: ${error.message}`);
        }

        const { data: campaignRow, error } = await supabase.from('campaigns').insert({
            organization_id: task.organization_id,
            user_id: userId,
            name: generatedName,
            status: 'active',
            excluded_lead_ids: [],
            settings: { source: 'antonia', aiGenerated: true, missionId: task.mission_id, tracking: { enabled: false, pixel: true, linkTracking: true } },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).select().single();

        if (error || !campaignRow) throw new Error(`Failed to create campaign: ${error?.message || 'unknown error'}`);

        const stepsPayload = steps.map((s, idx) => ({
            campaign_id: campaignRow.id,
            order_index: idx,
            name: s.name || `Paso ${idx + 1}`,
            offset_days: Number.isFinite(Number(s.offsetDays)) ? Number(s.offsetDays) : 0,
            subject_template: s.subject || '',
            body_template: s.bodyHtml || '',
            attachments: []
        }));

        const { error: stepErr } = await supabase
            .from('campaign_steps')
            .insert(stepsPayload);

        if (stepErr) throw new Error(`Failed to create campaign steps: ${stepErr.message}`);
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
            apollo_id: lead.id, // Save Apollo ID
            created_at: new Date().toISOString()
        }));

        // [FIX #9] Use upsert to avoid duplicate leads from repeated searches
        const { error: insertErr } = await supabase.from('leads').upsert(leadsToInsert, {
            onConflict: 'apollo_id',
            ignoreDuplicates: true
        });
        if (insertErr) {
            // Fallback: apollo_id unique constraint may not exist, try regular insert
            console.warn('[Search] Upsert failed, trying insert:', insertErr.message);
            await supabase.from('leads').insert(leadsToInsert);
        }

        // Track stats AND execution count
        await incrementUsage(supabase, task.organization_id, 'search', leads.length); // Volume for stats
        await incrementUsage(supabase, task.organization_id, 'search_run', 1);        // Frequency for limits
    } else {
        // FALLBACK: No new leads found, check for saved leads to process
        console.log('[Search] No new leads found. Checking for saved leads to process...');

        const { data: savedLeads, error: savedError } = await supabase
            .from('leads')
            .select('*')
            .eq('mission_id', task.mission_id)
            .eq('status', 'saved')
            .limit(config.daily_enrich_limit || 50);

        if (savedError) {
            console.error('[Search] Error fetching saved leads:', savedError);
            await incrementUsage(supabase, task.organization_id, 'search_run', 1);
            return { leadsFound: 0, fallbackUsed: false, error: savedError.message };
        }

        if (savedLeads && savedLeads.length > 0) {
            console.log(`[Search] Found ${savedLeads.length} saved leads to process via fallback`);

            // Track that we executed a search (even though we're using fallback)
            await incrementUsage(supabase, task.organization_id, 'search_run', 1);

            // Create enrichment task for saved leads
            if (task.payload.enrichmentLevel) {
                await supabase.from('antonia_tasks').insert({
                    mission_id: task.mission_id,
                    organization_id: task.organization_id,
                    type: 'ENRICH',
                    status: 'pending',
                    payload: {
                        userId: task.payload.userId,
                        source: 'queue',
                        enrichmentLevel: task.payload.enrichmentLevel,
                        campaignName: task.payload.campaignName
                    },
                    created_at: new Date().toISOString()
                });
            }

            // Log the fallback usage
            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'info',
                message: `No new leads found. Using ${savedLeads.length} saved leads from previous searches.`,
                details: { fallbackUsed: true, savedLeadsCount: savedLeads.length }
            });

            return { leadsFound: 0, savedLeadsUsed: savedLeads.length, fallbackUsed: true };
        }

        // No new leads AND no saved leads available.
        // CHECK FOR STRANDED 'ENRICHED' LEADS (Leads that were enriched but missed contact task)
        // Only if campaignName is configured
        if (config.daily_contact_limit > 0 && task.payload.campaignName) {
            console.log('[Search] Checking for stranded enriched leads to contact...');

            // We need leads that are 'enriched' AND NOT in 'contacted_leads'? 
            // Or just trust 'status=enriched' now that we update it to 'contacted'?
            // Since we just added the update logic, old leads are still 'enriched'.
            // So relying on status='enriched' is safe for now to pick them up.

            const { data: strandedLeads, error: strandedError } = await supabase
                .from('leads')
                .select('*')
                .eq('mission_id', task.mission_id)
                .eq('status', 'enriched')
                .limit(config.daily_contact_limit || 10);

            if (strandedLeads && strandedLeads.length > 0) {
                console.log(`[Search] Found ${strandedLeads.length} stranded enriched leads. Scheduling CONTACT task.`);

                await supabase.from('antonia_tasks').insert({
                    mission_id: task.mission_id,
                    organization_id: task.organization_id,
                    type: 'CONTACT',
                    status: 'pending',
                    payload: {
                        userId: task.payload.userId,
                        enrichedLeads: strandedLeads.map((l: any) => ({
                            id: l.id,
                            fullName: l.name,
                            full_name: l.name,
                            name: l.name,
                            email: l.email,
                            linkedinUrl: l.linkedin_url,
                            companyName: l.company,
                            title: l.title
                        })),
                        campaignName: task.payload.campaignName
                    },
                    created_at: new Date().toISOString()
                });

                await incrementUsage(supabase, task.organization_id, 'search_run', 1); // Count as activity run
                return { leadsFound: 0, strandedLeadsRecovered: strandedLeads.length, fallbackUsed: true };
            }
        }

        console.log('[Search] No new leads found, no saved leads, and no stranded enriched leads.');
        await incrementUsage(supabase, task.organization_id, 'search_run', 1);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'warning',
            message: 'Pipeline empty: No new, saved, or pending enriched leads found.',
            details: { fallbackUsed: false }
        });

        return { leadsFound: 0, fallbackUsed: false, message: 'Pipeline empty' };
    }

    // Create ENRICH task for new leads found
    if (task.payload.enrichmentLevel && leads.length > 0) {
        await supabase.from('antonia_tasks').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'ENRICH',
            status: 'pending',
            payload: {
                userId: task.payload.userId,
                source: 'queue',
                enrichmentLevel: task.payload.enrichmentLevel,
                campaignName: task.payload.campaignName
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
        const retryAt = getNextUtcDayStartIso();
        console.log(`[Limit] Daily ${isDeep ? 'investigate' : 'enrich'} limit reached (${currentUsage}/${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
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
    // [FIX #4] Correct field mapping from DB columns to API format
    leadsToProcess = leadsToProcess.map((l: any) => ({
        id: l.id, // Keep ID to update later
        name: l.name,
        full_name: l.name,
        linkedin_url: l.linkedin_url,
        company_name: l.company || l.company_name,
        organization_website_url: l.company_website || l.organization_website_url,
        title: l.title,
        email: l.email, // [FIX #4] was l.emailRaw which doesn't exist
        apolloId: l.apollo_id || l.apolloId // Map DB apollo_id
    }));

    if (leadsToProcess.length === 0) return { skipped: true, reason: 'no_leads_to_process' };

    const revealPhone = isDeep;
    const enrichPayload = {
        leads: leadsToProcess.map((l: any) => ({
            fullName: l.full_name || l.name,
            linkedinUrl: l.linkedin_url,
            companyName: l.company_name, // [FIX #4] was l.organization_name which doesn't exist here
            companyDomain: l.organization_website_url,
            title: l.title,
            email: l.email,
            id: l.id,
            clientRef: l.id,
            apolloId: l.apolloId
        })),
        revealEmail: true,
        revealPhone: revealPhone
    };

    const enrichUrl = `${appUrl}/api/opportunities/enrich-apollo`;

    const response = await fetch(enrichUrl, {
        method: 'POST',
        headers: withInternalApiSecret({
            'Content-Type': 'application/json',
            'x-user-id': userId
        }),
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

        // [P2-LOGIC-002] Fix Consistency: Insert into 'enriched_leads' table so they appear in UI
        const rowsToInsert = enriched.map((l: any) => ({
            id: l.id || l.clientRef || uuid.v4(), // Use existing ID or generate
            user_id: task.payload.userId,
            organization_id: task.organization_id,
            full_name: l.fullName || l.name,
            email: l.email,
            company_name: l.companyName || l.company,
            title: l.title,
            linkedin_url: l.linkedinUrl,
            phone_numbers: l.phoneNumbers || [],
            primary_phone: l.primaryPhone,
            enrichment_status: 'completed',
            data: {
                sourceOpportunityId: l.sourceOpportunityId,
                emailStatus: l.emailStatus,
                companyDomain: l.companyDomain,
                descriptionSnippet: l.descriptionSnippet,
                country: l.country,
                city: l.city,
                industry: l.industry
            },
            created_at: new Date().toISOString()
        }));

        const { error: insertError } = await supabase.from('enriched_leads').upsert(rowsToInsert, { onConflict: 'email' }); // Simple dedup by email if possible, or usually just insert. 'id' conflict?
        // enriched_leads usually doesn't enforce unique email by constraint, but manual flow does logic check.
        // We'll trust upsert if ID matches, or insert if new.
        if (insertError) console.error('[Enrich] Failed to insert into enriched_leads:', insertError);


        // UPDATE LEADS STATUS in DB (source leads)
        // We need to match back to DB IDs
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

    // 1. Validation
    if (!enrichedLeads || !Array.isArray(enrichedLeads) || enrichedLeads.length === 0) {
        throw new Error('No enriched leads provided for contact');
    }

    // [FIX #8] Check daily contact limit before processing
    const { data: contactConfig } = await supabase
        .from('antonia_missions')
        .select('daily_contact_limit')
        .eq('id', task.mission_id)
        .single();

    const contactLimit = contactConfig?.daily_contact_limit || 3;
    const today = new Date().toISOString().split('T')[0];

    const { count: contactsToday } = await supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', task.organization_id)
        .gte('created_at', `${today}T00:00:00Z`);

    if ((contactsToday || 0) >= contactLimit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[Contact] Daily contact limit reached (${contactsToday}/${contactLimit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_contact_limit_reached', retryAt };
    }

    // Cap enrichedLeads to remaining capacity
    const remaining = contactLimit - (contactsToday || 0);
    const leadsToContact = enrichedLeads.slice(0, remaining);

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
    const { data: stepRows } = await supabase
        .from('campaign_steps')
        .select('order_index, subject_template, body_template')
        .eq('campaign_id', campaign.id)
        .order('order_index', { ascending: true })
        .limit(1);

    const subject = stepRows?.[0]?.subject_template || 'Seguimiento';
    const bodyTemplate = stepRows?.[0]?.body_template || 'Hola {{firstName}},\n\nSolo quería hacer seguimiento.';

    let campaignSentRecords: Record<string, any> | null = campaign.sent_records ? { ...(campaign.sent_records || {}) } : null;
    let campaignDirty = false;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

    const contactedLeads: any[] = [];
    const errors: any[] = [];

    // 3. Process each lead
    for (const lead of leadsToContact) { // [FIX #8] use capped list
        if (!lead.email) {
            errors.push({ name: lead.fullName, error: 'No email' });
            continue;
        }

        const schedule = computeLeadContactSchedule(lead);
        if (new Date(schedule.scheduledFor).getTime() > Date.now()) {
            console.log(
                `[Contact] Deferring ${lead.email} to ${schedule.scheduledFor} ` +
                `(${schedule.timeZone}, match:${schedule.matchedBy}, location:"${schedule.location}", reason:${schedule.reason})`
            );

            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT',
                status: 'pending',
                payload: {
                    userId: task.payload.userId,
                    enrichedLeads: [lead],
                    campaignName: campaignName
                },
                scheduled_for: schedule.scheduledFor,
                created_at: new Date().toISOString()
            });

            continue;
        }

        try {
            // Personalize email
            const firstName = lead.fullName?.split(' ')[0] || 'Hola';
            const personalizedBody = bodyTemplate
                .replace('{{firstName}}', firstName)
                .replace('{{lead.name}}', lead.fullName || '')
                .replace('{{company}}', lead.companyName || 'tu empresa');

            const personalizedSubject = subject
                .replace('{{firstName}}', firstName)
                .replace('{{lead.name}}', lead.fullName || '')
                .replace('{{company}}', lead.companyName || 'tu empresa');

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': task.payload.userId
                }),
                body: JSON.stringify({
                    to: lead.email,
                    subject: personalizedSubject,
                    body: personalizedBody,
                    leadId: lead.id,
                    campaignId: campaign?.id,
                    missionId: task.mission_id,
                    userId: task.payload.userId,
                    isHtml: true,
                    tracking: campaign?.settings?.tracking
                })
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                const lower = errorText.toLowerCase();
                const isUnsub = response.status === 409 || lower.includes('unsub');
                const isBlocked = response.status === 403 || lower.includes('domain');

                if (isUnsub || isBlocked) {
                    await supabase
                        .from('contacted_leads')
                        .update({
                            campaign_followup_allowed: false,
                            campaign_followup_reason: isUnsub ? 'unsubscribed' : 'domain_blocked',
                            evaluation_status: isUnsub ? 'do_not_contact' : 'pending',
                            last_update_at: new Date().toISOString(),
                        } as any)
                        .eq('lead_id', lead.id)
                        .eq('mission_id', task.mission_id);
                }

                errors.push({ email: lead.email, error: `API ${response.status}: ${errorText.slice(0, 160)}` });
                continue;
            }

            const resData = await response.json();
            const sentAt = new Date().toISOString();

            contactedLeads.push({
                user_id: task.payload.userId, // [FIX #5] add user_id required by RLS
                organization_id: task.organization_id,
                lead_id: lead.id,
                mission_id: task.mission_id,
                name: lead.fullName,
                email: lead.email,
                company: lead.companyName,
                role: lead.title,
                status: 'sent',
                provider: resData.provider || 'unknown',
                subject: personalizedSubject,
                sent_at: sentAt,
                created_at: sentAt
            });

            if (campaign?.id && campaignSentRecords && lead?.id) {
                campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: new Date().toISOString() };
                campaignDirty = true;
            }

        } catch (err: any) {
            console.error(`[Contact] Failed to send to ${lead.email}:`, err);
            errors.push({ email: lead.email, error: err.message });
            // Optionally insert as failed contact?
        }
    }

    if (contactedLeads.length > 0) {
        await supabase.from('contacted_leads').insert(contactedLeads);

        if (campaign?.id && campaignDirty && campaignSentRecords) {
            await supabase
                .from('campaigns')
                .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
                .eq('id', campaign.id);
        }

        // Update leads status to 'contacted' to remove from queue
        // We only update the ones that were successfully SENT
        const sentLeadIds = contactedLeads.map(c => c.lead_id);
        if (sentLeadIds.length > 0) {
            await supabase
                .from('leads')
                .update({ status: 'contacted', last_contacted_at: new Date().toISOString() })
                .in('id', sentLeadIds);
        }

        // Track contact metrics
        await incrementUsage(supabase, task.organization_id, 'contact', contactedLeads.length);
    }

    console.log(`[Contact] Successfully sent ${contactedLeads.length} emails. Failed: ${errors.length}`);

    return {
        contactedCount: contactedLeads.length,
        contactedList: contactedLeads.map(c => ({ name: c.name, email: c.email, status: 'sent', company: c.company })),
        errors
    };
}

async function executeReport(task: any, supabase: any, config: any) {
    if (task.payload.reportType === 'mission_historic') {
        const missionId = task.payload?.missionId || task.mission_id;
        if (!missionId) {
            return { skipped: true, reason: 'missing_mission_id' };
        }

        const { data: mission } = await supabase
            .from('antonia_missions')
            .select('*')
            .eq('id', missionId)
            .maybeSingle();

        if (!mission) {
            return { skipped: true, reason: 'mission_not_found' };
        }

        const { count: leadsFound } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId);

        const { data: contactedRows } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', missionId);

        const leadsContacted = new Set(
            ((contactedRows as any[]) || [])
                .map((r: any) => String(r?.lead_id || '').trim())
                .filter(Boolean)
        ).size;

        const { count: blockedCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .eq('status', 'do_not_contact');

        const { count: leadsAdvancedInFunnel } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .in('status', ['enriched', 'contacted', 'do_not_contact']);

        const { count: leadsWithEmail } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .not('email', 'is', null);

        const { count: replies } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .not('replied_at', 'is', null);

        const audit = {
            found: 0,
            enrichEmail: 0,
            enrichNoEmail: 0,
            enrichFailed: 0,
            investigated: 0,
            investigateFailed: 0,
            contactedSent: 0,
            contactedBlocked: 0,
            contactedFailed: 0,
        };

        const enrichedLeadIds = new Set<string>();
        try {
            const { data: evs } = await supabase
                .from('antonia_lead_events')
                .select('lead_id, event_type, outcome')
                .eq('mission_id', missionId)
                .limit(5000);

            for (const e of (evs as any[]) || []) {
                const type = String(e.event_type || '');
                const outcome = String(e.outcome || '');
                const leadId = String(e.lead_id || '').trim();

                if (type === 'lead_found') audit.found++;
                if (type === 'lead_enrich_completed') {
                    if (outcome === 'email_found') audit.enrichEmail++;
                    else if (outcome === 'no_email') audit.enrichNoEmail++;
                    if (leadId) enrichedLeadIds.add(leadId);
                }
                if (type === 'lead_enrich_failed') audit.enrichFailed++;
                if (type === 'lead_investigate_completed') audit.investigated++;
                if (type === 'lead_investigate_failed') audit.investigateFailed++;
                if (type === 'lead_contact_sent') audit.contactedSent++;
                if (type === 'lead_contact_blocked') audit.contactedBlocked++;
                if (type === 'lead_contact_failed') audit.contactedFailed++;
            }
        } catch (e) {
            console.warn('[executeReport] mission audit fallback:', e);
        }

        const leadsEnriched = Math.max(
            enrichedLeadIds.size,
            audit.enrichEmail + audit.enrichNoEmail,
            leadsAdvancedInFunnel || 0,
            leadsWithEmail || 0,
            leadsContacted
        );

        const totalFound = leadsFound || 0;
        const totalReplies = replies || 0;
        const toRate = (num: number, den: number) => (den > 0 ? Math.min(100, (num / den) * 100).toFixed(1) : '0');
        const enrichmentRate = toRate(leadsEnriched, totalFound);
        const contactRate = toRate(leadsContacted, totalFound);
        const responseRate = toRate(totalReplies, leadsContacted);

        const summaryData = {
            missionId,
            title: mission.title,
            leadsFound: totalFound,
            leadsEnriched,
            leadsContacted,
            investigated: audit.investigated,
            replies: totalReplies,
            blocked: blockedCount || 0,
            audit,
        };

        const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 20px; background: #eef2f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; }
    .container { max-width: 780px; margin: 0 auto; background: #fff; border: 1px solid #dbe3ef; border-radius: 14px; overflow: hidden; }
    .header { padding: 30px; background: linear-gradient(135deg, #0f4c81 0%, #0a7fa4 100%); color: #fff; }
    .header h1 { margin: 0; font-size: 30px; }
    .header p { margin: 8px 0 0 0; font-size: 15px; opacity: 0.95; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center; }
    .card .v { font-size: 30px; font-weight: 800; color: #0f4c81; line-height: 1; }
    .card .l { margin-top: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: #475569; font-weight: 700; }
    .section { padding: 22px; }
    .section h2 { margin: 0 0 12px 0; font-size: 17px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .rates { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .rate { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 12px; text-align: center; }
    .rate .v { font-size: 28px; font-weight: 800; color: #c2410c; }
    .rate .l { font-size: 11px; color: #9a3412; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    .audit { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
    .audit-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
    .audit-item .k { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
    .audit-item .n { margin-top: 6px; font-size: 22px; font-weight: 800; color: #334155; line-height: 1; }
    .footer { background: #0f172a; color: #cbd5e1; text-align: center; font-size: 12px; padding: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reporte de Misión</h1>
      <p>${mission.title}</p>
    </div>

    <div class="cards">
      <div class="card"><div class="v">${totalFound}</div><div class="l">Leads Encontrados</div></div>
      <div class="card"><div class="v">${leadsEnriched}</div><div class="l">Leads Enriquecidos</div></div>
      <div class="card"><div class="v">${audit.investigated || 0}</div><div class="l">Leads Investigados</div></div>
      <div class="card"><div class="v">${leadsContacted}</div><div class="l">Leads Contactados</div></div>
      <div class="card"><div class="v">${totalReplies}</div><div class="l">Respuestas</div></div>
      <div class="card"><div class="v">${blockedCount || 0}</div><div class="l">Bloqueados</div></div>
    </div>

    <div class="section">
      <h2>Tasas de Conversión</h2>
      <div class="rates">
        <div class="rate"><div class="v">${enrichmentRate}%</div><div class="l">Enriquecimiento</div></div>
        <div class="rate"><div class="v">${contactRate}%</div><div class="l">Contacto</div></div>
        <div class="rate"><div class="v">${responseRate}%</div><div class="l">Respuesta</div></div>
      </div>
    </div>

    <div class="section">
      <h2>Auditoría por Etapa</h2>
      <div class="audit">
        <div class="audit-item"><div class="k">Found</div><div class="n">${audit.found || 0}</div></div>
        <div class="audit-item"><div class="k">Email Encontrado</div><div class="n">${audit.enrichEmail || 0}</div></div>
        <div class="audit-item"><div class="k">Sin Email</div><div class="n">${audit.enrichNoEmail || 0}</div></div>
        <div class="audit-item"><div class="k">Investigados</div><div class="n">${audit.investigated || 0}</div></div>
        <div class="audit-item"><div class="k">Contactados</div><div class="n">${audit.contactedSent || 0}</div></div>
        <div class="audit-item"><div class="k">Bloqueados/Fallidos</div><div class="n">${(audit.contactedBlocked || 0) + (audit.contactedFailed || 0)}</div></div>
      </div>
    </div>

    <div class="footer">
      Generado automáticamente por ANTONIA · ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </div>
  </div>
</body>
</html>
        `;

        const { data: reportRow } = await supabase
            .from('antonia_reports')
            .insert({
                organization_id: task.organization_id,
                mission_id: missionId,
                type: 'mission_historic',
                content: html,
                summary_data: summaryData,
                sent_to: [],
                created_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        const subject = `Reporte de Misión: ${mission.title}`;
        const sendResult = await notificationService.sendReportEmail(task.organization_id, subject, html);

        if (reportRow?.id && sendResult?.recipients?.length) {
            await supabase
                .from('antonia_reports')
                .update({ sent_to: sendResult.recipients })
                .eq('id', reportRow.id);
        }

        return {
            reportId: reportRow?.id || null,
            sent: Boolean(sendResult?.sent),
            recipients: sendResult?.recipients || [],
            summary: summaryData,
        };

    } else {
        // Daily Report Task (Default)
        // Delegate to notification service
        const result = await notificationService.sendDailyReport(task.organization_id);
        return { reportGenerated: true, ...result };
    }
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
            case 'GENERATE_REPORT': // Handle both types
                result = await executeReport(task, supabase, config || {});
                break;
            default:
                throw new Error(`Unknown task type: ${task.type}`);
        }

        const shouldRetryAtDailyReset =
            Boolean(result?.skipped) &&
            typeof result?.retryAt === 'string' &&
            String(result.retryAt || '').trim().length > 0 &&
            (String(result?.reason || '') === 'daily_limit_reached' || String(result?.reason || '') === 'daily_contact_limit_reached');

        if (shouldRetryAtDailyReset) {
            const retryAt = String(result.retryAt);
            await supabase.from('antonia_tasks').update({
                status: 'pending',
                scheduled_for: retryAt,
                processing_started_at: null,
                result,
                error_message: null,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `Task ${task.type} deferred until ${retryAt} by daily quota.`,
                details: result
            });

            return;
        }

        await supabase.from('antonia_tasks').update({
            status: 'completed',
            result: result,
            error_message: null,
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
        // Backup worker should not permanently fail tasks.
        // We return them to the queue so Firebase (primary) can process.
        const scheduledFor = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        await supabase.from('antonia_tasks').update({
            status: 'pending',
            scheduled_for: scheduledFor,
            error_message: `[next-backup] ${e.message}`,
            updated_at: new Date().toISOString()
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'error',
            message: `Task ${task.type} failed: ${e.message}`
        });

        // Don't send alerts from backup worker to avoid duplicate/noisy notifications.
    }
}

export async function GET(request: Request) {
    // [P1-SEC-002] Security Check
    const authHeader = request.headers.get('authorization');
    const cronSecret = String(process.env.CRON_SECRET || '').trim();
    const providedBearer = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const providedCronSecret = String(request.headers.get('x-cron-secret') || '').trim();

    // Check for Bearer token or direct matching if configured that way
    // Usually Vercel Cron uses just the header, or custom provided header
    if (!cronSecret || (providedBearer !== cronSecret && providedCronSecret !== cronSecret)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const dryRunParam = String(url.searchParams.get('dryRun') || '').toLowerCase();
    const dryRun = dryRunParam === '1' || dryRunParam === 'true' || dryRunParam === 'yes';

    // [FIX #2] Use runtime getter instead of module-level constants
    const { url: supabaseUrl, key: supabaseServiceKey } = getSupabaseCredentials();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (dryRun) {
        const { count: pendingTasks } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { count: activeMissions } = await supabase
            .from('antonia_missions')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'active');

        return NextResponse.json({
            dryRun: true,
            authorized: true,
            activeMissions: activeMissions || 0,
            pendingTasks: pendingTasks || 0,
            firebaseForwardConfigured: Boolean(process.env.ANTONIA_FIREBASE_TICK_URL && process.env.ANTONIA_FIREBASE_TICK_SECRET),
            backupProcessingEnabled: String(process.env.ANTONIA_NEXT_BACKUP_PROCESSING || 'false') === 'true',
        });
    }

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

    // STEP 1.5: Trigger Firebase primary worker if configured
    const tickUrl = process.env.ANTONIA_FIREBASE_TICK_URL;
    const tickSecret = String(process.env.ANTONIA_FIREBASE_TICK_SECRET || '').trim();
    let firebaseForwardFailure: { status: number; bodyPreview: string } | null = null;

    if (tickUrl && tickSecret) {
        try {
            // [FIX #10] Use POST instead of GET for Firebase trigger
            const r = await fetch(tickUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${tickSecret}`,
                    'x-cron-secret': tickSecret,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ source: 'next-cron', ts: Date.now() }),
                cache: 'no-store',
            });

            const text = await r.text().catch(() => '');
            if (r.ok) {
                return NextResponse.json({
                    forwarded: true,
                    worker: 'firebase',
                    status: r.status,
                    bodyPreview: text.slice(0, 400),
                }, { status: 200 });
            }

            firebaseForwardFailure = {
                status: r.status,
                bodyPreview: text.slice(0, 400),
            };
            console.error('[Cron] Firebase worker responded with non-2xx status:', r.status, text.slice(0, 400));
        } catch (e: any) {
            console.error('[Cron] Failed to trigger Firebase worker:', e);
            firebaseForwardFailure = {
                status: 0,
                bodyPreview: String(e?.message || 'unknown_error').slice(0, 400),
            };
            // fall through to backup processing only if explicitly enabled
        }
    }

    // STEP 2: Process pending tasks (Backup Worker)
    // Default: disabled. Enable only if you intentionally want Vercel/Next to pick tasks when Firebase is down.
    // This avoids two workers producing divergent behavior.
    const enableBackup = String(process.env.ANTONIA_NEXT_BACKUP_PROCESSING || 'false') === 'true';

    const now = new Date().toISOString();
    const allowTypes = ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'CONTACT', 'REPORT', 'GENERATE_REPORT'];

    const { data: tasks, error } = enableBackup
        ? await supabase
            .from('antonia_tasks')
            .update({
                status: 'processing',
                processing_started_at: now
            })
            .eq('status', 'pending')
            .in('type', allowTypes)
            .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
            .select('*')
            // Keep very low to avoid timeouts (Firebase worker is primary)
            .limit(1)
        : { data: [], error: null } as any;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!enableBackup) {
        if (firebaseForwardFailure) {
            return NextResponse.json({
                error: 'Firebase worker forwarding failed and backup processing is disabled',
                worker: 'firebase',
                forwarded: false,
                status: firebaseForwardFailure.status,
                bodyPreview: firebaseForwardFailure.bodyPreview,
            }, { status: 502 });
        }
        return NextResponse.json({ message: 'Backup processing disabled (ANTONIA_NEXT_BACKUP_PROCESSING=false)' });
    }

    if (!tasks || tasks.length === 0) {
        return NextResponse.json({ message: 'No executable tasks found' });
    }

    await Promise.all(tasks.map((t: any) => processTask(t, supabase)));

    return NextResponse.json({ processed: tasks.length, tasks: tasks.map((t: any) => t.id) });
}
