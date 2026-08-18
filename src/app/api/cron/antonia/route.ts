import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { notificationService } from '@/lib/services/notification-service';
import { findPriorReplyMatch, shouldPermanentlySuppressContact } from '@/lib/contact-history-guard';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';
import { assessLeadMissionFit, decideAutopilotContactAction, scoreLeadForMission } from '@/lib/antonia-autopilot';
import { getLeadResearchAutoContactBlockReason, getLeadResearchStatus, isLeadResearchReadyForAutoContact } from '@/lib/lead-research';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { getDailyQuotaStatus } from '@/lib/server/daily-quota-store';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { ensureLeadResearchReport } from '@/lib/server/lead-research-reports';
import { buildThreadKey } from '@/lib/email-observability';
import {
    classifyContactSendFailure,
    isReplayedContactSend,
    isRetryableContactSendException,
    isSuccessfulContactSend,
    parseContactSendResponseBody,
    shouldAppendContactedLead,
} from '@/lib/contact-send-response';
import * as uuid from 'uuid';

// [FIX #2] Initialize at runtime, not module-load (secrets may not be available at build time)
function getSupabaseCredentials() {
    return {
        url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
        key: process.env.SUPABASE_SERVICE_ROLE_KEY!
    };
}
const DEFAULT_LEAD_SEARCH_URL = "https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-search";
const LEAD_SEARCH_URL = process.env.ANTONIA_LEAD_SEARCH_URL || process.env.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL;

function withInternalApiSecret(headers: Record<string, string>): Record<string, string> {
    const secret = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (!secret) return headers;
    return {
        ...headers,
        'x-internal-api-secret': secret,
    };
}

function ensureInternalHeaders(headers: Record<string, string>, context: string) {
    const enriched = withInternalApiSecret(headers);
    if (!String(enriched['x-internal-api-secret'] || '').trim()) {
        throw new Error(`${context}: INTERNAL_API_SECRET not configured`);
    }
    return enriched;
}

function parseApplyIcpFilter(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return null;

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
}

async function shouldApplyMissionIcpFilter(task: any, supabase: any) {
    const payloadValue = parseApplyIcpFilter(task?.payload?.applyIcpFilter);
    if (payloadValue !== null) return payloadValue;

    if (!task?.mission_id) return true;

    const { data: mission } = await supabase
        .from('antonia_missions')
        .select('params')
        .eq('id', task.mission_id)
        .maybeSingle();

    const missionValue = parseApplyIcpFilter(mission?.params?.applyIcpFilter);
    return missionValue !== null ? missionValue : true;
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

const TASK_STUCK_TIMEOUT_MINUTES = 35;
const TASK_AUTO_RETRY_DELAYS_MINUTES = [5, 20];
const TASK_FAILURE_PATTERN_LOOKBACK_HOURS = 6;
const TASK_FAILURE_PATTERN_THRESHOLD = 3;
const SEARCH_FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const ENRICH_FETCH_TIMEOUT_MS = 4 * 60 * 1000;
const CONTACT_SEND_TIMEOUT_MS = 90 * 1000;

class MissionPausedError extends Error {
    missionId: string;
    missionStatus: string;

    constructor(missionId: string, missionStatus: string, context: string) {
        super(`Mission ${missionId} is ${missionStatus} during ${context}`);
        this.name = 'MissionPausedError';
        this.missionId = missionId;
        this.missionStatus = missionStatus;
    }
}

function normalizeTaskErrorMessage(error: unknown) {
    return String(error || 'unknown_task_error')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
}

function getTaskRetryDelayMinutes(retryCount: number) {
    if (retryCount <= 0) return TASK_AUTO_RETRY_DELAYS_MINUTES[0];
    return TASK_AUTO_RETRY_DELAYS_MINUTES[Math.min(retryCount - 1, TASK_AUTO_RETRY_DELAYS_MINUTES.length - 1)];
}

function getTaskRetryScheduledFor(retryCount: number) {
    return new Date(Date.now() + getTaskRetryDelayMinutes(retryCount) * 60 * 1000).toISOString();
}

async function touchTaskHeartbeat(supabase: any, taskId?: string | null) {
    if (!taskId) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
        .from('antonia_tasks')
        .update({ heartbeat_at: nowIso, updated_at: nowIso })
        .eq('id', taskId)
        .eq('status', 'processing');

    if (error) {
        console.warn('[Cron] Failed to update task heartbeat:', taskId, error.message || error);
    }
}

async function assertMissionIsActive(supabase: any, missionId?: string | null, context: string = 'task_execution') {
    if (!missionId) return;

    const { data: mission, error } = await supabase
        .from('antonia_missions')
        .select('status')
        .eq('id', missionId)
        .maybeSingle();

    if (error) {
        throw new Error(`mission_status_check_failed:${error.message || error}`);
    }

    const missionStatus = String(mission?.status || '').trim().toLowerCase();
    if (missionStatus && missionStatus !== 'active') {
        throw new MissionPausedError(String(missionId), missionStatus, context);
    }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`${label}_timeout_after_${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function pauseMissionProspecting(supabase: any, missionId: string, reason: string, details: Record<string, any> = {}) {
    const nowIso = new Date().toISOString();

    const { data: mission } = await supabase
        .from('antonia_missions')
        .update({ status: 'paused', updated_at: nowIso })
        .eq('id', missionId)
        .eq('status', 'active')
        .select('id, organization_id')
        .maybeSingle();

    await supabase
        .from('antonia_tasks')
        .update({
            status: 'completed',
            result: {
                skipped: true,
                reason: 'mission_paused',
                source: reason,
            },
            error_message: null,
            processing_started_at: null,
            heartbeat_at: null,
            updated_at: nowIso,
        } as any)
        .eq('mission_id', missionId)
        .eq('status', 'pending')
        .in('type', ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'CONTACT_CAMPAIGN']);

    if (mission?.organization_id) {
        await supabase.from('antonia_logs').insert({
            mission_id: missionId,
            organization_id: mission.organization_id,
            level: 'warning',
            message: `Mission paused automatically: ${reason}`,
            details: {
                source: reason,
                ...details,
            },
            created_at: nowIso,
        });
    }

    return Boolean(mission);
}

async function maybePauseMissionForRepeatedFailures(supabase: any, task: any, errorMessage: string) {
    if (!task?.mission_id) return false;

    const lookbackIso = new Date(Date.now() - TASK_FAILURE_PATTERN_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
        .from('antonia_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('mission_id', task.mission_id)
        .eq('type', task.type)
        .eq('status', 'failed')
        .gte('updated_at', lookbackIso);

    if ((count || 0) < TASK_FAILURE_PATTERN_THRESHOLD) {
        return false;
    }

    const paused = await pauseMissionProspecting(supabase, task.mission_id, 'repeated_task_failures', {
        taskType: task.type,
        recentFailedTasks: count || 0,
        lookbackHours: TASK_FAILURE_PATTERN_LOOKBACK_HOURS,
        latestError: errorMessage,
    });

    if (paused) {
        await createAntoniaException(supabase, {
            organizationId: task.organization_id,
            missionId: task.mission_id,
            taskId: task.id,
            category: 'repeated_task_failures',
            severity: 'critical',
            title: 'Mision pausada por fallos repetidos',
            description: `La tarea ${task.type} fallo ${count || 0} veces en las ultimas ${TASK_FAILURE_PATTERN_LOOKBACK_HOURS} horas.`,
            dedupeKey: `mission_repeated_failures_${task.mission_id}_${task.type}`,
            payload: {
                taskType: task.type,
                recentFailedTasks: count || 0,
                latestError: errorMessage,
            },
        });
    }

    return paused;
}

async function rescheduleTaskAfterFailure(
    supabase: any,
    task: any,
    rawErrorMessage: string,
    source: 'task_failure' | 'stuck_watchdog',
    failureDetails?: Record<string, any>
) {
    const nowIso = new Date().toISOString();
    const errorMessage = normalizeTaskErrorMessage(rawErrorMessage);
    const nextRetryCount = Number(task?.retry_count || 0) + 1;

    if (nextRetryCount > TASK_AUTO_RETRY_DELAYS_MINUTES.length) {
        await supabase.from('antonia_tasks').update({
            status: 'failed',
            retry_count: nextRetryCount,
            result: {
                skipped: true,
                reason: 'auto_retry_exhausted',
                source,
                retryCount: nextRetryCount,
                ...(failureDetails ? { failure: failureDetails } : {}),
            },
            error_message: errorMessage,
            processing_started_at: null,
            heartbeat_at: null,
            updated_at: nowIso,
        }).eq('id', task.id);

        await supabase.from('antonia_logs').insert({
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            level: 'error',
            message: `Task ${task.type} marked as failed after exhausting automatic retries.`,
            details: {
                taskId: task.id,
                retryCount: nextRetryCount,
                source,
                errorMessage,
                ...(failureDetails ? { failure: failureDetails } : {}),
            },
            created_at: nowIso,
        });

        await createAntoniaException(supabase, {
            organizationId: task.organization_id,
            missionId: task.mission_id,
            taskId: task.id,
            category: source === 'stuck_watchdog' ? 'stuck_task_failed' : 'task_retry_exhausted',
            severity: 'high',
            title: source === 'stuck_watchdog' ? 'Tarea estancada marcada como fallida' : 'Tarea marcada como fallida por reintentos agotados',
            description: errorMessage,
            dedupeKey: `task_failure_${task.id}`,
            payload: {
                retryCount: nextRetryCount,
                taskType: task.type,
                source,
                ...(failureDetails ? { failure: failureDetails } : {}),
            },
        });

        await maybePauseMissionForRepeatedFailures(supabase, task, errorMessage);
        return { final: true, retryCount: nextRetryCount };
    }

    const scheduledFor = getTaskRetryScheduledFor(nextRetryCount);
    await supabase.from('antonia_tasks').update({
        status: 'pending',
        retry_count: nextRetryCount,
        scheduled_for: scheduledFor,
        result: {
            skipped: true,
            reason: 'auto_retry_scheduled',
            source,
            retryCount: nextRetryCount,
            scheduledFor,
            ...(failureDetails ? { failure: failureDetails } : {}),
        },
        error_message: errorMessage,
        processing_started_at: null,
        heartbeat_at: null,
        updated_at: nowIso,
    }).eq('id', task.id);

    await supabase.from('antonia_logs').insert({
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        level: 'warning',
        message: `Task ${task.type} scheduled for retry #${nextRetryCount}.`,
        details: {
            taskId: task.id,
            retryCount: nextRetryCount,
            scheduledFor,
            source,
            errorMessage,
            ...(failureDetails ? { failure: failureDetails } : {}),
        },
        created_at: nowIso,
    });

    return { final: false, retryCount: nextRetryCount, scheduledFor };
}

