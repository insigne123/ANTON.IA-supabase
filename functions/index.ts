/**
 * ANTON.IA Cloud Functions
 * Force Deploy: 2025-12-29T19:45:00 - N8N Payload Fix
 */
// Cloud Functions for Antonia AI
// Last Updated: 2025-12-30 02:45 Dry Run & N8N Fields Fix
import * as functions from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// NOTE: Keep defaults for backwards compatibility, but prefer env vars in production.
const DEFAULT_APP_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const DEFAULT_LEAD_SEARCH_URL = 'https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search';

function getAppUrl(): string {
    return (
        process.env.ANTONIA_APP_URL ||
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        DEFAULT_APP_URL
    );
}

function getLeadSearchUrl(): string {
    return process.env.ANTONIA_LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL;
}

function withInternalApiSecret(headers: Record<string, string>): Record<string, string> {
    const secret = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (!secret) return headers;
    return {
        ...headers,
        'x-internal-api-secret': secret,
    };
}

type LeadEventInsert = {
    organization_id: string;
    mission_id?: string | null;
    task_id?: string | null;
    lead_id: string;
    event_type: string;
    stage?: string | null;
    outcome?: string | null;
    message?: string | null;
    meta?: any;
    created_at?: string;
};

let supportsHeartbeatColumn: boolean | null = null;

function isMissingHeartbeatColumnError(error: any): boolean {
    const message = String(error?.message || error || '').toLowerCase();
    const details = String(error?.details || '').toLowerCase();
    const hint = String(error?.hint || '').toLowerCase();
    const combined = `${message} ${details} ${hint}`;

    if (!combined.includes('heartbeat_at')) return false;
    return (
        combined.includes('does not exist') ||
        combined.includes('not found in the schema cache') ||
        combined.includes('schema cache') ||
        combined.includes('column')
    );
}

function handleHeartbeatColumnError(error: any, context: string): boolean {
    if (!isMissingHeartbeatColumnError(error)) return false;
    if (supportsHeartbeatColumn !== false) {
        supportsHeartbeatColumn = false;
        console.warn(`[heartbeat_at] Column unavailable in ${context}. Falling back to legacy behavior.`);
    }
    return true;
}

async function safeInsertLeadEvents(supabase: SupabaseClient, events: LeadEventInsert[]) {
    if (!events || events.length === 0) return;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const filtered = events.filter((e) => e.lead_id && uuidRegex.test(String(e.lead_id)));
    if (filtered.length === 0) return;
    try {
        const { error } = await supabase.from('antonia_lead_events').insert(filtered);
        if (error) {
            console.error('[antonia_lead_events] insert error:', error);
        }
    } catch (e) {
        console.error('[antonia_lead_events] insert exception:', e);
    }
}

async function safeHeartbeatTask(
    supabase: SupabaseClient,
    taskId: string,
    patch?: { progress_current?: number | null; progress_total?: number | null; progress_label?: string | null }
) {
    if (!taskId) return;
    const nowIso = new Date().toISOString();
    try {
        const payload: any = {
            updated_at: nowIso,
        };
        if (supportsHeartbeatColumn !== false) {
            payload.heartbeat_at = nowIso;
        }
        if (patch) {
            if (patch.progress_current !== undefined) payload.progress_current = patch.progress_current;
            if (patch.progress_total !== undefined) payload.progress_total = patch.progress_total;
            if (patch.progress_label !== undefined) payload.progress_label = patch.progress_label;
        }
        const { error } = await supabase.from('antonia_tasks').update(payload).eq('id', taskId);
        if (error) {
            if (payload.heartbeat_at && handleHeartbeatColumnError(error, 'safeHeartbeatTask')) {
                delete payload.heartbeat_at;
                const { error: retryError } = await supabase.from('antonia_tasks').update(payload).eq('id', taskId);
                if (!retryError) return;
                console.warn('[antonia_tasks] heartbeat fallback update failed:', retryError.message || retryError);
                return;
            }
            // Don't fail the task for observability failures.
            console.warn('[antonia_tasks] heartbeat update failed:', error.message || error);
        }
    } catch (e) {
        console.warn('[antonia_tasks] heartbeat update exception:', e);
    }
}

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
    { timeZone: 'America/Panama', tokens: ['panama'] },
    { timeZone: 'America/Costa_Rica', tokens: ['costa rica'] },
    { timeZone: 'America/Guatemala', tokens: ['guatemala'] },
    { timeZone: 'America/Tegucigalpa', tokens: ['honduras', 'tegucigalpa'] },
    { timeZone: 'America/El_Salvador', tokens: ['el salvador', 'san salvador'] },
    { timeZone: 'America/Managua', tokens: ['nicaragua', 'managua'] },
    { timeZone: 'America/Santo_Domingo', tokens: ['dominican republic', 'republica dominicana', 'santo domingo'] },
    { timeZone: 'America/Puerto_Rico', tokens: ['puerto rico', 'san juan'] },
    { timeZone: 'America/Havana', tokens: ['cuba', 'havana'] },
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

function pad2(n: number) {
    return String(n).padStart(2, '0');
}

function formatZonedDateTime(parts: ZonedParts) {
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
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
            localNow,
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
        localNow,
        reason: scheduleTomorrow ? 'after_business_hours' : 'before_business_hours',
    };
}

