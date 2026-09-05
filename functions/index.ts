/**
 * ANTON.IA Cloud Functions
 * Force Deploy: 2025-12-29T19:45:00
 */
// Cloud Functions for Antonia AI
// Last Updated: 2025-12-30 02:45 Dry Run fixes
import * as functions from 'firebase-functions/v2';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';
import { buildAntoniaDailyDashboardHtml, type AntoniaDailyMissionRow } from './report-email';
import { getMessagingOutcomeEffects } from './messaging-outcome';
import { getResearchReadinessBlockReason, hasMeaningfulResearchEvidence } from './research-readiness';
import { getCampaignReference, getCurrentCampaignFollowUp } from './campaign-followup';
import { findPriorReplyMatchForLead, shouldPermanentlySuppressContact } from './contact-history-guard';
import {
    buildFirebaseLeadResearchRequestKey,
    claimLeadResearchRequest,
    completeLeadResearchRequestSubmission,
    consumeLeadResearchRequestQuota,
    failLeadResearchRequest,
    failSubmittedLeadResearchRequest,
    markLeadResearchRequestSubmitting,
    markLeadResearchRequestUnknown,
    persistLeadResearchTerminalResult,
    releaseLeadResearchRequest,
} from './lead-research-request';
import { hasUserEnrichmentSearchCreditAccess } from './enrichment-search-access';

// Retain the old endpoint only as an IAM-private deprecation response.
export { antoniaWorker } from './src/antonia-worker';

// NOTE: Keep defaults for backwards compatibility, but prefer env vars in production.
const DEFAULT_APP_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const DEFAULT_LEAD_RESEARCH_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-research';
const DEFAULT_DAILY_CREDIT_LIMIT = 50;

function isLikelyN8nWebhookUrl(value?: string | null) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return false;
    return raw.includes('/webhook/') || raw.includes('.n8n.cloud');
}

function getAppUrl(): string {
    return (
        process.env.ANTONIA_APP_URL ||
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        DEFAULT_APP_URL
    );
}

function getLeadResearchUrl(): string {
    const configured = process.env.ANTONIA_LEAD_RESEARCH_URL || process.env.LEAD_RESEARCH_URL || '';
    if (configured && !isLikelyN8nWebhookUrl(configured)) {
        return configured;
    }
    return DEFAULT_LEAD_RESEARCH_URL;
}

function cleanDomain(value?: string | null): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    }
}

function guessCompanyNameFromDomain(domain?: string | null): string {
    const host = cleanDomain(domain);
    const root = host.split('.')[0] || '';
    return root
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
}

function sanitizeCompanyName(value?: string | null, domain?: string | null, email?: string | null): string {
    const raw = String(value || '').trim();
    let company = raw;

    if (!company) {
        const fromDomain = cleanDomain(domain || (email && email.includes('@') ? email.split('@')[1] : ''));
        return guessCompanyNameFromDomain(fromDomain) || 'tu empresa';
    }

    company = company.replace(/\bcontact\s*:\s*[^\s]+/gi, '').trim();
    if (company.includes(' - ') && (company.includes('@') || company.length > 80)) {
        company = company.split(' - ')[0].trim();
    }
    company = company.replace(/\s+/g, ' ').trim().replace(/[\-–:;,]+$/g, '').trim();

    if (!company) {
        const fromDomain = cleanDomain(domain || (email && email.includes('@') ? email.split('@')[1] : ''));
        return guessCompanyNameFromDomain(fromDomain) || 'tu empresa';
    }

    return company;
}

function titleizeToken(value?: string | null): string {
    return String(value || '')
        .trim()
        .split(/[-_.\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
        .trim();
}

function safeDecodeComponent(value?: string | null): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function safeDecodeUriValue(value?: string | null): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURI(raw);
    } catch {
        return raw;
    }
}

function inferNameFromEmailOrLinkedin(email?: string | null, linkedinUrl?: string | null): { fullName: string; firstName: string; lastName: string } | null {
    const emailLocal = String(email || '').trim().split('@')[0] || '';
    const emailTokens = emailLocal.split(/[._-]+/).filter(Boolean);
    if (emailTokens.length >= 2) {
        const firstName = titleizeToken(emailTokens[0]);
        const lastName = titleizeToken(emailTokens.slice(1).join(' '));
        if (firstName && lastName) {
            return { fullName: `${firstName} ${lastName}`.trim(), firstName, lastName };
        }
    }

    const linkedin = safeDecodeUriValue(linkedinUrl);
    if (linkedin) {
        const slug = safeDecodeComponent(linkedin.replace(/\?.*$/, '').replace(/\/$/, '').split('/').pop() || '');
        const cleaned = slug.replace(/-[0-9a-f]{4,}$/i, '');
        const tokens = cleaned.split('-').filter(Boolean);
        if (tokens.length >= 2) {
            const firstName = titleizeToken(tokens[0]);
            const lastName = titleizeToken(tokens.slice(1).join(' '));
            if (firstName && lastName) {
                return { fullName: `${firstName} ${lastName}`.trim(), firstName, lastName };
            }
        }
    }

    return null;
}

function resolveLeadIdentity(lead: any) {
    const rawFullName = String(lead?.fullName || lead?.full_name || lead?.name || '').trim();
    const masked = /\*{2,}/.test(rawFullName);
    const inferred = inferNameFromEmailOrLinkedin(lead?.email, lead?.linkedinUrl || lead?.linkedin_url);
    const fallbackFirstName = safeFirstName(rawFullName || inferred?.fullName || '');
    const fallbackLastName = String(lead?.last_name || lead?.lastName || '').trim();

    if ((!rawFullName || masked) && inferred) {
        return inferred;
    }

    return {
        fullName: rawFullName,
        firstName: String(lead?.first_name || lead?.firstName || fallbackFirstName).trim(),
        lastName: fallbackLastName,
    };
}

function normalizeCompanyCompare(value?: string | null) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isResearchCompanyMismatch(target: { name?: string | null; domain?: string | null }, research: any) {
    const targetDomain = cleanDomain(target?.domain);
    const targetName = normalizeCompanyCompare(target?.name);
    const researchCompany = research?.company || {};
    const researchDomain = cleanDomain(researchCompany?.domain || research?.company_domain || research?.domain || '');
    const researchName = normalizeCompanyCompare(researchCompany?.name || research?.company_name || research?.companyName || '');

    if (targetDomain && researchDomain) {
        return targetDomain !== researchDomain;
    }

    if (targetName && researchName) {
        return !(targetName.includes(researchName) || researchName.includes(targetName));
    }

    return false;
}

function safeFirstName(value?: string | null): string {
    const first = String(value || '').trim().split(/\s+/)[0] || '';
    return first || 'hola';
}

function asStringArray(value: any): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
        return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function truncateText(value?: string | null, max = 220): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trim()}…`;
}

function normalizeResearchData(raw: any, lead: any) {
    if (!raw || typeof raw !== 'object') return null;

    const cross = raw?.existing_compat?.cross || raw?.cross || null;
    const enhanced = raw?.existing_compat?.enhanced || raw?.enhanced || null;
    const overview = String(raw?.company_context?.overview || raw?.website_summary?.overview || raw?.overview || cross?.overview || '').trim();
    const pains = asStringArray(raw?.company_context?.pain_hypotheses?.map((item: any) => item?.detail || item?.title) || raw?.pains || cross?.pains || enhanced?.pains);
    const opportunities = asStringArray(raw?.company_context?.opportunity_hypotheses?.map((item: any) => item?.detail || item?.title) || raw?.opportunities || cross?.opportunities || enhanced?.opportunities);
    const talkTracks = asStringArray(raw?.outreach_pack?.talk_tracks || raw?.talkTracks || cross?.talkTracks || enhanced?.talkTracks);
    const subjectLines = asStringArray(raw?.outreach_pack?.subject_lines || raw?.subjectLines || cross?.subjectLines || enhanced?.subjectLines);
    const emailDraft = raw?.outreach_pack?.email_drafts?.medium
        || raw?.outreach_pack?.email_drafts?.short
        || raw?.outreach_pack?.email_drafts?.challenger
        || raw?.emailDraft
        || cross?.emailDraft
        || enhanced?.emailDraft
        || null;
    const signals = Array.isArray(raw?.signals) ? raw.signals : [];
    const iceBreaker = raw?.lead_context?.ice_breakers?.[0]?.text || raw?.lead_context?.iceBreaker || cross?.leadContext?.iceBreaker || null;
    const recentActivity = raw?.lead_context?.recent_activity_summary || cross?.leadContext?.recentActivitySummary || null;
    const profileSummary = raw?.lead_context?.profile_summary || raw?.lead_context?.role_summary || cross?.leadContext?.profileSummary || null;
    const warnings = asStringArray(raw?.warnings || raw?.provider_warnings);
    const sources = Array.isArray(raw?.sources)
        ? raw.sources.map((source: any) => ({
            id: source?.id || source?.source_id || undefined,
            title: source?.title || source?.name || undefined,
            url: source?.url,
        })).filter((source: any) => !!source.url)
        : (Array.isArray(cross?.sources) ? cross.sources : []);
    const firstSignal = signals[0];
    const summary = truncateText(
        firstSignal?.summary
        || overview
        || pains[0]
        || opportunities[0]
        || `${sanitizeCompanyName(lead?.companyName || lead?.company_name || lead?.company, lead?.companyDomain || lead?.company_website, lead?.email)} tiene iniciativas relevantes en marcha.`
    );

    return {
        ...raw,
        cross,
        enhanced,
        overview,
        summary,
        pains,
        opportunities,
        talkTracks,
        subjectLines,
        emailDraft,
        signals,
        leadContext: {
            iceBreaker,
            recentActivitySummary: recentActivity,
            profileSummary,
        },
        warnings,
        sources,
    };
}

function hasMeaningfulResearch(raw: any): boolean {
    const normalized = normalizeResearchData(raw, {});
    return hasMeaningfulResearchEvidence(normalized);
}

function parseResearchResponseText(text: string) {
    if (!String(text || '').trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function getResearchProviderStatus(result: any, fallback = 'completed') {
    return String(result?.status || result?.provider_status || fallback).trim().toLowerCase();
}

function isActiveResearchProviderStatus(status: string) {
    return ['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status);
}

async function pollLeadResearchProvider(reportId: string, initialResult: any) {
    let result = initialResult;
    for (let pollAttempt = 0; pollAttempt < 18 && isActiveResearchProviderStatus(getResearchProviderStatus(result, 'queued')); pollAttempt++) {
        await sleep(5000);
        const response = await fetch(`${getLeadResearchUrl().replace(/\/$/, '')}/${encodeURIComponent(reportId)}`, {
            headers: { Accept: 'application/json' },
        });
        const payload = parseResearchResponseText(await response.text());
        if (!response.ok) {
            const error: any = new Error(payload?.message || payload?.error || `lead-research poll ${response.status}`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        result = payload;
    }
    return result;
}

function getResearchAutoContactBlockReason(raw: any): string | null {
    const normalized = normalizeResearchData(raw, {});
    if (!normalized) return 'missing_research';
    return getResearchReadinessBlockReason(normalized);
}

function isResearchReadyForAutoContact(raw: any): boolean {
    return getResearchAutoContactBlockReason(raw) === null;
}

function appendSignatureIfMissing(body: string, userSignature: string, signerName?: string | null): string {
    const draft = String(body || '').trim();
    const signature = String(userSignature || '').trim();
    if (!signature) return draft;
    const lowerDraft = draft.toLowerCase();
    const lowerSignature = signature.toLowerCase();
    const lowerName = String(signerName || '').trim().toLowerCase();
    if (lowerSignature && lowerDraft.includes(lowerSignature)) return draft;
    if (lowerName && lowerDraft.includes(lowerName)) return draft;
    return `${draft}\n\n${signature}`.trim();
}

function normalizeDraftText(value: any): string {
    const text = String(value ?? '').trim();
    const lowered = text.toLowerCase();
    if (!text) return '';
    if (['null', 'undefined', 'n/a', 'none'].includes(lowered)) return '';
    return text;
}

function replacePlaceholderVariants(text: string, patterns: string[], value: string) {
    let output = text;
    for (const pattern of patterns) {
        output = output.replace(new RegExp(pattern, 'gi'), value);
    }
    return output;
}

function renderLegacyDraftPlaceholders(text: string, params: {
    leadName: string;
    firstName: string;
    leadTitle: string;
    companyName: string;
    senderName: string;
    senderTitle: string;
    senderCompany: string;
    senderEmail: string;
    senderPhone: string;
    senderWebsite: string;
}) {
    let output = normalizeDraftText(text);
    if (!output) return '';

    output = replacePlaceholderVariants(output, [
        '\\[\\s*Nombre\\s+del\\s+Lead\\s*\\]',
        '\\[\\s*Nombre\\s+Lead\\s*\\]',
        '\\[\\s*Lead\\s+Name\\s*\\]',
    ], params.leadName || params.firstName || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Nombre\\s*\\]',
        '\\[\\s*First\\s+Name\\s*\\]',
    ], params.firstName || params.leadName || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Cargo\\s+del\\s+Lead\\s*\\]',
        '\\[\\s*Lead\\s+Title\\s*\\]',
    ], params.leadTitle || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Empresa\\s+del\\s+Lead\\s*\\]',
        '\\[\\s*Nombre\\s+de\\s+la\\s+Empresa\\s*\\]',
        '\\[\\s*Lead\\s+Company\\s*\\]',
    ], params.companyName || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Nombre\\s*\\]',
        '\\[\\s*Mi\\s+Nombre\\s*\\]',
        '\\[\\s*Su\\s+Nombre\\s*\\]',
    ], params.senderName || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Cargo\\s*\\]',
        '\\[\\s*Mi\\s+Cargo\\s*\\]',
        '\\[\\s*Su\\s+Cargo\\s*\\]',
    ], params.senderTitle || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Compa(?:ñ|n)[ií]a\\s*\\]',
        '\\[\\s*Mi\\s+Compa(?:ñ|n)[ií]a\\s*\\]',
        '\\[\\s*Tu\\s+Empresa\\s*\\]',
        '\\[\\s*Mi\\s+Empresa\\s*\\]',
        '\\[\\s*Su\\s+Empresa\\s*\\]',
    ], params.senderCompany || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Correo(?:\\s+Electr[oó]nico)?\\s*\\]',
        '\\[\\s*Mi\\s+Correo(?:\\s+Electr[oó]nico)?\\s*\\]',
        '\\[\\s*Su\\s+Correo(?:\\s+Electr[oó]nico)?\\s*\\]',
    ], params.senderEmail || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Tel[eé]fono\\s*\\]',
        '\\[\\s*Mi\\s+Tel[eé]fono\\s*\\]',
        '\\[\\s*Su\\s+Tel[eé]fono\\s*\\]',
    ], params.senderPhone || '');
    output = replacePlaceholderVariants(output, [
        '\\[\\s*Tu\\s+Sitio\\s+Web\\s*\\]',
        '\\[\\s*Mi\\s+Sitio\\s+Web\\s*\\]',
        '\\[\\s*Su\\s+Sitio\\s+Web\\s*\\]',
    ], params.senderWebsite || '');

    return output;
}

function hasMalformedDraftContent(value: string): boolean {
    const text = normalizeDraftText(value);
    if (!text) return true;
    if (/\{\{[^}]+\}\}/.test(text)) return true;
    if (/\[\s*(?:nombre(?:\s+del\s+lead)?|lead\s+name|cargo(?:\s+del\s+lead)?|lead\s+title|empresa(?:\s+del\s+lead)?|lead\s+company|tu\s+nombre|mi\s+nombre|su\s+nombre|tu\s+cargo|mi\s+cargo|su\s+cargo|tu\s+compa(?:ñ|n)[ií]a|mi\s+compa(?:ñ|n)[ií]a|tu\s+empresa|mi\s+empresa|su\s+empresa|tu\s+correo(?:\s+electr[oó]nico)?|mi\s+correo(?:\s+electr[oó]nico)?|su\s+correo(?:\s+electr[oó]nico)?|tu\s+tel[eé]fono|mi\s+tel[eé]fono|su\s+tel[eé]fono|tu\s+sitio\s+web|mi\s+sitio\s+web|su\s+sitio\s+web)\s*\]/i.test(text)) return true;
    if (/\b(?:null|undefined)\b/i.test(text)) return true;
    return false;
}

function buildFallbackSubject(companyName: string, researchData: any): string {
    return normalizeDraftText(researchData?.subjectLines?.[0])
        || normalizeDraftText(researchData?.emailDraft?.subject)
        || `Ideas para ${companyName}`;
}

function buildFallbackBody(params: {
    firstName: string;
    companyName: string;
    researchData: any;
    senderCompanyName: string;
    senderValueProp: string;
    userSignature: string;
}) {
    const { firstName, companyName, researchData, senderCompanyName, senderValueProp, userSignature } = params;
    const signal = researchData?.signals?.[0]?.summary || researchData?.signals?.[0]?.title || '';
    const pain = researchData?.pains?.[0] || '';
    const opener = researchData?.leadContext?.iceBreaker
        || signal
        || researchData?.summary
        || `vi que ${companyName} está impulsando iniciativas relevantes en su mercado.`;
    const reason = pain
        ? `Creo que podría hacer sentido conversar sobre ${pain.charAt(0).toLowerCase()}${pain.slice(1)}.`
        : 'Creo que podría hacer sentido conversar sobre formas concretas de mejorar velocidad comercial y eficiencia operativa.';
    const valueLine = senderValueProp
        ? `Desde ${senderCompanyName} ${senderValueProp.charAt(0).toLowerCase()}${senderValueProp.slice(1)}.`
        : `Desde ${senderCompanyName} ayudamos a equipos comerciales a generar más pipeline con menos trabajo manual.`;

    const body = `Hola ${firstName},