async function rescueStuckTasks(supabase: any) {
    const cutoffIso = new Date(Date.now() - TASK_STUCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    const { data: stuckTasks, error } = await supabase
        .from('antonia_tasks')
        .select('id, mission_id, organization_id, type, retry_count, updated_at, processing_started_at, heartbeat_at')
        .eq('status', 'processing')
        .or(`and(heartbeat_at.is.null,processing_started_at.lt.${cutoffIso}),heartbeat_at.lt.${cutoffIso}`)
        .order('processing_started_at', { ascending: true })
        .limit(25);

    if (error) {
        console.error('[Cron] Failed to query stuck Antonia tasks:', error);
        return { rescuedCount: 0, stuckCount: 0 };
    }

    const tasks = stuckTasks || [];
    for (const stuckTask of tasks) {
        await rescheduleTaskAfterFailure(
            supabase,
            stuckTask,
            `Task remained in processing beyond ${TASK_STUCK_TIMEOUT_MINUTES} minutes without heartbeat progress.`,
            'stuck_watchdog'
        );
    }

    return { rescuedCount: tasks.length, stuckCount: tasks.length };
}

async function insertTaskWithIdempotencyGuard(supabase: any, row: Record<string, any>) {
    const payload: Record<string, any> = {
        ...row,
        created_at: row.created_at || new Date().toISOString(),
    };
    const { error } = await supabase.from('antonia_tasks').insert(payload);
    if (String((error as any)?.code || '') === '23505' && payload.idempotency_key) {
        return { inserted: false, duplicate: true };
    }
    if (error) throw error;
    return { inserted: true, duplicate: false };
}

async function claimPendingTasks(supabase: any, limit: number, allowTypes: string[], workerId: string, workerSource: string) {
    const nowIso = new Date().toISOString();
    const { data: candidates, error } = await supabase
        .from('antonia_tasks')
        .select('*')
        .eq('status', 'pending')
        .in('type', allowTypes)
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
        .order('created_at', { ascending: true })
        .limit(Math.max(limit * 3, limit));

    if (error || !candidates?.length) {
        if (error) console.error('[Cron] Failed to fetch pending Antonia tasks:', error);
        return [];
    }

    const claimed: any[] = [];
    for (const candidate of candidates) {
        if (claimed.length >= limit) break;
        const { data: task } = await supabase
            .from('antonia_tasks')
            .update({
                status: 'processing',
                processing_started_at: nowIso,
                heartbeat_at: nowIso,
                worker_id: workerId,
                worker_source: workerSource,
                updated_at: nowIso,
            })
            .eq('id', candidate.id)
            .eq('status', 'pending')
            .select('*')
            .maybeSingle();

        if (task) claimed.push(task);
    }

    return claimed;
}

function buildResearchLeadContext(lead: any) {
    return {
        id: lead?.id || null,
        leadId: lead?.id || null,
        name: lead?.fullName || lead?.full_name || lead?.name || '',
        email: lead?.email || null,
        company: lead?.companyName || lead?.company || '',
        role: lead?.title || null,
        industry: lead?.industry || null,
        city: lead?.city || null,
        country: lead?.country || null,
        companyDomain: lead?.companyDomain || lead?.company_domain || lead?.company_website || null,
        linkedinUrl: lead?.linkedin_url || lead?.linkedinUrl || null,
    };
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
    await assertMissionIsActive(supabase, task.mission_id, 'campaign_generation_start');
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

        await assertMissionIsActive(supabase, task.mission_id, 'campaign_generation_after_ai');

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
    await insertTaskWithIdempotencyGuard(supabase, {
        mission_id: task.mission_id,
        organization_id: task.organization_id,
        type: 'SEARCH',
        status: 'pending',
        payload: {
            ...task.payload,
            campaignName: generatedName, // Override/Set the campaign name
        },
        idempotency_key: `task_${task.id}_search`,
        created_at: new Date().toISOString()
    });

    return { campaignGenerated: true, campaignName: generatedName };
}

async function executeSearch(task: any, supabase: any, config: any) {
    await assertMissionIsActive(supabase, task.mission_id, 'search_start');
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';
    const internalUrl = `${appUrl}/api/leads/search`;

    const employeeRanges = String(task.payload.companySize || '').trim()
        ? [String(task.payload.companySize).trim()]
        : ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'];

    const internalBody = [
        {
            industry_keywords: [String(industry || '').trim()].filter(Boolean),
            company_location: [String(location || '').trim()].filter(Boolean),
            employee_ranges: employeeRanges,
            titles: String(jobTitle || '').trim(),
            seniorities: Array.isArray(task.payload?.seniorities) ? task.payload.seniorities : [],
            max_results: 100,
        }
    ];

    let data: any;
    try {
        await touchTaskHeartbeat(supabase, task.id);
        const response = await fetchWithTimeout(internalUrl, {
            method: 'POST',
            headers: ensureInternalHeaders({
                'Content-Type': 'application/json',
                'x-user-id': String(task.payload.userId || ''),
            }, 'search'),
            body: JSON.stringify(internalBody),
        }, SEARCH_FETCH_TIMEOUT_MS, 'internal_search');

        if (!response.ok) {
            const txt = await response.text().catch(() => '');
            throw new Error(`internal_search_failed:${response.status}:${txt.slice(0, 300)}`);
        }
        data = await response.json();
    } catch (internalErr: any) {
        console.warn('[Search] Internal /api/leads/search failed. Falling back to external URL.', internalErr?.message || internalErr);

        const searchPayload = {
            user_id: task.payload.userId,
            titles: jobTitle ? [jobTitle] : [],
            company_location: location ? [location] : [],
            industry_keywords: industry ? [industry] : [],
            seniorities: Array.isArray(task.payload?.seniorities) ? task.payload.seniorities : [],
            employee_range: String(task.payload.companySize || '').trim() ? [String(task.payload.companySize).trim()] : employeeRanges,
            employee_ranges: String(task.payload.companySize || '').trim() ? [String(task.payload.companySize).trim()] : employeeRanges,
            max_results: 100
        };

        await touchTaskHeartbeat(supabase, task.id);
        const response = await fetchWithTimeout(LEAD_SEARCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(searchPayload)
        }, SEARCH_FETCH_TIMEOUT_MS, 'external_search');

        if (!response.ok) {
            throw new Error(`Search API failed: ${response.statusText}`);
        }

        data = await response.json();
    }

    await touchTaskHeartbeat(supabase, task.id);
    await assertMissionIsActive(supabase, task.mission_id, 'search_after_fetch');

    const leads = Array.isArray(data?.leads)
        ? data.leads
        : (Array.isArray(data?.results) ? data.results : []);

    let acceptedLeadCount = 0;
    let rejectedLeadCount = 0;
    const applyIcpFilter = await shouldApplyMissionIcpFilter(task, supabase);

    if (leads.length > 0) {
        const acceptedRows: any[] = [];
        const rejectedRows: any[] = [];
        const rejectedSamples: Array<{ name: string; company: string; reason: string }> = [];

        for (const lead of leads) {
            const normalizedLead = {
                name: lead.full_name || lead.fullName || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.name || '',
                title: lead.title || '',
                company: lead.organization?.name || lead.organization_name || lead.company_name || lead.company || '',
                email: lead.email || null,
                linkedin_url: lead.linkedin_url || lead.linkedinUrl || null,
                industry: lead.industry || lead.organization_industry || lead.organization?.industry || null,
                location: lead.location || lead.country || lead.city || lead.organization_location_country || null,
            };
            const fit = applyIcpFilter
                ? assessLeadMissionFit(lead, task.payload)
                : { action: 'allow', reason: 'filtro_icp_desactivado', matchedSignals: [], blockingSignals: [] };
            const score = fit.action === 'allow'
                ? scoreLeadForMission(normalizedLead, task.payload)
                : { score: 0, tier: 'cold', reason: `Fuera de ICP: ${fit.reason}` };

            const baseRow = {
                user_id: task.payload.userId,
                organization_id: task.organization_id,
                name: normalizedLead.name,
                title: normalizedLead.title,
                company: normalizedLead.company,
                email: normalizedLead.email,
                linkedin_url: normalizedLead.linkedin_url,
                status: 'saved',
                mission_id: task.mission_id,
                apollo_id: lead.apollo_id || lead.apolloId || lead.id || null,
                score: score.score,
                score_tier: score.tier,
                score_reason: score.reason,
                last_scored_at: new Date().toISOString(),
                created_at: new Date().toISOString()
            };

            if (fit.action === 'allow') {
                acceptedRows.push({ ...baseRow, status: 'saved' });
                continue;
            }

            rejectedRows.push({
                ...baseRow,
                status: 'out_of_icp',
                investigation_error: `search_fit:${fit.reason}`,
            });

            if (rejectedSamples.length < 5) {
                rejectedSamples.push({
                    name: normalizedLead.name || 'Lead',
                    company: normalizedLead.company || 'Empresa',
                    reason: fit.reason,
                });
            }
        }

        if (acceptedRows.length > 0) {
            const { error: insertErr } = await supabase.from('leads').upsert(acceptedRows, {
                onConflict: 'apollo_id',
                ignoreDuplicates: true
            });
            if (insertErr) {
                console.warn('[Search] Upsert failed for accepted leads, trying insert:', insertErr.message);
                await supabase.from('leads').insert(acceptedRows);
            }
        }

        if (rejectedRows.length > 0) {
            const { error: rejectErr } = await supabase.from('leads').upsert(rejectedRows, {
                onConflict: 'apollo_id',
                ignoreDuplicates: true
            });
            if (rejectErr) {
                console.warn('[Search] Upsert failed for out-of-ICP leads, trying insert:', rejectErr.message);
                await supabase.from('leads').insert(rejectedRows);
            }

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `ANTONIA bloqueo ${rejectedRows.length} lead(s) por salir fuera del ICP de la misión.`,
                details: {
                    source: 'search_fit_guardrail',
                    acceptedCount: acceptedRows.length,
                    blockedCount: rejectedRows.length,
                    samples: rejectedSamples,
                },
                created_at: new Date().toISOString(),
            });
        }

        acceptedLeadCount = acceptedRows.length;
        rejectedLeadCount = rejectedRows.length;

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
                await insertTaskWithIdempotencyGuard(supabase, {
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
                    idempotency_key: `task_${task.id}_fallback_enrich`,
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

                await insertTaskWithIdempotencyGuard(supabase, {
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
                    idempotency_key: `task_${task.id}_recover_contact`,
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
    if (task.payload.enrichmentLevel && acceptedLeadCount > 0) {
        await insertTaskWithIdempotencyGuard(supabase, {
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
            idempotency_key: `task_${task.id}_enrich`,
            created_at: new Date().toISOString()
        });
    }

    return {
        leadsFound: acceptedLeadCount,
        providerLeadsFound: leads.length,
        outOfIcpCount: rejectedLeadCount,
    };
}

async function executeEnrichment(task: any, supabase: any, config: any) {
    await assertMissionIsActive(supabase, task.mission_id, 'enrichment_start');
    const { leads, enrichmentLevel, userId } = task.payload;
    const isDeep = enrichmentLevel === 'deep';

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const batchLimit = isDeep ? (config.daily_investigate_limit || 20) : (config.daily_enrich_limit || 50);

    // FETCH LEADS FROM QUEUE if not provided in payload
    let leadsToProcess = leads || [];

    if (leadsToProcess.length === 0 || task.payload.source === 'queue') {
        console.log(`[Enrich] Fetching leads from queue for Mission ${task.mission_id} (Batch limit: ${batchLimit})`);

        const { data: queuedLeads, error: queueError } = await supabase
            .from('leads')
            .select('*')
            .eq('mission_id', task.mission_id)
            .eq('status', 'saved')
            // .is('email', null) // Optional: only process those without email? 
            // Better to rely on 'saved' status vs 'enriched' status
            .limit(batchLimit);

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
        revealPhone: revealPhone,
        mode: isDeep ? 'deep' : 'normal',
        tableName: 'enriched_leads'
    };

    const enrichUrl = `${appUrl}/api/opportunities/enrich-apollo`;

    await touchTaskHeartbeat(supabase, task.id);
    const response = await fetchWithTimeout(enrichUrl, {
        method: 'POST',
        headers: ensureInternalHeaders({
            'Content-Type': 'application/json',
            'x-user-id': userId,
            'x-organization-id': task.organization_id,
            'Idempotency-Key': `antonia-task:${task.id}:enrich`,
        }, 'enrich'),
        body: JSON.stringify(enrichPayload)
    }, ENRICH_FETCH_TIMEOUT_MS, 'enrich_apollo');

    const data = await response.json().catch(() => ({}));
    if (response.status === 429) {
        const retryAt = String(data?.retryAt || '').trim() || getNextUtcDayStartIso();
        console.log(`[Limit] Enrichment endpoint denied ${isDeep ? 'investigate' : 'enrich'} quota. Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }
    if (!response.ok) {
        throw new Error(`Enrichment API failed: ${response.status} ${String(data?.error || response.statusText)}`);
    }

    if (data?.error) {
        throw new Error(`Enrichment logical error: ${String(data.error)}`);
    }
    await touchTaskHeartbeat(supabase, task.id);
    await assertMissionIsActive(supabase, task.mission_id, 'enrichment_after_fetch');
    const enriched = data.enriched || [];

    if (enriched.length > 0) {
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
        await insertTaskWithIdempotencyGuard(supabase, {
            mission_id: task.mission_id,
            organization_id: task.organization_id,
            type: 'CONTACT',
            status: 'pending',
            payload: {
                userId: userId,
                enrichedLeads: enriched,
                campaignName: task.payload.campaignName
            },
            idempotency_key: `task_${task.id}_contact`,
            created_at: new Date().toISOString()
        });
    }

    return { enrichedCount: enriched.length };
}

async function executeContact(task: any, supabase: any) {
    await assertMissionIsActive(supabase, task.mission_id, 'contact_start');
    const { enrichedLeads, campaignName } = task.payload;

    // 1. Validation
    if (!enrichedLeads || !Array.isArray(enrichedLeads) || enrichedLeads.length === 0) {
        throw new Error('No enriched leads provided for contact');
    }

    // [FIX #8] Check daily contact limit before processing
    const { data: missionConfig } = await supabase
        .from('antonia_missions')
        .select('daily_contact_limit, title, params')
        .eq('id', task.mission_id)
        .single();

    const { data: orgConfig } = await supabase
        .from('antonia_config')
        .select('autopilot_enabled, autopilot_mode, approval_mode, min_auto_send_score, min_review_score, pause_on_negative_reply, pause_on_failure_spike')
        .eq('organization_id', task.organization_id)
        .maybeSingle();

    const autopilotConfig = mapAutopilotConfigRow(orgConfig);

    const baseContactLimit = missionConfig?.daily_contact_limit || 3;
    const today = new Date().toISOString().split('T')[0];

    if (autopilotConfig.autopilotEnabled && autopilotConfig.pauseOnFailureSpike) {
        const { count: recentFailures } = await supabase
            .from('antonia_exceptions')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', task.organization_id)
            .eq('category', 'send_failed')
            .gte('created_at', `${today}T00:00:00Z`);

        if ((recentFailures || 0) >= 5) {
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                category: 'failure_spike_paused',
                severity: 'critical',
                title: 'Autopilot pausado por fallos repetidos',
                description: `Se detectaron ${recentFailures} fallos de envio hoy. Revisa la cola antes de reanudar.`,
                dedupeKey: `org_${task.organization_id}_failure_spike_${today}`,
                payload: { recentFailures, today },
            });
            return { skipped: true, reason: 'failure_spike_paused' };
        }

        const deliverability = await evaluateMissionDeliverability(supabase, task.mission_id, task.organization_id);
        if (deliverability.contacts >= 10 && deliverability.failureRate >= 0.35) {
            await supabase
                .from('antonia_missions')
                .update({ status: 'paused', updated_at: new Date().toISOString() })
                .eq('id', task.mission_id)
                .eq('status', 'active');

            await supabase
                .from('antonia_tasks')
                .update({
                    status: 'completed',
                    result: {
                        skipped: true,
                        reason: 'mission_paused',
                        source: 'deliverability_watchdog',
                    },
                    error_message: null,
                    updated_at: new Date().toISOString(),
                } as any)
                .eq('mission_id', task.mission_id)
                .eq('status', 'pending')
                .in('type', ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'CONTACT_CAMPAIGN']);

            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                category: 'deliverability_watchdog',
                severity: 'critical',
                title: 'Mision pausada por deliverability watchdog',
                description: `ANTONIA detecto una tasa de falla/compliance de ${(deliverability.failureRate * 100).toFixed(0)}% en los ultimos 7 dias.`,
                dedupeKey: `deliverability_watchdog_${task.mission_id}`,
                payload: deliverability,
            });
            return { skipped: true, reason: 'deliverability_watchdog_paused' };
        }
    }

    const contactQuota = await getDailyQuotaStatus({
        userId: task.payload.userId,
        organizationId: task.organization_id,
        resource: 'contact',
        limit: baseContactLimit,
    });
    const contactLimit = contactQuota.limit;
    const contactsToday = Math.max(contactQuota.count, 0);

    if ((contactsToday || 0) >= contactLimit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[Contact] Daily contact limit reached (${contactsToday}/${contactLimit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_contact_limit_reached', retryAt };
    }

    // Cap enrichedLeads to remaining capacity
    const remaining = contactLimit - (contactsToday || 0);
    const leadsToContact = enrichedLeads.slice(0, remaining);

    const leadIds = leadsToContact.map((lead: any) => lead?.id).filter(Boolean);
    const { data: leadRows } = leadIds.length > 0
        ? await supabase
            .from('leads')
            .select('id, name, title, company, email, linkedin_url, company_website, industry, city, country, score, score_tier, score_reason')
            .in('id', leadIds)
        : { data: [] };

    const leadMap = new Map<string, any>(((leadRows as any[]) || []).map((lead: any) => [String(lead.id), lead]));

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

    const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('full_name, company_name, company_domain, job_title, signatures')
        .eq('id', task.payload.userId)
        .maybeSingle();

    let campaignSentRecords: Record<string, any> | null = campaign.sent_records ? { ...(campaign.sent_records || {}) } : null;
    let campaignDirty = false;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

    const contactedLeads: any[] = [];
    const contactResults: any[] = [];
    const errors: any[] = [];

    const candidateEmails = [...new Set(
        leadsToContact
            .map((lead: any) => String(lead?.email || leadMap.get(String(lead?.id || ''))?.email || '').trim().toLowerCase())
            .filter(Boolean)
    )];
    const candidateLeadIds = [...new Set(leadsToContact.map((lead: any) => String(lead?.id || '').trim()).filter(Boolean))];
    const priorReplyMatches: any[] = [];

    if (candidateEmails.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('id, lead_id, email, status, replied_at, reply_intent, last_reply_text, name, company, mission_id, sent_at, delivery_status, bounce_category, bounce_reason, evaluation_status, campaign_followup_reason, data')
            .eq('organization_id', task.organization_id)
            .in('email', candidateEmails);
        priorReplyMatches.push(...(data || []));
    }

    if (candidateLeadIds.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('id, lead_id, email, status, replied_at, reply_intent, last_reply_text, name, company, mission_id, sent_at, delivery_status, bounce_category, bounce_reason, evaluation_status, campaign_followup_reason, data')
            .eq('organization_id', task.organization_id)
            .in('lead_id', candidateLeadIds);
        priorReplyMatches.push(...(data || []));
    }

    // 3. Process each lead
    for (const lead of leadsToContact) { // [FIX #8] use capped list
        await assertMissionIsActive(supabase, task.mission_id, 'contact_loop');
        await touchTaskHeartbeat(supabase, task.id);
        const leadDb = lead?.id ? leadMap.get(String(lead.id)) : null;
        const leadContext = {
            ...lead,
            ...(leadDb || {}),
            id: lead?.id || leadDb?.id,
            fullName: lead?.fullName || lead?.full_name || lead?.name || leadDb?.name || '',
            name: lead?.name || leadDb?.name || lead?.fullName || '',
            companyName: lead?.companyName || lead?.company || leadDb?.company || '',
            company: lead?.company || lead?.companyName || leadDb?.company || '',
            companyDomain: lead?.companyDomain || lead?.company_domain || lead?.company_website || leadDb?.company_website || null,
            title: lead?.title || leadDb?.title || '',
            email: lead?.email || leadDb?.email || null,
            linkedin_url: lead?.linkedin_url || lead?.linkedinUrl || leadDb?.linkedin_url || null,
            industry: lead?.industry || leadDb?.industry || null,
            city: lead?.city || leadDb?.city || null,
            country: lead?.country || leadDb?.country || null,
            score: leadDb?.score ?? lead?.score ?? 0,
            scoreTier: leadDb?.score_tier || lead?.scoreTier || 'cold',
            scoreReason: leadDb?.score_reason || lead?.scoreReason || null,
        };

        const priorReply = findPriorReplyMatch({
            id: leadContext.id,
            email: leadContext.email,
        }, priorReplyMatches as any[]);

        if (priorReply) {
            const permanentSuppression = shouldPermanentlySuppressContact(priorReply);
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'reply_guardrail',
                severity: 'high',
                title: permanentSuppression ? 'Contacto bloqueado permanentemente' : 'Contacto bloqueado: existe historial previo',
                description: permanentSuppression
                    ? `${leadContext.email || leadContext.fullName || 'Lead'} tiene una baja o falla permanente registrada.`
                    : `${leadContext.email || leadContext.fullName || 'Lead'} tiene una respuesta o falla temporal registrada; ANTONIA omitio este envio para evitar continuar el hilo a ciegas.`,
                dedupeKey: `reply_guardrail_${task.organization_id}_${leadContext.email || leadContext.id}`,
                payload: { lead: leadContext, priorReply, permanentSuppression },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: permanentSuppression ? 'closed_lost' : 'engaged',
                notes: permanentSuppression
                    ? 'Contacto suprimido por baja o falla de entrega permanente'
                    : 'Envio omitido porque existe una respuesta o falla temporal previa',
                nextAction: permanentSuppression
                    ? 'Mantener al contacto fuera de futuras automatizaciones'
                    : 'Revisar el historial antes de decidir cualquier nuevo contacto',
                nextActionType: permanentSuppression ? 'do_not_contact' : 'prior_reply_guardrail',
                nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                autopilotStatus: permanentSuppression ? 'do_not_contact' : 'action_required',
                lastAutopilotEvent: permanentSuppression ? 'permanent_suppression' : 'prior_reply_guardrail',
            });
            if (leadContext.id && permanentSuppression) {
                await supabase
                    .from('leads')
                    .update({ status: 'do_not_contact', updated_at: new Date().toISOString() } as any)
                    .eq('id', leadContext.id);
            }
            errors.push({
                email: leadContext.email,
                error: permanentSuppression ? 'Contacto suprimido permanentemente' : 'Existe historial previo; envio omitido',
                permanentSuppression,
            });
            continue;
        }

        if (!leadContext.email) {
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'missing_email',
                severity: 'medium',
                title: 'Lead listo sin email verificable',
                description: `${leadContext.fullName || leadContext.name || 'Lead'} no puede entrar al autopilot porque no tiene email.`,
                dedupeKey: `missing_email_${task.mission_id}_${leadContext.id || leadContext.email || 'unknown'}`,
                payload: { lead: leadContext, campaignName, userId: task.payload.userId },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'qualified',
                notes: 'Lead sin email verificable para autopilot',
                nextAction: 'Intentar nueva fuente de enriquecimiento o revisar manualmente',
                nextActionType: 'missing_email_research',
                nextActionDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                autopilotStatus: 'missing_email',
                lastAutopilotEvent: 'missing_email',
            });
            errors.push({ name: leadContext.fullName || leadContext.name, error: 'No email' });
            continue;
        }

        let ensuredResearch: Awaited<ReturnType<typeof ensureLeadResearchReport>>;
        try {
            ensuredResearch = await ensureLeadResearchReport({
                userId: task.payload.userId,
                organizationId: task.organization_id,
                lead: buildResearchLeadContext(leadContext),
                sellerProfile,
            });
        } catch (researchError: any) {
            ensuredResearch = {
                report: null,
                cacheHit: false,
                created: false,
                warning: String(researchError?.message || researchError || 'RESEARCH_LOOKUP_FAILED'),
            };
        }

        const researchStatus = getLeadResearchStatus(ensuredResearch.report);
        if (!isLeadResearchReadyForAutoContact(ensuredResearch.report)) {
            const researchReason = getLeadResearchAutoContactBlockReason(ensuredResearch.report, ensuredResearch.warning);
            if (leadContext.id) {
                await supabase
                    .from('leads')
                    .update({
                        last_investigated_at: new Date().toISOString(),
                        investigation_error: researchReason,
                        updated_at: new Date().toISOString(),
                    } as any)
                    .eq('id', leadContext.id);
            }
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'research_required',
                severity: 'high',
                title: 'Lead bloqueado: investigacion incompleta',
                description: ensuredResearch.warning
                    ? `No se pudo dejar lista la investigacion automatica (${ensuredResearch.warning}).`
                    : `La investigacion quedo en estado ${researchStatus} y ANTONIA bloqueo el contacto automatico.`,
                dedupeKey: `research_required_${task.mission_id}_${leadContext.id || leadContext.email}`,
                payload: {
                    missionTitle: missionConfig?.title || null,
                    campaignName,
                    userId: task.payload.userId,
                    lead: leadContext,
                    researchStatus,
                    researchReason,
                    researchWarning: ensuredResearch.warning,
                    reportStatus: ensuredResearch.report
                        ? (ensuredResearch.cacheHit ? 'cache_hit' : 'generated')
                        : 'missing',
                },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'qualified',
                notes: `Contacto bloqueado: investigacion ${researchStatus} (${researchReason})`,
                nextAction: 'Completar investigacion o revisar manualmente antes de contactar',
                nextActionType: 'research_required',
                nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                autopilotStatus: 'research_blocked',
                lastAutopilotEvent: 'research_required',
            });
            errors.push({ email: leadContext.email, error: `Research blocked (${researchReason})` });
            continue;
        }

        if (leadContext.id) {
            await supabase
                .from('leads')
                .update({
                    last_investigated_at: new Date().toISOString(),
                    investigation_error: null,
                    updated_at: new Date().toISOString(),
                } as any)
                .eq('id', leadContext.id);
        }

        const missionFit = assessLeadMissionFit({
            ...leadContext,
            researchReport: ensuredResearch.report,
        }, missionConfig?.params || {});

        if (missionFit.action === 'block') {
            if (leadContext.id) {
                await supabase
                    .from('leads')
                    .update({
                        status: 'out_of_icp',
                        investigation_error: `mission_fit:${missionFit.reason}`,
                    } as any)
                    .eq('id', leadContext.id);
            }

            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'out_of_icp',
                severity: 'high',
                title: 'Lead bloqueado: fuera del ICP de la misión',
                description: missionFit.reason,
                dedupeKey: `out_of_icp_${task.mission_id}_${leadContext.id || leadContext.email}`,
                payload: {
                    missionTitle: missionConfig?.title || null,
                    campaignName,
                    userId: task.payload.userId,
                    lead: leadContext,
                    missionFit,
                },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'inbox',
                notes: `Lead bloqueado por ICP: ${missionFit.reason}`,
                nextAction: 'Ajustar ICP o revisar manualmente antes de cualquier contacto',
                nextActionType: 'out_of_icp',
                nextActionDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                autopilotStatus: 'out_of_icp',
                lastAutopilotEvent: 'out_of_icp',
            });
            errors.push({ email: leadContext.email, error: `Out of ICP (${missionFit.reason})` });
            continue;
        }

        const autopilotDecision = decideAutopilotContactAction({
            config: autopilotConfig,
            lead: leadContext,
        });

        if (autopilotDecision.action === 'review') {
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'approval_required',
                severity: autopilotDecision.severity,
                title: 'Lead requiere aprobacion antes de contacto',
                description: autopilotDecision.reason,
                dedupeKey: `approval_${task.mission_id}_${leadContext.id || leadContext.email}`,
                payload: {
                    missionTitle: missionConfig?.title || null,
                    campaignName,
                    userId: task.payload.userId,
                    lead: leadContext,
                    decision: autopilotDecision,
                    contactTaskPayload: {
                        userId: task.payload.userId,
                        campaignName,
                        enrichedLeads: [leadContext],
                    },
                },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'qualified',
                notes: autopilotDecision.reason,
                nextAction: 'Revisar mensaje y aprobar contacto',
                nextActionType: 'approval_required',
                nextActionDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                autopilotStatus: 'awaiting_approval',
                lastAutopilotEvent: 'approval_required',
            });
            continue;
        }

        if (autopilotDecision.action === 'skip') {
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'low_score_skip',
                severity: autopilotDecision.severity,
                title: 'Lead omitido por guardrails de autopilot',
                description: autopilotDecision.reason,
                dedupeKey: `skip_${task.mission_id}_${leadContext.id || leadContext.email}`,
                payload: { lead: leadContext, decision: autopilotDecision, campaignName },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'inbox',
                notes: autopilotDecision.reason,
                nextAction: 'Ampliar investigacion o descartar',
                nextActionType: 'low_score_skip',
                nextActionDueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
                autopilotStatus: 'skipped_by_guardrails',
                lastAutopilotEvent: 'low_score_skip',
            });
            continue;
        }

        const schedule = computeLeadContactSchedule(leadContext);
        if (new Date(schedule.scheduledFor).getTime() > Date.now()) {
            console.log(
                `[Contact] Deferring ${leadContext.email} to ${schedule.scheduledFor} ` +
                `(${schedule.timeZone}, match:${schedule.matchedBy}, location:"${schedule.location}", reason:${schedule.reason})`
            );

            await insertTaskWithIdempotencyGuard(supabase, {
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                type: 'CONTACT',
                status: 'pending',
                payload: {
                    userId: task.payload.userId,
                    enrichedLeads: [leadContext],
                    campaignName: campaignName
                },
                scheduled_for: schedule.scheduledFor,
                idempotency_key: `schedule_contact_${task.id}_${leadContext.id || leadContext.email}_${schedule.scheduledFor}`,
                created_at: new Date().toISOString()
            });

            continue;
        }

        try {
            // Personalize email
            const firstName = leadContext.fullName?.split(' ')[0] || 'Hola';
            const personalizedBody = bodyTemplate
                .replace('{{firstName}}', firstName)
                .replace('{{lead.name}}', leadContext.fullName || '')
                .replace('{{company}}', leadContext.companyName || 'tu empresa');

            const personalizedSubject = subject
                .replace('{{firstName}}', firstName)
                .replace('{{lead.name}}', leadContext.fullName || '')
                .replace('{{company}}', leadContext.companyName || 'tu empresa');

            const response = await fetchWithTimeout(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: ensureInternalHeaders({
                    'Content-Type': 'application/json',
                    'x-user-id': task.payload.userId,
                    'x-organization-id': task.organization_id,
                }, 'contact'),
                body: JSON.stringify({
                    to: leadContext.email,
                    subject: personalizedSubject,
                    body: personalizedBody,
                    leadId: leadContext.id,
                    campaignId: campaign?.id,
                    missionId: task.mission_id,
                    taskId: task.id,
                    userId: task.payload.userId,
                    idempotencyKey: `antonia:${task.id}:${leadContext.id || leadContext.email}:initial`,
                    isHtml: true,
                    tracking: campaign?.settings?.tracking
                })
            }, CONTACT_SEND_TIMEOUT_MS, 'contact_send');

            const responseText = await response.text().catch(() => '');
            const responseData: any = parseContactSendResponseBody(responseText);
            if (!isSuccessfulContactSend(response.status, responseData)) {
                const failure = classifyContactSendFailure(response.status, responseData);
                const responseMessage = typeof responseData.error === 'string'
                    ? responseData.error
                    : responseText || 'Empty response';
                const isUnsub = failure.complianceReason === 'unsubscribed';
                const isBlocked = failure.complianceReason === 'domain_blocked';

                if (failure.shouldMarkDoNotContact) {
                    await createAntoniaException(supabase, {
                        organizationId: task.organization_id,
                        missionId: task.mission_id,
                        taskId: task.id,
                        leadId: leadContext.id || null,
                        category: 'compliance_block',
                        severity: 'high',
                        title: isUnsub ? 'Contacto frenado por unsubscribe' : 'Contacto frenado por dominio bloqueado',
                        description: `ANTONIA detuvo el contacto a ${leadContext.email}.`,
                        dedupeKey: `compliance_${task.mission_id}_${leadContext.id || leadContext.email}_${isUnsub ? 'unsub' : 'blocked'}`,
                        payload: {
                            lead: leadContext,
                            campaignName,
                            responseStatus: response.status,
                            responseCode: failure.code,
                        },
                    });

                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: task.organization_id,
                        leadId: leadContext.id || null,
                        stage: 'closed_lost',
                        notes: isUnsub ? 'Lead marco unsubscribe' : 'Dominio bloqueado por compliance',
                        nextAction: 'Excluir del flujo y revisar reputacion/canal',
                        nextActionType: 'compliance_review',
                        nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        autopilotStatus: isUnsub ? 'unsubscribed' : 'domain_blocked',
                        lastAutopilotEvent: isUnsub ? 'unsubscribe' : 'domain_blocked',
                    });

                    await supabase
                        .from('contacted_leads')
                        .update({
                            campaign_followup_allowed: false,
                            campaign_followup_reason: isUnsub ? 'unsubscribed' : 'domain_blocked',
                            evaluation_status: isUnsub ? 'do_not_contact' : 'pending',
                            last_update_at: new Date().toISOString(),
                        } as any)
                        .eq('lead_id', leadContext.id)
                        .eq('mission_id', task.mission_id);

                    await supabase
                        .from('leads')
                        .update({ status: 'do_not_contact', updated_at: new Date().toISOString() })
                        .eq('id', leadContext.id);
                }

                if (!failure.shouldMarkDoNotContact) {
                    await createAntoniaException(supabase, {
                        organizationId: task.organization_id,
                        missionId: task.mission_id,
                        taskId: task.id,
                        leadId: leadContext.id || null,
                        category: 'send_failed',
                        severity: 'medium',
                        title: failure.outcomeUnknown ? 'Estado de envio no confirmado' : 'Fallo enviando contacto',
                        description: `API ${response.status}${failure.code ? ` ${failure.code}` : ''}: ${responseMessage.slice(0, 160)}`,
                        dedupeKey: `send_fail_${task.id}_${leadContext.id || leadContext.email}_${response.status}`,
                        payload: {
                            lead: leadContext,
                            campaignName,
                            responseStatus: response.status,
                            responseCode: failure.code,
                            retryable: failure.retryable,
                            outcomeUnknown: failure.outcomeUnknown,
                            dailyQuotaExceeded: failure.dailyQuotaExceeded,
                            outboundConflict: failure.outboundConflict,
                            dispatchId: responseData.dispatchId || null,
                            errorText: responseMessage.slice(0, 500),
                        },
                    });
                    await syncLeadAutopilotToCrm(supabase, {
                        organizationId: task.organization_id,
                        leadId: leadContext.id || null,
                        stage: 'qualified',
                        notes: failure.outcomeUnknown
                            ? `Estado de envio no confirmado: ${failure.code || `API ${response.status}`}`
                            : `Fallo de envio: ${failure.code || `API ${response.status}`}`,
                        nextAction: 'Revisar canal, provider o plantilla antes de reintentar',
                        nextActionType: 'send_failure_review',
                        nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                        autopilotStatus: failure.outcomeUnknown ? 'send_outcome_unknown' : 'send_failed',
                        lastAutopilotEvent: failure.outcomeUnknown ? 'send_outcome_unknown' : 'send_failed',
                    });
                }

                errors.push({
                    email: leadContext.email,
                    error: `API ${response.status}${failure.code ? ` ${failure.code}` : ''}: ${responseMessage.slice(0, 160)}`,
                    status: response.status,
                    code: failure.code,
                    retryable: failure.retryable,
                    outcomeUnknown: failure.outcomeUnknown,
                    dailyQuotaExceeded: failure.dailyQuotaExceeded,
                    outboundConflict: failure.outboundConflict,
                    dispatchId: responseData.dispatchId || null,
                });
                continue;
            }

            const resData = responseData;
            const isReplayed = isReplayedContactSend(resData);
            const existingContact = isReplayed && resData.dispatchId
                ? priorReplyMatches.find((row: any) => row?.data?.dispatchId === resData.dispatchId)
                : null;
            const sentAt = existingContact?.sent_at || new Date().toISOString();

            contactResults.push({
                name: leadContext.fullName,
                email: leadContext.email,
                company: leadContext.companyName,
                status: isReplayed ? 'replayed' : 'sent',
                contactedId: existingContact?.id || null,
            });

            if (shouldAppendContactedLead(response.status, responseData)) {
                contactedLeads.push({
                    ...(resData.trackingId ? { id: resData.trackingId } : {}),
                    user_id: task.payload.userId, // [FIX #5] add user_id required by RLS
                    organization_id: task.organization_id,
                    lead_id: leadContext.id,
                    mission_id: task.mission_id,
                    campaign_id: campaign.id,
                    name: leadContext.fullName,
                    email: leadContext.email,
                    company: leadContext.companyName,
                    role: leadContext.title,
                    status: 'sent',
                    provider: resData.provider || 'unknown',
                    subject: personalizedSubject,
                    message_id: resData.messageId || null,
                    thread_id: resData.threadId || null,
                    conversation_id: resData.conversationId || null,
                    internet_message_id: resData.internetMessageId || null,
                    thread_key: buildThreadKey({
                        provider: resData.provider || 'unknown',
                        threadId: resData.threadId,
                        conversationId: resData.conversationId,
                        internetMessageId: resData.internetMessageId,
                        messageId: resData.messageId,
                    }),
                    lifecycle_state: 'sent',
                    last_event_type: 'sent',
                    last_event_at: sentAt,
                    sent_at: sentAt,
                    created_at: sentAt,
                    data: {
                        campaign_id: campaign.id,
                        draftId: resData.draftId || null,
                        draftVersionId: resData.draftVersionId || null,
                        contentHash: resData.contentHash || null,
                        dispatchId: resData.dispatchId || null,
                    },
                });
            }

            if (campaign?.id && campaignSentRecords && leadContext?.id) {
                const leadKey = String(leadContext.id);
                const existingSentRecord = campaignSentRecords[leadKey];
                if (!isReplayed || !existingSentRecord || Number(existingSentRecord.lastStepIdx) < 0) {
                    campaignSentRecords[leadKey] = { lastStepIdx: 0, lastSentAt: sentAt };
                    campaignDirty = true;
                }
            }

            if (!isReplayed) {
                await syncLeadAutopilotToCrm(supabase, {
                    organizationId: task.organization_id,
                    leadId: leadContext.id || null,
                    stage: 'contacted',
                    notes: `Primer contacto enviado via ${resData.provider || 'unknown'}`,
                    nextAction: 'Esperar senales de apertura o respuesta para decidir follow-up',
                    nextActionType: 'wait_for_reply',
                    nextActionDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                    autopilotStatus: 'contacted',
                    lastAutopilotEvent: 'contact_sent',
                });
            }
            await touchTaskHeartbeat(supabase, task.id);

        } catch (err: any) {
            console.error(`[Contact] Failed to send to ${leadContext.email}:`, err);
            const retryable = isRetryableContactSendException(err);
            await createAntoniaException(supabase, {
                organizationId: task.organization_id,
                missionId: task.mission_id,
                taskId: task.id,
                leadId: leadContext.id || null,
                category: 'send_failed',
                severity: 'medium',
                title: 'Fallo inesperado enviando contacto',
                description: err.message || 'Unexpected send failure',
                dedupeKey: `send_fail_${task.id}_${leadContext.id || leadContext.email}_unexpected`,
                payload: {
                    lead: leadContext,
                    campaignName,
                    error: err.message || String(err),
                    retryable,
                    outcomeUnknown: retryable,
                },
            });
            await syncLeadAutopilotToCrm(supabase, {
                organizationId: task.organization_id,
                leadId: leadContext.id || null,
                stage: 'qualified',
                notes: err.message || 'Unexpected send failure',
                nextAction: 'Revisar error y reintentar contacto',
                nextActionType: 'send_failure_review',
                nextActionDueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                autopilotStatus: retryable ? 'send_outcome_unknown' : 'send_failed',
                lastAutopilotEvent: retryable ? 'send_outcome_unknown' : 'send_failed',
            });
            errors.push({
                email: leadContext.email,
                error: err.message || String(err),
                code: String(err?.code || 'CONTACT_SEND_EXCEPTION'),
                retryable,
                outcomeUnknown: retryable,
            });
            // Optionally insert as failed contact?
        }
    }

    if (contactedLeads.length > 0) {
        await supabase.from('contacted_leads').insert(contactedLeads);

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

    if (campaign?.id && campaignDirty && campaignSentRecords) {
        await supabase
            .from('campaigns')
            .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
            .eq('id', campaign.id);
    }

    const replayedCount = contactResults.filter((result) => result.status === 'replayed').length;
    const retryableErrors = errors.filter((error) => error.retryable === true);
    console.log(`[Contact] Successfully sent ${contactedLeads.length} emails. Replayed: ${replayedCount}. Failed: ${errors.length}`);

    if (retryableErrors.length > 0) {
        const retryError: any = new Error(
            `Retryable contact send failure: ${retryableErrors.map((error) => error.code || 'UNKNOWN').join(', ')}`
        );
        retryError.code = retryableErrors[0]?.code || 'CONTACT_SEND_RETRYABLE';
        retryError.retryable = true;
        retryError.outcomeUnknown = retryableErrors.some((error) => error.outcomeUnknown === true);
        retryError.result = {
            contactedCount: contactedLeads.length,
            replayedCount,
            contactedList: contactResults,
            errors,
            retryable: true,
            outcomeUnknown: retryError.outcomeUnknown,
        };
        throw retryError;
    }

    return {
        contactedCount: contactedLeads.length,
        replayedCount,
        contactedList: contactResults,
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

function mapAutopilotConfigRow(row: any) {
    return {
        autopilotEnabled: Boolean(row?.autopilot_enabled ?? false),
        autopilotMode: row?.autopilot_mode || 'manual_assist',
        approvalMode: row?.approval_mode || 'low_score_only',
        minAutoSendScore: Number(row?.min_auto_send_score || 70),
        minReviewScore: Number(row?.min_review_score || 45),
        pauseOnNegativeReply: Boolean(row?.pause_on_negative_reply ?? true),
        pauseOnFailureSpike: Boolean(row?.pause_on_failure_spike ?? true),
    };
}

async function evaluateMissionDeliverability(supabase: any, missionId: string, organizationId: string) {
    const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [contactsRes, sendFailedRes, complianceRes] = await Promise.all([
        supabase
            .from('contacted_leads')
            .select('*', { count: 'exact', head: true })
            .eq('mission_id', missionId)
            .gte('created_at', last7d),
        supabase
            .from('antonia_exceptions')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('mission_id', missionId)
            .eq('category', 'send_failed')
            .gte('created_at', last7d),
        supabase
            .from('antonia_exceptions')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('mission_id', missionId)
            .eq('category', 'compliance_block')
            .gte('created_at', last7d),
    ]);

    const contacts = Number(contactsRes.count || 0);
    const sendFailed = Number(sendFailedRes.count || 0);
    const complianceBlocks = Number(complianceRes.count || 0);
    const failureRate = contacts > 0 ? (sendFailed + complianceBlocks) / contacts : 0;

    return {
        contacts,
        sendFailed,
        complianceBlocks,
        failureRate,
    };
}

async function processTask(task: any, supabase: any) {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);

    const { data: config } = await supabase
        .from('antonia_config')
        .select('*')
        .eq('organization_id', task.organization_id)
        .single();

    const startedAt = new Date().toISOString();
    await supabase.from('antonia_tasks').update({
        status: 'processing',
        processing_started_at: startedAt,
        heartbeat_at: startedAt,
        updated_at: startedAt,
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
                heartbeat_at: null,
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
            processing_started_at: null,
            heartbeat_at: null,
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
        if (e instanceof MissionPausedError) {
            const nowIso = new Date().toISOString();
            await supabase.from('antonia_tasks').update({
                status: 'completed',
                result: {
                    skipped: true,
                    reason: 'mission_paused',
                    missionStatus: e.missionStatus,
                },
                error_message: null,
                processing_started_at: null,
                heartbeat_at: null,
                updated_at: nowIso,
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `Task ${task.type} skipped because mission is ${e.missionStatus}.`,
                details: {
                    taskId: task.id,
                    missionStatus: e.missionStatus,
                },
                created_at: nowIso,
            });

            return;
        }

        console.error(`[Worker] Task ${task.id} Failed`, e);
        const failureDetails = e?.retryable === true && e?.result && typeof e.result === 'object'
            ? { code: e.code || null, retryable: true, outcomeUnknown: e.outcomeUnknown === true, result: e.result }
            : undefined;
        await rescheduleTaskAfterFailure(
            supabase,
            task,
            `[next-backup] ${e?.message || 'unknown_error'}`,
            'task_failure',
            failureDetails
        );
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
    const skipFirebaseForwardParam = String(url.searchParams.get('skipFirebaseForward') || '').toLowerCase();
    const forceBackupParam = String(url.searchParams.get('forceBackupProcessing') || '').toLowerCase();
    const skipFirebaseForward = skipFirebaseForwardParam === '1' || skipFirebaseForwardParam === 'true' || skipFirebaseForwardParam === 'yes';
    const forceBackupProcessing = forceBackupParam === '1' || forceBackupParam === 'true' || forceBackupParam === 'yes';

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
            skipFirebaseForward,
            forceBackupProcessing,
            firebaseForwardConfigured: Boolean(process.env.ANTONIA_FIREBASE_TICK_URL && process.env.ANTONIA_FIREBASE_TICK_SECRET),
            backupProcessingEnabled: String(process.env.ANTONIA_NEXT_BACKUP_PROCESSING || 'false') === 'true',
        });
    }

    const stuckRescue = await rescueStuckTasks(supabase);
    if (stuckRescue.rescuedCount > 0) {
        console.warn(`[Cron] Rescued ${stuckRescue.rescuedCount} stuck Antonia task(s) before scheduling.`);
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

    // STEP 1.25: Process active campaigns so follow-ups/reconnections keep moving without manual sends.
    try {
        const campaignsUrl = new URL('/api/cron/process-campaigns', request.url);
        const campaignCronResponse = await fetch(campaignsUrl.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${cronSecret}`,
                'x-cron-secret': cronSecret,
            },
            cache: 'no-store',
        });

        if (!campaignCronResponse.ok) {
            const text = await campaignCronResponse.text().catch(() => '');
            console.error('[Cron] Campaign processor returned non-2xx:', campaignCronResponse.status, text.slice(0, 400));
        }
    } catch (e) {
        console.error('[Cron] Failed to process campaigns:', e);
    }

    // Retention is destructive and must be enabled separately from normal task processing.
    if (String(process.env.ANTONIA_PRIVACY_RETENTION_ENABLED || 'false').toLowerCase() === 'true') {
        try {
            const retentionUrl = new URL('/api/cron/privacy-retention', request.url);
            const retentionResponse = await fetch(retentionUrl.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${cronSecret}`,
                    'x-cron-secret': cronSecret,
                },
                cache: 'no-store',
            });

            if (!retentionResponse.ok) {
                const text = await retentionResponse.text().catch(() => '');
                console.error('[Cron] Privacy retention returned non-2xx:', retentionResponse.status, text.slice(0, 400));
            }
        } catch (e) {
            console.error('[Cron] Failed to run privacy retention:', e);
        }
    }

    // STEP 1.5: Trigger Firebase primary worker if configured
    const tickUrl = process.env.ANTONIA_FIREBASE_TICK_URL;
    const tickSecret = String(process.env.ANTONIA_FIREBASE_TICK_SECRET || '').trim();
    let firebaseForwardFailure: { status: number; bodyPreview: string } | null = null;

    if (!skipFirebaseForward && tickUrl && tickSecret) {
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
    const enableBackup = forceBackupProcessing || String(process.env.ANTONIA_NEXT_BACKUP_PROCESSING || 'false') === 'true';

    const allowTypes = ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'CONTACT', 'REPORT', 'GENERATE_REPORT'];
    const workerId = `next-backup-${Date.now()}`;

    const tasks = enableBackup
        ? await claimPendingTasks(supabase, 1, allowTypes, workerId, 'next-backup')
        : [];

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
        return NextResponse.json({ message: 'No executable tasks found', rescuedStuckTasks: stuckRescue.rescuedCount });
    }

    await Promise.all(tasks.map((t: any) => processTask(t, supabase)));

    return NextResponse.json({ processed: tasks.length, tasks: tasks.map((t: any) => t.id), rescuedStuckTasks: stuckRescue.rescuedCount });
}