async function incrementUsage(
    supabase: SupabaseClient,
    organizationId: string,
    type: 'search' | 'enrich' | 'investigate' | 'search_run',
    count: number,
    taskId?: string  // Optional task ID for deduplication
) {
    const today = new Date().toISOString().split('T')[0];

    // 🛡️ IDEMPOTENCY: Check if we already incremented for this task
    if (taskId) {
        const { data: existing } = await supabase
            .from('antonia_usage_increments')
            .select('id')
            .eq('task_id', taskId)
            .eq('increment_type', type)
            .maybeSingle();

        if (existing) {
            console.log(`[incrementUsage] ⏭️ Already incremented ${type} for task ${taskId}, skipping`);
            return;
        }
    }

    console.log(`[incrementUsage] 📊 Incrementing ${type} by ${count} for org ${organizationId}${taskId ? ` (task: ${taskId})` : ''} `);

    // Use atomic SQL function to prevent race conditions
    const params: any = {
        p_organization_id: organizationId,
        p_date: today,
        p_leads_searched: type === 'search' ? count : 0,
        p_search_runs: type === 'search_run' ? count : 0,
        p_leads_enriched: type === 'enrich' ? count : 0,
        p_leads_investigated: type === 'investigate' ? count : 0
    };

    const { error } = await supabase.rpc('increment_daily_usage', params);

    if (error) {
        console.error('[incrementUsage] Failed to increment:', error);
        // Fallback to old method if RPC fails
        const current = await getDailyUsage(supabase, organizationId);
        let col = '';
        if (type === 'search') col = 'leads_searched';
        else if (type === 'search_run') col = 'search_runs';
        else if (type === 'enrich') col = 'leads_enriched';
        else col = 'leads_investigated';

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

    // 🛡️ IDEMPOTENCY: Record that we incremented for this task
    if (taskId) {
        const { error: logError } = await supabase
            .from('antonia_usage_increments')
            .insert({
                task_id: taskId,
                organization_id: organizationId,
                increment_type: type,
                amount: count
            });

        if (logError) {
            // If insert fails due to unique constraint, that's OK (already incremented)
            if (logError.code !== '23505') { // 23505 = unique_violation
                console.error('[incrementUsage] Failed to log increment:', logError);
            }
        }
    }
}

// Task execution functions

// Helper to reliably get UserId from payload or mission
async function getTaskUserId(task: any, supabase: SupabaseClient): Promise<string> {
    let { userId } = task.payload || {};

    if (userId && userId !== 'anon' && userId !== 'undefined') {
        return userId;
    }

    // Fallback: Fetch from mission
    // console.log(`[${ task.type }] Missing userId in payload(val: ${ userId }), recovering from mission...`);

    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('user_id') // Correct column name is 'user_id'
        .eq('id', task.mission_id)
        .single();

    if (mission && mission.user_id) {
        console.log(`[${task.type}] Recovered userId: ${mission.user_id} `);
        return mission.user_id;
    }

    console.error(`[${task.type}] CRITICAL: Could not recover userId. Operations may fail.`);
    throw new Error(`Failed to recover userId for task ${task.id}`);
}

async function executeCampaignGeneration(task: any, supabase: SupabaseClient, taskConfig: any) {
    let { jobTitle, industry, campaignContext, userId, missionTitle } = task.payload;

    // Ensure userId
    if (!userId || userId === 'anon') {
        userId = await getTaskUserId(task, supabase);
    }

    const generatedName = `Misión: ${missionTitle || 'Campaña Inteligente'}`;

    console.log('[GENERATE] Generating campaign...', generatedName);

    const { data: existing } = await supabase
        .from('campaigns')
        .select('id, name, sent_records')
        .eq('organization_id', task.organization_id)
        .eq('name', generatedName)
        .maybeSingle();

    let subjectPreview = '';
    let bodyPreview = '';

    if (!existing) {
        let steps: Array<{ name?: string; offsetDays?: number; subject?: string; bodyHtml?: string }> = [];
        let aiGenerated = false;

        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', userId)
                .maybeSingle();

            const appUrl = getAppUrl();
            const aiRes = await fetch(`${appUrl}/api/ai/generate-campaign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobTitle,
                    industry,
                    missionTitle,
                    campaignContext,
                    userName: profile?.full_name || undefined,
                    language: 'es'
                })
            });

            if (aiRes.ok) {
                const aiData = await aiRes.json();
                if (Array.isArray(aiData?.steps) && aiData.steps.length > 0) {
                    steps = aiData.steps;
                    aiGenerated = true;
                }
            } else {
                const errText = await aiRes.text().catch(() => '');
                console.warn('[GENERATE] AI request failed:', errText.slice(0, 400));
            }
        } catch (e) {
            console.warn('[GENERATE] AI generation failed, using fallback:', e);
        }

        if (steps.length === 0) {
            const fallbackSubject = `Oportunidad para innovar en ${industry}`;
            const fallbackBody = `Hola {{lead.name}},\n\nEspero que estés muy bien.\n\nVi que estás liderando iniciativas de ${jobTitle} y me pareció muy relevante contactarte.\n${campaignContext ? `\nContexto específico: ${campaignContext}\n` : ''}\nMe gustaría conversar sobre cómo podemos potenciar sus resultados.\n\n¿Tienes 5 minutos esta semana?\n\nSaludos,\n{{sender.name}}`;

            steps = [
                {
                    name: 'Contacto inicial',
                    offsetDays: 0,
                    subject: fallbackSubject,
                    bodyHtml: `<p>${fallbackBody.replace(/\n/g, '<br/>')}</p>`
                }
            ];
        }

        subjectPreview = steps[0]?.subject || '';
        bodyPreview = steps[0]?.bodyHtml || '';

        const { data: campaignRow, error: campaignErr } = await supabase
            .from('campaigns')
            .insert({
                organization_id: task.organization_id,
                user_id: userId,
                name: generatedName,
                status: 'active',
                excluded_lead_ids: [],
                settings: {
                    source: 'antonia',
                    aiGenerated,
                    missionId: task.mission_id,
                    tracking: { enabled: false, pixel: true, linkTracking: true }
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (campaignErr || !campaignRow) {
            throw new Error(`Failed to create campaign: ${campaignErr?.message || 'unknown error'}`);
        }

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

        if (stepErr) {
            console.error('[GENERATE] Failed to insert campaign steps:', stepErr);
        }
    } else {
        const { data: existingSteps } = await supabase
            .from('campaign_steps')
            .select('subject_template, body_template')
            .eq('campaign_id', existing.id)
            .order('order_index', { ascending: true })
            .limit(1);

        subjectPreview = existingSteps?.[0]?.subject_template || '';
        bodyPreview = existingSteps?.[0]?.body_template || '';
    }

    // Chain to SEARCH task
    await supabase.from('antonia_tasks').insert({
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        type: 'SEARCH',
        status: 'pending',
        payload: {
            ...task.payload,
            userId: userId, // Ensure we use the recovered userId
            campaignName: generatedName
        },
        created_at: new Date().toISOString()
    });

    return {
        campaignGenerated: true,
        campaignName: generatedName,
        subjectPreview,
        bodyPreview: bodyPreview ? bodyPreview.substring(0, 150) + '...' : ''
    };
}

async function executeSearch(task: any, supabase: SupabaseClient, taskConfig: any) {
    const { jobTitle, location, industry, keywords, companySize } = task.payload || {};
    const userId = await getTaskUserId(task, supabase);
    const nowIso = new Date().toISOString();

    await safeHeartbeatTask(supabase, task.id, {
        progress_current: null,
        progress_total: null,
        progress_label: 'Buscando leads...'
    });

    // 1) Global org-level execution limit (protect costs)
    const usage = await getDailyUsage(supabase, task.organization_id);
    const globalLimit = Math.min(5, taskConfig?.daily_search_limit || 3);
    if ((usage.search_runs || 0) >= globalLimit) {
        return { skipped: true, reason: 'daily_limit_reached', scope: 'organization', used: usage.search_runs || 0, limit: globalLimit };
    }

    // 2) Mission-level limit (the wizard config)
    try {
        const { data: mission } = await supabase
            .from('antonia_missions')
            .select('daily_search_limit')
            .eq('id', task.mission_id)
            .maybeSingle();

        const missionLimit = Math.min(5, Math.max(1, Number(mission?.daily_search_limit || 1)));
        const d = new Date();
        const todayStartUtc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
        const { count: missionSearchesToday } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', task.mission_id)
            .eq('type', 'SEARCH')
            .gte('created_at', todayStartUtc);

        if ((missionSearchesToday || 0) > missionLimit) {
            return { skipped: true, reason: 'daily_limit_reached', scope: 'mission', used: missionSearchesToday || 0, limit: missionLimit };
        }
    } catch (e) {
        console.warn('[SEARCH] Failed mission limit check (continuing):', e);
    }

    // 3) Validate required filters (the search API requires these)
    const missing: string[] = [];
    if (!String(industry || '').trim()) missing.push('industry');
    if (!String(location || '').trim()) missing.push('location');
    if (!String(companySize || '').trim()) missing.push('companySize');
    if (missing.length > 0) {
        await safeHeartbeatTask(supabase, task.id, { progress_label: `Omitido: faltan filtros (${missing.join(', ')})` });
        return { skipped: true, reason: 'missing_filters', missing };
    }

    console.log('[SEARCH] Searching leads:', { jobTitle, location, industry });

    // Prefer calling our own API route (centralized logic + USE_APIFY switch)
    const appUrl = getAppUrl();
    const internalUrl = `${appUrl}/api/leads/search`;

    const internalBody = [
        {
            industry_keywords: [String(industry).trim()],
            company_location: [String(location).trim()],
            employee_ranges: [String(companySize).trim()],
            titles: String(jobTitle || '').trim(),
            seniorities: Array.isArray(task.payload?.seniorities) ? task.payload.seniorities : [],
            max_results: 100,
        }
    ];

    let data: any = null;
    try {
        const response = await fetch(internalUrl, {
            method: 'POST',
            headers: withInternalApiSecret({
                'Content-Type': 'application/json',
                'x-user-id': userId,
            }),
            body: JSON.stringify(internalBody)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`internal_search_failed:${response.status}:${errorText.slice(0, 800)}`);
        }
        data = await response.json();
    } catch (e) {
        // Backward compatible fallback: hit the external service directly
        const fallbackUrl = getLeadSearchUrl();
        console.warn('[SEARCH] Internal search failed. Falling back to external URL:', String(e));

        const searchPayload = {
            user_id: userId,
            titles: jobTitle ? [jobTitle] : [],
            company_location: location ? [location] : [],
            industry_keywords: industry ? [industry] : [],
            employee_range: companySize ? [companySize] : [],
            max_results: 100
        };
        const response = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchPayload)
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Search API failed: ${response.statusText} - ${errorText}`);
        }
        data = await response.json();
    }

    const rawLeads: any[] = Array.isArray(data?.leads) ? data.leads : (Array.isArray(data?.results) ? data.results : (Array.isArray(data?.data?.leads) ? data.data.leads : []));

    // Normalize across response shapes
    const normalized = rawLeads.map((lead: any) => {
        const first = lead.first_name || lead.firstName || '';
        const last = lead.last_name || lead.lastName || '';
        const fullName = String(
            (lead.full_name || lead.fullName) ||
            `${first} ${last}`.trim() ||
            lead.name ||
            ''
        ).trim();

        const orgName = lead.organization?.name || lead.organization_name || lead.company_name || lead.companyName || lead.company || '';
        const orgDomain = lead.organization?.domain || lead.organization_domain || lead.company_domain || lead.companyDomain || lead.organization_website_url || null;

        const apolloId = lead.apollo_id || lead.apolloId || lead.id || null;

        return {
            apolloId: apolloId ? String(apolloId) : null,
            fullName,
            title: lead.title || '',
            email: lead.email || null,
            linkedinUrl: lead.linkedin_url || lead.linkedinUrl || null,
            companyName: String(orgName || '').trim(),
            companyDomain: orgDomain ? String(orgDomain).trim() : null,
        };
    }).filter((x: any) => x.fullName);

    const leads = normalized;

    if (leads.length > 0) {
        // Deduplicate by apollo_id within the mission (best-effort)
        const apolloIds = Array.from(new Set(leads.map((l: any) => l.apolloId).filter(Boolean)));
        const existingApollo = new Set<string>();

        if (apolloIds.length > 0) {
            const { data: existing } = await supabase
                .from('leads')
                .select('apollo_id')
                .eq('mission_id', task.mission_id)
                .in('apollo_id', apolloIds);
            (existing || []).forEach((r: any) => {
                if (r?.apollo_id) existingApollo.add(String(r.apollo_id));
            });
        }

        const leadsToInsert = leads
            .filter((l: any) => !l.apolloId || !existingApollo.has(String(l.apolloId)))
            .map((l: any) => {
                const id = randomUUID();
                return {
                    id,
                    user_id: userId,
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,

                    name: l.fullName,
                    title: l.title || '',
                    company: l.companyName || '',

                    email: l.email || null,
                    linkedin_url: l.linkedinUrl || null,

                    company_website: l.companyDomain || null,
                    industry: String(industry || '').trim() || null,
                    location: String(location || '').trim() || null,

                    apollo_id: l.apolloId || null,
                    status: 'saved',
                    created_at: nowIso
                };
            });

        if (leadsToInsert.length > 0) {
            const { error: insertError } = await supabase.from('leads').insert(leadsToInsert);
            if (insertError) {
                console.error('[SEARCH] Failed to insert leads:', insertError);
                throw new Error(`Failed to insert leads: ${insertError.message}`);
            }

            await safeInsertLeadEvents(
                supabase,
                leadsToInsert.map((row: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: row.id,
                    event_type: 'lead_found',
                    stage: 'search',
                    outcome: 'inserted',
                    message: `Lead encontrado: ${row.name}`,
                    meta: {
                        title: row.title,
                        company: row.company,
                        email: row.email,
                        linkedin_url: row.linkedin_url,
                        apollo_id: row.apollo_id,
                    },
                    created_at: nowIso,
                }))
            );
        }

        const duplicatesSkipped = leads.length - leadsToInsert.length;

        await incrementUsage(supabase, task.organization_id, 'search', leadsToInsert.length, task.id);
        await incrementUsage(supabase, task.organization_id, 'search_run', 1, task.id);

        // Chain to ENRICH if configured
        if (task.payload.enrichmentLevel && leadsToInsert.length > 0) {
            const leadsForEnrich = leadsToInsert.slice(0, 10).map((row: any) => ({
                id: row.id,
                clientRef: row.id,
                fullName: row.name,
                title: row.title,
                companyName: row.company,
                linkedinUrl: row.linkedin_url,
                companyDomain: row.company_website,
                email: row.email,
                apolloId: row.apollo_id,
                location: row.location,
                industry: row.industry,
            }));

            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'ENRICH',
                status: 'pending',
                payload: {
                    userId: userId,
                    leads: leadsForEnrich,
                    enrichmentLevel: task.payload.enrichmentLevel,
                    campaignName: task.payload.campaignName,
                    source: 'search_inserted'
                },
                created_at: nowIso
            });
        }

        await safeHeartbeatTask(supabase, task.id, { progress_label: `Búsqueda completada: ${leadsToInsert.length} lead(s)` });

        return {
            leadsFound: leadsToInsert.length,
            duplicatesSkipped,
            searchCriteria: { jobTitle, location, industry, keywords },
            sampleLeads: leads.slice(0, 5).map((l: any) => ({ name: l.fullName, company: l.companyName, title: l.title }))
        };
    } else {
        // NO LEADS FOUND - EXHAUSTION DETECTION
        console.log('[SEARCH] ⚠️ No leads found with current filters - checking for uncontacted leads from previous searches');

        // 1. Log the exhaustion event
        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'warning',
            message: 'No se encontraron nuevos leads con los filtros actuales',
            details: {
                searchCriteria: { jobTitle, location, industry, keywords },
                action: 'checking_previous_leads'
            }
        });

        // 2. Check for previously found but uncontacted leads
        // Get list of already contacted lead IDs
        const { data: contactedLeadIds } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', task.mission_id);

        const contactedIds = (contactedLeadIds || []).map((c: any) => c.lead_id).filter(Boolean);

        // Find enriched leads that haven't been contacted
        let uncontactedQuery = supabase
            .from('leads')
            .select('id, name, email, title, company, linkedin_url, company_website, apollo_id, industry, location')
            .eq('mission_id', task.mission_id)
            .eq('status', 'enriched')
            .limit(50);

        if (contactedIds.length > 0) {
            uncontactedQuery = uncontactedQuery.not('id', 'in', `(${contactedIds.join(',')})`);
        }

        const { data: uncontactedLeads, error: queryError } = await uncontactedQuery;

        if (queryError) {
            console.error('[SEARCH] Error querying uncontacted leads:', queryError);
        }

        if (uncontactedLeads && uncontactedLeads.length > 0) {
            console.log(`[SEARCH] ✅ Found ${uncontactedLeads.length} previously enriched but uncontacted leads`);

            // 3. Create INVESTIGATE + CONTACT tasks for these leads
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'INVESTIGATE',
                status: 'pending',
                payload: {
                    userId: userId,
                    leads: uncontactedLeads.slice(0, 10), // Process in batches
                    source: 'reused_from_previous_searches'
                },
                created_at: new Date().toISOString()
            });

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'info',
                message: `Reutilizando ${uncontactedLeads.length} leads encontrados previamente`,
                details: {
                    uncontactedCount: uncontactedLeads.length,
                    action: 'reusing_previous_leads'
                }
            });

            return {
                leadsFound: 0,
                reusedLeads: uncontactedLeads.length,
                exhausted: true,
                message: 'No se encontraron nuevos leads. Reutilizando leads previos no contactados.'
            };
        } else {
            // 4. No new leads AND no uncontacted previous leads
            console.log('[SEARCH] ❌ CRITICAL: No new leads and no uncontacted previous leads available');

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'error',
                message: '⚠️ AGOTAMIENTO TOTAL: No hay más leads disponibles',
                details: {
                    searchCriteria: { jobTitle, location, industry, keywords },
                    recommendation: 'Considere ampliar los filtros de búsqueda o pausar la misión'
                }
            });

            // Create a notification task to alert the user
            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'GENERATE_REPORT',
                status: 'pending',
                payload: {
                    reportType: 'lead_exhaustion_alert',
                    userId: userId,
                    missionId: task.mission_id,
                    searchCriteria: { jobTitle, location, industry, keywords }
                },
                created_at: new Date().toISOString()
            });

            return {
                leadsFound: 0,
                reusedLeads: 0,
                exhausted: true,
                critical: true,
                message: 'AGOTAMIENTO TOTAL: No hay más leads disponibles con estos filtros.'
            };
        }
    }

    await safeHeartbeatTask(supabase, task.id, { progress_label: 'Búsqueda completada: 0 leads' });

    return {
        leadsFound: 0,
        searchCriteria: { jobTitle, location, industry, keywords },
        sampleLeads: []
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
    const limit = Math.min(50, mission?.daily_enrich_limit || 10);

    console.log(`[ENRICH] 🔍 QUOTA CHECK: `, {
        organization_id: task.organization_id,
        mission_id: task.mission_id,
        current_enriched: usage.leads_enriched || 0,
        limit: limit,
        remaining: limit - (usage.leads_enriched || 0),
        will_skip: (usage.leads_enriched || 0) >= limit
    });

    if ((usage.leads_enriched || 0) >= limit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[ENRICH] ⚠️ Daily limit reached(${usage.leads_enriched} / ${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }

    let { leads, enrichmentLevel, campaignName } = task.payload;
    const userId = await getTaskUserId(task, supabase);

    console.log(`[ENRICH] Task payload: `, JSON.stringify({
        leadsCount: leads?.length || 0,
        userId,
        enrichmentLevel,
        campaignName
    }));

    const remaining = Math.max(0, limit - (usage.leads_enriched || 0));

    // Backward compatibility:
    // - Old tasks might include raw leads from the external service (no DB UUIDs)
    // - New tasks should include DB-backed leads with stable `id`
    // If we can't guarantee stable IDs, we fetch from the DB queue.
    const hasStableIds = Array.isArray(leads) && leads.some((l: any) => typeof l?.id === 'string' && l.id.length >= 32);

    if (!Array.isArray(leads) || leads.length === 0 || !hasStableIds) {
        console.log('[ENRICH] No stable leads in payload. Fetching from DB queue (status=saved)...');
        const { data: queued, error: qErr } = await supabase
            .from('leads')
            .select('id, name, email, title, company, linkedin_url, company_website, apollo_id, industry, location')
            .eq('mission_id', task.mission_id)
            .eq('status', 'saved')
            .order('created_at', { ascending: false })
            .limit(Math.min(remaining, 50));

        if (qErr) {
            console.error('[ENRICH] Failed to fetch queue leads:', qErr);
            return { enrichedCount: 0, skipped: true, reason: 'queue_fetch_failed' };
        }
        leads = queued || [];
    }

    if (!Array.isArray(leads) || leads.length === 0) {
        console.log('[ENRICH] No leads to enrich after fallback');
        return { enrichedCount: 0, skipped: true, reason: 'no_leads' };
    }

    const leadsToEnrich = leads.slice(0, remaining);

    // If we had more leads than capacity, record that they were deferred (so the UI can explain "what happened")
    if (Array.isArray(leads) && leads.length > leadsToEnrich.length) {
        const deferred = leads.slice(leadsToEnrich.length);
        await safeInsertLeadEvents(
            supabase,
            deferred
                .filter((l: any) => !!l?.id)
                .map((l: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(l.id),
                    event_type: 'lead_enrich_skipped',
                    stage: 'enrich',
                    outcome: 'deferred_by_quota',
                    message: 'Enriquecimiento diferido por cuota diaria',
                    meta: { remainingCapacity: remaining },
                    created_at: new Date().toISOString(),
                }))
        );
    }

    console.log(`[ENRICH] Enriching ${leadsToEnrich.length} leads`);

    const appUrl = getAppUrl();
    console.log(`[ENRICH] Using appUrl: ${appUrl} `);

    const revealPhone = enrichmentLevel === 'deep' || enrichmentLevel === 'premium' || enrichmentLevel === 'phone';

    // Map leads to the format expected by the API.
    // CRITICAL: include `id`/`clientRef` so the enrichment result keeps the SAME UUID as `leads.id`.
    const leadsFormatted = leadsToEnrich.map((lead: any) => ({
        id: lead.id,
        clientRef: lead.id,
        fullName: lead.fullName || lead.full_name || lead.name || '',
        title: lead.title || '',
        companyName: lead.companyName || lead.company_name || lead.company || lead.organization?.name || lead.organization_name || '',
        linkedinUrl: lead.linkedinUrl || lead.linkedin_url || null,
        companyDomain: lead.companyDomain || lead.company_domain || lead.company_website || lead.organization_website_url || null,
        email: lead.email || null,
        apolloId: lead.apolloId || lead.apollo_id || null,
        // Keep a reference (not used as identifier)
        sourceOpportunityId: lead.id
    }));

    console.log(`[ENRICH] Calling enrichment API with ${leadsFormatted.length} leads`);

    const attemptAt = new Date().toISOString();
    await safeHeartbeatTask(supabase, task.id, {
        progress_current: 0,
        progress_total: leadsFormatted.length,
        progress_label: `Enriqueciendo ${leadsFormatted.length} lead(s)...`
    });

    await safeInsertLeadEvents(
        supabase,
        leadsFormatted
            .filter((l: any) => !!l?.id)
            .map((l: any) => ({
                organization_id: task.organization_id,
                mission_id: task.mission_id,
                task_id: task.id,
                lead_id: String(l.id),
                event_type: 'lead_enrich_started',
                stage: 'enrich',
                outcome: 'started',
                message: 'Enriquecimiento iniciado',
                meta: {
                    revealPhone,
                    enrichmentLevel: enrichmentLevel || null,
                },
                created_at: attemptAt,
            }))
    );

    try {
        const response = await fetch(`${appUrl}/api/opportunities/enrich-apollo`, {
            method: 'POST',
            headers: withInternalApiSecret({
                'Content-Type': 'application/json',
                'x-user-id': userId
            }),
                body: JSON.stringify({
                    leads: leadsFormatted,
                    revealEmail: true,
                    revealPhone
                })
            });

        console.log(`[ENRICH] API response status: ${response.status} `);

        if (response.ok) {
            const data = await response.json();
            const enrichedLeads = Array.isArray(data?.enriched) ? data.enriched : [];
            console.log(`[ENRICH] Successfully enriched ${enrichedLeads.length} leads`);

            // Map results by lead id
            const enrichedById = new Map<string, any>();
            for (const l of enrichedLeads) {
                if (l?.id) enrichedById.set(String(l.id), l);
            }

            const events: LeadEventInsert[] = [];
            let emailFoundCount = 0;
            let noEmailCount = 0;
            let missingResultCount = 0;

            // Persist enriched fields back into `leads` so later steps can filter reliably.
            // NOTE: /api/opportunities/enrich-apollo already consumes/records daily quota in antonia_daily_usage.
            // Do NOT increment usage here to avoid double counting.
            for (const input of leadsFormatted) {
                const leadId = String(input?.id || '').trim();
                if (!leadId) continue;

                const out = enrichedById.get(leadId);
                if (!out) {
                    missingResultCount++;
                    // Mark attempt for observability
                    await supabase
                        .from('leads')
                        .update({
                            last_enrichment_attempt_at: attemptAt,
                            enrichment_error: 'enrichment_no_result'
                        } as any)
                        .eq('id', leadId);

                    events.push({
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        task_id: task.id,
                        lead_id: leadId,
                        event_type: 'lead_enrich_failed',
                        stage: 'enrich',
                        outcome: 'no_result',
                        message: 'Enriquecimiento sin resultado (API no devolvio item)',
                        meta: { revealPhone },
                        created_at: attemptAt,
                    });
                    continue;
                }

                const emailFound = Boolean(out.email);
                if (emailFound) emailFoundCount++; else noEmailCount++;

                const updateData: any = {
                    status: 'enriched',
                    last_enriched_at: attemptAt,
                    last_enrichment_attempt_at: attemptAt,
                    enrichment_error: emailFound ? null : 'no_email',
                };

                if (out.email !== undefined) updateData.email = out.email || null;
                if (out.linkedinUrl !== undefined) updateData.linkedin_url = out.linkedinUrl || null;
                if (out.title) updateData.title = out.title;
                if (out.companyName) updateData.company = out.companyName;
                if (out.industry) updateData.industry = out.industry;
                if (out.location) updateData.location = out.location;

                const { error: updateError } = await supabase
                    .from('leads')
                    .update(updateData)
                    .eq('id', leadId);
                if (updateError) console.error('[ENRICH] Error updating lead row:', leadId, updateError);

                const phoneNumbers = out.phoneNumbers || out.phone_numbers || null;
                const primaryPhone = out.primaryPhone || out.primary_phone || null;
                const phoneFound = Boolean(primaryPhone) || (Array.isArray(phoneNumbers) && phoneNumbers.length > 0);

                events.push({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: leadId,
                    event_type: 'lead_enrich_completed',
                    stage: 'enrich',
                    outcome: emailFound ? 'email_found' : 'no_email',
                    message: emailFound ? 'Email encontrado' : 'Sin email',
                    meta: {
                        email: out.email || null,
                        emailStatus: out.emailStatus || out.email_status || null,
                        phoneFound,
                        primaryPhone,
                        enrichmentStatus: out.enrichmentStatus || out.enrichment_status || null,
                    },
                    created_at: attemptAt,
                });
            }

            await safeInsertLeadEvents(supabase, events);
            await safeHeartbeatTask(supabase, task.id, {
                progress_current: leadsFormatted.length,
                progress_total: leadsFormatted.length,
                progress_label: `Enriquecimiento completado: ${emailFoundCount} con email, ${noEmailCount} sin email`
            });

            // Chain to INVESTIGATE only for contactable leads (email present)
            const leadsEligible = enrichedLeads.filter((l: any) => !!l?.email);
            if (leadsEligible.length > 0) {
                await supabase.from('antonia_tasks').insert({
                    mission_id: task.mission_id,
                    organization_id: task.organization_id,
                    type: 'INVESTIGATE',
                    status: 'pending',
                    payload: {
                        userId: userId,
                        leads: leadsEligible,
                        campaignName: campaignName,
                        dryRun: task.payload.dryRun
                    },
                    created_at: attemptAt
                });
            }

            return {
                enrichedCount: enrichedLeads.length,
                emailFoundCount,
                noEmailCount,
                missingResultCount,
                enrichedLeadsSummary: enrichedLeads.slice(0, 30).map((l: any) => ({
                    id: l.id,
                    name: l.fullName || l.name,
                    company: l.companyName || l.organization?.name,
                    emailFound: !!l.email,
                    linkedinFound: !!(l.linkedinUrl || l.linkedin_url)
                }))
            };
        } else {
            const errorText = await response.text().catch(() => '');
            console.error(`[ENRICH] API error: ${response.status} - ${errorText} `);

            // Mark attempts as failed for observability
            const events: LeadEventInsert[] = leadsFormatted
                .filter((l: any) => !!l?.id)
                .map((l: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(l.id),
                    event_type: 'lead_enrich_failed',
                    stage: 'enrich',
                    outcome: `api_${response.status}`,
                    message: 'Error llamando API de enriquecimiento',
                    meta: { error: errorText.slice(0, 800) },
                    created_at: attemptAt,
                }));
            await safeInsertLeadEvents(supabase, events);
            await safeHeartbeatTask(supabase, task.id, { progress_label: `Error de enriquecimiento (${response.status})` });
            return { enrichedCount: 0, error: errorText };
        }
    } catch (e) {
        console.error('[ENRICH] Failed to enrich leads:', e);
        await safeHeartbeatTask(supabase, task.id, { progress_label: 'Error de enriquecimiento (exception)' });
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
    const limit = Math.min(50, mission?.daily_investigate_limit || 5);

    console.log(`[INVESTIGATE] 🔍 QUOTA CHECK: `, {
        organization_id: task.organization_id,
        mission_id: task.mission_id,
        current_investigated: usage.leads_investigated || 0,
        limit: limit,
        remaining: limit - (usage.leads_investigated || 0),
        will_skip: (usage.leads_investigated || 0) >= limit
    });

    if ((usage.leads_investigated || 0) >= limit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[INVESTIGATE] ⚠️ Daily limit reached(${usage.leads_investigated} / ${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }

    let { leads, campaignName } = task.payload;
    // Use helper for Robust Fallback
    const userId = await getTaskUserId(task, supabase);

    const remaining = Math.max(0, limit - (usage.leads_investigated || 0));

    if (!Array.isArray(leads) || leads.length === 0) {
        console.log('[INVESTIGATE] No leads in payload. Fetching from DB (status=enriched, not contacted)...');

        const { data: contactedLeadIds } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', task.mission_id);

        const contactedIds = (contactedLeadIds || []).map((c: any) => c.lead_id).filter(Boolean);

        let q = supabase
            .from('leads')
            .select('id, name, email, title, company, linkedin_url, company_website, apollo_id, industry, location')
            .eq('mission_id', task.mission_id)
            .eq('status', 'enriched')
            .not('email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(Math.min(remaining, 50));

        if (contactedIds.length > 0) {
            q = q.not('id', 'in', `(${contactedIds.join(',')})`);
        }

        const { data: fallbackLeads, error: qErr } = await q;
        if (qErr) {
            console.error('[INVESTIGATE] Failed to fetch enriched leads:', qErr);
            return { skipped: true, reason: 'queue_fetch_failed' };
        }
        leads = fallbackLeads || [];
    }

    if (!Array.isArray(leads) || leads.length === 0) {
        console.log('[INVESTIGATE] No leads to investigate after fallback');
        return { skipped: true, reason: 'no_leads' };
    }

    const leadsToInvestigate = leads.slice(0, remaining);

    if (Array.isArray(leads) && leads.length > leadsToInvestigate.length) {
        const deferred = leads.slice(leadsToInvestigate.length);
        await safeInsertLeadEvents(
            supabase,
            deferred
                .filter((l: any) => !!l?.id)
                .map((l: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(l.id),
                    event_type: 'lead_investigate_skipped',
                    stage: 'investigate',
                    outcome: 'deferred_by_quota',
                    message: 'Investigacion diferida por cuota diaria',
                    meta: { remainingCapacity: remaining },
                    created_at: new Date().toISOString(),
                }))
        );
    }

    const attemptAt = new Date().toISOString();
    await safeHeartbeatTask(supabase, task.id, {
        progress_current: 0,
        progress_total: leadsToInvestigate.length,
        progress_label: `Investigando ${leadsToInvestigate.length} lead(s)...`
    });

    await safeInsertLeadEvents(
        supabase,
        leadsToInvestigate
            .filter((l: any) => !!l?.id)
            .map((l: any) => ({
                organization_id: task.organization_id,
                mission_id: task.mission_id,
                task_id: task.id,
                lead_id: String(l.id),
                event_type: 'lead_investigate_started',
                stage: 'investigate',
                outcome: 'started',
                message: 'Investigacion iniciada',
                created_at: attemptAt,
            }))
    );

    // Restore appUrl if missing (it seems present in line 354, but good to be sure or just define leadsToInvestigate)
    console.log(`[INVESTIGATE] Investigating ${leadsToInvestigate.length} leads`);


    const appUrl = getAppUrl();
    const investigatedLeads = [];

    // Fetch User Profile for Context (Name, Job Title, Company Profile)
    const { data: userProfile } = await supabase
        .from('profiles')
        .select('full_name, job_title, company_name, company_domain, signatures')
        .eq('id', userId)
        .single();

    // Extract company profile from signatures.profile_extended (same as UI)
    const profileExtended = userProfile?.signatures?.profile_extended || {};

    // 🔧 FIX: Use signatures.profile_extended (has data) not company_profile.signatures
    const userCompanyProfile = {
        name: userProfile?.company_name || profileExtended.companyName || 'Tu Empresa',
        sector: profileExtended.sector || '',
        description: profileExtended.description || '',
        services: profileExtended.services || '',
        valueProposition: profileExtended.valueProposition || '',
        website: userProfile?.company_domain || profileExtended.website || ''
    };

    const userContext = {
        id: userId,
        name: userProfile?.full_name || 'Usuario',
        jobTitle: userProfile?.job_title || profileExtended.role || 'Gerente'
    };

    // 🛡️ CRITICAL GUARD: Ensure we have a valid user context before calling N8N
    if (userContext.id === 'anon' || !userContext.id || userCompanyProfile.name === 'Tu Empresa') {
        const debugInfo = JSON.stringify({
            userId: userId,
            profileFound: !!userProfile,
            compNameDB: userProfile?.company_name,
            compNameExt: profileExtended?.companyName,
            finalName: userCompanyProfile.name
        });
        console.error('[INVESTIGATE] 🚨 CRITICAL: Invalid User Context detected.', debugInfo);
        throw new Error(`Invalid User Context. Debug: ${debugInfo}`);
    }

    let investigateIndex = 0;
    for (const lead of leadsToInvestigate) {
        investigateIndex++;
        await safeHeartbeatTask(supabase, task.id, {
            progress_current: investigateIndex,
            progress_total: leadsToInvestigate.length,
            progress_label: `Investigando (${investigateIndex}/${leadsToInvestigate.length}): ${lead.fullName || lead.full_name || lead.name || 'lead'}`
        });

        try {
            console.log(`[INVESTIGATE] Investigating lead: `, {
                name: lead.fullName || lead.full_name || lead.name,
                company: lead.companyName || lead.company_name || lead.company
            });

            // Construct specific N8N payload structure
            const n8nPayload = {
                companies: [
                    {
                        leadRef: lead.id,
                        targetCompany: {
                            name: lead.companyName || lead.company_name || lead.company || lead.organization?.name,
                            domain: lead.companyDomain || lead.company_domain || lead.company_website,
                            linkedin: null, // Populate if available
                            country: lead.location || null,
                            industry: lead.industry || "—",
                            website: lead.website || lead.company_website || null
                        },
                        lead: {
                            id: lead.id,
                            fullName: lead.fullName || lead.full_name || lead.name,
                            title: lead.title,
                            email: lead.email,
                            linkedinUrl: lead.linkedinUrl || lead.linkedin_url
                        },
                        meta: {
                            leadRef: lead.id
                        }
                    }
                ],
                userCompanyProfile: userCompanyProfile,
                id: lead.id,
                fullName: lead.fullName || lead.full_name || lead.name, // Redundant but requested in top level
                title: lead.title,
                email: lead.email,
                linkedinUrl: lead.linkedinUrl || lead.linkedin_url,
                companyName: lead.companyName || lead.company_name || lead.company || lead.organization?.name,
                companyDomain: lead.companyDomain || lead.company_domain || lead.company_website,
                userContext: userContext
            };

            // 🚀 Call N8N directly (URL configurable via env)
            const N8N_WEBHOOK_URL = process.env.ANTONIA_N8N_WEBHOOK_URL || "https://nicogun.app.n8n.cloud/webhook/ANTONIA";

            const response = await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                }),
                body: JSON.stringify(n8nPayload)
            });

            console.log(`[INVESTIGATE] API response status: ${response.status} `);

            if (response.ok) {
                // The N8N workflow returns an array, we need to extract the first item's message content if it matches the structure
                const responseData = await response.json();

                // --- DEBUGGING LOG ---
                console.log(`[INVESTIGATE] Raw N8N Response for ${lead.email}: `, JSON.stringify(responseData).substring(0, 500));
                // ---------------------

                // Handle different response shapes (Array vs Object)
                let item = null;
                if (Array.isArray(responseData) && responseData.length > 0) {
                    item = responseData[0];
                } else if (responseData && typeof responseData === 'object') {
                    item = responseData;
                }

                let researchData = null;

                if (item && item.message && item.message.content) {
                    // Extract JSON from markdown code block if present
                    let content = item.message.content;

                    // Normalize newlines - N8N returns DOUBLE-escaped newlines (\\n as literal string)
                    content = content.replace(/\\\\n/g, '\n').replace(/\r\n/g, '\n');

                    let jsonStr = null;

                    // Strategy 1: Simple Regex for code blocks
                    const match = content.match(/```json\s*([\s\S]*?)```/);
                    if (match) {
                        jsonStr = match[1];
                    } else {
                        // Strategy 2: Brute force find first '{' and last '}'
                        const firstOpen = content.indexOf('{');
                        const lastClose = content.lastIndexOf('}');

                        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
                            jsonStr = content.substring(firstOpen, lastClose + 1);
                        }
                    }

                    if (jsonStr) {
                        try {
                            researchData = JSON.parse(jsonStr.trim());
                            console.log('[INVESTIGATE] Successfully parsed JSON via ' + (match ? 'regex' : 'brute-force'));
                        } catch (err) {
                            console.error('[INVESTIGATE] Failed to parse extracted JSON:', err);
                            researchData = item; // Fallback to raw item
                        }
                    } else {
                        try {
                            researchData = JSON.parse(content);
                            console.log('[INVESTIGATE] Successfully parsed raw JSON content');
                        } catch (e) {
                            researchData = item; // Fallback to raw item
                        }
                    }
                } else {
                    // Fallback to raw item if structure doesn't match
                    researchData = item || responseData;
                }


                if (researchData && researchData.overview) {
                    investigatedLeads.push({ ...lead, research: researchData });
                    console.log(`[INVESTIGATE] Successfully investigated lead`);
                } else if (researchData) {
                    investigatedLeads.push({ ...lead, research: researchData });
                    console.warn(`[INVESTIGATE] Parsed data missing 'overview' field`);
                } else {
                    console.warn(`[INVESTIGATE] Received empty or invalid research data`);

                    // DEBUG: Capture why it failed
                    let debugMsg = "Error parsing.";
                    if (!item) debugMsg += " Item is null.";
                    else if (!item.message) debugMsg += " No message.";
                    else if (!item.message.content) debugMsg += " No content.";
                    else {
                        const c = item.message.content;
                        debugMsg += ` Len = ${c.length} Start = ${c.substring(0, 20).replace(/\n/g, '\\n')} `;
                        // Check brute force failure
                        const first = c.indexOf('{');
                        const last = c.lastIndexOf('}');
                        debugMsg += ` Brute = ${first},${last} `;
                        if (first !== -1 && last !== -1) {
                            try {
                                JSON.parse(c.substring(first, last + 1));
                            } catch (e: any) {
                                debugMsg += ` Err:${e.message} `;
                            }
                        }
                    }
                    investigatedLeads.push({ ...lead, research: { overview: debugMsg } });
                }

                // Persist investigation timestamp for quick UI filters
                if (lead?.id) {
                    await supabase
                        .from('leads')
                        .update({ last_investigated_at: attemptAt, investigation_error: null } as any)
                        .eq('id', lead.id);
                }

                await safeInsertLeadEvents(supabase, [
                    {
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        task_id: task.id,
                        lead_id: String(lead.id),
                        event_type: 'lead_investigate_completed',
                        stage: 'investigate',
                        outcome: 'completed',
                        message: 'Investigacion completada',
                        meta: {
                            hasOverview: Boolean((investigatedLeads[investigatedLeads.length - 1] as any)?.research?.overview),
                        },
                        created_at: attemptAt,
                    }
                ]);

            } else {
                const errorText = await response.text();
                console.error(`[INVESTIGATE] API error: ${response.status} - ${errorText} `);

                // Treat non-OK as a failure, but keep the pipeline moving with a fallback summary
                const fallbackSummary = `${lead.companyName || lead.company || 'Company'} - ${lead.title || 'Professional'}.` +
                    `${lead.email ? ` Contact: ${lead.email}` : ' Contact information unavailable.'}`;

                investigatedLeads.push({
                    ...lead,
                    research: {
                        overview: fallbackSummary,
                        source: 'http_error',
                        note: `N8N error ${response.status}`
                    }
                });

                if (lead?.id) {
                    await supabase
                        .from('leads')
                        .update({ last_investigated_at: attemptAt, investigation_error: `http_${response.status}` } as any)
                        .eq('id', lead.id);
                }

                await safeInsertLeadEvents(supabase, [
                    {
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        task_id: task.id,
                        lead_id: String(lead.id),
                        event_type: 'lead_investigate_failed',
                        stage: 'investigate',
                        outcome: `http_${response.status}`,
                        message: 'Investigacion fallo (HTTP)',
                        meta: { error: errorText.slice(0, 800) },
                        created_at: attemptAt,
                    }
                ]);
            }

        } catch (e) {
            console.error('[INVESTIGATE] Failed to investigate lead:', e);

            // Fallback: Use generic summary based on available lead data
            const fallbackSummary = `${lead.companyName || lead.company || 'Company'} - ${lead.title || 'Professional'}.` +
                `${lead.email ? `Contact: ${lead.email}` : 'Contact information available.'} `;

            investigatedLeads.push({
                ...lead,
                research: {
                    overview: fallbackSummary,
                    source: 'fallback',
                    note: 'Research service temporarily unavailable'
                }
            });

            if (lead?.id) {
                await supabase
                    .from('leads')
                    .update({ last_investigated_at: attemptAt, investigation_error: 'exception' } as any)
                    .eq('id', lead.id);
            }

            await safeInsertLeadEvents(supabase, [
                {
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(lead.id),
                    event_type: 'lead_investigate_failed',
                    stage: 'investigate',
                    outcome: 'exception',
                    message: 'Investigacion fallo (exception)',
                    meta: { error: String((e as any)?.message || e).slice(0, 800) },
                    created_at: attemptAt,
                }
            ]);

            console.log(`[INVESTIGATE] Using fallback summary for ${lead.email}`);
        }
    }

    await incrementUsage(supabase, task.organization_id, 'investigate', investigatedLeads.length, task.id);

    // Chain to CONTACT if we have investigated leads
    if (investigatedLeads.length > 0) {
        for (const lead of investigatedLeads) {
            const schedule = computeLeadContactSchedule(lead);
            console.log(
                `[SCHEDULING] Contact for ${lead.email || lead.id} in "${schedule.location}" ` +
                `(${schedule.timeZone}, match:${schedule.matchedBy}, localNow:${formatZonedDateTime(schedule.localNow)}) ` +
                `at ${schedule.scheduledFor} [${schedule.reason}]`
            );

            await supabase.from('antonia_tasks').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT',
                status: 'pending',
                payload: {
                    userId: userId,
                    leads: [lead],
                    campaignName: campaignName,
                    dryRun: task.payload.dryRun // Pass dryRun flag
                },
                scheduled_for: schedule.scheduledFor,
                created_at: new Date().toISOString()
            });
        }
    }

    await safeHeartbeatTask(supabase, task.id, {
        progress_current: leadsToInvestigate.length,
        progress_total: leadsToInvestigate.length,
        progress_label: `Investigación completada: ${investigatedLeads.length} lead(s)`
    });

    return {
        investigatedCount: investigatedLeads.length,
        investigations: investigatedLeads.map((l: any) => ({
            name: l.fullName || l.name || l.full_name,
            company: l.companyName || l.company_name || l.company || l.organization?.name,
            summarySnippet: l.research?.summary || l.research?.overview
                ? (l.research.summary || l.research.overview).substring(0, 150) + '...'
                : (l.research?.company?.description ? l.research.company.description.substring(0, 150) + '...' : 'No summary available')
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
    const limit = Math.min(50, mission?.daily_contact_limit || 3);

    // Count contacts sent today
    const today = new Date().toISOString().split('T')[0];
    const { count: contactsToday } = await supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', task.organization_id)
        .gte('created_at', `${today}T00:00:00Z`);

    if ((contactsToday || 0) >= limit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[CONTACT] Daily limit reached(${contactsToday} / ${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }

    const { leads, campaignName, dryRun } = task.payload;
    const userId = await getTaskUserId(task, supabase);
    const leadsList = Array.isArray(leads) ? leads : [];
    // If dryRun, we don't consume daily limit? Or do we? 
    // User wants to "test", usually tests shouldn't burn quota, but for safety let's assume they might?
    // Actually, let's allow dryRun to bypass contactsToday check IF we want to allow unlimited testing,
    // but typically we should still respect limits or at least logs. 
    // Let's keep limit check for now to simulate real behavior.

    // Optional: link initial contact to a campaign for analytics/follow-ups
    let campaignRef: any = null;
    let campaignSentRecords: Record<string, any> | null = null;
    let campaignDirty = false;
    if (campaignName) {
        const { data: camp } = await supabase
            .from('campaigns')
            .select('id, sent_records, settings')
            .eq('organization_id', task.organization_id)
            .eq('name', campaignName)
            .maybeSingle();

        if (camp?.id) {
            campaignRef = camp as any;
            campaignSentRecords = { ...(camp.sent_records || {}) };
        }
    }

    // [DOMAIN BLACKLIST CHECK]
    const { data: excludedDomains } = await supabase
        .from('excluded_domains')
        .select('domain')
        .eq('organization_id', task.organization_id);

    const blacklistedSet = new Set((excludedDomains || []).map((d: any) => d.domain.toLowerCase().trim().replace('@', '')));

    const attemptAt = new Date().toISOString();
    const stage = 'contact';

    await safeHeartbeatTask(supabase, task.id, {
        progress_current: 0,
        progress_total: leadsList.length,
        progress_label: `Preparando contacto (${leadsList.length} lead(s))...`
    });

    // Filter out blacklisted domains (but record why we skipped)
    const leadsFiltered: any[] = [];
    const skippedEvents: LeadEventInsert[] = [];

    for (const l of leadsList) {
        const leadId = String(l?.id || '').trim();
        const email = String(l?.email || '').trim().toLowerCase();

        if (!email) {
            if (leadId) {
                skippedEvents.push({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: leadId,
                    event_type: 'lead_contact_skipped',
                    stage,
                    outcome: 'no_email',
                    message: 'Contacto omitido: lead sin email',
                    meta: { reason: 'no_email' },
                    created_at: attemptAt,
                });
            }
            continue;
        }

        const domain = email.split('@')[1]?.trim() || '';
        if (domain && blacklistedSet.has(domain)) {
            console.log(`[CONTACT] 🚫 Skipping ${email} due to Blacklisted Domain: ${domain}`);
            if (leadId) {
                skippedEvents.push({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: leadId,
                    event_type: 'lead_contact_blocked',
                    stage,
                    outcome: 'domain_blacklisted',
                    message: `Contacto bloqueado: dominio excluido (${domain})`,
                    meta: { reason: 'excluded_domain', domain },
                    created_at: attemptAt,
                });

                // Make it non-eligible for future pipeline runs
                await supabase
                    .from('leads')
                    .update({ status: 'do_not_contact' } as any)
                    .eq('id', leadId);
            }
            continue;
        }

        leadsFiltered.push(l);
    }

    await safeInsertLeadEvents(supabase, skippedEvents);

    const leadsToContact = leadsFiltered.slice(0, limit - (contactsToday || 0));

    if (leadsFiltered.length > leadsToContact.length) {
        const deferred = leadsFiltered.slice(leadsToContact.length);
        await safeInsertLeadEvents(
            supabase,
            deferred
                .filter((l: any) => !!l?.id)
                .map((l: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(l.id),
                    event_type: 'lead_contact_skipped',
                    stage,
                    outcome: 'deferred_by_quota',
                    message: 'Contacto diferido por cuota diaria',
                    meta: { dailyContactLimit: limit, contactsToday: contactsToday || 0 },
                    created_at: attemptAt,
                }))
        );
    }

    console.log(`[CONTACT] Contacting ${leadsToContact.length} leads`);

    await safeHeartbeatTask(supabase, task.id, {
        progress_current: 0,
        progress_total: leadsToContact.length,
        progress_label: `Contactando ${leadsToContact.length} lead(s)...`
    });

    await safeInsertLeadEvents(
        supabase,
        leadsToContact
            .filter((l: any) => !!l?.id)
            .map((l: any) => ({
                organization_id: task.organization_id,
                mission_id: task.mission_id,
                task_id: task.id,
                lead_id: String(l.id),
                event_type: 'lead_contact_started',
                stage,
                outcome: 'started',
                message: 'Contacto iniciado',
                meta: { dryRun: Boolean(dryRun) },
                created_at: attemptAt,
            }))
    );

    // Fetch user's email signature from profiles
    const { data: profile } = await supabase
        .from('profiles')
        .select('signatures, full_name, job_title')
        .eq('id', userId)
        .single();

    // Get the signature for the provider being used (google or outlook)
    // Signatures are stored as: { google: "...", outlook: "..." }
    let userSignature = '';

    // Construct signature logic
    if (profile?.signatures && (profile.signatures.google || profile.signatures.outlook)) {
        // Try to get signature for google first (most common), fallback to outlook
        userSignature = profile.signatures.google || profile.signatures.outlook || '';
    } else {
        // Fallback: Create a simple text signature based on profile info
        const signerName = profile?.full_name || 'Usuario';
        const signerTitle = profile?.job_title ? `\n${profile.job_title} ` : '';
        userSignature = `\n${signerName}${signerTitle} `;
    }

    // Default templates (Fallback if research.emailDraft is missing)
    const defaultSubject = 'Oportunidad de colaboración - {{company}}';
    let defaultBody = `Hola {{name}},

Estuve leyendo sobre {{company}} y vi que {{research.summary}}

Me pareció muy interesante y me gustaría conectar contigo para explorar posibles oportunidades de colaboración.

¿Tendrías disponibilidad para una breve conversación?

Saludos,`;

    if (userSignature) {
        defaultBody += `\n\n${userSignature} `;
    }

    // App URL (server-to-server)
    const appUrl = getAppUrl();

    console.log(`[CONTACT_INITIAL] Preparing to contact leads using Research Drafts (if available)`);

    let contactedCount = 0;

    let contactIndex = 0;
    for (const lead of leadsToContact) {
        contactIndex++;
        await safeHeartbeatTask(supabase, task.id, {
            progress_current: contactIndex,
            progress_total: leadsToContact.length,
            progress_label: `Contactando (${contactIndex}/${leadsToContact.length}): ${lead.fullName || lead.full_name || lead.name || lead.email || 'lead'}`
        });

        try {
            // Safe access to research summary
            const researchData = lead.research;
            const researchSummary = researchData?.overview || researchData?.summary || 'tienen iniciativas interesantes en curso.';

            // Determine Subject and Body
            // Priority 1: Use Draft from Research
            let finalSubject = defaultSubject;
            let finalBody = defaultBody;

            if (researchData?.emailDraft?.subject && researchData?.emailDraft?.body) {
                console.log(`[CONTACT] Using AI Generated Draft for ${lead.email}`);
                finalSubject = researchData.emailDraft.subject;
                finalBody = researchData.emailDraft.body;

                // If the draft body does NOT contain the signature, append it?
                // Usually N8N drafts might include a placeholder or just the text.
                // Let's assume we append signature if strictly necessary OR if the draft doesn't look like it has one.
                // Safest approach: Append signature if configured signature is not null and body doesn't end with it.
                // For now, let's trust the draft BUT ensure unsubscription link is added.
                // Actually, let's append our signature if the body is short/generic.
                // Better yet: Just append the signature if we generated it from profile.
                // If using N8N draft, user might expect the prompt to handle signing.
                // Reviewing user example: "Saludos cordiales,\n\nNicolás Yaur..." IS in the draft.
                // So if draft exists, we DO NOT append userSignature again, unless we detect it's missing.

            } else {
                console.log(`[CONTACT] Using Default Template for ${lead.email}`);
                // Use fallback template (unsubscribe footer is appended server-side in /api/contact/send)
                finalBody = defaultBody;
            }

            // Replace template variables (Applicable to both Default and Drafts if they use {{}} syntax, though N8N drafts usually come resolved)
            // We should still run replacement just in case the draft uses placeholders
            const personalizedSubject = finalSubject
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || lead.name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || lead.company || 'your company');

            const personalizedBody = finalBody
                .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || lead.name || 'there')
                .replace(/\{\{company\}\}/g, lead.companyName || lead.company_name || lead.company || 'your company')
                .replace(/\{\{title\}\}/g, lead.title || 'your role')
                .replace(/\{\{research\.summary\}\}/g, researchSummary)
                .replace(/\{\{email\}\}/g, lead.email || '');

            // Validate and clean unreplaced variables
            const unreplacedVars = personalizedBody.match(/\{\{[^}]+\}\}/g);
            let cleanedBody = personalizedBody;

            if (unreplacedVars && unreplacedVars.length > 0) {
                console.warn(`[CONTACT] Unreplaced variables found for ${lead.email}: `, unreplacedVars);
                cleanedBody = personalizedBody.replace(/\{\{[^}]+\}\}/g, '[información]');
            }

            console.log(`[CONTACT] Sending email to ${lead.email} `);

            // [DRY RUN CHECK]
            if (dryRun) {
                console.log(`[DRY_RUN] 🛑 SKIPPING API CALL for ${lead.email}`);
                console.log(`[DRY_RUN] 📧 Subject: ${personalizedSubject}`);
                console.log(`[DRY_RUN] 📝 Body Preview: ${cleanedBody.substring(0, 200)}...`);
                console.log(`[DRY_RUN] 📝 Full Body Length: ${cleanedBody.length}`);

                // Simulate success
                contactedCount++;
                console.log(`[CONTACT] Dry Run success for ${lead.email}`);

                const sentAt = new Date().toISOString();

                await supabase.from('contacted_leads').insert({
                    user_id: userId,
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    lead_id: lead.id,

                    // Store display fields for UI/analytics
                    name: lead.fullName || lead.full_name || lead.name || '',
                    email: lead.email,
                    company: lead.companyName || lead.company_name || lead.company || '',
                    role: lead.title || '',
                    industry: lead.industry || null,
                    city: lead.city || null,
                    country: lead.country || null,

                    status: 'sent',
                    subject: personalizedSubject,
                    provider: 'gmail',
                    sent_at: sentAt,

                    // Seed evaluation fields so the heartbeat can pick it up
                    evaluation_status: 'pending',
                    last_interaction_at: sentAt,
                    engagement_score: 0,
                    last_update_at: sentAt,
                } as any);

                if (campaignRef && campaignSentRecords && lead?.id) {
                    campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: sentAt };
                    campaignDirty = true;
                }

                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_sent',
                            stage,
                            outcome: 'sent',
                            message: 'Contacto enviado (dry run)',
                            meta: { dryRun: true },
                            created_at: attemptAt,
                        }
                    ]);
                }

                // Mark lead as contacted so it leaves the enriched queue
                if (lead.id) {
                    const { error: leadUpdateErr } = await supabase
                        .from('leads')
                        .update({ status: 'contacted' })
                        .eq('id', lead.id);
                    if (leadUpdateErr) console.error('[CONTACT] Failed to update lead status to contacted (dry_run):', lead.id, leadUpdateErr);
                }
                continue; // Skip the rest of the loop (actual fetch)
            }

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                }),
                body: JSON.stringify({
                    to: lead.email,
                    subject: personalizedSubject,
                    body: cleanedBody, // Use cleaned body instead of personalizedBody
                    leadId: lead.id,
                    campaignId: null,
                    missionId: task.mission_id,
                    userId: userId,
                    tracking: campaignRef?.settings?.tracking
                })
            });

            console.log(`[CONTACT] API response status: ${response.status} `);

            if (response.ok) {
                contactedCount++;
                const resData = await response.json();
                console.log(`[CONTACT] Successfully contacted lead via ${resData.provider} `);

                const sentAt = new Date().toISOString();

                await supabase.from('contacted_leads').insert({
                    user_id: userId,
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    lead_id: lead.id,

                    name: lead.fullName || lead.full_name || lead.name || '',
                    email: lead.email,
                    company: lead.companyName || lead.company_name || lead.company || '',
                    role: lead.title || '',
                    industry: lead.industry || null,
                    city: lead.city || null,
                    country: lead.country || null,

                    status: 'sent',
                    subject: personalizedSubject,
                    provider: resData.provider || 'unknown',
                    sent_at: sentAt,

                    evaluation_status: 'pending',
                    last_interaction_at: sentAt,
                    engagement_score: 0,
                    last_update_at: sentAt,
                } as any);

                if (campaignRef && campaignSentRecords && lead?.id) {
                    campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: sentAt };
                    campaignDirty = true;
                }

                if (lead.id) {
                    const { error: leadUpdateErr } = await supabase
                        .from('leads')
                        .update({ status: 'contacted' })
                        .eq('id', lead.id);
                    if (leadUpdateErr) console.error('[CONTACT] Failed to update lead status to contacted:', lead.id, leadUpdateErr);
                }

                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_sent',
                            stage,
                            outcome: 'sent',
                            message: 'Contacto enviado',
                            meta: { provider: resData.provider || 'unknown' },
                            created_at: attemptAt,
                        }
                    ]);
                }
            } else {
                const errorText = await response.text();
                console.error(`[CONTACT] API error: ${response.status} - ${errorText} `);

                // Track error for reporting
                lead.error = `API Error ${response.status}: ${errorText.substring(0, 100)} `;

                const lower = String(errorText || '').toLowerCase();
                const isUnsub = response.status === 409 || lower.includes('unsub');
                const isBlockedDomain = response.status === 403 || lower.includes('domain blocked') || lower.includes('blocked');

                if (lead?.id) {
                    if (isUnsub || isBlockedDomain) {
                        // Don't try again in the automation pipeline
                        await supabase
                            .from('leads')
                            .update({ status: 'do_not_contact' } as any)
                            .eq('id', lead.id);

                        await safeInsertLeadEvents(supabase, [
                            {
                                organization_id: task.organization_id,
                                mission_id: task.mission_id,
                                task_id: task.id,
                                lead_id: String(lead.id),
                                event_type: 'lead_contact_blocked',
                                stage,
                                outcome: isUnsub ? 'unsubscribed' : 'domain_blocked',
                                message: isUnsub ? 'Contacto bloqueado: destinatario dado de baja' : 'Contacto bloqueado: dominio excluido',
                                meta: { status: response.status, error: errorText.slice(0, 800) },
                                created_at: attemptAt,
                            }
                        ]);
                    } else {
                        await safeInsertLeadEvents(supabase, [
                            {
                                organization_id: task.organization_id,
                                mission_id: task.mission_id,
                                task_id: task.id,
                                lead_id: String(lead.id),
                                event_type: 'lead_contact_failed',
                                stage,
                                outcome: `api_${response.status}`,
                                message: 'Fallo enviando contacto',
                                meta: { status: response.status, error: errorText.slice(0, 800) },
                                created_at: attemptAt,
                            }
                        ]);
                    }
                }
            }
        } catch (e: any) {
            console.error('[CONTACT] Failed to contact lead:', e);
            lead.error = `Exception: ${e.message} `;

            if (lead?.id) {
                await safeInsertLeadEvents(supabase, [
                    {
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        task_id: task.id,
                        lead_id: String(lead.id),
                        event_type: 'lead_contact_failed',
                        stage,
                        outcome: 'exception',
                        message: 'Fallo enviando contacto (exception)',
                        meta: { error: String(e?.message || e).slice(0, 800) },
                        created_at: attemptAt,
                    }
                ]);
            }
        }
    }

    if (campaignRef && campaignDirty && campaignSentRecords) {
        const { error: campErr } = await supabase
            .from('campaigns')
            .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
            .eq('id', campaignRef.id);
        if (campErr) {
            console.warn('[CONTACT] Failed to update campaign sent_records:', campErr);
        }
    }

    // Do NOT mark mission as completed immediately. 
    // The mission continues with the evaluation phase.

    await safeHeartbeatTask(supabase, task.id, {
        progress_current: leadsToContact.length,
        progress_total: leadsToContact.length,
        progress_label: `Contacto completado: ${contactedCount} enviado(s)`
    });

    return {
        contactedCount,
        contactedList: leadsToContact.map((l: any) => ({
            name: l.fullName || l.full_name || l.name,
            email: l.email,
            company: l.companyName || l.company_name || l.company,
            status: l.error ? 'failed' : 'sent',
            error: l.error || null
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
            .eq('mission_id', task.mission_id)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const score = contactedLead?.engagement_score || 0;
        const hasReplied = interactions?.some((i: any) => i.type === 'reply');

        console.log(`[EVALUATE] Leading ${lead.email} - Score: ${score}, Replied: ${hasReplied} `);

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
                }
            });
            console.log(`[EVALUATE] Lead qualified! Created CONTACT_CAMPAIGN task.`);
        }

        // Update status
        await supabase.from('contacted_leads').update({
            evaluation_status: newStatus
        }).eq('lead_id', lead.id).eq('mission_id', task.mission_id);
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
// --- 7. EXECUTE REPORT GENERATION ---
async function executeReportGeneration(task: any, supabase: SupabaseClient) {
    const { reportType, userId, missionId } = task.payload;
    const organizationId = task.organization_id;

    let subject = '';
    let htmlContent = '';
    let summaryData: any = {}; // Initialize with proper type

    if (reportType === 'daily') {
        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 24 * 60 * 60 * 1000);
        const rangeStartIso = rangeStart.toISOString();
        const rangeEndIso = rangeEnd.toISOString();
        const rangeStartDate = rangeStartIso.split('T')[0];
        const rangeEndDate = rangeEndIso.split('T')[0];
        const rangeLabel = `${rangeStart.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${rangeStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} - ${rangeEnd.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${rangeEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;

        subject = `Reporte Diario Antonia AI · ${rangeStart.toLocaleDateString('es-AR')} - ${rangeEnd.toLocaleDateString('es-AR')}`;

        // 1) Usage totals (covers quota-controlled counters)
        const { data: usageRows } = await supabase
            .from('antonia_daily_usage')
            .select('leads_searched, leads_enriched, leads_investigated, search_runs, date')
            .eq('organization_id', organizationId)
            .gte('date', rangeStartDate)
            .lte('date', rangeEndDate);

        const usageTotals = ((usageRows as any[]) || []).reduce(
            (acc: any, row: any) => {
                acc.leadsSearched += Number(row?.leads_searched || 0);
                acc.leadsEnriched += Number(row?.leads_enriched || 0);
                acc.leadsInvestigated += Number(row?.leads_investigated || 0);
                acc.searchRuns += Number(row?.search_runs || 0);
                return acc;
            },
            { leadsSearched: 0, leadsEnriched: 0, leadsInvestigated: 0, searchRuns: 0 }
        );

        // 2) Tasks health in window
        const { count: tasksCompleted } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'completed')
            .gte('updated_at', rangeStartIso)
            .lt('updated_at', rangeEndIso);

        const { count: tasksFailed } = await supabase
            .from('antonia_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'failed')
            .gte('updated_at', rangeStartIso)
            .lt('updated_at', rangeEndIso);

        // 3) Active missions snapshot
        const { data: missions } = await supabase
            .from('antonia_missions')
            .select('id, title, status, daily_search_limit')
            .eq('organization_id', organizationId)
            .eq('status', 'active');

        // 4) Contact/reply counters in window
        const { count: contactedByTable } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', rangeStartIso)
            .lt('created_at', rangeEndIso);

        let repliesByTable = 0;
        try {
            const { count } = await supabase
                .from('lead_responses')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .eq('type', 'reply')
                .gte('created_at', rangeStartIso)
                .lt('created_at', rangeEndIso);
            repliesByTable = count || 0;
        } catch {
            repliesByTable = 0;
        }

        if (repliesByTable === 0) {
            const { count: fallbackReplies } = await supabase
                .from('contacted_leads')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .not('replied_at', 'is', null)
                .gte('replied_at', rangeStartIso)
                .lt('replied_at', rangeEndIso);
            repliesByTable = fallbackReplies || 0;
        }

        // 5) Snapshot of active agents (tasks)
        let activeTasks: any[] = [];
        try {
            const modernSelect = 'mission_id, type, status, progress_label, progress_current, progress_total, heartbeat_at, created_at';
            const legacySelect = 'mission_id, type, status, progress_label, progress_current, progress_total, created_at';

            let { data: t, error: tErr } = await supabase
                .from('antonia_tasks')
                .select((supportsHeartbeatColumn === false ? legacySelect : modernSelect) as any)
                .eq('organization_id', organizationId)
                .in('status', ['pending', 'processing'])
                .order('created_at', { ascending: false })
                .limit(100);

            if (tErr && handleHeartbeatColumnError(tErr, 'daily-report activeTasks')) {
                const retry = await supabase
                    .from('antonia_tasks')
                    .select(legacySelect as any)
                    .eq('organization_id', organizationId)
                    .in('status', ['pending', 'processing'])
                    .order('created_at', { ascending: false })
                    .limit(100);
                t = retry.data;
                tErr = retry.error;
            }

            if (tErr) {
                console.warn('[REPORT][daily] Failed to load active tasks snapshot query:', tErr);
            }
            activeTasks = (t as any[]) || [];
        } catch (e) {
            console.warn('[REPORT][daily] Failed to load active tasks snapshot:', e);
        }

        // 6) Lead-event breakdown (most explicit source for contacted/investigated)
        const perMission: Record<string, any> = {};
        const totalsFromEvents = {
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

        try {
            const { data: evs } = await supabase
                .from('antonia_lead_events')
                .select('mission_id, event_type, outcome')
                .eq('organization_id', organizationId)
                .gte('created_at', rangeStartIso)
                .lt('created_at', rangeEndIso)
                .limit(10000);

            for (const e of (evs as any[]) || []) {
                const mid = String(e.mission_id || '').trim();
                if (!mid) continue;
                if (!perMission[mid]) {
                    perMission[mid] = {
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
                }

                const type = String(e.event_type || '');
                const outcome = String(e.outcome || '');

                if (type === 'lead_found') {
                    perMission[mid].found++;
                    totalsFromEvents.found++;
                }
                if (type === 'lead_enrich_completed') {
                    if (outcome === 'email_found') {
                        perMission[mid].enrichEmail++;
                        totalsFromEvents.enrichEmail++;
                    } else if (outcome === 'no_email') {
                        perMission[mid].enrichNoEmail++;
                        totalsFromEvents.enrichNoEmail++;
                    }
                }
                if (type === 'lead_enrich_failed') {
                    perMission[mid].enrichFailed++;
                    totalsFromEvents.enrichFailed++;
                }
                if (type === 'lead_investigate_completed') {
                    perMission[mid].investigated++;
                    totalsFromEvents.investigated++;
                }
                if (type === 'lead_investigate_failed') {
                    perMission[mid].investigateFailed++;
                    totalsFromEvents.investigateFailed++;
                }
                if (type === 'lead_contact_sent') {
                    perMission[mid].contactedSent++;
                    totalsFromEvents.contactedSent++;
                }
                if (type === 'lead_contact_blocked') {
                    perMission[mid].contactedBlocked++;
                    totalsFromEvents.contactedBlocked++;
                }
                if (type === 'lead_contact_failed') {
                    perMission[mid].contactedFailed++;
                    totalsFromEvents.contactedFailed++;
                }
            }
        } catch (e) {
            console.warn('[REPORT][daily] Failed to aggregate lead events:', e);
        }

        const searchRuns = Math.max(usageTotals.searchRuns, 0);
        const leadsFound = Math.max(usageTotals.leadsSearched, totalsFromEvents.found);
        const leadsEnriched = Math.max(usageTotals.leadsEnriched, totalsFromEvents.enrichEmail + totalsFromEvents.enrichNoEmail);
        const leadsInvestigated = Math.max(usageTotals.leadsInvestigated, totalsFromEvents.investigated);
        const contacted = Math.max(contactedByTable || 0, totalsFromEvents.contactedSent);
        const replies = repliesByTable || 0;

        summaryData = {
            windowStart: rangeStartIso,
            windowEnd: rangeEndIso,
            searchRuns,
            leadsFound,
            leadsEnriched,
            leadsInvestigated,
            contacted,
            replies,
            activeMissions: missions?.length || 0,
            tasksCompleted: tasksCompleted || 0,
            tasksFailed: tasksFailed || 0,
            perMission,
        };

        const missionList = (missions || []) as any[];
        const taskByMission: Record<string, any> = {};
        for (const t of activeTasks) {
            const mid = String(t.mission_id || '').trim();
            if (!mid) continue;
            if (!taskByMission[mid]) taskByMission[mid] = t;
            else if (taskByMission[mid].status !== 'processing' && t.status === 'processing') taskByMission[mid] = t;
        }

        const perMissionRowsHtml = missionList.length === 0
            ? '<div style="text-align:center;color:#64748b;font-style:italic;padding:18px 0;">No hay misiones activas.</div>'
            : missionList.map((m: any) => {
                const mid = String(m.id || '').trim();
                const s = perMission[mid] || {};
                const t = taskByMission[mid];
                const agent = t
                    ? `${t.status === 'processing' ? 'Procesando' : 'En cola'} · ${t.progress_label || t.type}`
                    : 'Sin ejecución activa';
                const prog = (t && typeof t.progress_current === 'number' && typeof t.progress_total === 'number')
                    ? ` (${t.progress_current}/${t.progress_total})`
                    : '';
                return `
                    <div class="mission-row">
                        <div class="mission-title-wrap">
                            <div class="mission-title">${m.title}</div>
                            <div class="mission-agent">${agent}${prog}</div>
                        </div>
                        <div class="mission-metrics">
                            <span>Encontrados <strong>${s.found || 0}</strong></span>
                            <span>Enriq. <strong>${(s.enrichEmail || 0) + (s.enrichNoEmail || 0)}</strong></span>
                            <span>Invest. <strong>${s.investigated || 0}</strong></span>
                            <span>Contact. <strong>${s.contactedSent || 0}</strong></span>
                            ${(s.contactedBlocked || 0) > 0 ? `<span class="warn">Bloq. <strong>${s.contactedBlocked}</strong></span>` : ''}
                            ${(s.contactedFailed || 0) > 0 ? `<span class="danger">Fallos <strong>${s.contactedFailed}</strong></span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

        const failureNote = (tasksFailed || 0) > 0
            ? `<div class="alert danger">Se detectaron <strong>${tasksFailed}</strong> tarea(s) fallida(s) en la ventana analizada.</div>`
            : `<div class="alert ok">No se registraron fallos en tareas durante la ventana analizada.</div>`;

        htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { margin: 0; padding: 22px; background: #eef2f7; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
                .container { max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #dbe3ef; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
                .header { padding: 30px 28px; background: linear-gradient(135deg, #0f4c81 0%, #0a7fa4 100%); color: #ffffff; }
                .header h1 { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.2px; }
                .header p { margin: 8px 0 0 0; font-size: 13px; opacity: 0.92; }
                .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
                .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center; }
                .card .v { font-size: 30px; font-weight: 800; color: #0f4c81; line-height: 1; }
                .card .l { margin-top: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: #475569; font-weight: 700; }
                .section { padding: 22px; }
                .section h2 { margin: 0 0 14px 0; font-size: 17px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
                .mission-row { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 10px; background: #fcfdff; }
                .mission-title { font-weight: 700; font-size: 14px; color: #0f172a; }
                .mission-agent { margin-top: 4px; font-size: 12px; color: #475569; }
                .mission-metrics { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #1e293b; }
                .mission-metrics strong { color: #0f4c81; }
                .mission-metrics .warn { color: #92400e; }
                .mission-metrics .danger { color: #b91c1c; }
                .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .meta-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #ffffff; }
                .meta-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; color: #475569; }
                .meta-value { margin-top: 4px; font-size: 24px; font-weight: 800; color: #0f4c81; }
                .alert { margin-top: 12px; border-radius: 10px; padding: 12px; font-size: 13px; }
                .alert.ok { background: #ecfdf5; border: 1px solid #bbf7d0; color: #166534; }
                .alert.danger { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
                .footer { background: #0f172a; color: #cbd5e1; text-align: center; font-size: 12px; padding: 18px; }
                .footer a { color: #f8fafc; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>ANTONIA · Reporte Diario</h1>
                    <p><strong>Ventana analizada:</strong> ${rangeLabel}</p>
                </div>

                <div class="cards">
                    <div class="card"><div class="v">${searchRuns}</div><div class="l">Búsquedas</div></div>
                    <div class="card"><div class="v">${leadsFound}</div><div class="l">Leads Encontrados</div></div>
                    <div class="card"><div class="v">${leadsEnriched}</div><div class="l">Leads Enriquecidos</div></div>
                    <div class="card"><div class="v">${leadsInvestigated}</div><div class="l">Leads Investigados</div></div>
                    <div class="card"><div class="v">${contacted}</div><div class="l">Leads Contactados</div></div>
                    <div class="card"><div class="v">${replies}</div><div class="l">Respuestas</div></div>
                </div>

                <div class="section">
                    <h2>Misiones Activas (${summaryData.activeMissions})</h2>
                    ${perMissionRowsHtml}
                </div>

                <div class="section">
                    <h2>Salud del Sistema</h2>
                    <div class="meta-grid">
                        <div class="meta-card">
                            <div class="meta-title">Tareas Completadas</div>
                            <div class="meta-value">${tasksCompleted || 0}</div>
                        </div>
                        <div class="meta-card">
                            <div class="meta-title">Tareas Fallidas</div>
                            <div class="meta-value">${tasksFailed || 0}</div>
                        </div>
                    </div>
                    ${failureNote}
                </div>

                <div class="footer">
                    Generado automáticamente por Antonia AI · <a href="${getAppUrl()}">Ir al Dashboard</a>
                </div>
            </div>
        </body>
        </html>
        `;

    } else if (reportType === 'weekly') {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const weekStartStr = weekStart.toISOString().split('T')[0];
        subject = `Resumen Semanal de Progreso - Antonia AI`;

        // 1. Aggregate Weekly Stats from antonia_daily_usage
        const { data: weeklyUsage } = await supabase
            .from('antonia_daily_usage')
            .select('leads_searched, leads_enriched, search_runs')
            .eq('organization_id', organizationId)
            .gte('date', weekStartStr);

        // Sum up the weekly totals
        const weeklyTotals = weeklyUsage?.reduce((acc, day) => ({
            leadsSearched: acc.leadsSearched + (day.leads_searched || 0),
            leadsEnriched: acc.leadsEnriched + (day.leads_enriched || 0),
            searchRuns: acc.searchRuns + (day.search_runs || 0)
        }), { leadsSearched: 0, leadsEnriched: 0, searchRuns: 0 }) || { leadsSearched: 0, leadsEnriched: 0, searchRuns: 0 };

        // 2. Count contacted leads in the last 7 days
        const { count: contacted } = await supabase.from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', weekStart.toISOString());

        summaryData = {
            range: '7 days',
            searchRuns: weeklyTotals.searchRuns,
            leadsFound: weeklyTotals.leadsSearched,
            leadsEnriched: weeklyTotals.leadsEnriched,
            contacted: contacted || 0
        };

        htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: -apple-system, sans-serif; background: #f3f4f6; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
                .header { background: #1e293b; padding: 40px; text-align: center; color: white; }
                .stat-row { display: flex; border-bottom: 1px solid #e2e8f0; }
                .stat-item { flex: 1; padding: 20px; text-align: center; }
                .stat-val { font-size: 24px; font-weight: bold; color: #3b82f6; }
                .stat-lbl { font-size: 12px; color: #64748b; text-transform: uppercase; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Resumen Semanal</h1>
                    <p>Tus métricas de los últimos 7 días</p>
                </div>
                <div class="stat-row">
                    <div class="stat-item">
                        <div class="stat-val">${summaryData.searchRuns}</div>
                        <div class="stat-lbl">Búsquedas</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${summaryData.leadsFound}</div>
                        <div class="stat-lbl">Leads Encontrados</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${summaryData.leadsEnriched}</div>
                        <div class="stat-lbl">Enriquecidos</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-val">${summaryData.contacted}</div>
                        <div class="stat-lbl">Contactados</div>
                    </div>
                </div>
                 <div style="padding:20px;text-align:center;background:#f8fafc">
                    <p style="color:#64748b;margin:0">Sigue así! Tu agente está trabajando duro.</p>
                </div>
            </div>
        </body>
        </html>
        `;

    } else if (reportType === 'lead_exhaustion_alert') {
        const { missionId, searchCriteria } = task.payload;

        // Fetch mission details
        const { data: mission } = await supabase
            .from('antonia_missions')
            .select('title, params')
            .eq('id', missionId)
            .single();

        subject = `⚠️ Alerta: Agotamiento de Leads - ${mission?.title}`;

        // Get stats
        const { count: totalLeads } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId);

        const { count: contactedCount } = await supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId);

        // Get contacted lead IDs to exclude
        const { data: contactedLeadIds } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', missionId);

        const contactedIds = (contactedLeadIds || []).map((c: any) => c.lead_id);

        const { count: uncontactedEnriched } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .eq('status', 'enriched')
            .not('id', 'in', `(${contactedIds.length > 0 ? contactedIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);

        summaryData = {
            missionTitle: mission?.title,
            totalLeadsFound: totalLeads || 0,
            contacted: contactedCount || 0,
            uncontactedEnriched: uncontactedEnriched || 0,
            searchCriteria: searchCriteria
        };

        htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: -apple-system, sans-serif; background: #f3f4f6; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; text-align: center; color: white; }
                .header h1 { margin: 0; font-size: 24px; }
                .alert-icon { font-size: 48px; margin-bottom: 10px; }
                .content { padding: 30px; }
                .stat-box { background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 15px 0; border-radius: 4px; }
                .stat-label { font-size: 12px; color: #991b1b; text-transform: uppercase; font-weight: 600; }
                .stat-value { font-size: 24px; color: #dc2626; font-weight: 800; margin-top: 5px; }
                .criteria { background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0; }
                .criteria-item { margin: 8px 0; color: #374151; }
                .recommendation { background: #fffbeb; border: 1px solid #fbbf24; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .recommendation h3 { margin: 0 0 10px 0; color: #92400e; }
                .footer { background: #1f2937; color: #9ca3af; padding: 20px; text-align: center; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="alert-icon">⚠️</div>
                    <h1>Alerta de Agotamiento de Leads</h1>
                    <p>Misión: ${mission?.title}</p>
                </div>
                
                <div class="content">
                    <p><strong>La búsqueda no ha encontrado nuevos leads con los filtros actuales.</strong></p>
                    
                    <div class="stat-box">
                        <div class="stat-label">Total de Leads Encontrados</div>
                        <div class="stat-value">${summaryData.totalLeadsFound}</div>
                    </div>
                    
                    <div class="stat-box">
                        <div class="stat-label">Leads Contactados</div>
                        <div class="stat-value">${summaryData.contacted}</div>
                    </div>
                    
                    <div class="stat-box">
                        <div class="stat-label">Leads Enriquecidos Sin Contactar</div>
                        <div class="stat-value">${summaryData.uncontactedEnriched}</div>
                    </div>
                    
                    <div class="criteria">
                        <h3 style="margin-top:0; color:#1f2937;">Filtros de Búsqueda Actuales:</h3>
                        <div class="criteria-item"><strong>Cargo:</strong> ${searchCriteria.jobTitle || 'No especificado'}</div>
                        <div class="criteria-item"><strong>Ubicación:</strong> ${searchCriteria.location || 'No especificado'}</div>
                        <div class="criteria-item"><strong>Industria:</strong> ${searchCriteria.industry || 'No especificado'}</div>
                        <div class="criteria-item"><strong>Palabras clave:</strong> ${searchCriteria.keywords || 'No especificado'}</div>
                    </div>
                    
                    <div class="recommendation">
                        <h3>💡 Recomendaciones</h3>
                        <ul style="margin:10px 0; padding-left:20px; color:#78350f;">
                            ${summaryData.uncontactedEnriched > 0
                ? '<li>El agente continuará contactando los leads enriquecidos pendientes.</li>'
                : '<li>No hay más leads disponibles para contactar.</li>'}
                            <li>Considere ampliar los filtros de búsqueda (ubicación, cargo, industria).</li>
                            <li>Revise si los criterios son demasiado específicos.</li>
                            <li>Puede pausar la misión temporalmente si es necesario.</li>
                        </ul>
                    </div>
                </div>
                
                <div class="footer">
                    Generado automáticamente por Antonia AI<br>
                    <a href="${getAppUrl()}/missions/${missionId}" style="color:white;text-decoration:underline">Ver Misión</a>
                </div>
            </div>
        </body>
        </html>
        `;

    } else if (reportType === 'mission_historic') {
        // Fetch Mission Details
        const { data: mission } = await supabase
            .from('antonia_missions')
            .select('*')
            .eq('id', missionId)
            .single();

        if (!mission) throw new Error('Mission not found');

        subject = `Reporte de Misión: ${mission.title} `;

        // Fetch Metrics
        const { count: leadsFound } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('mission_id', missionId);

        // Contacted (unique leads, not total sends)
        const { data: contactedRows } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', missionId);
        const leadsContactedUniqueFromTable = new Set(
            ((contactedRows as any[]) || [])
                .map((r: any) => String(r?.lead_id || '').trim())
                .filter(Boolean)
        ).size;

        // Do-not-contact
        const { count: blockedCount } = await supabase
            .from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .eq('status', 'do_not_contact');

        // Leads that already advanced beyond "saved" in the funnel.
        // This keeps the mission report coherent when historical event logs are partial.
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

        // Replies (Positive/Negative) via lead_responses or contacted_leads status
        const { count: replies } = await supabase.from('contacted_leads').select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .neq('evaluation_status', 'pending');

        // Lead-level audit from antonia_lead_events
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
        const contactedLeadIdsFromEvents = new Set<string>();
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
                if (type === 'lead_contact_sent') {
                    audit.contactedSent++;
                    if (leadId) contactedLeadIdsFromEvents.add(leadId);
                }
                if (type === 'lead_contact_blocked') audit.contactedBlocked++;
                if (type === 'lead_contact_failed') audit.contactedFailed++;
            }
        } catch (e) {
            console.warn('[REPORT][mission_historic] Failed to aggregate lead events:', e);
        }

        // Enriched = acumulado histórico (normalizado) para evitar inconsistencias
        // cuando existen datos legacy sin eventos completos.
        const leadsEnriched = Math.max(
            enrichedLeadIds.size,
            audit.enrichEmail + audit.enrichNoEmail,
            leadsAdvancedInFunnel || 0,
            leadsWithEmail || 0,
            leadsContactedUniqueFromTable
        );

        // Contacted = leads únicos contactados
        const leadsContacted = leadsContactedUniqueFromTable > 0
            ? leadsContactedUniqueFromTable
            : contactedLeadIdsFromEvents.size;

        const totalFound = leadsFound || 0;
        const totalReplies = replies || 0;
        const toRate = (num: number, den: number) => (den > 0 ? Math.min(100, (num / den) * 100).toFixed(1) : '0');

        // Calculate conversion rates
        const enrichmentRate = toRate(leadsEnriched, totalFound);
        const contactRate = toRate(leadsContacted, totalFound);
        const responseRate = toRate(totalReplies, leadsContacted);

        summaryData = {
            missionId,
            title: mission.title,
            leadsFound: totalFound,
            leadsEnriched: leadsEnriched || 0,
            leadsContacted: leadsContacted || 0,
            replies: totalReplies,
            blocked: blockedCount || 0,
            audit,
        };

        // HTML Template
        htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            padding: 40px 30px;
            text-align: center;
            position: relative;
        }
        .header::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #fbbf24, #f59e0b, #fbbf24);
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 32px;
            font-weight: 700;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .header p {
            font-size: 18px;
            opacity: 0.95;
            font-weight: 300;
        }
        .mission-info {
            background: #f8fafc;
            padding: 25px 30px;
            border-bottom: 1px solid #e2e8f0;
        }
        .mission-info-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }
        .info-item {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .info-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #64748b;
            font-weight: 600;
            line-height: 1.2;
        }
        .info-value {
            font-size: 15px;
            color: #1e293b;
            font-weight: 600;
            line-height: 1.3;
        }
        .stats-section {
            padding: 30px;
        }
        .section-title {
            font-size: 20px;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e2e8f0;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            padding: 24px;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #e2e8f0;
            transition: transform 0.2s, box-shadow 0.2s;
            position: relative;
            overflow: hidden;
        }
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #667eea, #764ba2);
        }
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
        }
        .stat-value {
            font-size: 36px;
            font-weight: 800;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 8px;
        }
        .stat-label {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #64748b;
            font-weight: 600;
        }
        .conversion-metrics {
            background: #fefce8;
            border: 1px solid #fde047;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .conversion-title {
            font-size: 16px;
            font-weight: 700;
            color: #854d0e;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .conversion-title::before {
            content: '📊';
            font-size: 20px;
        }
        .conversion-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        .conversion-item {
            text-align: center;
        }
        .conversion-value {
            font-size: 28px;
            font-weight: 800;
            color: #ca8a04;
        }
        .conversion-label {
            font-size: 12px;
            color: #854d0e;
            margin-top: 4px;
        }
        .progress-bar {
            background: #e2e8f0;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 8px;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            border-radius: 4px;
            transition: width 0.3s ease;
        }
        .summary-section {
            background: #f8fafc;
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .summary-section h3 {
            font-size: 18px;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 15px;
        }
        .summary-section p {
            color: #475569;
            line-height: 1.8;
            margin-bottom: 12px;
        }
        .audit-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 10px;
            margin-top: 12px;
        }
        .audit-item {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 12px;
        }
        .audit-item .k {
            font-size: 11px;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 700;
        }
        .audit-item .n {
            margin-top: 6px;
            font-size: 24px;
            font-weight: 800;
            color: #334155;
            line-height: 1;
        }
        .status-badge {
            display: inline-block;
            padding: 6px 16px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .status-active {
            background: #dcfce7;
            color: #166534;
        }
        .status-paused {
            background: #fef3c7;
            color: #92400e;
        }
        .status-completed {
            background: #dbeafe;
            color: #1e40af;
        }
        .footer {
            background: #1e293b;
            padding: 20px;
            text-align: center;
            font-size: 13px;
            color: #94a3b8;
        }
        .footer strong {
            color: #e2e8f0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Reporte de Misión</h1>
            <p>${mission.title}</p>
        </div>

        <div class="mission-info">
            <div class="mission-info-grid">
                <div class="info-item">
                    <span class="info-label">Fecha de Inicio</span>
                    <span class="info-value">${new Date(mission.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Estado</span>
                    <span class="status-badge status-${mission.status}">${mission.status === 'active' ? 'ACTIVA' : mission.status === 'paused' ? 'PAUSADA' : 'COMPLETADA'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Objetivo</span>
                    <span class="info-value">${mission.params?.jobTitle || 'N/A'}</span>
                </div>
            </div>
        </div>

        <div class="stats-section">
            <h2 class="section-title">Métricas Principales</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${leadsFound || 0}</div>
                    <div class="stat-label">Leads Encontrados</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 100%;"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${leadsEnriched || 0}</div>
                    <div class="stat-label">Enriquecidos</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${enrichmentRate}%;"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${leadsContacted || 0}</div>
                    <div class="stat-label">Contactados</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${contactRate}%;"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${audit.investigated || 0}</div>
                    <div class="stat-label">Investigados</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${toRate(audit.investigated || 0, leadsEnriched || 0)}%;"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${replies || 0}</div>
                    <div class="stat-label">Respuestas</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${responseRate}%;"></div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${blockedCount || 0}</div>
                    <div class="stat-label">Bloqueados</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${toRate(blockedCount || 0, leadsFound || 0)}%;"></div>
                    </div>
                </div>
            </div>

            <div class="conversion-metrics">
                <div class="conversion-title">Tasas de Conversión</div>
                <div class="conversion-grid">
                    <div class="conversion-item">
                        <div class="conversion-value">${enrichmentRate}%</div>
                        <div class="conversion-label">Enriquecimiento</div>
                    </div>
                    <div class="conversion-item">
                        <div class="conversion-value">${contactRate}%</div>
                        <div class="conversion-label">Contacto</div>
                    </div>
                    <div class="conversion-item">
                        <div class="conversion-value">${responseRate}%</div>
                        <div class="conversion-label">Respuesta</div>
                    </div>
                </div>
            </div>

            <div class="summary-section">
                <h3>📋 Resumen Ejecutivo</h3>
                <p>La misión <strong>"${mission.title}"</strong> comenzó el <strong>${new Date(mission.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong> y ha estado procesando prospectos de forma automática según los criterios definidos.</p>
                <p><strong>Progreso:</strong> De ${leadsFound || 0} leads encontrados, se han enriquecido ${leadsEnriched || 0} (${enrichmentRate}%) y contactado ${leadsContacted || 0} (${contactRate}%). Se han recibido ${replies || 0} respuestas, lo que representa una tasa de respuesta del ${responseRate}%.</p>
                <p><strong>Investigación:</strong> Se investigaron ${audit.investigated || 0} leads y se registraron ${audit.investigateFailed || 0} fallos en investigación.</p>
                <p><strong>Estado actual:</strong> <span class="status-badge status-${mission.status}">${mission.status === 'active' ? 'ACTIVA' : mission.status === 'paused' ? 'PAUSADA' : 'COMPLETADA'}</span></p>
                <p style="margin-top:12px;"><strong>Auditoria por lead:</strong> encontrados ${audit.found}, email ${audit.enrichEmail}, sin email ${audit.enrichNoEmail}, investigados ${audit.investigated}, enviados ${audit.contactedSent}, bloqueados ${audit.contactedBlocked}${(blockedCount || 0) > 0 ? ` (do_not_contact: ${blockedCount})` : ''}.</p>

                <div class="audit-grid">
                    <div class="audit-item"><div class="k">Encontrados</div><div class="n">${audit.found || 0}</div></div>
                    <div class="audit-item"><div class="k">Email Encontrado</div><div class="n">${audit.enrichEmail || 0}</div></div>
                    <div class="audit-item"><div class="k">Sin Email</div><div class="n">${audit.enrichNoEmail || 0}</div></div>
                    <div class="audit-item"><div class="k">Investigados</div><div class="n">${audit.investigated || 0}</div></div>
                    <div class="audit-item"><div class="k">Enviados</div><div class="n">${audit.contactedSent || 0}</div></div>
                    <div class="audit-item"><div class="k">Bloqueados</div><div class="n">${audit.contactedBlocked || 0}</div></div>
                </div>
            </div>
        </div>

        <div class="footer">
            <strong>🤖 Generado automáticamente por Antonia AI</strong><br>
            ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
    </div>
</body>
</html>
        `;
    }

    // Save to Database
    const { data: report, error } = await supabase.from('antonia_reports').insert({
        organization_id: organizationId,
        mission_id: missionId, // Nullable
        type: reportType,
        content: htmlContent,
        summary_data: summaryData,
        sent_to: [],
        created_at: new Date().toISOString()
    }).select().single();

    if (error) {
        console.error('Failed to save report', error);
        throw error;
    }

    // --- SEND EMAIL ---
    // User Request: Send to the email configured in Antonia Settings

    // 1. Fetch Config again to be sure (or reuse taskConfig if available, but safe to fetch)
    const { data: config } = await supabase
        .from('antonia_config')
        .select('notification_email')
        .eq('organization_id', organizationId)
        .single();

    const parseRecipients = (raw?: string | null) => {
        if (!raw) return [] as string[];
        const parts = String(raw)
            .split(/[,;\n\r\t ]+/)
            .map(s => s.trim())
            .filter(Boolean);
        const uniq = new Set<string>();
        const out: string[] = [];
        for (const p of parts) {
            const v = p.toLowerCase();
            // Minimal sanity check
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) continue;
            if (uniq.has(v)) continue;
            uniq.add(v);
            out.push(v);
        }
        return out;
    };

    let targetEmails = parseRecipients(config?.notification_email);

    // 2. Fallback to Admin User Email if config is missing/empty
    if (targetEmails.length === 0) {
        console.log('[REPORT] No notification_email in config, fetching admin user email...');
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
        if (authUser?.email) {
            targetEmails = [authUser.email.toLowerCase()];
        }
    }

    if (targetEmails.length > 0) {
        console.log(`[REPORT] Sending report to ${targetEmails.join(', ')}`);

        // Update sent_to in report record
        await supabase.from('antonia_reports').update({ sent_to: targetEmails }).eq('id', report.id);

        const appUrl = getAppUrl();
        for (const to of targetEmails) {
            await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({ 'Content-Type': 'application/json', 'x-user-id': userId }),
                body: JSON.stringify({
                    to,
                    subject,
                    body: htmlContent,
                    isHtml: true,
                    userId,
                    missionId
                })
            });
        }
    } else {
        console.warn('[REPORT] No email found to send report to.');
    }

    return { reportId: report.id, generated: true };
}

async function executeLegacyContact(task: any, supabase: SupabaseClient) {
    const { leads, userId, campaignName } = task.payload;
    const appUrl = getAppUrl();
    let contactedCount = 0;
    const attemptAt = new Date().toISOString();
    const stage = 'contact';

    // Fetch Campaign
    const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('organization_id', task.organization_id)
        .eq('name', campaignName)
        .maybeSingle();

    const { data: steps } = campaign?.id
        ? await supabase
            .from('campaign_steps')
            .select('order_index, subject_template, body_template')
            .eq('campaign_id', campaign.id)
            .order('order_index', { ascending: true })
            .limit(1)
        : { data: null } as any;

    const subject = steps?.[0]?.subject_template || campaign?.settings?.subject || 'Follow up';
    const body = steps?.[0]?.body_template || campaign?.settings?.body || 'Just checking in...';

    let campaignSentRecords: Record<string, any> | null = campaign?.sent_records ? { ...(campaign.sent_records || {}) } : null;
    let campaignDirty = false;

    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
    const senderName = profile?.full_name || 'Tu equipo';

    for (const lead of leads) {
        try {
            console.log(`[CONTACT_CAMPAIGN] Sending campaign email to ${lead.email} `);

            if (lead?.id) {
                await safeInsertLeadEvents(supabase, [
                    {
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        task_id: task.id,
                        lead_id: String(lead.id),
                        event_type: 'lead_contact_started',
                        stage,
                        outcome: 'started',
                        message: 'Seguimiento iniciado (campana)',
                        meta: { kind: 'followup', campaignId: campaign?.id || null },
                        created_at: attemptAt,
                    }
                ]);
            }

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId
                }),
                body: JSON.stringify({
                    to: lead.email,
                    subject: subject
                        .replace('{{lead.name}}', lead.fullName || lead.full_name || lead.name || '')
                        .replace('{{firstName}}', (lead.fullName || lead.full_name || lead.name || '').split(' ')[0] || '')
                        .replace('{{company}}', lead.companyName || lead.company_name || lead.company || '')
                        .replace('{{sender.name}}', senderName),
                    body: body
                        .replace('{{lead.name}}', lead.fullName || lead.full_name || lead.name || '')
                        .replace('{{firstName}}', (lead.fullName || lead.full_name || lead.name || '').split(' ')[0] || '')
                        .replace('{{company}}', lead.companyName || lead.company_name || lead.company || '')
                        .replace('{{sender.name}}', senderName),
                    leadId: lead.id,
                    campaignId: campaign?.id,
                    missionId: task.mission_id,
                    userId: userId,
                    metadata: { type: 'campaign_followup' },
                    tracking: (campaign as any)?.settings?.tracking
                })
            });
            if (response.ok) {
                contactedCount++;
                // We don't read JSON here in legacy logic usually, but let's do it for consistency
                // Note: fetch body might have been consumed if we are not careful? No, it's fresh response.
                // However, let's keep it simple for legacy campaign_followup or just do same logic:
                try {
                    const resData = await response.json();
                    await supabase.from('contacted_leads').insert({
                        user_id: userId,
                        organization_id: task.organization_id,
                        mission_id: task.mission_id,
                        lead_id: lead.id,
                        status: 'sent',
                        subject: subject, // from campaign settings above
                        provider: resData.provider || 'unknown',
                        sent_at: new Date().toISOString(),
                        data: {
                            campaign_id: campaign?.id,
                            type: 'followup'
                        }
                    });

                    if (campaign?.id && campaignSentRecords && lead?.id) {
                        campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: new Date().toISOString() };
                        campaignDirty = true;
                    }

                    if (lead?.id) {
                        await supabase
                            .from('leads')
                            .update({ status: 'contacted' } as any)
                            .eq('id', lead.id);

                        await safeInsertLeadEvents(supabase, [
                            {
                                organization_id: task.organization_id,
                                mission_id: task.mission_id,
                                task_id: task.id,
                                lead_id: String(lead.id),
                                event_type: 'lead_contact_sent',
                                stage,
                                outcome: 'sent',
                                message: 'Seguimiento enviado',
                                meta: { kind: 'followup', provider: resData.provider || 'unknown', campaignId: campaign?.id || null },
                                created_at: attemptAt,
                            }
                        ]);
                    }
                } catch (err) { console.error('Error recording contact', err); }
            } else {
                const errorText = await response.text().catch(() => '');
                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_failed',
                            stage,
                            outcome: `api_${response.status}`,
                            message: 'Fallo enviando seguimiento',
                            meta: { status: response.status, error: errorText.slice(0, 800) },
                            created_at: attemptAt,
                        }
                    ]);
                }
            }
        } catch (e) { console.error(e); }
    }
    if (campaign?.id && campaignDirty && campaignSentRecords) {
        const { error: campErr } = await supabase
            .from('campaigns')
            .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
            .eq('id', campaign.id);
        if (campErr) console.warn('[CONTACT_CAMPAIGN] Failed to update sent_records:', campErr);
    }

    return { contactedCount };
}