Estuve revisando ${companyName} y ${opener}

${reason}

${valueLine}

¿Tendrías disponibilidad para una breve conversación esta semana?

Saludos,`;

    return appendSignatureIfMissing(body, userSignature, senderCompanyName);
}

function withInternalApiSecret(headers: Record<string, string>): Record<string, string> {
    const secret = String(process.env.INTERNAL_API_SECRET || '').trim();
    if (!secret) {
        throw new Error('INTERNAL_API_SECRET is required for internal app requests');
    }
    return {
        ...headers,
        'x-internal-api-secret': secret,
    };
}

function parseContactApiBody(raw: string): Record<string, any> {
    try {
        const parsed = JSON.parse(String(raw || ''));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function isRetryableContactApiFailure(status: number, code?: string | null) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    return normalizedCode === 'OUTBOUND_UNKNOWN'
        || [202, 408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isRetryableContactException(error: any) {
    if (error?.retryable === true) return true;
    const details = `${String(error?.message || '')} ${String(error?.code || '')}`.toLowerCase();
    return ['econnreset', 'etimedout', 'enotfound', 'econnrefused', 'timeout', 'network', 'fetch failed']
        .some((pattern) => details.includes(pattern));
}

function createContactApiError(params: {
    status: number;
    code?: string | null;
    message: string;
    result?: Record<string, any>;
}) {
    const error: any = new Error(`Contact API ${params.status}${params.code ? ` ${params.code}` : ''}: ${params.message}`);
    error.status = params.status;
    error.code = params.code || `contact_api_${params.status}`;
    error.retryable = isRetryableContactApiFailure(params.status, params.code);
    if (params.result) error.result = params.result;
    return error;
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

    await safeInsertAntoniaLedgerEvents(supabase, filtered);
  } catch (e) {
    console.error('[antonia_lead_events] insert exception:', e);
  }
}

function redactWorkerLedgerValue(value: unknown, key = '', depth = 0): unknown {
    if (/(authorization|api[_-]?key|token|secret|password|cookie)/i.test(key)) return '[REDACTED]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth > 4) return '[TRUNCATED]';
    if (typeof value === 'string') {
        if (/(^|_)(email|phone|mobile|linkedin)(_|$)/i.test(key)) {
            return `sha256:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex')}`;
        }
        return value.slice(0, 500);
    }
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactWorkerLedgerValue(item, key, depth + 1));
    if (typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .slice(0, 100)
            .reduce<Record<string, unknown>>((out, childKey) => {
                out[childKey] = redactWorkerLedgerValue((value as Record<string, unknown>)[childKey], childKey, depth + 1);
                return out;
            }, {});
    }
    return String(value).slice(0, 500);
}

async function safeInsertAntoniaLedgerEvents(supabase: SupabaseClient, events: LeadEventInsert[]) {
    const rows = events.map((event) => {
        const createdAt = event.created_at || new Date().toISOString();
        const seed = JSON.stringify({
            lead: event.lead_id,
            mission: event.mission_id || null,
            task: event.task_id || null,
            type: event.event_type,
            createdAt,
            outcome: event.outcome || null,
        });
        const payload = redactWorkerLedgerValue(event.meta || {}) as Record<string, unknown>;
        return {
            event_key: `legacy:lead_event:${createHash('sha256').update(seed).digest('hex')}`,
            event_type: `legacy.lead.${String(event.event_type || 'unknown').trim() || 'unknown'}`,
            occurred_at: createdAt,
            organization_id: event.organization_id || null,
            organization_ref: event.organization_id || null,
            actor_type: 'worker',
            lead_id: event.lead_id,
            entity_type: 'lead',
            entity_id: event.lead_id,
            mission_id: event.mission_id || null,
            task_id: event.task_id || null,
            source_system: 'firebase-antonia-worker',
            status: event.stage || null,
            outcome: event.outcome || null,
            message: event.message || null,
            metrics: {},
            redacted_payload: payload,
            source_confidence: 'observed',
            privacy_class: 'operational',
        };
    });

    for (const event of rows) {
        try {
            const { error } = await supabase.rpc('append_antonia_event_v1', { p_event: event });
            if (error) console.error('[antonia_event_ledger] append error:', error);
        } catch (error) {
            console.error('[antonia_event_ledger] append exception:', error);
        }
    }
}

async function safeAppendWorkerLedgerEvent(supabase: SupabaseClient, event: Record<string, unknown>) {
    try {
        const message = typeof event.message === 'string'
            ? event.message
                .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
                .replace(/\+?[0-9][0-9().\s-]{7,}[0-9]/g, '[PHONE_REDACTED]')
                .slice(0, 500)
            : event.message;
        const { error } = await supabase.rpc('append_antonia_event_v1', {
            p_event: { ...event, message },
        });
        if (error) console.error('[antonia_event_ledger] worker event error:', error);
    } catch (error) {
        console.error('[antonia_event_ledger] worker event exception:', error);
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

function normalizeFitText(value: any) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s,.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseMissionTerms(value: any) {
    return String(value || '')
        .split(',')
        .map((item) => normalizeFitText(item))
        .filter(Boolean);
}

function textMatchesAnyTerm(text: any, terms: string[]) {
    const normalizedText = normalizeFitText(text);
    if (!normalizedText || terms.length === 0) return false;
    return terms.some((term) => normalizedText.includes(term) || term.includes(normalizedText));
}

function parseEmployeeRange(input: any): { min?: number; max?: number } | null {
    const normalized = String(input || '').trim();
    if (!normalized) return null;

    const plus = normalized.match(/^(\d+)\+$/);
    if (plus) return { min: Number(plus[1]) };

    const range = normalized.match(/^(\d+)\s*[-,]\s*(\d+)$/);
    if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        if (Number.isFinite(a) && Number.isFinite(b)) {
            return a <= b ? { min: a, max: b } : { min: b, max: a };
        }
    }

    return null;
}

function fitsCompanySize(employeeCount: any, rangeInput: any) {
    const range = parseEmployeeRange(rangeInput);
    const count = Number(employeeCount);
    if (!range || !Number.isFinite(count) || count <= 0) return null;
    if (typeof range.min === 'number' && count < range.min) return false;
    if (typeof range.max === 'number' && count > range.max) return false;
    return true;
}

function assessLegacySearchLeadFit(lead: any, mission: any) {
    const reasons: string[] = [];
    const companyName = normalizeFitText(lead?.companyName);
    const title = normalizeFitText(lead?.title);
    const leadLocation = normalizeFitText(lead?.location);
    const leadIndustry = normalizeFitText(lead?.industryEvidence);
    const titleTerms = parseMissionTerms(mission?.jobTitle);
    const missionLocation = normalizeFitText(mission?.location);
    const missionIndustry = normalizeFitText(mission?.industry);
    const sizeFit = fitsCompanySize(lead?.organizationSize, mission?.companySize);

    if (!companyName) reasons.push('empresa no identificada');
    if (titleTerms.length > 0 && title && !textMatchesAnyTerm(title, titleTerms)) reasons.push('cargo fuera del ICP');
    if (missionLocation && leadLocation && !textMatchesAnyTerm(leadLocation, [missionLocation])) reasons.push('ubicacion fuera del ICP');
    if (missionIndustry && leadIndustry && !textMatchesAnyTerm(leadIndustry, [missionIndustry])) reasons.push('industria fuera del ICP');
    if (sizeFit === false) reasons.push('tamano de empresa fuera del ICP');

    return {
        allow: reasons.length === 0,
        reason: reasons[0] || 'compatible',
    };
}

async function getEffectiveDailyContactQuota(
    supabase: SupabaseClient,
    params: { userId: string; organizationId: string; fallbackLimit: number }
): Promise<{ limit: number; contactsToday: number }> {
    const today = new Date().toISOString().split('T')[0];
    const { userId, organizationId, fallbackLimit } = params;

    const { data: overrideRow, error: overrideError } = await supabase
        .from('user_quota_overrides')
        .select('daily_contact_limit')
        .eq('user_id', userId)
        .maybeSingle();

    const missingOverrideTable = String((overrideError as any)?.code || '') === 'PGRST205'
        || String((overrideError as any)?.message || '').toLowerCase().includes("could not find the table 'public.user_quota_overrides'");
    if (overrideError && !missingOverrideTable) {
        throw overrideError;
    }

    const readOverride = (value: any) => {
        const limit = Number(value?.daily_contact_limit ?? 0);
        return Number.isFinite(limit) && limit > 0 ? limit : 0;
    };

    const overrideLimit = missingOverrideTable ? 0 : readOverride(overrideRow);

    const useUserQuota = Number.isFinite(overrideLimit) && overrideLimit > 0;
    const effectiveLimit = useUserQuota ? overrideLimit : Math.max(0, Number(fallbackLimit) || 0);

    let contactsQuery = supabase
        .from('contacted_leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00Z`);

    contactsQuery = useUserQuota
        ? contactsQuery.eq('user_id', userId)
        : contactsQuery.eq('organization_id', organizationId);

    const { count } = await contactsQuery;
    return { limit: effectiveLimit, contactsToday: count || 0 };
}

async function getEffectiveLeadProcessingQuota(
    supabase: SupabaseClient,
    params: {
        userId: string;
        organizationId: string;
        resource: 'enrich' | 'investigate';
    }
): Promise<{ limit: number; used: number; scope: 'organization' | 'user' }> {
    const today = new Date().toISOString().split('T')[0];
    const { userId } = params;

    const { data: overrideRow, error: overrideError } = await supabase
        .from('user_quota_overrides')
        .select('daily_credit_limit')
        .eq('user_id', userId)
        .maybeSingle();

    const missingOverrideTable = String((overrideError as any)?.code || '') === 'PGRST205'
        || String((overrideError as any)?.message || '').toLowerCase().includes("could not find the table 'public.user_quota_overrides'");
    if (overrideError && !missingOverrideTable) {
        throw overrideError;
    }

    const overrideLimit = missingOverrideTable ? 0 : Number(overrideRow?.daily_credit_limit || 0);
    const effectiveLimit = Number.isFinite(overrideLimit) && overrideLimit > 0
        ? Math.min(DEFAULT_DAILY_CREDIT_LIMIT, Math.trunc(overrideLimit))
        : DEFAULT_DAILY_CREDIT_LIMIT;

    const { data: usageBucket, error: usageError } = await supabase
        .from('antonia_user_daily_credits')
        .select('usage_count')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();
    if (usageError) throw usageError;
    return { limit: effectiveLimit, used: Math.max(0, Number(usageBucket?.usage_count || 0)), scope: 'user' };
}

async function consumeLeadProcessingQuota(
    supabase: SupabaseClient,
    params: {
        userId: string;
        organizationId: string;
        resource: 'enrich' | 'investigate';
        scope: 'organization' | 'user';
        limit: number;
        count?: number;
    }
) {
    const requestedCount = Math.max(1, Math.trunc(Number(params.count || 1)));
    const { data, error } = await supabase.rpc('consume_antonia_daily_quota_v1', {
        p_organization_id: params.organizationId,
        p_user_id: params.userId,
        p_scope: params.scope,
        p_resource: params.resource,
        p_requested_count: requestedCount,
        p_limit: params.limit,
    } as any);
    if (error) throw error;

    const result = data as { allowed?: boolean; count?: number; limit?: number } | null;
    if (!result || typeof result.allowed !== 'boolean' || !Number.isFinite(Number(result.count))) {
        throw new Error('Invalid atomic quota response');
    }

    return {
        allowed: result.allowed,
        count: Number(result.count),
        limit: Number(result.limit ?? params.limit),
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMissionStatus(supabase: SupabaseClient, missionId?: string | null): Promise<string | null> {
    if (!missionId) return null;
    const { data, error } = await supabase
        .from('antonia_missions')
        .select('status')
        .eq('id', missionId)
        .maybeSingle();
    if (error) {
        console.warn('[mission-status] Failed to fetch mission status:', missionId, error.message || error);
        return null;
    }
    return String(data?.status || '').trim() || null;
}

function shouldRespectPausedMission(taskType: string) {
    return ['GENERATE_CAMPAIGN', 'SEARCH', 'ENRICH', 'INVESTIGATE', 'CONTACT', 'CONTACT_INITIAL', 'CONTACT_CAMPAIGN'].includes(taskType);
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

async function resolveCampaign(
    supabase: SupabaseClient,
    params: { organizationId: string; userId: string; missionId?: string | null; campaignId?: string | null; campaignName?: string | null }
) {
    const campaignId = String(params.campaignId || '').trim();
    const campaignName = String(params.campaignName || '').trim();

    if (campaignId) {
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', campaignId)
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .maybeSingle();
        if (error) throw error;
        if (data) return data;
        return null;
    }

    if (campaignName) {
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('name', campaignName)
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .maybeSingle();
        if (error) throw error;
        if (data) return data;
        return null;
    }

    const missionId = String(params.missionId || '').trim();
    if (missionId) {
        const { data: mission, error: missionError } = await supabase
            .from('antonia_missions')
            .select('params')
            .eq('id', missionId)
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .maybeSingle();
        if (missionError) throw missionError;

        const missionReference = getCampaignReference({ taskPayload: mission?.params || {} });
        if (missionReference.campaignId || missionReference.campaignName) {
            return resolveCampaign(supabase, {
                organizationId: params.organizationId,
                userId: params.userId,
                campaignId: missionReference.campaignId,
                campaignName: missionReference.campaignName,
            });
        }

        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .contains('settings', { missionId })
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (data) return data;
    }

    return null;
}

function findOriginatingContactedLead(lead: any, rows: any[]) {
    const contactedLeadId = String(lead?.contactedLeadId || lead?.contacted_lead_id || '').trim();
    if (contactedLeadId) {
        return rows.find((row: any) => String(row?.id || '').trim() === contactedLeadId) || null;
    }

    const leadId = String(lead?.id || '').trim().toLowerCase();
    const email = String(lead?.email || '').trim().toLowerCase();
    return rows.find((row: any) => {
        const rowLeadId = String(row?.lead_id || '').trim().toLowerCase();
        const rowEmail = String(row?.email || '').trim().toLowerCase();
        return (leadId && rowLeadId === leadId) || (email && rowEmail === email);
    }) || null;
}

function getCampaignStepRetryAt(contactedLead: any, step: any, lastSentAt?: string | null) {
    const offsetDays = Math.max(0, Number(step?.offset_days ?? step?.offsetDays ?? 0) || 0);
    const lastAt = lastSentAt
        || contactedLead?.last_follow_up_at
        || contactedLead?.last_interaction_at
        || contactedLead?.sent_at;
    if (!lastAt) return null;

    const lastAtMs = new Date(lastAt).getTime();
    if (!Number.isFinite(lastAtMs)) return null;
    const dueAtMs = lastAtMs + offsetDays * 24 * 60 * 60 * 1000;
    return dueAtMs > Date.now() ? new Date(dueAtMs).toISOString() : null;
}

function isConfirmedContactProvider(provider: any) {
    return ['gmail', 'google', 'outlook'].includes(String(provider || '').trim().toLowerCase());
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
        .eq('user_id', userId)
        .eq('name', generatedName)
        .maybeSingle();

    let resolvedCampaignId = existing?.id || null;
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
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId,
                    'x-organization-id': task.organization_id,
                }),
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
        resolvedCampaignId = campaignRow.id;

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
            campaignId: resolvedCampaignId,
            campaignName: generatedName
        },
        created_at: new Date().toISOString()
    });

    return {
        campaignGenerated: true,
        campaignId: resolvedCampaignId,
        campaignName: generatedName,
        subjectPreview,
        bodyPreview: bodyPreview ? bodyPreview.substring(0, 150) + '...' : ''
    };
}

async function executeSearch(task: any, supabase: SupabaseClient, taskConfig: any) {
    const { jobTitle, location, industry, keywords, companySize } = task.payload || {};
    const userId = await getTaskUserId(task, supabase);
    const nowIso = new Date().toISOString();
    let missionApplyIcpFilter = true;

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
            .select('daily_search_limit, params')
            .eq('id', task.mission_id)
            .maybeSingle();

        const missionLimit = Math.min(5, Math.max(1, Number(mission?.daily_search_limit || 1)));
        missionApplyIcpFilter = mission?.params?.applyIcpFilter !== false;
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
                'x-organization-id': task.organization_id,
            }),
            body: JSON.stringify(internalBody)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`internal_search_failed:${response.status}:${errorText.slice(0, 800)}`);
        }
        data = await response.json();
    } catch (e) {
        const errorText = String(e || '');
        if (errorText.includes('internal_search_failed:429:')
            || errorText.includes('DAILY_SEARCH_QUOTA_EXCEEDED')) {
            throw e;
        }
        throw e;
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

        const orgName = lead.organization?.name || lead.org_name || lead.organization_name || lead.organizationName || lead.company_name || lead.companyName || lead.company || '';
        const orgDomain = lead.organization?.domain || lead.organization_domain || lead.company_domain || lead.companyDomain || lead.organization_website_url || lead.organizationWebsite || lead.website || null;

        const sourceProvider = String(lead.source_provider || lead.sourceProvider || 'apollo').trim() || 'apollo';
        const sourceProviderId = lead.source_provider_id || lead.sourceProviderId || lead.id || null;

        return {
            sourceProvider,
            sourceProviderId: sourceProviderId ? String(sourceProviderId) : null,
            fullName,
            title: lead.title || '',
            email: lead.email || null,
            linkedinUrl: lead.linkedin_url || lead.linkedinUrl || null,
            companyName: String(orgName || '').trim(),
            companyDomain: orgDomain ? String(orgDomain).trim() : null,
            location: String(lead.location || lead.location_name || lead.country || lead.city || lead.organization_location_country || '').trim(),
            industryEvidence: String(lead.organization?.industry || lead.organization_industry || lead.job_company_industry || lead.industry || '').trim(),
            organizationSize: lead.organization?.estimated_num_employees || lead.organization_size || lead.job_company_size || null,
        };
    }).filter((x: any) => x.fullName);

    const leads = normalized;

    if (leads.length > 0) {
        // Deduplicate by provider identity within the mission (best-effort).
        const sourceProviderIds = Array.from(new Set(leads.map((lead: any) => lead.sourceProviderId).filter(Boolean)));
        const existingProviderIds = new Set<string>();

        if (sourceProviderIds.length > 0) {
            const { data: existing } = await supabase
                .from('leads')
                .select('source_provider, source_provider_id')
                .eq('mission_id', task.mission_id)
                .eq('source_provider', 'apollo')
                .in('source_provider_id', sourceProviderIds);
            (existing || []).forEach((r: any) => {
                if (r?.source_provider_id) existingProviderIds.add(String(r.source_provider_id));
            });
        }

        const blockedSamples: Array<{ name: string; title: string; company: string; reason: string }> = [];
        let blockedCount = 0;
        const leadsToInsert = leads
            .filter((lead: any) => !lead.sourceProviderId || !existingProviderIds.has(String(lead.sourceProviderId)))
            .filter((l: any) => {
                if (!missionApplyIcpFilter) return true;
                const fit = assessLegacySearchLeadFit(l, task.payload || {});
                if (fit.allow) return true;
                blockedCount += 1;
                if (blockedSamples.length < 5) {
                    blockedSamples.push({
                        name: l.fullName || 'Lead',
                        title: l.title || '',
                        company: l.companyName || '',
                        reason: fit.reason,
                    });
                }
                return false;
            })
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

                    source_provider: l.sourceProvider || 'apollo',
                    source_provider_id: l.sourceProviderId || null,
                    status: 'saved',
                    created_at: nowIso
                };
            });

        const duplicatesSkipped = leads.length - leadsToInsert.length;

        if (blockedCount > 0) {
            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `ANTONIA bloqueo ${blockedCount} lead(s) en búsqueda legacy por no cumplir el ICP mínimo.`,
                details: {
                    source: 'legacy_search_fit_guardrail',
                    searchCriteria: { jobTitle, location, industry, keywords },
                    samples: blockedSamples,
                },
                created_at: nowIso,
            });
        }

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
                        source_provider: row.source_provider,
                        source_provider_id: row.source_provider_id,
                    },
                    created_at: nowIso,
                }))
            );
        }

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
                sourceProvider: row.source_provider,
                sourceProviderId: row.source_provider_id,
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
                    campaignId: task.payload.campaignId,
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
            .select('id, name, email, title, company, linkedin_url, company_website, source_provider, source_provider_id, apollo_id, industry, location')
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
                    campaignId: task.payload.campaignId,
                    campaignName: task.payload.campaignName,
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