// Timeout wrapper to prevent tasks from hanging indefinitely
async function processTaskWithTimeout(task: any, supabase: SupabaseClient) {
    const TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes
    const timeoutLabel = `${Math.round(TIMEOUT_MS / 60000)} minutes`;

    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task execution timeout after ${timeoutLabel}`)), TIMEOUT_MS)
    );

    try {
        await Promise.race([
            processTask(task, supabase),
            timeoutPromise
        ]);
    } catch (e: any) {
        if (e.message?.includes('timeout')) {
            console.error(`[Worker] Task ${task.id} timed out`);
            await supabase.from('antonia_tasks').update({
                status: 'failed',
                error_message: `Task execution timeout after ${timeoutLabel}`,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'error',
                message: `Task ${task.type} timed out after ${timeoutLabel}`
            });
        }
        throw e;
    }
}

async function processTask(task: any, supabase: SupabaseClient) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    // Note: Status already set to 'processing' by optimistic lock in antoniaTick
    // This update is redundant but kept for backwards compatibility if processTask is called directly
    // (which should not happen in normal operation)
    // await supabase.from('antonia_tasks').update({
    //     status: 'processing',
    //     processing_started_at: new Date().toISOString()
    // }).eq('id', task.id);

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
            case 'GENERATE_REPORT':
                result = await executeReportGeneration(task, supabase);
                break;
            default:
                throw new Error(`Unknown task type: ${task.type}. Valid types are: GENERATE_CAMPAIGN, SEARCH, ENRICH, INVESTIGATE, EVALUATE, CONTACT, CONTACT_INITIAL, CONTACT_CAMPAIGN, GENERATE_REPORT`);
        }

        const isDailyLimitDeferred =
            Boolean((result as any)?.skipped) &&
            String((result as any)?.reason || '') === 'daily_limit_reached' &&
            typeof (result as any)?.retryAt === 'string' &&
            String((result as any)?.retryAt || '').trim().length > 0;

        if (isDailyLimitDeferred) {
            const retryAt = String((result as any).retryAt);
            await supabase.from('antonia_tasks').update({
                status: 'pending',
                scheduled_for: retryAt,
                processing_started_at: null,
                result: result,
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
            level: 'success',
            message: `Task ${task.type} completed successfully.`,
            details: result
        });

    } catch (e: any) {
        console.error(`[Worker] Task ${task.id} Failed`, e.stack || e);

        // Determine if error is retryable
        const retryableErrors = [
            'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
            '429', '503', '502', '504',
            'timeout', 'network', 'fetch failed'
        ];

        const isRetryable = retryableErrors.some(pattern =>
            e.message?.toLowerCase().includes(pattern.toLowerCase()) ||
            e.code?.toString().toLowerCase().includes(pattern.toLowerCase()) ||
            e.status?.toString().includes(pattern)
        );

        const retryCount = task.retry_count || 0;
        const maxRetries = 3;

        if (retryCount < maxRetries && isRetryable) {
            // Exponential backoff: 1min, 2min, 4min
            const backoffMinutes = Math.pow(2, retryCount);
            const scheduledFor = new Date(Date.now() + backoffMinutes * 60000).toISOString();

            console.log(`[Worker] Scheduling retry ${retryCount + 1}/${maxRetries} for task ${task.id} in ${backoffMinutes} min`);

            await supabase.from('antonia_tasks').update({
                status: 'pending',
                retry_count: retryCount + 1,
                scheduled_for: scheduledFor,
                error_message: `Retry ${retryCount + 1}/${maxRetries}: ${e.message}`,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `Task ${task.type} will retry (${retryCount + 1}/${maxRetries}): ${e.message}`
            });
        } else {
            // Permanent failure
            const failureReason = isRetryable
                ? `Max retries (${maxRetries}) exceeded`
                : 'Non-retryable error';

            await supabase.from('antonia_tasks').update({
                status: 'failed',
                error_message: `${failureReason}: ${e.message}`,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'error',
                message: `Task ${task.type} failed permanently: ${e.message}`
            });
        }
    }
}

async function runAntoniaTick() {
    console.log('[AntoniaTick] waking up...');

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase credentials');
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- 0.5 RESCUE STUCK TASKS (backup worker / crashes) ---
    try {
        const nowIso = new Date().toISOString();
        const stuckBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        const rescuePayload = {
            status: 'pending',
            scheduled_for: nowIso,
            updated_at: nowIso,
            error_message: '[auto-rescue] task stuck in processing (no heartbeat / timeout)'
        };

        let rescued: any[] | null = null;
        let rescueErr: any = null;

        if (supportsHeartbeatColumn === false) {
            const legacyRescue = await supabase
                .from('antonia_tasks')
                .update(rescuePayload)
                .eq('status', 'processing')
                .not('processing_started_at', 'is', null)
                .lt('processing_started_at', stuckBefore)
                .select('id')
                .limit(25);
            rescued = legacyRescue.data;
            rescueErr = legacyRescue.error;
        } else {
            const modernRescue = await supabase
                .from('antonia_tasks')
                .update(rescuePayload)
                .eq('status', 'processing')
                .or(
                    [
                        // Prefer heartbeat when available
                        `heartbeat_at.lt.${stuckBefore}`,
                        // Backwards compatibility
                        `and(heartbeat_at.is.null,processing_started_at.not.is.null,processing_started_at.lt.${stuckBefore})`
                    ].join(',')
                )
                .select('id')
                .limit(25);
            rescued = modernRescue.data;
            rescueErr = modernRescue.error;

            if (rescueErr && handleHeartbeatColumnError(rescueErr, 'runAntoniaTick rescue')) {
                const legacyRescue = await supabase
                    .from('antonia_tasks')
                    .update(rescuePayload)
                    .eq('status', 'processing')
                    .not('processing_started_at', 'is', null)
                    .lt('processing_started_at', stuckBefore)
                    .select('id')
                    .limit(25);
                rescued = legacyRescue.data;
                rescueErr = legacyRescue.error;
            }
        }

        if (rescueErr) {
            console.error('[AntoniaTick] Rescue error:', rescueErr);
        } else if (rescued && rescued.length > 0) {
            console.warn(`[AntoniaTick] Rescued ${rescued.length} stuck tasks`);
        }
    } catch (e) {
        console.error('[AntoniaTick] Rescue exception:', e);
    }

    // --- 0. SCHEDULE DAILY TASKS FOR ACTIVE MISSIONS ---
    try {
        const { data: scheduledMissions, error: scheduleError } = await supabase
            .rpc('schedule_daily_mission_tasks');

        if (scheduleError) {
            console.error('[AntoniaTick] Error scheduling daily missions:', scheduleError);
        } else if (scheduledMissions && scheduledMissions.length > 0) {
            console.log(`[AntoniaTick] Scheduled tasks for ${scheduledMissions.length} active missions`);
        }
    } catch (e) {
        console.error('[AntoniaTick] Failed to schedule missions:', e);
    }

    // --- 1. PROCESS PENDING TASKS ---
    const now = new Date().toISOString();
    const workerId = `firebase:${randomUUID()}`;
    let tasks: any[] = [];

    // Preferred: atomic claim via RPC (FOR UPDATE SKIP LOCKED)
    try {
        const { data, error } = await supabase.rpc('claim_antonia_tasks', {
            p_limit: 5,
            p_worker_id: workerId,
            p_worker_source: 'firebase'
        } as any);
        if (error) throw error;
        tasks = (data as any[]) || [];
    } catch (e) {
        console.warn('[AntoniaTick] claim_antonia_tasks failed, using fallback claim:', e);

        // Fallback: select then claim one-by-one (best effort)
        const { data: pending, error: selErr } = await supabase
            .from('antonia_tasks')
            .select('*')
            .eq('status', 'pending')
            .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
            .order('created_at', { ascending: true })
            .limit(5);

        if (selErr) {
            console.error('[AntoniaTick] Fallback select failed:', selErr);
        } else {
            const claimed: any[] = [];
            for (const t of (pending || [])) {
                const { data: row, error: claimErr } = await supabase
                    .from('antonia_tasks')
                    .update({
                        status: 'processing',
                        processing_started_at: now,
                        worker_id: workerId,
                        worker_source: 'firebase',
                        updated_at: now,
                    } as any)
                    .eq('id', t.id)
                    .eq('status', 'pending')
                    .select('*')
                    .maybeSingle();

                if (claimErr && supportsHeartbeatColumn !== false && handleHeartbeatColumnError(claimErr, 'fallback claim')) {
                    const retry = await supabase
                        .from('antonia_tasks')
                        .update({
                            status: 'processing',
                            processing_started_at: now,
                            worker_id: workerId,
                            worker_source: 'firebase',
                            updated_at: now,
                        } as any)
                        .eq('id', t.id)
                        .eq('status', 'pending')
                        .select('*')
                        .maybeSingle();
                    if (retry.error) continue;
                    if (retry.data) claimed.push(retry.data);
                    continue;
                }

                if (claimErr) continue;
                if (row) claimed.push(row);
            }
            tasks = claimed;
        }
    }

    if (tasks && tasks.length > 0) {
        console.log(`[AntoniaTick] Processing ${tasks.length} tasks`);
        await Promise.all(tasks.map((t: any) => processTaskWithTimeout(t, supabase)));
    }

    // --- 2. SCAN FOR EVALUATION (The Heartbeat) ---
    const checkTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: pendingLeads } = await supabase
        .from('contacted_leads')
        .select(`
                lead_id, 
                organization_id, 
                mission_id,
                leads!inner ( id, email, organization_id )
            `)
        .eq('evaluation_status', 'pending')
        .lt('last_interaction_at', checkTime)
        .limit(10);

    if (pendingLeads && pendingLeads.length > 0) {
        console.log(`[AntoniaTick] Found ${pendingLeads.length} leads pending evaluation`);

        const missionGroups = groupBy(pendingLeads.filter((x: any) => x.mission_id), 'mission_id');

        for (const missionId of Object.keys(missionGroups)) {
            const rows = missionGroups[missionId] || [];
            if (!rows.length) continue;

            const { data: mission } = await supabase
                .from('antonia_missions')
                .select('id, user_id, organization_id')
                .eq('id', missionId)
                .maybeSingle();

            if (!mission) continue;

            const leadsForMission = rows.map((pl: any) => pl.leads).filter(Boolean);
            if (leadsForMission.length === 0) continue;

            await supabase.from('antonia_tasks').insert({
                mission_id: mission.id,
                organization_id: mission.organization_id || rows[0].organization_id,
                type: 'EVALUATE',
                status: 'pending',
                payload: {
                    leads: leadsForMission,
                    userId: mission.user_id,
                    campaignName: 'Smart Campaign'
                }
            });
            console.log(`[AntoniaTick] Created EVALUATE task for Mission ${missionId}`);

            const leadIds = leadsForMission.map((l: any) => l.id).filter(Boolean);
            if (leadIds.length > 0) {
                await supabase
                    .from('contacted_leads')
                    .update({ evaluation_status: 'evaluating' })
                    .eq('mission_id', missionId)
                    .in('lead_id', leadIds);
            }
        }
    }
}

// Main scheduler function
export const antoniaTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
}, async () => {
    await runAntoniaTick();
});

// Manual trigger (backup scheduler can call this to force a tick)
export const antoniaTickHttp = functions.https.onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    invoker: 'public',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTONIA_TICK_SECRET']
} as any, async (req: any, res: any) => {
    try {
        const secret = String(process.env.ANTONIA_TICK_SECRET || '').trim();
        const authHeader = req.get('authorization') || '';
        const bearer = String(authHeader).replace(/^Bearer\s+/i, '').trim();
        const headerSecret = String(req.get('x-cron-secret') || '').trim();

        if (!secret || (bearer !== secret && headerSecret !== secret)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        await runAntoniaTick();
        res.status(200).json({ ok: true });
    } catch (e: any) {
        console.error('[antoniaTickHttp] error', e);
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

// Helper for grouping
function groupBy(xs: any[], key: string) {
    return xs.reduce(function (rv, x) {
        (rv[x[key]] = rv[x[key]] || []).push(x);
        return rv;
    }, {});
}


// Force rebuild Wed Dec 24 04:51:10 AM UTC 2025