async function executeEnrichment(task: any, supabase: SupabaseClient, _taskConfig: any) {
    const userId = await getTaskUserId(task, supabase);
    if (!(await hasUserEnrichmentSearchCreditAccess(supabase, userId))) {
        return { skipped: true, reason: 'credit_access_denied', resource: 'enrich' };
    }
    const quota = await getEffectiveLeadProcessingQuota(supabase, {
        userId,
        organizationId: task.organization_id,
        resource: 'enrich',
    });
    const limit = quota.limit;

    console.log(`[ENRICH] 🔍 QUOTA CHECK: `, {
        organization_id: task.organization_id,
        mission_id: task.mission_id,
        current_enriched: quota.used,
        limit: limit,
        remaining: limit - quota.used,
        will_skip: quota.used >= limit
    });

    if (quota.used >= limit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[ENRICH] ⚠️ Daily limit reached(${quota.used} / ${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }

    let { leads, enrichmentLevel, campaignId, campaignName } = task.payload;

    console.log(`[ENRICH] Task payload: `, JSON.stringify({
        leadsCount: leads?.length || 0,
        userId,
        enrichmentLevel,
        campaignName
    }));

    const remaining = Math.max(0, limit - quota.used);

    // Backward compatibility:
    // - Old tasks might include raw leads from the external service (no DB UUIDs)
    // - New tasks should include DB-backed leads with stable `id`
    // If we can't guarantee stable IDs, we fetch from the DB queue.
    const hasStableIds = Array.isArray(leads) && leads.some((l: any) => typeof l?.id === 'string' && l.id.length >= 32);

    if (!Array.isArray(leads) || leads.length === 0 || !hasStableIds) {
        console.log('[ENRICH] No stable leads in payload. Fetching from DB queue (status=saved)...');
        const { data: queued, error: qErr } = await supabase
            .from('leads')
            .select('id, name, email, title, company, linkedin_url, company_website, source_provider, source_provider_id, apollo_id, industry, location')
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
        sourceProvider: lead.sourceProvider || lead.source_provider || 'apollo',
        sourceProviderId: (lead.sourceProvider || lead.source_provider || 'apollo') === 'apollo'
            ? (lead.sourceProviderId || lead.source_provider_id || null)
            : null,
        // Keep a reference (not used as identifier)
        sourceOpportunityId: lead.id
    }));

    console.log(`[ENRICH] Calling enrichment API with ${leadsFormatted.length} leads`);

    const attemptAt = new Date().toISOString();
    const enrichmentOperationId = `antonia-task:${String(task.id)}:${String(task.updated_at || task.created_at || 'initial')}:${String(enrichmentLevel || 'normal')}`;
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
                'x-user-id': userId,
                'x-organization-id': task.organization_id,
                'Idempotency-Key': enrichmentOperationId,
                'x-request-id': enrichmentOperationId,
            }),
                body: JSON.stringify({
                    leads: leadsFormatted,
                    revealEmail: true,
                    revealPhone,
                    operationId: enrichmentOperationId,
                    tableName: 'enriched_leads'
                })
            });

        console.log(`[ENRICH] API response status: ${response.status} `);

        if (response.ok) {
            const data = await response.json();
            if (response.status === 202) {
                await safeInsertLeadEvents(
                    supabase,
                    leadsFormatted
                        .filter((lead: any) => Boolean(lead?.id))
                        .map((lead: any) => ({
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_enrich_queued',
                            stage: 'enrich',
                            outcome: 'queued',
                            message: 'Enriquecimiento enviado a Apollo',
                            meta: {
                                revealPhone,
                                enrichmentId: data?.enrichmentId || null,
                                operationId: data?.operationId || enrichmentOperationId,
                            },
                            created_at: attemptAt,
                        }))
                );
                await safeHeartbeatTask(supabase, task.id, {
                    progress_current: leadsFormatted.length,
                    progress_total: leadsFormatted.length,
                    progress_label: `Enriquecimiento en curso para ${leadsFormatted.length} lead(s)`,
                });
                return {
                    queued: true,
                    queuedCount: leadsFormatted.length,
                    enrichmentId: data?.enrichmentId || null,
                    operationId: data?.operationId || enrichmentOperationId,
                };
            }
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
                        campaignId: campaignId,
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
    const userId = await getTaskUserId(task, supabase);
    const quota = await getEffectiveLeadProcessingQuota(supabase, {
        userId,
        organizationId: task.organization_id,
        resource: 'investigate',
    });
    const limit = quota.limit;

    console.log(`[INVESTIGATE] 🔍 QUOTA CHECK: `, {
        organization_id: task.organization_id,
        mission_id: task.mission_id,
        scope: quota.scope,
        current_investigated: quota.used,
        limit: limit,
        remaining: limit - quota.used,
        will_skip: quota.used >= limit
    });

    let { leads, campaignId, campaignName } = task.payload;

    if (!Array.isArray(leads) || leads.length === 0) {
        console.log('[INVESTIGATE] No leads in payload. Fetching from DB (status=enriched, not contacted)...');

        const { data: contactedLeadIds } = await supabase
            .from('contacted_leads')
            .select('lead_id')
            .eq('mission_id', task.mission_id);

        const contactedIds = (contactedLeadIds || []).map((c: any) => c.lead_id).filter(Boolean);

        let q = supabase
            .from('leads')
            .select('id, name, email, title, company, linkedin_url, company_website, source_provider, source_provider_id, apollo_id, industry, location')
            .eq('mission_id', task.mission_id)
            .eq('status', 'enriched')
            .not('email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(50);

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

    const leadsToInvestigate = leads.slice(0, 50);
    let deferredLeadsForQuota = leads.slice(leadsToInvestigate.length);
    let quotaCount = quota.used;

    const attemptAt = new Date().toISOString();
    await safeHeartbeatTask(supabase, task.id, {
        progress_current: 0,
        progress_total: leadsToInvestigate.length,
        progress_label: `Investigando ${leadsToInvestigate.length} lead(s)...`
    });

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

    // Ensure the native research provider always receives a complete user context.
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
            const safeCompanyName = sanitizeCompanyName(
                lead.companyName || lead.company_name || lead.company || lead.organization?.name,
                lead.companyDomain || lead.company_domain || lead.company_website,
                lead.email,
            );
            const identity = resolveLeadIdentity(lead);
            const companyDomain = cleanDomain(lead.companyDomain || lead.company_domain || lead.company_website);
            const companyWebsite = companyDomain ? `https://${companyDomain}` : null;
            const normalizedLinkedinUrl = safeDecodeUriValue(lead.linkedinUrl || lead.linkedin_url);
            const leadRef = String(
                lead.id || lead.email || normalizedLinkedinUrl || `${identity.fullName || lead.fullName || lead.full_name || lead.name || ''}|${safeCompanyName}`
            ).trim();
            const researchRequestIdempotencyKey = buildFirebaseLeadResearchRequestKey({
                organizationId: task.organization_id,
                userId,
                taskId: task.id,
                leadRef,
            });
            const owner = {
                scopeKey: String(task.organization_id),
                organizationId: String(task.organization_id),
                userId,
            };
            const leadIdentity = {
                leadRef,
                leadId: lead.id || null,
                email: lead.email || null,
                companyName: safeCompanyName,
                companyDomain: companyDomain || null,
            };

            const leadResearchPayload = {
                user_id: userId,
                organization_id: task.organization_id,
                idempotency_key: researchRequestIdempotencyKey,
                lead_ref: leadRef,
                lead: {
                    id: lead.id,
                    source_provider_id: (lead.sourceProvider || lead.source_provider) === 'apollo'
                        ? (lead.sourceProviderId || lead.source_provider_id || null)
                        : null,
                    full_name: identity.fullName || null,
                    first_name: identity.firstName || null,
                    last_name: identity.lastName || null,
                    title: lead.title || null,
                    headline: lead.headline || null,
                    email: lead.email || null,
                    phone: lead.primaryPhone || null,
                    linkedin_url: normalizedLinkedinUrl || null,
                    location: lead.location || null,
                    city: lead.city || null,
                    country: lead.country || null,
                    seniority: lead.seniority || null,
                    department: Array.isArray(lead.departments) ? lead.departments[0] : null,
                },
                company: {
                    name: safeCompanyName,
                    domain: companyDomain || null,
                    website_url: companyWebsite,
                    linkedin_url: lead.companyLinkedinUrl || lead.company_linkedin_url || null,
                    industry: lead.organizationIndustry || lead.industry || null,
                    size: lead.organizationSize || null,
                },
                seller_context: {
                    company_name: userCompanyProfile.name,
                    company_domain: cleanDomain(userProfile?.company_domain),
                    sector: userCompanyProfile.sector,
                    description: userCompanyProfile.description,
                    services: asStringArray(userCompanyProfile.services),
                    value_proposition: userCompanyProfile.valueProposition,
                    proof_points: asStringArray(profileExtended.proofPoints || profileExtended.proof_points),
                    target_market: asStringArray(profileExtended.targetMarket || profileExtended.target_market),
                },
                user_context: {
                    id: userContext.id,
                    name: userContext.name,
                    job_title: userContext.jobTitle,
                },
                options: {
                    language: 'es',
                    depth: 'standard',
                    include_outreach_pack: true,
                    include_company_research: true,
                    include_lead_research: true,
                    include_recent_signals: true,
                    include_call_prep: true,
                    include_competitive_context: true,
                    include_raw_sources: true,
                    max_sources: 15,
                    force_refresh: true,
                },
            };
            const requestPayload = leadResearchPayload;
            const claim = await claimLeadResearchRequest(supabase, {
                ...owner,
                ...leadIdentity,
                requestIdempotencyKey: researchRequestIdempotencyKey,
                requestPayload,
            });
            let requestJob = claim.job;
            let claimToken = claim.claimToken;

            if (!claim.claimed && ['pre_provider', 'provider_submitting'].includes(requestJob.requestClaimState)) {
                console.log(`[INVESTIGATE] Reusing in-flight claim for ${lead.email || safeCompanyName}`);
                continue;
            }
            if (requestJob.requestClaimState === 'provider_unknown' || requestJob.requestClaimState === 'provider_failed') {
                console.warn(`[INVESTIGATE] Reusing terminal request failure for ${lead.email || safeCompanyName}: ${requestJob.errorCode || requestJob.requestClaimState}`);
                continue;
            }

            let providerReportId = requestJob.providerReportId;
            let providerStatus = getResearchProviderStatus(requestJob.resultPayload || requestJob.requestPayload, requestJob.status);
            let providerResult: any = requestJob.resultPayload;
            if (!claim.claimed && requestJob.requestClaimState === 'submitted' && ['completed', 'partial'].includes(requestJob.status)) {
                const reusedResearch = normalizeResearchData(providerResult, { ...lead, companyName: safeCompanyName });
                if (isResearchReadyForAutoContact(reusedResearch)) {
                    investigatedLeads.push({ ...lead, companyName: safeCompanyName, research: reusedResearch });
                    if (lead?.id) {
                        await supabase.from('leads')
                            .update({ last_investigated_at: attemptAt, investigation_error: null } as any)
                            .eq('id', lead.id);
                    }
                } else if (lead?.id) {
                    await supabase.from('leads')
                        .update({
                            last_investigated_at: attemptAt,
                            investigation_error: getResearchAutoContactBlockReason(reusedResearch) || 'invalid_reused_research',
                        } as any)
                        .eq('id', lead.id);
                }
                continue;
            }
            if (requestJob.requestClaimState === 'terminal_pending') {
                if (!claimToken || !providerReportId || !providerResult) throw new Error('LEAD_RESEARCH_TERMINAL_RECOVERY_INVALID');
            } else if (!claim.claimed && requestJob.requestClaimState === 'submitted') {
                if (!providerReportId) throw new Error('LEAD_RESEARCH_REPORT_ID_MISSING');
                if (isActiveResearchProviderStatus(providerStatus)) {
                    try {
                        providerResult = await pollLeadResearchProvider(providerReportId, requestJob.resultPayload || { status: providerStatus });
                    } catch (error: any) {
                        if (error?.status) {
                            console.warn(`[INVESTIGATE] Existing provider job poll failed for ${lead.email || safeCompanyName}: ${error.message}`);
                            continue;
                        }
                        error.retryable = true;
                        throw error;
                    }
                    providerStatus = getResearchProviderStatus(providerResult, providerStatus);
                }
                if (isActiveResearchProviderStatus(providerStatus)) continue;
                if (['failed', 'cancelled', 'insufficient_data'].includes(providerStatus)) {
                    await failSubmittedLeadResearchRequest(supabase, {
                        ...owner,
                        jobId: requestJob.id,
                        providerReportId,
                        providerStatus,
                        resultPayload: providerResult || {},
                    });
                    continue;
                }
            } else {
                if (!claimToken) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_TOKEN_MISSING');
                const ownedClaim = { ...owner, jobId: requestJob.id, claimToken };
                let reservation;
                try {
                    reservation = await consumeLeadResearchRequestQuota(supabase, { ...ownedClaim, limit });
                } catch (error: any) {
                    await releaseLeadResearchRequest(supabase, {
                        ...ownedClaim,
                        errorCode: 'research_quota_unavailable',
                        errorMessage: 'Research quota could not be reserved before provider submission.',
                    });
                    error.retryable = true;
                    error.code = error.code || 'QUOTA_RESERVATION_FAILED';
                    throw error;
                }
                quotaCount = reservation.count;
                if (!reservation.allowed) {
                    await releaseLeadResearchRequest(supabase, {
                        ...ownedClaim,
                        errorCode: 'daily_research_quota_exceeded',
                        errorMessage: 'Daily research quota exceeded.',
                    });
                    deferredLeadsForQuota = leads.slice(investigateIndex - 1);
                    console.log(`[INVESTIGATE] Daily limit reached atomically (${reservation.count}/${reservation.limit}). Deferring ${deferredLeadsForQuota.length} lead(s).`);
                    break;
                }

                await safeInsertLeadEvents(supabase, lead?.id ? [{
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(lead.id),
                    event_type: 'lead_investigate_started',
                    stage: 'investigate',
                    outcome: 'started',
                    message: 'Investigacion iniciada',
                    meta: { quotaScope: quota.scope, quotaCount: reservation.count, quotaLimit: reservation.limit },
                    created_at: attemptAt,
                }] : []);
                try {
                    await markLeadResearchRequestSubmitting(supabase, ownedClaim);
                } catch (error) {
                    await releaseLeadResearchRequest(supabase, {
                        ...ownedClaim,
                        errorCode: 'provider_submission_not_started',
                        errorMessage: 'Provider submission did not start.',
                    });
                    throw error;
                }
                requestJob = { ...requestJob, requestClaimState: 'provider_submitting', status: 'running' };

                const providerUrl = getLeadResearchUrl();
                let response: Response;
                let responseText: string;
                try {
                    response = await fetch(providerUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                            'Idempotency-Key': researchRequestIdempotencyKey,
                        },
                        body: JSON.stringify(requestPayload),
                    });
                    responseText = await response.text();
                } catch (error: any) {
                    await markLeadResearchRequestUnknown(supabase, {
                        ...ownedClaim,
                        errorCode: 'provider_outcome_unknown',
                        errorMessage: error?.message || 'The provider outcome is unknown and cannot be retried safely.',
                    });
                    console.error(`[INVESTIGATE] Provider outcome unknown for ${lead.email || safeCompanyName}; no resend`, error);
                    continue;
                }
                providerResult = parseResearchResponseText(responseText);
                if (!response.ok) {
                    const resultPayload = providerResult && typeof providerResult === 'object' && !Array.isArray(providerResult)
                        ? { ...providerResult, provider_http_status: response.status }
                        : { error: responseText, provider_http_status: response.status };
                    await failLeadResearchRequest(supabase, {
                        ...ownedClaim,
                        errorCode: `provider_http_${response.status}`,
                        errorMessage: String(resultPayload.message || resultPayload.error || `Provider returned HTTP ${response.status}`),
                        resultPayload,
                    });
                    continue;
                }

                providerReportId = String(providerResult?.report_id || '').trim();
                providerStatus = getResearchProviderStatus(providerResult, 'queued');
                if (!providerReportId) {
                    await markLeadResearchRequestUnknown(supabase, {
                        ...ownedClaim,
                        errorCode: 'invalid_provider_response',
                        errorMessage: 'Provider accepted the request without returning a report ID.',
                    });
                    continue;
                }
                if (isActiveResearchProviderStatus(providerStatus)) {
                    await completeLeadResearchRequestSubmission(supabase, {
                        ...ownedClaim,
                        ...leadIdentity,
                        providerReportId,
                        providerStatus,
                        requestPayload,
                    });
                    requestJob = { ...requestJob, requestClaimState: 'submitted', providerReportId, status: 'running' };
                    claimToken = null;
                    try {
                        providerResult = await pollLeadResearchProvider(providerReportId, providerResult);
                    } catch (error: any) {
                        if (error?.status) {
                            error.retryable = true;
                        }
                        throw error;
                    }
                    providerStatus = getResearchProviderStatus(providerResult, providerStatus);
                }
            }

            const normalizedResearchResult = providerResult;
            const normalizedLeadResearch = normalizeResearchData(normalizedResearchResult, { ...lead, companyName: safeCompanyName });
            const researchMismatch = isResearchCompanyMismatch({ name: safeCompanyName, domain: companyDomain }, normalizedLeadResearch);
            const researchFailureReason = getResearchAutoContactBlockReason(normalizedLeadResearch);
            if (['failed', 'cancelled', 'insufficient_data'].includes(providerStatus)) {
                if (requestJob.requestClaimState === 'submitted' && providerReportId) {
                    await failSubmittedLeadResearchRequest(supabase, {
                        ...owner,
                        jobId: requestJob.id,
                        providerReportId,
                        providerStatus,
                        resultPayload: providerResult || {},
                    });
                }
                continue;
            }
            if (isActiveResearchProviderStatus(providerStatus)) continue;
            if (!providerReportId) throw new Error('LEAD_RESEARCH_REPORT_ID_MISSING');
            if (researchMismatch || (providerStatus === 'partial'
                ? !hasMeaningfulResearch(normalizedLeadResearch)
                : Boolean(researchFailureReason))) {
                const failureReason = researchMismatch ? 'research_company_mismatch' : researchFailureReason || 'invalid_response';
                const resultPayload = {
                    ...(providerResult && typeof providerResult === 'object' && !Array.isArray(providerResult) ? providerResult : {}),
                    provider_status: 'failed',
                    error: failureReason,
                };
                if (requestJob.requestClaimState === 'provider_submitting' && claimToken) {
                    await failLeadResearchRequest(supabase, {
                        ...owner,
                        jobId: requestJob.id,
                        claimToken,
                        errorCode: failureReason,
                        errorMessage: `Research result is not reusable: ${failureReason}`,
                        resultPayload,
                    });
                } else if (requestJob.requestClaimState === 'submitted') {
                    await failSubmittedLeadResearchRequest(supabase, {
                        ...owner,
                        jobId: requestJob.id,
                        providerReportId,
                        providerStatus: failureReason,
                        resultPayload,
                    });
                }
                if (lead?.id) {
                    await supabase.from('leads')
                        .update({ last_investigated_at: attemptAt, investigation_error: failureReason } as any)
                        .eq('id', lead.id);
                }
                continue;
            }

            try {
                await persistLeadResearchTerminalResult(supabase, {
                    ...owner,
                    ...leadIdentity,
                    job: requestJob,
                    claimToken,
                    requestIdempotencyKey: researchRequestIdempotencyKey,
                    provider: 'lead-research',
                    providerReportId,
                    providerStatus: providerStatus === 'partial' ? 'partial' : 'completed',
                    requestPayload,
                    resultPayload: normalizedResearchResult || {},
                });
            } catch (error: any) {
                error.retryable = true;
                throw error;
            }

            if (!researchFailureReason && !researchMismatch) {
                investigatedLeads.push({ ...lead, companyName: safeCompanyName, research: normalizedLeadResearch });
                if (lead?.id) {
                    await supabase.from('leads')
                        .update({ last_investigated_at: attemptAt, investigation_error: null } as any)
                        .eq('id', lead.id);
                }
                await safeInsertLeadEvents(supabase, [{
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(lead.id),
                    event_type: 'lead_investigate_completed',
                    stage: 'investigate',
                    outcome: providerStatus,
                    message: 'Investigacion completada',
                    meta: { provider: 'lead-research', reportId: providerReportId },
                    created_at: attemptAt,
                }]);
            } else {
                const finalReason = researchMismatch ? 'research_company_mismatch' : researchFailureReason;
                if (lead?.id) {
                    await supabase.from('leads')
                        .update({ last_investigated_at: attemptAt, investigation_error: finalReason } as any)
                        .eq('id', lead.id);
                }
            }
        } catch (e) {
            if ((e as any)?.code === 'QUOTA_RESERVATION_FAILED' || (e as any)?.retryable === true) {
                throw e;
            }
            console.error('[INVESTIGATE] Failed to investigate lead:', e);

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
        }
    }

    if (deferredLeadsForQuota.length > 0) {
        await safeInsertLeadEvents(
            supabase,
            deferredLeadsForQuota
                .filter((lead: any) => !!lead?.id)
                .map((lead: any) => ({
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    task_id: task.id,
                    lead_id: String(lead.id),
                    event_type: 'lead_investigate_skipped',
                    stage: 'investigate',
                    outcome: 'deferred_by_quota',
                    message: 'Investigacion diferida por cuota diaria',
                    meta: { quotaScope: quota.scope, quotaCount, quotaLimit: limit },
                    created_at: new Date().toISOString(),
                }))
        );

        task.payload = { ...task.payload, userId, leads: deferredLeadsForQuota };
    }

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
                    campaignId: campaignId,
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

    if (deferredLeadsForQuota.length > 0) {
        return {
            skipped: true,
            reason: 'daily_limit_reached',
            retryAt: getNextUtcDayStartIso(),
            investigatedCount: investigatedLeads.length,
            deferredCount: deferredLeadsForQuota.length,
            quotaCount,
            limit,
            scope: quota.scope,
        };
    }

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

    const userId = await getTaskUserId(task, supabase);
    const usage = await getDailyUsage(supabase, task.organization_id);
    const { limit, contactsToday } = await getEffectiveDailyContactQuota(supabase, {
        userId,
        organizationId: task.organization_id,
        fallbackLimit: Math.min(50, mission?.daily_contact_limit || 3),
    });

    if ((contactsToday || 0) >= limit) {
        const retryAt = getNextUtcDayStartIso();
        console.log(`[CONTACT] Daily limit reached(${contactsToday} / ${limit}). Re-scheduling for ${retryAt}`);
        return { skipped: true, reason: 'daily_limit_reached', retryAt };
    }

    const { leads, campaignId, campaignName, dryRun } = task.payload;
    const dryRunEffects = getMessagingOutcomeEffects({ dryRun: Boolean(dryRun), outcome: 'sent' });
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
    if (campaignId || campaignName) {
        let campaignQuery = supabase
            .from('campaigns')
            .select('id, sent_records, settings')
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId);

        campaignQuery = campaignId
            ? campaignQuery.eq('id', campaignId)
            : campaignQuery.eq('name', campaignName);

        const { data: camp } = await campaignQuery.maybeSingle();

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
                if (dryRunEffects.allowLeadStatusMutation) {
                    await supabase
                        .from('leads')
                        .update({ status: 'do_not_contact' } as any)
                        .eq('id', leadId);
                }
            }
            continue;
        }

        leadsFiltered.push(l);
    }

    await safeInsertLeadEvents(supabase, skippedEvents);

    const leadsToContact = leadsFiltered.slice(0, limit - (contactsToday || 0));

    const candidateEmails = [...new Set(leadsToContact.map((lead: any) => String(lead?.email || '').trim().toLowerCase()).filter(Boolean))];
    const candidateLeadIds = [...new Set(leadsToContact.map((lead: any) => String(lead?.id || '').trim()).filter(Boolean))];
    const priorReplyRows: any[] = [];

    if (candidateEmails.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('lead_id, email, status, replied_at, reply_intent, last_reply_text, name, company, mission_id, delivery_status, bounce_category, bounce_reason, evaluation_status, campaign_followup_reason')
            .eq('organization_id', task.organization_id)
            .in('email', candidateEmails);
        priorReplyRows.push(...(data || []));
    }

    if (candidateLeadIds.length > 0) {
        const { data } = await supabase
            .from('contacted_leads')
            .select('lead_id, email, status, replied_at, reply_intent, last_reply_text, name, company, mission_id, delivery_status, bounce_category, bounce_reason, evaluation_status, campaign_followup_reason')
            .eq('organization_id', task.organization_id)
            .in('lead_id', candidateLeadIds);
        priorReplyRows.push(...(data || []));
    }

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

    // Fetch user's email signature from profiles
    const { data: profile } = await supabase
        .from('profiles')
        .select('signatures, full_name, job_title, company_name, company_domain, email')
        .eq('id', userId)
        .single();

    const { data: authUserData } = await supabase.auth.admin.getUserById(userId).catch(() => ({ data: { user: null } as any }));

    const profileExtended = profile?.signatures?.profile_extended || {};
    const senderCompanyName = profile?.company_name || profileExtended.companyName || 'nuestro equipo';
    const senderValueProp = profileExtended.valueProposition || profileExtended.value_proposition || '';
    const senderName = String(profile?.full_name || '').trim();
    const senderTitle = String(profile?.job_title || '').trim();
    const senderEmail = String(profile?.email || authUserData?.user?.email || '').trim();
    const senderPhone = String(profileExtended.phone || '').trim();
    const senderWebsite = String(profile?.company_domain || '').trim()
        ? (String(profile.company_domain).startsWith('http') ? String(profile.company_domain).trim() : `https://${String(profile.company_domain).trim()}`)
        : '';

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
    const defaultSubject = 'Ideas para {{company}}';
    let defaultBody = `Hola {{name}},

Estuve revisando {{company}} y vi que {{research.summary}}

Creo que podría hacer sentido conversar para explorar oportunidades concretas.

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
        const currentMissionStatus = await getMissionStatus(supabase, task.mission_id);
        if (currentMissionStatus && currentMissionStatus !== 'active') {
            console.warn(`[CONTACT] Mission ${task.mission_id} is ${currentMissionStatus}. Stopping contact loop before sending to ${lead.email || lead.id}.`);
            return {
                contactedCount,
                skipped: true,
                reason: currentMissionStatus === 'paused' ? 'mission_paused' : 'mission_not_active',
                missionStatus: currentMissionStatus,
                stoppedBeforeLeadId: lead?.id || null,
            };
        }

        await safeHeartbeatTask(supabase, task.id, {
            progress_current: contactIndex,
            progress_total: leadsToContact.length,
            progress_label: `Contactando (${contactIndex}/${leadsToContact.length}): ${lead.fullName || lead.full_name || lead.name || lead.email || 'lead'}`
        });

        try {
            const priorReply = findPriorReplyMatchForLead(lead, priorReplyRows);
            if (priorReply) {
                const permanentSuppression = shouldPermanentlySuppressContact(priorReply);
                console.warn(`[CONTACT] Guardrail blocked ${lead.email || lead.id} because the lead already replied in a previous thread.`);
                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_blocked',
                            stage,
                            outcome: 'prior_reply_guardrail',
                            message: 'Contacto bloqueado: el lead ya habia respondido antes',
                            meta: { priorReply, permanentSuppression },
                            created_at: attemptAt,
                        }
                    ]);
                    if (dryRunEffects.allowLeadStatusMutation && permanentSuppression) {
                        await supabase
                            .from('leads')
                            .update({ status: 'do_not_contact', updated_at: new Date().toISOString() } as any)
                            .eq('id', lead.id);
                    }
                }
                continue;
            }

            const safeCompanyName = sanitizeCompanyName(
                lead.companyName || lead.company_name || lead.company,
                lead.companyDomain || lead.company_domain || lead.company_website,
                lead.email,
            );
            const researchBlockReason = getResearchAutoContactBlockReason(lead.research);
            if (researchBlockReason) {
                console.warn(`[CONTACT] Blocking ${lead.email || lead.id} because research is not ready: ${researchBlockReason}`);
                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_blocked',
                            stage,
                            outcome: researchBlockReason,
                            message: 'Contacto bloqueado: investigacion incompleta o fallida',
                            meta: { reason: researchBlockReason },
                            created_at: attemptAt,
                        }
                    ]);
                }
                continue;
            }
            const firstName = safeFirstName(lead.fullName || lead.full_name || lead.name);
            const researchData = normalizeResearchData(lead.research, { ...lead, companyName: safeCompanyName }) || {};
            const researchSummary = truncateText(
                researchData?.summary
                || researchData?.overview
                || 'estan impulsando iniciativas relevantes que valdria la pena conversar.'
            );
            const preferredDraftSubject = normalizeDraftText(researchData?.emailDraft?.subject);
            const preferredDraftBody = normalizeDraftText(researchData?.emailDraft?.body);
            const preferredDraft = preferredDraftSubject && preferredDraftBody
                ? { subject: preferredDraftSubject, body: preferredDraftBody }
                : null;

            // Determine Subject and Body
            // Priority 1: Use Draft from Research
            let finalSubject = defaultSubject;
            let finalBody = defaultBody;
            let usedPreferredDraft = false;

            if (preferredDraft) {
                console.log(`[CONTACT] Using AI Generated Draft for ${lead.email}`);
                finalSubject = preferredDraft.subject;
                finalBody = appendSignatureIfMissing(preferredDraft.body, userSignature, profile?.full_name);
                usedPreferredDraft = true;

            } else {
                console.log(`[CONTACT] Using enriched fallback template for ${lead.email}`);
                finalSubject = buildFallbackSubject(safeCompanyName, researchData);
                finalBody = buildFallbackBody({
                    firstName,
                    companyName: safeCompanyName,
                    researchData,
                    senderCompanyName,
                    senderValueProp,
                    userSignature,
                });
            }

            // Replace template variables (Applicable to both Default and Drafts if they use {{}} syntax, though N8N drafts usually come resolved)
            // We should still run replacement just in case the draft uses placeholders
            const renderDraft = (subjectInput: string, bodyInput: string) => {
                const baseSubject = renderLegacyDraftPlaceholders(subjectInput, {
                    leadName: lead.fullName || lead.full_name || lead.name || '',
                    firstName,
                    leadTitle: lead.title || '',
                    companyName: safeCompanyName,
                    senderName,
                    senderTitle,
                    senderCompany: senderCompanyName,
                    senderEmail,
                    senderPhone,
                    senderWebsite,
                });
                const baseBody = renderLegacyDraftPlaceholders(bodyInput, {
                    leadName: lead.fullName || lead.full_name || lead.name || '',
                    firstName,
                    leadTitle: lead.title || '',
                    companyName: safeCompanyName,
                    senderName,
                    senderTitle,
                    senderCompany: senderCompanyName,
                    senderEmail,
                    senderPhone,
                    senderWebsite,
                });

                return {
                    subject: baseSubject
                        .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || lead.name || 'there')
                        .replace(/\{\{company\}\}/g, safeCompanyName || 'your company')
                        .replace(/\{\{firstName\}\}/g, firstName)
                        .trim(),
                    body: baseBody
                        .replace(/\{\{name\}\}/g, lead.fullName || lead.full_name || lead.name || 'there')
                        .replace(/\{\{company\}\}/g, safeCompanyName || 'your company')
                        .replace(/\{\{firstName\}\}/g, firstName)
                        .replace(/\{\{title\}\}/g, lead.title || 'your role')
                        .replace(/\{\{research\.summary\}\}/g, researchSummary)
                        .replace(/\{\{email\}\}/g, lead.email || '')
                        .trim(),
                };
            };

            let { subject: personalizedSubject, body: personalizedBody } = renderDraft(finalSubject, finalBody);

            if (usedPreferredDraft && (hasMalformedDraftContent(personalizedSubject) || hasMalformedDraftContent(personalizedBody))) {
                console.warn(`[CONTACT] Preferred draft malformed for ${lead.email}. Falling back to safe template.`);
                finalSubject = buildFallbackSubject(safeCompanyName, researchData);
                finalBody = buildFallbackBody({
                    firstName,
                    companyName: safeCompanyName,
                    researchData,
                    senderCompanyName,
                    senderValueProp,
                    userSignature,
                });
                ({ subject: personalizedSubject, body: personalizedBody } = renderDraft(finalSubject, finalBody));
            }

            if (hasMalformedDraftContent(personalizedSubject) || hasMalformedDraftContent(personalizedBody)) {
                console.warn(`[CONTACT] Blocking malformed draft for ${lead.email}`);
                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_blocked',
                            stage,
                            outcome: 'invalid_template',
                            message: 'Contacto bloqueado: plantilla malformada',
                            meta: {
                                subjectPreview: personalizedSubject.slice(0, 160),
                                bodyPreview: personalizedBody.slice(0, 400),
                            },
                            created_at: attemptAt,
                        }
                    ]);
                }
                continue;
            }

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

                if (lead?.id) {
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: 'lead_contact_dry_run',
                            stage,
                            outcome: dryRunEffects.receiptStatus,
                            message: 'Contacto simulado (dry run)',
                            meta: { dryRun: true },
                            created_at: attemptAt,
                        }
                    ]);
                }

                continue; // Skip the rest of the loop (actual fetch)
            }

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId,
                    'x-organization-id': task.organization_id,
                }),
                body: JSON.stringify({
                    to: lead.email,
                    subject: personalizedSubject,
                    body: cleanedBody, // Use cleaned body instead of personalizedBody
                    leadId: lead.id,
                    campaignId: campaignRef?.id || null,
                    missionId: task.mission_id,
                    taskId: task.id,
                    userId: userId,
                    idempotencyKey: campaignRef?.id
                        ? `campaign:${campaignRef.id}:${lead.id || lead.email}:step:0`
                        : `antonia:${task.id}:${lead.id || lead.email}:initial`,
                    tracking: campaignRef?.settings?.tracking
                })
            });

            console.log(`[CONTACT] API response status: ${response.status} `);

            const responseText = await response.text().catch(() => '');
            const resData = parseContactApiBody(responseText);
            if (response.ok && resData.success === true) {
                const isReplayed = resData.replayed === true;
                lead.replayed = isReplayed;
                if (!isReplayed) contactedCount += dryRunEffects.contactedCountDelta;
                console.log(`[CONTACT] Successfully contacted lead via ${resData.provider} `);

                const sentAt = new Date().toISOString();

                if (isReplayed && dryRunEffects.updateCampaignSentRecords && campaignRef && campaignSentRecords && lead?.id) {
                    campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: sentAt };
                    campaignDirty = true;
                }

                if (!isReplayed && dryRunEffects.insertContactedLead) await supabase.from('contacted_leads').insert({
                    user_id: userId,
                    organization_id: task.organization_id,
                    mission_id: task.mission_id,
                    lead_id: lead.id,
                    campaign_id: campaignRef?.id || null,

                    name: lead.fullName || lead.full_name || lead.name || '',
                    email: lead.email,
                    company: safeCompanyName,
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
                    data: campaignRef?.id ? { campaign_id: campaignRef.id } : {},
                } as any);

                if (!isReplayed && dryRunEffects.updateCampaignSentRecords && campaignRef && campaignSentRecords && lead?.id) {
                    campaignSentRecords[String(lead.id)] = { lastStepIdx: 0, lastSentAt: sentAt };
                    campaignDirty = true;
                }

                if (!isReplayed && dryRunEffects.markLeadContacted && lead.id) {
                    const { error: leadUpdateErr } = await supabase
                        .from('leads')
                        .update({ status: 'contacted' })
                        .eq('id', lead.id);
                    if (leadUpdateErr) console.error('[CONTACT] Failed to update lead status to contacted:', lead.id, leadUpdateErr);
                }

                if (!isReplayed && lead?.id) {
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
                const errorText = responseText || resData.error || 'Empty response';
                console.error(`[CONTACT] API error: ${response.status} - ${errorText} `);

                // Track error for reporting
                lead.error = `API Error ${response.status}: ${errorText.substring(0, 100)} `;

                const responseCode = String(resData.code || '').trim().toUpperCase();
                const isUnsub = responseCode === 'RECIPIENT_UNSUBSCRIBED';
                const isBlockedDomain = responseCode === 'DOMAIN_BLOCKED';

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
                                meta: { status: response.status, code: responseCode || null, error: errorText.slice(0, 800) },
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
                                meta: { status: response.status, code: responseCode || null, error: errorText.slice(0, 800) },
                                created_at: attemptAt,
                            }
                        ]);
                    }
                }

                if (isRetryableContactApiFailure(response.status, responseCode)) {
                    const retryError = createContactApiError({
                        status: response.status,
                        code: responseCode,
                        message: String(resData.error || errorText).slice(0, 800),
                        result: {
                            contactedCount,
                            contactedList: leadsToContact.map((item: any) => ({
                                leadId: item.id || null,
                                email: item.email || null,
                                status: item.error ? 'failed' : 'pending',
                                error: item.error || null,
                            })),
                        },
                    });
                    retryError.recorded = true;
                    throw retryError;
                }
            }
        } catch (e: any) {
            console.error('[CONTACT] Failed to contact lead:', e);
            lead.error = `Exception: ${e.message} `;

            if (lead?.id && !e?.recorded) {
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
            if (isRetryableContactException(e)) {
                const retryError: any = e && typeof e === 'object' ? e : new Error(String(e));
                retryError.retryable = true;
                retryError.result = retryError.result || {
                    contactedCount,
                    contactedList: leadsToContact.map((item: any) => ({
                        leadId: item.id || null,
                        email: item.email || null,
                        status: item.error ? 'failed' : 'pending',
                        error: item.error || null,
                    })),
                };
                throw retryError;
            }
        }
    }

    if (!dryRun && campaignRef && campaignDirty && campaignSentRecords) {
        const { error: campErr } = await supabase
            .from('campaigns')
            .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
            .eq('id', campaignRef.id)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId);
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
            status: l.error ? 'failed' : l.replayed ? 'replayed' : 'sent',
            ...(dryRun ? { status: 'dry_run' } : {}),
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
    const userId = await getTaskUserId(task, supabase);
    const { data: mission, error: missionError } = await supabase
        .from('antonia_missions')
        .select('params')
        .eq('id', task.mission_id)
        .eq('organization_id', task.organization_id)
        .eq('user_id', userId)
        .maybeSingle();
    if (missionError) throw missionError;
    const campaignPayload = { ...(mission?.params || {}), ...(task.payload || {}) };
    let qualifiedCount = 0;

    for (const lead of leads) {
        // Fetch interaction history
        const { data: interactions } = await supabase
            .from('lead_responses')
            .select('*')
            .eq('lead_id', lead.id);

        const { data: contactedLead, error: contactedLeadError } = await supabase
            .from('contacted_leads')
            .select('id, lead_id, email, campaign_id, data, engagement_score')
            .eq('lead_id', lead.id)
            .eq('mission_id', task.mission_id)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (contactedLeadError) {
            throw contactedLeadError;
        }
        if (!contactedLead?.id) {
            const error: any = new Error(`Originating contacted lead not found for evaluation lead ${lead.id || lead.email}`);
            error.code = 'CONTACTED_LEAD_NOT_FOUND';
            error.result = { evaluatedCount: 0, qualifiedCount, failedLeadId: lead.id || null };
            throw error;
        }

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

            const campaignReference = getCampaignReference({ contactedLead, lead, taskPayload: campaignPayload });
            const campaign = await resolveCampaign(supabase, {
                organizationId: task.organization_id,
                userId,
                missionId: task.mission_id,
                campaignId: campaignReference.campaignId,
                campaignName: campaignReference.campaignName,
            });

            if (campaign?.id && contactedLead?.id) {
                const { error: insertError } = await supabase.from('antonia_tasks').insert({
                    mission_id: task.mission_id,
                    organization_id: task.organization_id,
                    type: 'CONTACT_CAMPAIGN',
                    status: 'pending',
                    payload: {
                        leads: [{ ...lead, contactedLeadId: contactedLead.id }],
                        userId,
                        campaignId: campaign.id,
                        campaignName: campaign.name,
                    },
                    idempotency_key: `campaign_followup_${campaign.id}_${contactedLead.id}`,
                    created_at: new Date().toISOString(),
                });
                if (insertError && String((insertError as any)?.code || '') !== '23505') {
                    throw insertError;
                }
                console.log(`[EVALUATE] Lead qualified. CONTACT_CAMPAIGN ${insertError ? 'already exists' : 'created'} for campaign ${campaign.id}.`);
            } else {
                const error: any = new Error(`Qualified lead ${lead.email || lead.id} has no resolvable originating campaign`);
                error.code = 'CAMPAIGN_NOT_FOUND';
                error.result = {
                    evaluatedCount: 0,
                    qualifiedCount,
                    failedLeadId: lead.id || null,
                    campaignReference,
                    followUpCreated: false,
                };
                throw error;
            }
        }

        // Update status
        const { error: evaluationUpdateError } = await supabase.from('contacted_leads').update({
            evaluation_status: newStatus
        })
            .eq('id', contactedLead.id)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId);
        if (evaluationUpdateError) throw evaluationUpdateError;
    }

    return { evaluatedCount: leads.length, qualifiedCount };
}

// --- 6. EXECUTE CONTACT CAMPAIGN (Follow-up) ---
async function executeContactCampaign(task: any, supabase: SupabaseClient) {
    return executeLegacyContact(task, supabase);
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
        const missionRows: AntoniaDailyMissionRow[] = missionList
            .filter((m: any) => {
                const mid = String(m.id || '').trim();
                const s = perMission[mid] || {};
                const hasStats = Object.values(s).some((value: any) => Number(value || 0) > 0);
                const hasTask = Boolean(taskByMission[mid]);
                return m.status === 'active' || hasStats || hasTask;
            })
            .map((m: any) => {
                const mid = String(m.id || '').trim();
                const s = perMission[mid] || {};
                const t = taskByMission[mid];
                const agent = t
                    ? `${t.status === 'processing' ? 'Procesando' : 'En cola'} · ${t.progress_label || t.type}`
                    : 'Sin ejecucion activa';
                const prog = (t && typeof t.progress_current === 'number' && typeof t.progress_total === 'number')
                    ? ` (${t.progress_current}/${t.progress_total})`
                    : '';

                return {
                    title: String(m.title || 'Mision sin titulo'),
                    status: m.status || null,
                    agentLabel: `${agent}${prog}`,
                    found: Number(s.found || 0),
                    enriched: Number((s.enrichEmail || 0) + (s.enrichNoEmail || 0)),
                    investigated: Number(s.investigated || 0),
                    contacted: Number(s.contactedSent || 0),
                    blocked: Number(s.contactedBlocked || 0),
                    failed: Number((s.contactedFailed || 0) + (s.enrichFailed || 0) + (s.investigateFailed || 0)),
                };
            });

        htmlContent = buildAntoniaDailyDashboardHtml({
            rangeLabel,
            generatedAtLabel: new Date().toLocaleDateString('es-AR', {
                day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
            }),
            dashboardUrl: `${getAppUrl()}/antonia`,
            searchRuns,
            leadsFound,
            leadsEnriched,
            leadsInvestigated,
            leadsContacted: contacted,
            replies,
            activeMissions: missionList.filter((m: any) => m.status === 'active').length,
            tasksCompleted: tasksCompleted || 0,
            tasksFailed: tasksFailed || 0,
            missions: missionRows,
        });

        summaryData.missionRows = missionRows;

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

    // The database trigger creates the durable SUPL.IA review item. Reports
    // are intentionally not delivered from this worker.
    return { reportId: report.id, generated: true, status: 'review_required' };
}

async function executeLegacyContact(task: any, supabase: SupabaseClient) {
    const { leads } = task.payload || {};
    const userId = await getTaskUserId(task, supabase);
    const appUrl = getAppUrl();
    let contactedCount = 0;
    const attemptAt = new Date().toISOString();
    const stage = 'contact';
    const leadList = Array.isArray(leads) ? leads : [];
    const leadResults: Array<{ leadId: string | null; contactedLeadId?: string | null; email: string | null; status: 'sent' | 'replayed' | 'skipped' | 'failed'; code?: string | null; error?: string | null }> = [];

    if (leadList.length === 0) {
        return {
            contactedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            replayedCount: 0,
            totalCount: 0,
            leads: [],
            skipped: true,
            reason: 'no_leads',
        };
    }

    const candidateEmails = [...new Set(leadList.map((lead: any) => String(lead?.email || '').trim().toLowerCase()).filter(Boolean))];
    const candidateLeadIds = [...new Set(leadList.map((lead: any) => String(lead?.id || '').trim()).filter(Boolean))];
    const candidateContactedLeadIds = [...new Set(leadList.map((lead: any) => String(lead?.contactedLeadId || lead?.contacted_lead_id || '').trim()).filter(Boolean))];
    const contactedRows: any[] = [];
    const contactedSelect = 'id, lead_id, email, status, replied_at, reply_intent, last_reply_text, name, company, mission_id, provider, campaign_id, data, sent_at, last_follow_up_at, last_interaction_at, last_step_idx, follow_up_count, delivery_status, bounce_category, bounce_reason, evaluation_status, campaign_followup_reason';

    if (candidateEmails.length > 0) {
        const { data, error } = await supabase
            .from('contacted_leads')
            .select(contactedSelect)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId)
            .eq('mission_id', task.mission_id)
            .in('email', candidateEmails);
        if (error) throw error;
        contactedRows.push(...(data || []));
    }

    if (candidateLeadIds.length > 0) {
        const { data, error } = await supabase
            .from('contacted_leads')
            .select(contactedSelect)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId)
            .eq('mission_id', task.mission_id)
            .in('lead_id', candidateLeadIds);
        if (error) throw error;
        contactedRows.push(...(data || []));
    }

    if (candidateContactedLeadIds.length > 0) {
        const { data, error } = await supabase
            .from('contacted_leads')
            .select(contactedSelect)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId)
            .eq('mission_id', task.mission_id)
            .in('id', candidateContactedLeadIds);
        if (error) throw error;
        contactedRows.push(...(data || []));
    }

    const uniqueContactedRows = [...new Map(contactedRows.map((row: any) => [String(row.id), row])).values()];
    const firstLead = leadList[0] || null;
    const firstContactedLead = firstLead ? findOriginatingContactedLead(firstLead, uniqueContactedRows) : null;
    const campaignReference = getCampaignReference({
        contactedLead: firstContactedLead,
        lead: firstLead,
        taskPayload: task.payload,
    });
    const campaign = await resolveCampaign(supabase, {
        organizationId: task.organization_id,
        userId,
        missionId: task.mission_id,
        campaignId: campaignReference.campaignId,
        campaignName: campaignReference.campaignName,
    });

    if (!campaign?.id) {
        const error: any = new Error('CONTACT_CAMPAIGN requires a concrete campaign scoped to the task organization and user');
        error.code = 'CAMPAIGN_NOT_FOUND';
        error.result = {
            contactedCount: 0,
            failedCount: leadList.length,
            skippedCount: 0,
            replayedCount: 0,
            totalCount: leadList.length,
            campaignReference,
            leads: leadList.map((lead: any) => ({
                leadId: lead?.id || null,
                email: lead?.email || null,
                status: 'failed',
                code: 'CAMPAIGN_NOT_FOUND',
            })),
        };
        throw error;
    }

    if (String(campaign.status || '').toLowerCase() !== 'active') {
        return {
            contactedCount: 0,
            failedCount: 0,
            skippedCount: leadList.length,
            replayedCount: 0,
            totalCount: leadList.length,
            skipped: true,
            reason: 'campaign_not_active',
            campaignId: campaign.id,
            campaignStatus: campaign.status || null,
            leads: leadList.map((lead: any) => ({
                leadId: lead?.id || null,
                email: lead?.email || null,
                status: 'skipped',
                code: 'CAMPAIGN_NOT_ACTIVE',
            })),
        };
    }

    const { data: steps, error: stepsError } = await supabase
        .from('campaign_steps')
        .select('order_index, offset_days, subject_template, body_template')
        .eq('campaign_id', campaign.id)
        .order('order_index', { ascending: true });
    if (stepsError) throw stepsError;
    if (!steps?.length) {
        const error: any = new Error(`Campaign ${campaign.id} has no campaign steps`);
        error.code = 'CAMPAIGN_STEPS_MISSING';
        throw error;
    }

    const campaignSentRecords: Record<string, any> = { ...(campaign.sent_records || {}) };
    let campaignDirty = false;
    const deferredRetryTimes: string[] = [];

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle();
    if (profileError) throw profileError;
    const senderName = profile?.full_name || 'Tu equipo';

    for (const lead of leadList) {
        try {
            const currentMissionStatus = await getMissionStatus(supabase, task.mission_id);
            if (currentMissionStatus && currentMissionStatus !== 'active') {
                console.warn(`[CONTACT_CAMPAIGN] Mission ${task.mission_id} is ${currentMissionStatus}. Stopping follow-up loop before sending to ${lead.email || lead.id}.`);
                const remaining = leadList.slice(leadList.indexOf(lead));
                for (const item of remaining) {
                    leadResults.push({
                        leadId: item?.id || null,
                        email: item?.email || null,
                        status: 'skipped',
                        code: currentMissionStatus === 'paused' ? 'MISSION_PAUSED' : 'MISSION_NOT_ACTIVE',
                    });
                }
                return {
                    contactedCount,
                    failedCount: leadResults.filter((item) => item.status === 'failed').length,
                    skippedCount: leadResults.filter((item) => item.status === 'skipped').length,
                    totalCount: leadList.length,
                    leads: leadResults,
                    skipped: true,
                    reason: currentMissionStatus === 'paused' ? 'mission_paused' : 'mission_not_active',
                    missionStatus: currentMissionStatus,
                    stoppedBeforeLeadId: lead?.id || null,
                };
            }

            const contactedLead = findOriginatingContactedLead(lead, uniqueContactedRows);
            if (!contactedLead?.id) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: null,
                    email: lead?.email || null,
                    status: 'failed',
                    code: 'CONTACTED_LEAD_NOT_FOUND',
                    error: 'The originating contacted lead could not be resolved',
                });
                continue;
            }

            const perLeadCampaignReference = getCampaignReference({ contactedLead, lead, taskPayload: task.payload });
            if (perLeadCampaignReference.campaignId && perLeadCampaignReference.campaignId !== String(campaign.id)) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email: lead?.email || contactedLead.email || null,
                    status: 'failed',
                    code: 'CAMPAIGN_MISMATCH',
                    error: `Originating contact belongs to campaign ${perLeadCampaignReference.campaignId}`,
                });
                continue;
            }

            const priorReply = findPriorReplyMatchForLead(lead, uniqueContactedRows);
            if (priorReply) {
                const permanentSuppression = shouldPermanentlySuppressContact(priorReply);
                console.warn(`[CONTACT_CAMPAIGN] Guardrail blocked ${lead.email || lead.id} because the lead already replied in a previous thread.`);
                if (permanentSuppression && lead?.id) {
                    await supabase
                        .from('leads')
                        .update({ status: 'do_not_contact', updated_at: new Date().toISOString() } as any)
                        .eq('id', lead.id)
                        .eq('organization_id', task.organization_id)
                        .eq('user_id', userId);
                }
                leadResults.push({ leadId: lead?.id || null, contactedLeadId: contactedLead.id, email: lead?.email || contactedLead.email || null, status: 'skipped', code: 'PRIOR_REPLY' });
                continue;
            }

            const email = String(lead?.email || contactedLead.email || '').trim();
            if (!email) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email: null,
                    status: 'skipped',
                    code: 'NO_EMAIL',
                });
                continue;
            }

            if (!isConfirmedContactProvider(contactedLead.provider)) {
                const result = {
                    contactedCount,
                    failedCount: leadResults.filter((item) => item.status === 'failed').length + 1,
                    skippedCount: leadResults.filter((item) => item.status === 'skipped').length,
                    replayedCount: leadResults.filter((item) => item.status === 'replayed').length,
                    totalCount: leadList.length,
                    leads: [...leadResults, {
                        leadId: lead?.id || null,
                        contactedLeadId: contactedLead.id,
                        email,
                        status: 'failed',
                        code: 'PROVIDER_UNKNOWN',
                    }],
                };
                const error: any = new Error(`Provider is unknown or deferred for contacted lead ${contactedLead.id}`);
                error.code = 'OUTBOUND_UNKNOWN';
                error.retryable = true;
                error.result = result;
                throw error;
            }

            const currentStep = getCurrentCampaignFollowUp({
                campaignId: campaign.id,
                contactedLeadId: contactedLead.id,
                leadId: contactedLead.lead_id || lead?.id || null,
                steps,
                sentRecords: campaignSentRecords,
            });
            if (!currentStep.step) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email,
                    status: 'skipped',
                    code: 'CAMPAIGN_SEQUENCE_COMPLETE',
                });
                continue;
            }

            const retryAt = getCampaignStepRetryAt(
                contactedLead,
                currentStep.step,
                campaignSentRecords[currentStep.sentRecordKey]?.lastSentAt,
            );
            if (retryAt) {
                deferredRetryTimes.push(retryAt);
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email,
                    status: 'skipped',
                    code: 'CAMPAIGN_STEP_NOT_DUE',
                });
                continue;
            }

            const subject = String(currentStep.step.subject_template || '').trim();
            const body = String(currentStep.step.body_template || '').trim();
            if (!subject || !body) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email,
                    status: 'failed',
                    code: 'CAMPAIGN_STEP_INVALID',
                    error: `Campaign step ${currentStep.stepIndex} requires subject and body templates`,
                });
                continue;
            }

            console.log(`[CONTACT_CAMPAIGN] Sending campaign ${campaign.id} step ${currentStep.stepIndex} to ${email}`);

            const response = await fetch(`${appUrl}/api/contact/send`, {
                method: 'POST',
                headers: withInternalApiSecret({
                    'Content-Type': 'application/json',
                    'x-user-id': userId,
                    'x-organization-id': task.organization_id,
                }),
                body: JSON.stringify({
                    to: email,
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
                    taskId: task.id,
                    userId: userId,
                    metadata: { type: 'campaign_followup' },
                    tracking: (campaign as any)?.settings?.tracking,
                    idempotencyKey: currentStep.idempotencyKey,
                })
            });
            const responseText = await response.text().catch(() => '');
            const resData = parseContactApiBody(responseText);
            if (response.ok && resData.success === true) {
                const isReplayed = resData.replayed === true;
                if (!isConfirmedContactProvider(resData.provider)) {
                    const error: any = new Error(`Contact API returned an unconfirmed provider for ${email}`);
                    error.code = 'OUTBOUND_UNKNOWN';
                    error.retryable = true;
                    throw error;
                }
                if (!isReplayed) contactedCount++;
                const sentAt = new Date().toISOString();
                campaignSentRecords[currentStep.sentRecordKey] = { lastStepIdx: currentStep.stepIndex, lastSentAt: sentAt };
                campaignDirty = true;

                const alreadyRecorded = Boolean(
                    contactedLead.last_follow_up_at
                    && Number(contactedLead.last_step_idx) === currentStep.stepIndex
                );
                const { error: contactedUpdateError } = await supabase
                    .from('contacted_leads')
                    .update({
                        campaign_id: campaign.id,
                        last_follow_up_at: sentAt,
                        last_interaction_at: sentAt,
                        last_step_idx: currentStep.stepIndex,
                        follow_up_count: Number(contactedLead.follow_up_count || 0) + (alreadyRecorded ? 0 : 1),
                        message_id: resData.messageId || undefined,
                        thread_id: resData.threadId || undefined,
                        conversation_id: resData.conversationId || undefined,
                        internet_message_id: resData.internetMessageId || undefined,
                        last_update_at: sentAt,
                    } as any)
                    .eq('id', contactedLead.id)
                    .eq('organization_id', task.organization_id)
                    .eq('user_id', userId);
                if (contactedUpdateError) {
                    const error: any = new Error(`Failed to persist campaign follow-up: ${contactedUpdateError.message || contactedUpdateError}`);
                    error.code = 'SIDE_EFFECT_PERSISTENCE_FAILED';
                    error.retryable = true;
                    throw error;
                }

                if (!isReplayed && lead?.id) {
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
                            meta: { kind: 'followup', provider: resData.provider, campaignId: campaign.id, campaignStepIndex: currentStep.stepIndex },
                            created_at: attemptAt,
                        }
                    ]);
                }
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email,
                    status: isReplayed ? 'replayed' : 'sent',
                });
            } else {
                const errorText = responseText || String(resData.error || 'Empty response');
                const responseCode = String(resData.code || '').trim().toUpperCase();
                const isUnsub = responseCode === 'RECIPIENT_UNSUBSCRIBED';
                const isBlockedDomain = responseCode === 'DOMAIN_BLOCKED';
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: contactedLead.id,
                    email,
                    status: isUnsub || isBlockedDomain ? 'skipped' : 'failed',
                    code: responseCode || `HTTP_${response.status}`,
                    error: String(resData.error || errorText).slice(0, 800),
                });
                if (lead?.id) {
                    if (isUnsub || isBlockedDomain) {
                        await supabase
                            .from('leads')
                            .update({ status: 'do_not_contact' } as any)
                            .eq('id', lead.id)
                            .eq('organization_id', task.organization_id)
                            .eq('user_id', userId);
                    }
                    await safeInsertLeadEvents(supabase, [
                        {
                            organization_id: task.organization_id,
                            mission_id: task.mission_id,
                            task_id: task.id,
                            lead_id: String(lead.id),
                            event_type: isUnsub || isBlockedDomain ? 'lead_contact_blocked' : 'lead_contact_failed',
                            stage,
                            outcome: isUnsub ? 'unsubscribed' : isBlockedDomain ? 'domain_blocked' : `api_${response.status}`,
                            message: isUnsub ? 'Seguimiento bloqueado: destinatario dado de baja' : isBlockedDomain ? 'Seguimiento bloqueado: dominio excluido' : 'Fallo enviando seguimiento',
                            meta: { status: response.status, code: responseCode || null, error: errorText.slice(0, 800) },
                            created_at: attemptAt,
                        }
                    ]);
                }
                if (isRetryableContactApiFailure(response.status, responseCode)) {
                    throw createContactApiError({
                        status: response.status,
                        code: responseCode,
                        message: String(resData.error || errorText).slice(0, 800),
                        result: {
                            contactedCount,
                            failedCount: leadResults.filter((item) => item.status === 'failed').length,
                            skippedCount: leadResults.filter((item) => item.status === 'skipped').length,
                            replayedCount: leadResults.filter((item) => item.status === 'replayed').length,
                            totalCount: leadList.length,
                            leads: leadResults,
                        },
                    });
                }
            }
        } catch (e: any) {
            console.error(e);
            if (isRetryableContactException(e)) {
                const retryError: any = e && typeof e === 'object' ? e : new Error(String(e));
                retryError.retryable = true;
                retryError.result = retryError.result || {
                    contactedCount,
                    failedCount: leadResults.filter((item) => item.status === 'failed').length,
                    skippedCount: leadResults.filter((item) => item.status === 'skipped').length,
                    replayedCount: leadResults.filter((item) => item.status === 'replayed').length,
                    totalCount: leadList.length,
                    leads: leadResults,
                };
                throw retryError;
            }
            if (!leadResults.some((item) => item.leadId === (lead?.id || null) && item.email === (lead?.email || null))) {
                leadResults.push({
                    leadId: lead?.id || null,
                    contactedLeadId: null,
                    email: lead?.email || null,
                    status: 'failed',
                    code: String(e?.code || 'EXCEPTION'),
                    error: String(e?.message || e).slice(0, 800),
                });
            }
        }
    }
    if (campaignDirty) {
        const { error: campErr } = await supabase
            .from('campaigns')
            .update({ sent_records: campaignSentRecords, updated_at: new Date().toISOString() })
            .eq('id', campaign.id)
            .eq('organization_id', task.organization_id)
            .eq('user_id', userId);
        if (campErr) {
            const error: any = new Error(`Failed to persist campaign sent_records: ${campErr.message || campErr}`);
            error.code = 'CAMPAIGN_CURSOR_PERSISTENCE_FAILED';
            error.retryable = true;
            throw error;
        }
    }

    const result = {
        contactedCount,
        failedCount: leadResults.filter((item) => item.status === 'failed').length,
        skippedCount: leadResults.filter((item) => item.status === 'skipped').length,
        replayedCount: leadResults.filter((item) => item.status === 'replayed').length,
        totalCount: leadList.length,
        leads: leadResults,
    };

    if (result.failedCount > 0) {
        const error: any = new Error(`CONTACT_CAMPAIGN failed for ${result.failedCount}/${result.totalCount} lead(s)`);
        error.code = 'CONTACT_CAMPAIGN_PARTIAL_FAILURE';
        error.result = result;
        throw error;
    }

    if (deferredRetryTimes.length > 0) {
        return {
            ...result,
            skipped: true,
            reason: 'campaign_step_not_due',
            retryAt: deferredRetryTimes.sort()[0],
            campaignId: campaign.id,
        };
    }

    return result;
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
            console.error(`[Worker] Task ${task.id} (${task.type}) timed out`);
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

async function processTask(task: any, supabase: SupabaseClient): Promise<any> {
    console.log(`[Worker] Processing task ${task.id} (${task.type})`);
    const taskActorId = String(task.user_id || task.payload?.userId || '').trim() || null;
    const taskEventBase = {
        organization_id: task.organization_id || null,
        organization_ref: task.organization_id || null,
        actor_id: taskActorId,
        actor_type: 'worker',
        entity_type: 'task',
        entity_id: String(task.id),
        task_id: String(task.id),
        mission_id: task.mission_id ? String(task.mission_id) : null,
        source_system: 'firebase-antonia-worker',
        source_route: 'processTask',
        operation_id: String(task.id),
        metrics: { taskType: String(task.type || '') },
    };
    await safeAppendWorkerLedgerEvent(supabase, {
        ...taskEventBase,
        event_key: `worker:task:${task.id}:started:${String(task.updated_at || task.created_at || 'initial')}`,
        event_type: 'task.started',
        occurred_at: new Date().toISOString(),
        status: 'processing',
        outcome: 'claimed',
        redacted_payload: {},
    });

    // Note: Status already set to 'processing' by optimistic lock in antoniaTick
    // This update is redundant but kept for backwards compatibility if processTask is called directly
    // (which should not happen in normal operation)
    // await supabase.from('antonia_tasks').update({
    //     status: 'processing',
    //     processing_started_at: new Date().toISOString()
    // }).eq('id', task.id);

    try {
        const missionStatus = await getMissionStatus(supabase, task.mission_id);
        if (missionStatus && missionStatus !== 'active' && shouldRespectPausedMission(task.type)) {
            return {
                skipped: true,
                reason: missionStatus === 'paused' ? 'mission_paused' : 'mission_not_active',
                missionStatus,
                taskType: task.type,
            };
        }

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

        const isScheduledDeferral =
            Boolean((result as any)?.skipped) &&
            ['daily_limit_reached', 'campaign_step_not_due'].includes(String((result as any)?.reason || '')) &&
            typeof (result as any)?.retryAt === 'string' &&
            String((result as any)?.retryAt || '').trim().length > 0;

        if (isScheduledDeferral) {
            const retryAt = String((result as any).retryAt);
            await supabase.from('antonia_tasks').update({
                status: 'pending',
                scheduled_for: retryAt,
                processing_started_at: null,
                payload: task.payload,
                result: result,
                error_message: null,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `Task ${task.type} deferred until ${retryAt}: ${(result as any).reason}.`,
                details: result
            });

            await safeAppendWorkerLedgerEvent(supabase, {
                ...taskEventBase,
                event_key: `worker:task:${task.id}:deferred:${retryAt}`,
                event_type: 'task.deferred',
                occurred_at: new Date().toISOString(),
                status: 'pending',
                outcome: String((result as any).reason || 'scheduled_deferral'),
                redacted_payload: { retryAt },
            });

            return result;
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

        await safeAppendWorkerLedgerEvent(supabase, {
            ...taskEventBase,
            event_key: `worker:task:${task.id}:completed:${new Date().toISOString()}`,
            event_type: 'task.completed',
            occurred_at: new Date().toISOString(),
            status: 'completed',
            outcome: (result as any)?.skipped ? String((result as any).reason || 'skipped') : 'completed',
            redacted_payload: redactWorkerLedgerValue({
                skipped: Boolean((result as any)?.skipped),
                reason: (result as any)?.reason || null,
            }) as Record<string, unknown>,
        });

        return result;

    } catch (e: any) {
        console.error(`[Worker] Task ${task.id} Failed`, e.stack || e);

        // Determine if error is retryable
        const retryableErrors = [
            'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED',
            '429', '503', '502', '504',
            'timeout', 'network', 'fetch failed'
        ];

        const isRetryable = e?.retryable === true || retryableErrors.some(pattern =>
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
                result: e?.result || null,
                error_message: `Retry ${retryCount + 1}/${maxRetries}: ${e.message}`,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'warning',
                message: `Task ${task.type} will retry (${retryCount + 1}/${maxRetries}): ${e.message}`
            });

            await safeAppendWorkerLedgerEvent(supabase, {
                ...taskEventBase,
                event_key: `worker:task:${task.id}:retry:${retryCount + 1}:${scheduledFor}`,
                event_type: 'task.retry_scheduled',
                occurred_at: new Date().toISOString(),
                status: 'pending',
                outcome: 'retry_scheduled',
                error_code: e?.code || null,
                message: String(e?.message || 'retryable_task_error').slice(0, 500),
                metrics: { ...taskEventBase.metrics, retryCount: retryCount + 1, maxRetries, scheduledFor },
                redacted_payload: {},
            });
        } else {
            // Permanent failure
            const failureReason = isRetryable
                ? `Max retries (${maxRetries}) exceeded`
                : 'Non-retryable error';

            await supabase.from('antonia_tasks').update({
                status: 'failed',
                result: e?.result || null,
                error_message: `${failureReason}: ${e.message}`,
                updated_at: new Date().toISOString()
            }).eq('id', task.id);

            await supabase.from('antonia_logs').insert({
                mission_id: task.mission_id,
                organization_id: task.organization_id,
                level: 'error',
                message: `Task ${task.type} failed permanently: ${e.message}`
            });

            await safeAppendWorkerLedgerEvent(supabase, {
                ...taskEventBase,
                event_key: `worker:task:${task.id}:failed:${new Date().toISOString()}`,
                event_type: 'task.failed',
                occurred_at: new Date().toISOString(),
                status: 'failed',
                outcome: isRetryable ? 'max_retries_exceeded' : 'non_retryable_error',
                severity: 'error',
                error_code: e?.code || null,
                message: String(e?.message || 'task_failed').slice(0, 500),
                metrics: { ...taskEventBase.metrics, retryCount, maxRetries },
                redacted_payload: {},
            });
        }

        throw e;
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
        const results = await Promise.allSettled(tasks.map((t: any) => processTaskWithTimeout(t, supabase)));
        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length > 0) {
            console.error(`[AntoniaTick] ${failed.length}/${tasks.length} tasks failed during this tick`);
        }
    }

    // --- 2. SCAN FOR EVALUATION (The Heartbeat) ---
    const checkTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: pendingLeads } = await supabase
        .from('contacted_leads')
        .select(`
                id,
                lead_id, 
                user_id,
                organization_id, 
                mission_id,
                campaign_id,
                data,
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
                .select('id, user_id, organization_id, params')
                .eq('id', missionId)
                .maybeSingle();

            if (!mission) continue;

            const leadsForMission = rows
                .map((pl: any) => pl.leads ? {
                    ...pl.leads,
                    contactedLeadId: pl.id,
                    campaignId: pl.campaign_id || pl.data?.campaign_id || pl.data?.campaignId || null,
                } : null)
                .filter(Boolean);
            if (leadsForMission.length === 0) continue;

            const campaignIds: string[] = [...new Set<string>(rows
                .map((row: any) => String(row.campaign_id || row.data?.campaign_id || row.data?.campaignId || '').trim())
                .filter(Boolean))];

            let campaign: any = null;
            if (campaignIds.length === 1) {
                campaign = await resolveCampaign(supabase, {
                    organizationId: mission.organization_id || rows[0].organization_id,
                    userId: mission.user_id,
                    missionId: mission.id,
                    campaignId: campaignIds[0] || mission.params?.campaignId || mission.params?.campaign_id,
                });
            } else if (campaignIds.length === 0) {
                campaign = await resolveCampaign(supabase, {
                    organizationId: mission.organization_id || rows[0].organization_id,
                    userId: mission.user_id,
                    missionId: mission.id,
                    campaignId: mission.params?.campaignId || mission.params?.campaign_id,
                    campaignName: mission.params?.campaignName || mission.params?.campaign_name,
                });
            }

            await supabase.from('antonia_tasks').insert({
                mission_id: mission.id,
                organization_id: mission.organization_id || rows[0].organization_id,
                type: 'EVALUATE',
                status: 'pending',
                payload: {
                    leads: leadsForMission,
                    userId: mission.user_id,
                    campaignId: campaign?.id || mission.params?.campaignId || mission.params?.campaign_id || null,
                    campaignName: campaign?.name || mission.params?.campaignName || mission.params?.campaign_name || null,
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

function nativeResearchSchedulerEnabled() {
    return String(process.env.NATIVE_RESEARCH_SCHEDULER_ENABLED || 'false').toLowerCase() === 'true';
}

function hasManualTickAuthorization(req: any, expectedSecret: string) {
    if (!expectedSecret) return false;
    const headerSecret = String(req.get('x-manual-trigger-secret') || '').trim();
    return headerSecret === expectedSecret;
}

type FirebaseSchedulerBridgeTarget = {
    name: string;
    path: string;
    method: 'GET' | 'POST';
};

async function invokeFirebaseSchedulerBridge(target: FirebaseSchedulerBridgeTarget) {
    const appUrl = getAppUrl().replace(/\/$/, '');
    const secret = String(process.env.FIREBASE_SCHEDULER_SECRET || '').trim();
    if (!appUrl || !secret) {
        throw new Error(`${target.name} scheduler requires APP_URL and FIREBASE_SCHEDULER_SECRET.`);
    }

    const response = await fetch(`${appUrl}${target.path}`, {
        method: target.method,
        headers: {
            Accept: 'application/json',
            'x-firebase-scheduler-secret': secret,
            'x-scheduler-owner': 'firebase-functions',
            'x-request-id': `firebase-scheduler:${target.name}:${randomUUID()}`,
        },
    });
    await response.text().catch(() => '');

    if (!response.ok) {
        throw new Error(`${target.name} scheduler bridge returned ${response.status}.`);
    }

    console.log(`[FirebaseScheduler] ${target.name} completed with ${response.status}.`);
}

async function runNativeResearchTick() {
    if (!nativeResearchSchedulerEnabled()) {
        console.log('[NativeResearchTick] Scheduler disabled.');
        return { skipped: true };
    }

    const appUrl = getAppUrl().replace(/\/$/, '');
    const secret = String(process.env.LEAD_RESEARCH_WORKER_SECRET || '').trim();
    if (!appUrl || !secret) {
        throw new Error('Native research scheduler requires APP_URL and LEAD_RESEARCH_WORKER_SECRET.');
    }

    const limit = Math.max(1, Math.min(25, Math.trunc(Number(process.env.NATIVE_RESEARCH_SCHEDULER_LIMIT || 5))));
    const response = await fetch(`${appUrl}/api/cron/native-research?limit=${limit}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'x-lead-research-worker-secret': secret,
        },
    });
    const body = await response.text();
    let payload: any = null;
    try {
        payload = body ? JSON.parse(body) : null;
    } catch {
        payload = { raw: body.slice(0, 500) };
    }
    if (!response.ok) {
        throw new Error(`Native research scheduler returned ${response.status}: ${payload?.error || payload?.message || 'unknown error'}`);
    }
    console.log('[NativeResearchTick] Processed native research queue.', payload);
    return payload;
}

export const nativeResearchTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['LEAD_RESEARCH_WORKER_SECRET'],
}, async () => {
    await runNativeResearchTick();
});

// Manual use is IAM-restricted before it reaches this defense-in-depth secret check.
export const nativeResearchTickHttp = functions.https.onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    invoker: 'private',
    secrets: ['NATIVE_RESEARCH_MANUAL_TICK_SECRET', 'LEAD_RESEARCH_WORKER_SECRET'],
} as any, async (req: any, res: any) => {
    try {
        const secret = String(process.env.NATIVE_RESEARCH_MANUAL_TICK_SECRET || '').trim();

        if (!hasManualTickAuthorization(req, secret)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const result = await runNativeResearchTick();
        res.status(200).json({ ok: true, manual: true, schedulerOwner: 'firebase-functions', ...result });
    } catch (e: any) {
        console.error('[nativeResearchTickHttp] error', e);
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

// Main scheduler function
export const antoniaTick = functions.scheduler.onSchedule({
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'INTERNAL_API_SECRET', 'ENRICHMENT_SERVICE_SECRET']
}, async () => {
    await runAntoniaTick();
});

// These schedules are the only production owners of their respective Next.js bridges.
export const campaignProcessingTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    const results = await Promise.allSettled([
        invokeFirebaseSchedulerBridge({
            name: 'campaign-processing',
            path: '/api/cron/process-campaigns?dryRun=true',
            method: 'GET',
        }),
        invokeFirebaseSchedulerBridge({
            name: 'campaign-v2-due-state',
            path: '/api/cron/campaigns-v2',
            method: 'POST',
        }),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
        throw new Error(`Campaign scheduler bridge failures: ${failures.map((failure) => String(failure.reason)).join('; ')}`);
    }
});

export const outboundReconciliationTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'outbound-reconciliation',
        path: '/api/cron/outbound-reconciliation',
        method: 'POST',
    });
});

export const apolloReconciliationTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'apollo-reconciliation',
        path: '/api/cron/apollo-reconciliation',
        method: 'POST',
    });
});

export const apolloUsageTick = functions.scheduler.onSchedule({
    schedule: 'every 1 hours',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'apollo-usage',
        path: '/api/cron/apollo-usage',
        method: 'POST',
    });
});

export const replySyncTick = functions.scheduler.onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'reply-sync',
        path: '/api/cron/reply-sync',
        method: 'POST',
    });
});

export const privacyRetentionTick = functions.scheduler.onSchedule({
    schedule: '30 3 * * *',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'privacy-retention',
        path: '/api/cron/privacy-retention',
        method: 'POST',
    });
});

export const antoniaRollupsTick = functions.scheduler.onSchedule({
    schedule: '10 0 * * *',
    timeZone: 'Etc/UTC',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: ['FIREBASE_SCHEDULER_SECRET'],
}, async () => {
    await invokeFirebaseSchedulerBridge({
        name: 'antonia-rollups',
        path: '/api/cron/antonia-rollups',
        method: 'POST',
    });
});

// Manual use is IAM-restricted before it reaches this defense-in-depth secret check.
export const antoniaTickHttp = functions.https.onRequest({
    timeoutSeconds: 540,
    memory: '1GiB',
    invoker: 'private',
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTONIA_MANUAL_TICK_SECRET', 'INTERNAL_API_SECRET', 'ENRICHMENT_SERVICE_SECRET']
} as any, async (req: any, res: any) => {
    try {
        const secret = String(process.env.ANTONIA_MANUAL_TICK_SECRET || '').trim();

        if (!hasManualTickAuthorization(req, secret)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        await runAntoniaTick();
        res.status(200).json({ ok: true, manual: true, schedulerOwner: 'firebase-functions' });
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
