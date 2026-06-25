import type { AuthContext } from '@/lib/server/auth-utils';
import { generateCampaignFlow } from '@/ai/flows/generate-campaign';
import { assessCampaignQa } from '@/lib/campaign-qa';
import { cleanDomain, getContactabilityCopy, normalizeEmail, type ContactabilityStatus } from '@/lib/commercial-intelligence';
import { enrichPersonWithPDL, pickPdlEmail } from '@/lib/providers/pdl';
import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { buildSupliaContext } from '@/lib/server/suplia-context';
import { sendSupliaEmail } from '@/lib/server/suplia-email';
import { getSupliaPolicy, type SupliaPolicy } from '@/lib/server/suplia-policy';
import { searchProspectingCompanies, searchProspectingPeople, type SupliaProspectingProvider } from '@/lib/server/suplia-prospecting';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { syncRepliesForOrganization } from '@/lib/server/reply-sync';
import { draftAutonomousReply } from '@/lib/server/antonia-reply-drafting';
import {
  buildGmailContactArtifactContent,
  fetchGmailMailboxMessage,
  fetchGmailMailboxThread,
  findGmailContactedLeads,
  getGmailMailboxAccessToken,
  getGmailMailboxProfile,
  matchGmailMailboxContactsInput,
  searchGmailMailboxMessages,
  searchGmailMailboxThreads,
  summarizeGmailMailboxResultsInput,
} from '@/lib/server/gmail-mailbox';

export type SupliaToolContext = {
  auth: AuthContext;
  conversationId: string;
  jobId?: string | null;
  stepId?: string | null;
  agentRunId?: string | null;
  messageId?: string | null;
  pendingActionId?: string | null;
  reportProgress?: (progress: { current: number; total?: number; label?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  assertRunnable?: () => Promise<void>;
  heartbeat?: () => Promise<void>;
};

export type SupliaToolHandler = (input: Record<string, unknown>, context: SupliaToolContext) => Promise<Record<string, unknown>>;

export type SupliaToolDefinition = {
  name: string;
  description: string;
  inputSchema: string;
  handler: SupliaToolHandler;
};

function asText(value: unknown) {
  return String(value || '').trim();
}

function asLimit(value: unknown, fallback = 10, max = 25) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function ilikePattern(value: unknown) {
  const clean = asText(value).replace(/[%,]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? `%${clean}%` : '';
}

function asList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = asText(value);
  if (!text) return [];
  return text.split(/[;,]/g).map((item) => item.trim()).filter(Boolean);
}

function asProvider(value: unknown): SupliaProspectingProvider | undefined {
  const provider = asText(value).toLowerCase();
  if (provider === 'apollo' || provider === 'pdl') return provider;
  return undefined;
}

function asObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Record<string, any>[] : [];
}

function norm(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textIncludesAny(text: unknown, values: unknown[]) {
  const normalized = norm(text);
  return values.some((value) => {
    const item = norm(value);
    return item && normalized.includes(item);
  });
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getLeadEmail(lead: Record<string, any>) {
  return normalizeEmail(lead.email || lead.workEmail || lead.work_email || lead.recommendedPersonalEmail || lead.recommended_personal_email);
}

function getLeadName(lead: Record<string, any>) {
  return asText(lead.fullName || lead.full_name || lead.name || `${lead.firstName || lead.first_name || ''} ${lead.lastName || lead.last_name || ''}`);
}

function getCompanyDomain(company: Record<string, any>) {
  return cleanDomain(company.primary_domain || company.companyDomain || company.domain || company.website_url || company.website || company.company_website || '');
}

function scoreLabel(score: number) {
  if (score >= 80) return 'strong_fit';
  if (score >= 60) return 'good_fit';
  if (score >= 40) return 'uncertain';
  return 'low_fit';
}

function safeCount(result: { count?: number | null } | null | undefined) {
  return Number(result?.count || 0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function currentHourInTimezone(date: Date, timeZone: string) {
  try {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).formatToParts(date).find((part) => part.type === 'hour')?.value;
    return Number(hour);
  } catch {
    return date.getHours();
  }
}

function getBulkSendConfig() {
  return {
    maxBatchSize: envInt('SUPLIA_BULK_SEND_MAX_BATCH_SIZE', 10, 1, 50),
    perMessageDelayMs: envInt('SUPLIA_BULK_SEND_DELAY_MS', 750, 0, 10000),
    windowStartHour: envInt('SUPLIA_SEND_WINDOW_START_HOUR', 8, 0, 23),
    windowEndHour: envInt('SUPLIA_SEND_WINDOW_END_HOUR', 18, 0, 23),
    timeZone: asText(process.env.SUPLIA_SEND_WINDOW_TIMEZONE) || 'UTC',
  };
}

function isWithinBulkSendWindow(date = new Date(), config = getBulkSendConfig()) {
  const hour = currentHourInTimezone(date, config.timeZone);
  if (!Number.isFinite(hour)) return true;
  if (config.windowStartHour === config.windowEndHour) return true;
  if (config.windowStartHour < config.windowEndHour) return hour >= config.windowStartHour && hour < config.windowEndHour;
  return hour >= config.windowStartHour || hour < config.windowEndHour;
}

function contactabilityResult(status: ContactabilityStatus, reasons: string[]) {
  return { status, reasons, ...getContactabilityCopy(status) };
}

async function getAppContext(_input: Record<string, unknown>, context: SupliaToolContext) {
  return { context: await buildSupliaContext(context.auth) };
}

async function getCompanyProfile(_input: Record<string, unknown>, context: SupliaToolContext) {
  const appContext = await buildSupliaContext(context.auth);
  return { profile: appContext.profile };
}

async function searchCrm(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit);
  const search = ilikePattern(input.query || input.search);
  const company = ilikePattern(input.company);
  const status = asText(input.status);

  let query = admin
    .from('leads')
    .select('id, name, title, company, email, status, industry, location, country, city, created_at')
    .eq('organization_id', context.auth.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (company) query = query.ilike('company', company);
  if (search) query = query.or(`name.ilike.${search},company.ilike.${search},email.ilike.${search},title.ilike.${search}`);

  const { data, error } = await query;
  if (error) throw error;

  return { items: data || [], count: (data || []).length };
}

async function getLeadDetail(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const leadId = asText(input.leadId || input.id);
  const email = normalizeEmail(asText(input.email));

  if (!leadId && !email) throw new Error('Falta leadId o email para leer el detalle del lead.');

  let query = admin
    .from('leads')
    .select('id, name, title, company, email, status, industry, company_website, company_linkedin, linkedin_url, location, country, city, created_at')
    .eq('organization_id', context.auth.organizationId)
    .limit(1);

  query = leadId ? query.eq('id', leadId) : query.ilike('email', email);

  const { data: lead, error } = await query.maybeSingle();
  if (error) throw error;
  if (!lead) return { lead: null, contacted: [] };

  let contactedQuery = admin
    .from('contacted_leads')
    .select('id, lead_id, name, email, company, role, status, provider, subject, sent_at, replied_at, opened_at, clicked_at, bounced_at, reply_summary, reply_intent, evaluation_status')
    .eq('organization_id', context.auth.organizationId)
    .order('sent_at', { ascending: false })
    .limit(10);

  contactedQuery = lead.email ? contactedQuery.or(`lead_id.eq.${lead.id},email.ilike.${lead.email}`) : contactedQuery.eq('lead_id', lead.id);
  const { data: contacted, error: contactedError } = await contactedQuery;
  if (contactedError) throw contactedError;

  return { lead, contacted: contacted || [] };
}

async function searchContacted(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit);
  const search = ilikePattern(input.query || input.search);
  const company = ilikePattern(input.company);
  const email = normalizeEmail(asText(input.email));
  const status = asText(input.status);

  let query = admin
    .from('contacted_leads')
    .select('id, lead_id, name, email, company, role, status, provider, subject, sent_at, replied_at, opened_at, clicked_at, bounced_at, evaluation_status, campaign_followup_allowed, campaign_followup_reason, reply_summary, reply_intent')
    .eq('organization_id', context.auth.organizationId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (email) query = query.ilike('email', email);
  if (company) query = query.ilike('company', company);
  if (search) query = query.or(`name.ilike.${search},email.ilike.${search},company.ilike.${search},subject.ilike.${search}`);

  const { data, error } = await query;
  if (error) throw error;

  return { items: data || [], count: (data || []).length };
}

async function getContactedTimeline(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const leadId = asText(input.leadId);
  const email = normalizeEmail(asText(input.email));
  const limit = asLimit(input.limit, 15, 50);

  if (!leadId && !email) throw new Error('Falta leadId o email para leer el timeline.');

  let contactedQuery = admin
    .from('contacted_leads')
    .select('id, lead_id, name, email, company, role, status, provider, subject, sent_at, opened_at, clicked_at, click_count, replied_at, reply_preview, reply_summary, reply_intent, bounced_at, bounce_category, bounce_reason, delivery_status, evaluation_status, campaign_followup_allowed, campaign_followup_reason')
    .eq('organization_id', context.auth.organizationId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  contactedQuery = leadId && email
    ? contactedQuery.or(`lead_id.eq.${leadId},email.ilike.${email}`)
    : leadId
      ? contactedQuery.eq('lead_id', leadId)
      : contactedQuery.ilike('email', email);

  const { data: contacted, error } = await contactedQuery;
  if (error) throw error;

  const contactedIds = (contacted || []).map((row: any) => row.id).filter(Boolean);
  if (contactedIds.length === 0) return { contacted: [], emailEvents: [] };

  const { data: emailEvents, error: eventsError } = await admin
    .from('email_events')
    .select('id, contacted_id, event_type, event_at, provider, meta')
    .in('contacted_id', contactedIds)
    .order('event_at', { ascending: false })
    .limit(100);
  if (eventsError) throw eventsError;

  return { contacted: contacted || [], emailEvents: emailEvents || [] };
}

async function listCampaigns(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit, 10, 20);
  const status = asText(input.status);

  let query = admin
    .from('campaigns')
    .select('id, name, status, steps, created_at')
    .eq('organization_id', context.auth.organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  return { items: data || [], count: (data || []).length };
}

async function listAntoniaMissions(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit, 8, 20);
  const status = asText(input.status);

  let query = admin
    .from('antonia_missions')
    .select('id, title, status, goal_summary, daily_search_limit, daily_enrich_limit, daily_investigate_limit, daily_contact_limit, created_at, updated_at')
    .eq('organization_id', context.auth.organizationId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;

  return { items: data || [], count: (data || []).length };
}

async function listAntoniaExceptions(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit, 10, 25);
  const status = asText(input.status) || 'open';

  const { data, error } = await admin
    .from('antonia_exceptions')
    .select('id, mission_id, task_id, lead_id, category, severity, status, title, description, payload, created_at, updated_at')
    .eq('organization_id', context.auth.organizationId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return { items: data || [], count: (data || []).length };
}

async function getMetricsOverview(_input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const organizationId = context.auth.organizationId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [leadsRes, contactedRes, contactedWeekRes, repliesWeekRes, campaignsRes, missionsRes, exceptionsRes] = await Promise.all([
    admin.from('leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('sent_at', since),
    admin.from('contacted_leads').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('replied_at', since),
    admin.from('campaigns').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId),
    admin.from('antonia_missions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'active'),
    admin.from('antonia_exceptions').select('*', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('status', 'open'),
  ]);

  const firstError = [leadsRes, contactedRes, contactedWeekRes, repliesWeekRes, campaignsRes, missionsRes, exceptionsRes].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  return {
    windowDays: 7,
    counts: {
      leads: safeCount(leadsRes),
      contacted: safeCount(contactedRes),
      contactedLast7Days: safeCount(contactedWeekRes),
      repliesLast7Days: safeCount(repliesWeekRes),
      campaigns: safeCount(campaignsRes),
      activeMissions: safeCount(missionsRes),
      openExceptions: safeCount(exceptionsRes),
    },
  };
}

async function checkContactability(input: Record<string, unknown>, context: SupliaToolContext) {
  const email = normalizeEmail(asText(input.email));
  if (!email || !email.includes('@')) return contactabilityResult('missing_email', ['missing_email']);

  const reasons: string[] = [];
  const admin = getSupabaseAdminClient();
  const domain = cleanDomain(email.split('@')[1] || '');

  const suppressed = await isEmailSuppressedForScope(email, {
    userId: context.auth.user.id,
    organizationId: context.auth.organizationId,
  });
  if (suppressed) reasons.push('unsubscribe_or_privacy_block');

  if (domain) {
    const { data: blockedDomain, error } = await admin
      .from('excluded_domains')
      .select('id')
      .eq('organization_id', context.auth.organizationId)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw error;
    if (blockedDomain?.id) reasons.push('blocked_domain');
  }

  const { data: latestContact, error: latestError } = await admin
    .from('contacted_leads')
    .select('id, delivery_status, evaluation_status, campaign_followup_allowed, campaign_followup_reason, bounced_at, replied_at, reply_intent')
    .eq('organization_id', context.auth.organizationId)
    .ilike('email', email)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  if (latestContact?.evaluation_status === 'do_not_contact' || latestContact?.campaign_followup_allowed === false) {
    reasons.push('do_not_contact');
  }
  if (latestContact?.bounced_at || String(latestContact?.delivery_status || '').includes('bounce')) reasons.push('recent_bounce');
  if (latestContact?.reply_intent === 'unsubscribe') reasons.push('unsubscribe_reply');

  if (reasons.some((reason) => ['unsubscribe_or_privacy_block', 'blocked_domain', 'do_not_contact', 'unsubscribe_reply'].includes(reason))) {
    return contactabilityResult('blocked', reasons);
  }

  if (reasons.length > 0) return contactabilityResult('warning', reasons);
  return contactabilityResult('ok', []);
}

async function suggestSegments(input: Record<string, unknown>, context: SupliaToolContext) {
  const goal = asText(input.goal || input.objective || input.query);
  const industry = asText(input.industry || input.market) || goal || 'mercado objetivo';
  const locations = asList(input.locations || input.geographies || input.countries);
  const appContext = await buildSupliaContext(context.auth);

  const segments = [
    {
      name: industry,
      industries: [industry],
      companySizes: ['10-200 empleados', '200-1000 empleados'],
      geographies: locations.length > 0 ? locations : ['Geografia principal del usuario'],
      buyingSignals: ['Crecimiento operativo', 'Proceso manual visible', 'Necesidad de eficiencia comercial'],
      decisionRoles: ['CEO', 'Founder', 'COO', 'Head of Operations', 'Commercial Director'],
      influencerRoles: ['Operations Manager', 'Sales Manager', 'Project Manager'],
      exclusions: ['Dominios bloqueados', 'Unsubscribes', 'Contactados recientemente'],
    },
  ];

  return {
    goal,
    segments,
    contextCounts: appContext.counts,
    note: 'Segmentos sugeridos internamente. No se consumieron creditos externos.',
  };
}

async function buildSearchPlan(input: Record<string, unknown>) {
  const goal = asText(input.goal || input.objective || input.query);
  const segments = Array.isArray(input.segments) ? input.segments as any[] : [];
  const firstSegment = segments[0] || {};
  const companyQueries = asList(input.companyQueries || input.companyQuery || firstSegment.name || goal || 'empresas objetivo').slice(0, 5);
  const peopleTitles = asList(input.peopleTitles || input.roles || firstSegment.decisionRoles || ['CEO', 'Founder', 'COO', 'Head of Operations', 'Commercial Director']).slice(0, 12);
  const locations = asList(input.locations || input.geographies || firstSegment.geographies).slice(0, 8);
  const maxCompanies = asLimit(input.maxCompanies || input.perPage, 8, 25);
  const maxPeoplePerCompany = asLimit(input.maxPeoplePerCompany, 3, 10);

  return {
    provider: asProvider(input.provider) || 'apollo',
    companyQueries,
    peopleTitles,
    locations,
    maxCompanies,
    maxPeoplePerCompany,
    estimatedCreditUse: {
      companySearches: companyQueries.length || 1,
      peopleSearchPages: Math.max(1, Math.ceil((maxCompanies * maxPeoplePerCompany) / 25)),
    },
    approvalRequiredBeforeExternalSearch: true,
    note: 'Search plan creado sin llamar Apollo ni PDL.',
  };
}

async function dedupeAgainstCrm(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const companies = asObjectArray(input.companies || input.candidates);
  const leads = asObjectArray(input.leads || input.people || input.contacts);
  const emails = Array.from(new Set(leads.map(getLeadEmail).filter(Boolean)));
  const domains = Array.from(new Set([
    ...companies.map(getCompanyDomain),
    ...leads.map((lead) => cleanDomain(lead.companyDomain || lead.company_domain || lead.companyWebsite || lead.company_website || '')),
  ].filter(Boolean)));
  const companyNames = Array.from(new Set([
    ...companies.map((company) => asText(company.name || company.companyName)),
    ...leads.map((lead) => asText(lead.companyName || lead.company || lead.organization_name)),
  ].filter(Boolean)));

  const [crmByEmail, contactedByEmail, crmByCompany, contactedByCompany] = await Promise.all([
    emails.length > 0
      ? admin.from('leads').select('id, email, company, company_website').eq('organization_id', context.auth.organizationId).in('email', emails)
      : Promise.resolve({ data: [], error: null } as any),
    emails.length > 0
      ? admin.from('contacted_leads').select('id, email, company, sent_at, status').eq('organization_id', context.auth.organizationId).in('email', emails)
      : Promise.resolve({ data: [], error: null } as any),
    companyNames.length > 0
      ? admin.from('leads').select('id, email, company, company_website').eq('organization_id', context.auth.organizationId).in('company', companyNames.slice(0, 100))
      : Promise.resolve({ data: [], error: null } as any),
    companyNames.length > 0
      ? admin.from('contacted_leads').select('id, email, company, sent_at, status').eq('organization_id', context.auth.organizationId).in('company', companyNames.slice(0, 100))
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const firstError = [crmByEmail, contactedByEmail, crmByCompany, contactedByCompany].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  const existingEmails = new Set([...(crmByEmail.data || []), ...(contactedByEmail.data || [])].map((row: any) => normalizeEmail(row.email)).filter(Boolean));
  const existingCompanies = new Set([...(crmByCompany.data || []), ...(contactedByCompany.data || [])].map((row: any) => norm(row.company)).filter(Boolean));

  const keptCompanies = uniqueBy(companies, (company) => getCompanyDomain(company) || norm(company.name || company.companyName));
  const excludedCompanies: any[] = [];
  const finalCompanies = keptCompanies.filter((company) => {
    const nameKey = norm(company.name || company.companyName);
    const duplicate = nameKey && existingCompanies.has(nameKey);
    if (duplicate) excludedCompanies.push({ item: company, reason: 'already_in_crm_or_contacted' });
    return !duplicate;
  });

  const keptLeads = uniqueBy(leads, (lead) => getLeadEmail(lead) || norm(`${getLeadName(lead)} ${lead.companyName || lead.company}`));
  const excludedLeads: any[] = [];
  const finalLeads = keptLeads.filter((lead) => {
    const email = getLeadEmail(lead);
    const duplicate = email && existingEmails.has(email);
    if (duplicate) excludedLeads.push({ item: lead, reason: 'already_in_crm_or_contacted' });
    return !duplicate;
  });

  return {
    companies: finalCompanies,
    leads: finalLeads,
    excludedCompanies,
    excludedLeads,
    domainsChecked: domains,
    summary: {
      inputCompanies: companies.length,
      keptCompanies: finalCompanies.length,
      inputLeads: leads.length,
      keptLeads: finalLeads.length,
      excluded: excludedCompanies.length + excludedLeads.length,
    },
  };
}

async function createShortlist(input: Record<string, unknown>) {
  const companies = asObjectArray(input.companies || input.candidates).slice(0, asLimit(input.companyLimit, 12, 50));
  const leads = asObjectArray(input.leads || input.people || input.contacts).slice(0, asLimit(input.leadLimit, 25, 100));
  return {
    companies,
    leads,
    title: asText(input.title) || 'Shortlist SUPL.IA',
    summary: {
      companies: companies.length,
      leads: leads.length,
    },
  };
}

async function scoreCompanies(input: Record<string, unknown>, context: SupliaToolContext) {
  const companies = asObjectArray(input.companies || input.candidates);
  const strategy = input.strategy && typeof input.strategy === 'object' ? input.strategy as any : {};
  const segments = Array.isArray(strategy.segments) ? strategy.segments : [];
  const industries = segments.flatMap((segment: any) => Array.isArray(segment.industries) ? segment.industries : []);
  const buyingSignals = segments.flatMap((segment: any) => Array.isArray(segment.buyingSignals) ? segment.buyingSignals : []);

  const scored = companies.map((company) => {
    const name = asText(company.name || company.companyName) || 'Empresa';
    const domain = getCompanyDomain(company);
    const reasons: string[] = [];
    const risks: string[] = [];
    let score = 35;

    if (domain) { score += 15; reasons.push('Dominio identificable.'); }
    if (typeof company.score === 'number' && company.score >= 0.65) { score += 15; reasons.push('Buen match con el criterio de busqueda.'); }
    if (textIncludesAny(`${name} ${company.industry || ''}`, industries)) { score += 18; reasons.push('Coincide con industria/segmento ICP.'); }
    if (textIncludesAny(JSON.stringify(company), buyingSignals)) { score += 10; reasons.push('Tiene senales compatibles con la hipotesis de compra.'); }
    if (!domain) risks.push('Sin dominio claro para buscar decisores.');
    if (String(name).length < 3) risks.push('Nombre de empresa poco confiable.');

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      companyKey: String(company.id || domain || name),
      companyName: name,
      domain,
      score,
      scoreLabel: scoreLabel(score),
      reasons: reasons.length ? reasons : ['Match inicial por criterio de busqueda.'],
      risks,
      matchedSegments: segments.map((segment: any) => segment.name).filter(Boolean).slice(0, 3),
      sourcePayload: company,
    };
  }).sort((a, b) => b.score - a.score);

  if (context.jobId && scored.length > 0) {
    const admin = getSupabaseAdminClient();
    await admin.from('suplia_company_scores').insert(scored.map((item) => ({
      organization_id: context.auth.organizationId,
      job_id: context.jobId,
      company_key: item.companyKey,
      company_name: item.companyName,
      domain: item.domain || null,
      score: item.score,
      score_label: item.scoreLabel,
      reasons: item.reasons,
      risks: item.risks,
      matched_segments: item.matchedSegments,
      source_payload: item.sourcePayload,
    })));
  }

  return { items: scored, count: scored.length, topCompanies: scored.slice(0, asLimit(input.limit, 8, 25)) };
}

async function scorePeople(input: Record<string, unknown>, context: SupliaToolContext) {
  const leads = asObjectArray(input.leads || input.people || input.contacts);
  const strategy = input.strategy && typeof input.strategy === 'object' ? input.strategy as any : {};
  const segments = Array.isArray(strategy.segments) ? strategy.segments : [];
  const decisionRoles = segments.flatMap((segment: any) => Array.isArray(segment.decisionRoles) ? segment.decisionRoles : []);
  const influencerRoles = segments.flatMap((segment: any) => Array.isArray(segment.influencerRoles) ? segment.influencerRoles : []);
  const targetRoles = [...decisionRoles, ...influencerRoles];

  const scored = await Promise.all(leads.map(async (lead) => {
    const email = getLeadEmail(lead);
    const fullName = getLeadName(lead) || 'Contacto';
    const title = asText(lead.title || lead.job_title || lead.role);
    const companyName = asText(lead.companyName || lead.company || lead.organization_name);
    const reasons: string[] = [];
    const risks: string[] = [];
    let score = 30;

    if (email && email.includes('@')) { score += 20; reasons.push('Email disponible.'); }
    else risks.push('Sin email util para contactar.');
    if (lead.lockedEmail) { score -= 12; risks.push('Email bloqueado o no desbloqueado.'); }
    if (textIncludesAny(title, decisionRoles)) { score += 25; reasons.push('Rol decisor compatible con ICP.'); }
    else if (textIncludesAny(title, influencerRoles)) { score += 14; reasons.push('Rol influenciador compatible con ICP.'); }
    else if (textIncludesAny(title, targetRoles)) { score += 10; reasons.push('Rol relacionado con el ICP.'); }
    if (companyName) { score += 8; reasons.push('Empresa identificable.'); }
    if (lead.linkedinUrl || lead.linkedin_url) score += 5;

    let contactability: any = null;
    if (email) {
      contactability = await checkContactability({ email }, context);
      if (contactability.status === 'blocked') { score = Math.min(score, 20); risks.push('Bloqueado por privacidad/contactabilidad.'); }
      if (contactability.status === 'warning') { score -= 8; risks.push('Tiene warning de contactabilidad.'); }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      leadKey: String(lead.id || email || `${fullName}-${companyName}`),
      leadId: asText(lead.leadId || lead.lead_id) || null,
      email,
      fullName,
      title,
      companyName,
      score,
      scoreLabel: scoreLabel(score),
      reasons: reasons.length ? reasons : ['Lead compatible con la busqueda inicial.'],
      risks,
      recommendedAction: score >= 60 && email ? 'approve_for_enrichment_or_preview' : 'review_before_using',
      contactability,
      sourcePayload: lead,
    };
  }));

  const sorted = scored.sort((a, b) => b.score - a.score);
  if (context.jobId && sorted.length > 0) {
    const admin = getSupabaseAdminClient();
    await admin.from('suplia_lead_scores').insert(sorted.map((item) => ({
      organization_id: context.auth.organizationId,
      job_id: context.jobId,
      lead_key: item.leadKey,
      lead_id: item.leadId || null,
      email: item.email || null,
      full_name: item.fullName,
      company_name: item.companyName || null,
      score: item.score,
      score_label: item.scoreLabel,
      reasons: item.reasons,
      risks: item.risks,
      recommended_action: item.recommendedAction,
      source_payload: item.sourcePayload,
    })));
  }

  return { items: sorted, count: sorted.length, topLeads: sorted.slice(0, asLimit(input.limit, 12, 50)) };
}

async function enrichLead(input: Record<string, unknown>, context: SupliaToolContext) {
  const result = await enrichLeadBatch({ leads: [input], provider: input.provider }, context);
  return { lead: (result.items as any[])?.[0] || null, summary: result.summary };
}

async function enrichLeadBatch(input: Record<string, unknown>, context: SupliaToolContext) {
  const leads = asObjectArray(input.leads || input.items).slice(0, asLimit(input.limit, 10, 25));
  if (leads.length === 0) throw new Error('Faltan leads para enriquecer.');

  const limits = await getEffectiveDailyQuotaLimits({ userId: context.auth.user.id, organizationId: context.auth.organizationId });
  const quota = await checkAndConsumeDailyQuota({
    userId: context.auth.user.id,
    organizationId: context.auth.organizationId,
    resource: 'enrich',
    limit: limits.enrich,
    count: leads.length,
  });
  if (!quota.allowed) throw new Error(`Cuota diaria de enrichment agotada (${quota.count}/${quota.limit}).`);

  const items: any[] = [];
  await context.reportProgress?.({ current: 0, total: leads.length, label: 'Enrichment iniciado' });
  for (const lead of leads) {
    await context.assertRunnable?.();
    try {
      const provider = asProvider(input.provider) || 'pdl';
      if (provider !== 'pdl') {
        items.push({ ...lead, enrichmentStatus: 'skipped', reason: 'apollo_enrichment_not_available_in_suplia_yet' });
        continue;
      }
      const enriched = await enrichPersonWithPDL({
        linkedinUrl: asText(lead.linkedinUrl || lead.linkedin_url),
        email: getLeadEmail(lead),
        fullName: getLeadName(lead),
        companyName: asText(lead.companyName || lead.company),
        companyDomain: cleanDomain(lead.companyDomain || lead.company_domain || ''),
        location: asText(lead.location),
        dataInclude: ['id', 'full_name', 'job_title', 'linkedin_url', 'work_email', 'recommended_personal_email', 'job_company_name', 'job_company_website', 'location_name'],
      });
      const person = enriched.person || {};
      items.push({
        ...lead,
        enrichmentStatus: enriched.matched ? 'completed' : 'not_found',
        providerUsed: 'pdl',
        email: pickPdlEmail(person) || getLeadEmail(lead) || undefined,
        fullName: person.full_name || getLeadName(lead),
        title: person.job_title || lead.title,
        linkedinUrl: person.linkedin_url || lead.linkedinUrl || lead.linkedin_url,
        companyName: person.job_company_name || lead.companyName || lead.company,
        companyDomain: cleanDomain(person.job_company_website || lead.companyDomain || lead.company_domain || '') || undefined,
        location: person.location_name || lead.location,
        raw: enriched.raw,
      });
    } catch (error: any) {
      items.push({ ...lead, enrichmentStatus: 'failed', error: error?.message || 'enrichment_failed' });
    }
    await context.reportProgress?.({ current: items.length, total: leads.length, label: `Enrichment ${items.length}/${leads.length}` });
    await context.heartbeat?.();
  }

  return {
    items,
    summary: {
      requested: leads.length,
      completed: items.filter((item) => item.enrichmentStatus === 'completed').length,
      failed: items.filter((item) => item.enrichmentStatus === 'failed').length,
      notFound: items.filter((item) => item.enrichmentStatus === 'not_found').length,
      quota,
    },
  };
}

async function personalizeForLead(input: Record<string, unknown>, context: SupliaToolContext) {
  const lead = input.lead && typeof input.lead === 'object' ? input.lead as any : input;
  const profile = (await buildSupliaContext(context.auth)).profile || {};
  const fullName = getLeadName(lead) || 'ahi';
  const companyName = asText(lead.companyName || lead.company) || 'tu equipo';
  const role = asText(lead.title || lead.role);
  const offer = asText(input.offerSummary || input.offer || profile.company_profile || profile.companyName || profile.company || 'ANTON.IA');
  const cta = asText(input.cta) || 'te parece si lo revisamos 15 minutos esta semana?';
  const subject = asText(input.subject) || `${companyName} y automatizacion comercial`;
  const openingName = fullName.split(' ')[0] || fullName;
  const textBody = [
    `Hola ${openingName},`,
    `Vi que ${companyName}${role ? ` tiene perfiles como ${role}` : ''} y pense que podria ser buen momento para mostrarte ${offer}.`,
    'La idea es ayudar a priorizar oportunidades, preparar mensajes y mantener control humano antes de acciones sensibles.',
    cta.charAt(0).toUpperCase() + cta.slice(1),
  ].join('\n\n');

  return {
    to: getLeadEmail(lead),
    recipientName: fullName,
    company: companyName,
    role,
    subject,
    textBody,
    htmlBody: textBody.split('\n\n').map((paragraph) => `<p>${paragraph}</p>`).join(''),
    sourceLead: lead,
    note: 'Borrador personalizado. No fue enviado.',
  };
}

async function bulkVariantPreview(input: Record<string, unknown>, context: SupliaToolContext) {
  const leads = asObjectArray(input.leads || input.items).slice(0, asLimit(input.limit, 5, 20));
  const previews = [];
  await context.reportProgress?.({ current: 0, total: leads.length, label: 'Generando previews' });
  for (const lead of leads) {
    await context.assertRunnable?.();
    previews.push(await personalizeForLead({ ...input, lead }, context));
    await context.reportProgress?.({ current: previews.length, total: leads.length, label: `Previews ${previews.length}/${leads.length}` });
  }
  return { previews, count: previews.length };
}

async function campaignPreviewForLead(input: Record<string, unknown>, context: SupliaToolContext) {
  const preview = await personalizeForLead(input, context);
  return { previewType: 'lead_email', sampleMessages: [preview], audienceCount: 1, sampleCount: 1 };
}

async function batchContactability(input: Record<string, unknown>, context: SupliaToolContext) {
  const emails = asList(input.emails || asObjectArray(input.leads).map(getLeadEmail)).slice(0, asLimit(input.limit, 50, 100));
  const results = [];
  await context.reportProgress?.({ current: 0, total: emails.length, label: 'Verificando contactabilidad' });
  for (const email of emails) {
    await context.assertRunnable?.();
    results.push({ email, ...(await checkContactability({ email }, context)) });
    await context.reportProgress?.({ current: results.length, total: emails.length, label: `Contactabilidad ${results.length}/${emails.length}` });
  }
  return {
    results,
    summary: {
      total: results.length,
      blocked: results.filter((item: any) => item.status === 'blocked' || item.status === 'missing_email').length,
      warning: results.filter((item: any) => item.status === 'warning').length,
      ok: results.filter((item: any) => item.status === 'ok').length,
    },
  };
}

async function preflightEmail(input: Record<string, unknown>, context: SupliaToolContext) {
  const email = normalizeEmail(asText(input.to || input.email));
  const contactability = email ? await checkContactability({ email }, context) : contactabilityResult('missing_email', ['missing_email']);
  const qa = assessCampaignQa({
    email,
    subject: asText(input.subject),
    body: asText(input.htmlBody || input.textBody || input.body),
    contactability: contactability as any,
    usePixel: input.usePixel !== false,
    useLinkTracking: input.useLinkTracking !== false,
  });
  return { status: qa.status, qa, contactability, blocked: qa.status === 'blocked' };
}

async function preflightCampaign(input: Record<string, unknown>, context: SupliaToolContext) {
  const messages = asObjectArray(input.messages || input.sampleMessages || input.previews).slice(0, asLimit(input.sampleLimit, 10, 25));
  const checks = [];
  await context.reportProgress?.({ current: 0, total: messages.length, label: 'Preflight iniciado' });
  for (const message of messages) {
    await context.assertRunnable?.();
    checks.push(await preflightEmail(message, context));
    await context.reportProgress?.({ current: checks.length, total: messages.length, label: `Preflight ${checks.length}/${messages.length}` });
  }
  const blocked = checks.filter((check: any) => check.status === 'blocked').length;
  const review = checks.filter((check: any) => check.status === 'review').length;
  const result = {
    status: blocked > 0 ? 'blocked' : review > 0 ? 'review' : 'pass',
    sampleCount: messages.length,
    blockedCount: blocked,
    reviewCount: review,
    checks,
  };

  if (context.jobId) {
    await getSupabaseAdminClient().from('suplia_campaign_previews').insert({
      organization_id: context.auth.organizationId,
      job_id: context.jobId,
      preview_type: 'compliance_preflight',
      audience_count: Number(input.audienceCount || messages.length || 0),
      sample_count: messages.length,
      excluded_count: blocked,
      risk_summary: result,
      sample_messages: messages,
      preflight_result: result,
    });
  }

  return result;
}

async function searchCompanies(input: Record<string, unknown>, context: SupliaToolContext) {
  const companyName = asText(input.companyName || input.company || input.query);
  if (!companyName) throw new Error('Falta companyName para buscar empresas.');

  const perPage = asLimit(input.perPage || input.limit, 8, 25);
  const page = asLimit(input.page, 1, 10);
  const result = await searchProspectingCompanies({
    organizationId: context.auth.organizationId,
    companyName,
    perPage,
    page,
    provider: asProvider(input.provider),
  });

  return {
    ...result,
    search: { companyName, perPage, page },
    estimatedCreditUse: {
      provider: result.providerUsed,
      companySearches: 1,
      maxRows: perPage,
    },
  };
}

async function searchPeople(input: Record<string, unknown>, context: SupliaToolContext) {
  const personTitles = asList(input.personTitles || input.titles || input.roles);
  const domains = asList(input.domains || input.companyDomains);
  const companyNames = asList(input.companyNames || input.companies || input.companyName);
  const personLocations = asList(input.personLocations || input.locations);

  if (domains.length === 0 && companyNames.length === 0) {
    throw new Error('Falta al menos un dominio o nombre de empresa para buscar personas.');
  }

  const perPage = asLimit(input.perPage || input.limit, 25, 50);
  const maxPages = asLimit(input.maxPages, 1, 5);
  const result = await searchProspectingPeople({
    organizationId: context.auth.organizationId,
    personTitles,
    domains,
    companyNames,
    personLocations,
    perPage,
    maxPages,
    onlyVerifiedEmails: input.onlyVerifiedEmails !== false,
    similarTitles: input.similarTitles !== false,
    dedupe: ['smart', 'id', 'email', 'none'].includes(asText(input.dedupe)) ? asText(input.dedupe) as any : 'smart',
    includeLockedEmails: input.includeLockedEmails !== false,
    provider: asProvider(input.provider),
  });

  return {
    ...result,
    search: { personTitles, domains, companyNames, personLocations, perPage, maxPages },
    estimatedCreditUse: {
      provider: result.providerUsed,
      peopleSearchPages: maxPages,
      maxRows: perPage * maxPages,
    },
  };
}

async function generateCampaignSequence(input: Record<string, unknown>) {
  const steps = await generateCampaignFlow({
    goal: asText(input.goal),
    companyName: asText(input.companyName),
    targetAudience: asText(input.targetAudience || input.audience),
    language: asText(input.language) || 'es',
    campaignType: asText(input.campaignType) === 'reconnection' ? 'reconnection' : 'standard',
    offerName: asText(input.offerName),
    offerSummary: asText(input.offerSummary),
    offerBenefits: asList(input.offerBenefits),
    cta: asText(input.cta),
    tone: asText(input.tone),
    jobTitle: asText(input.jobTitle),
    industry: asText(input.industry),
    missionTitle: asText(input.missionTitle),
    campaignContext: asText(input.campaignContext),
    userName: asText(input.userName),
  });

  return {
    ...steps,
    artifactType: 'campaign_draft',
    editable: true,
    note: 'Secuencia generada como borrador editable. Guardar o lanzar una campana requiere aprobacion posterior.',
  };
}

function normalizeCampaignSteps(value: unknown) {
  const rawSteps = Array.isArray(value) ? value : [];
  return rawSteps.slice(0, 5).map((step: any, index) => ({
    name: asText(step?.name) || `Paso ${index + 1}`,
    offsetDays: Math.max(0, Math.min(Number(step?.offsetDays ?? step?.offset_days ?? index * 3) || 0, 30)),
    subject: asText(step?.subject || step?.subjectTemplate || step?.subject_template),
    bodyHtml: asText(step?.bodyHtml || step?.bodyTemplate || step?.body_template),
  })).filter((step) => step.subject && step.bodyHtml);
}

async function createCampaignDraft(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const name = asText(input.name || input.title) || 'Campana creada por SUPL.IA';
  const steps = normalizeCampaignSteps(input.steps);
  if (steps.length === 0) throw new Error('Faltan pasos validos para guardar la campana.');

  const campaignType = asText(input.campaignType) === 'reconnection' ? 'reconnection' : 'follow_up';
  const excludedLeadIds = asList(input.excludedLeadIds || input.excludeLeadIds);

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .insert({
      user_id: context.auth.user.id,
      organization_id: context.auth.organizationId,
      campaign_type: campaignType,
      name,
      status: 'paused',
      excluded_lead_ids: excludedLeadIds,
      settings: input.settings && typeof input.settings === 'object' ? input.settings : {},
      sent_records: {},
    })
    .select('id, name, status, campaign_type, created_at')
    .single();
  if (campaignError) throw campaignError;

  const { error: stepsError } = await admin.from('campaign_steps').insert(steps.map((step, index) => ({
    campaign_id: campaign.id,
    order_index: index,
    name: step.name,
    offset_days: step.offsetDays,
    subject_template: step.subject,
    body_template: step.bodyHtml,
    attachments: [],
  })));

  if (stepsError) {
    await admin.from('campaigns').delete().eq('id', campaign.id);
    throw stepsError;
  }

  return {
    campaignId: campaign.id,
    name: campaign.name,
    status: campaign.status,
    campaignType: campaign.campaign_type,
    stepsCount: steps.length,
    steps,
    createdAt: campaign.created_at,
    note: 'Campana guardada pausada. Lanzarla requiere una aprobacion separada.',
  };
}

function asLeadIds(input: Record<string, unknown>) {
  return asList(input.leadIds || input.leadId || input.ids).slice(0, 25);
}

async function updateCrmStage(input: Record<string, unknown>, context: SupliaToolContext) {
  const leadIds = asLeadIds(input);
  const stage = asText(input.stage || input.status);
  if (leadIds.length === 0) throw new Error('Falta leadId o leadIds para actualizar CRM.');
  if (!stage) throw new Error('Falta stage para actualizar CRM.');

  await Promise.all(leadIds.map((leadId) => syncLeadAutopilotToCrm(getSupabaseAdminClient(), {
    organizationId: context.auth.organizationId,
    leadId,
    stage,
    lastAutopilotEvent: 'suplia_crm_update_stage',
  })));

  return {
    leadIds,
    stage,
    updatedCount: leadIds.length,
    note: 'CRM actualizado en unified_crm_data. No se enviaron mensajes ni campanas.',
  };
}

async function setCrmNextAction(input: Record<string, unknown>, context: SupliaToolContext) {
  const leadIds = asLeadIds(input);
  const nextAction = asText(input.nextAction || input.action || input.note);
  if (leadIds.length === 0) throw new Error('Falta leadId o leadIds para registrar proxima accion.');
  if (!nextAction) throw new Error('Falta nextAction para registrar seguimiento.');

  const nextActionType = asText(input.nextActionType || input.type) || 'follow_up';
  const nextActionDueAt = asText(input.nextActionDueAt || input.dueAt) || null;
  await Promise.all(leadIds.map((leadId) => syncLeadAutopilotToCrm(getSupabaseAdminClient(), {
    organizationId: context.auth.organizationId,
    leadId,
    nextAction,
    nextActionType,
    nextActionDueAt,
    lastAutopilotEvent: 'suplia_crm_set_next_action',
  })));

  return {
    leadIds,
    nextAction,
    nextActionType,
    nextActionDueAt,
    updatedCount: leadIds.length,
    note: 'Proxima accion registrada en CRM. No se enviaron mensajes ni campanas.',
  };
}

async function addCrmNote(input: Record<string, unknown>, context: SupliaToolContext) {
  const leadIds = asLeadIds(input);
  const note = asText(input.note || input.notes);
  if (leadIds.length === 0) throw new Error('Falta leadId o leadIds para agregar nota.');
  if (!note) throw new Error('Falta note para agregar al CRM.');

  await Promise.all(leadIds.map((leadId) => syncLeadAutopilotToCrm(getSupabaseAdminClient(), {
    organizationId: context.auth.organizationId,
    leadId,
    notes: note,
    lastAutopilotEvent: 'suplia_crm_add_note',
  })));

  return {
    leadIds,
    note,
    updatedCount: leadIds.length,
  };
}

async function getCampaignStatus(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const campaignId = asText(input.campaignId || input.id);
  if (!campaignId) throw new Error('Falta campaignId.');

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('organization_id', context.auth.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign) throw new Error('Campana no encontrada.');

  const { data: steps, error: stepsError } = await admin
    .from('campaign_steps')
    .select('id, name, order_index, offset_days, subject_template, body_template')
    .eq('campaign_id', campaignId)
    .order('order_index', { ascending: true });
  if (stepsError) throw stepsError;

  return { campaign, steps: steps || [], stepsCount: (steps || []).length };
}

async function updateCampaign(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const campaignId = asText(input.campaignId || input.id);
  if (!campaignId) throw new Error('Falta campaignId.');

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const name = asText(input.name || input.title);
  if (name) patch.name = name;
  if (input.settings && typeof input.settings === 'object') patch.settings = input.settings;
  const excludedLeadIds = asList(input.excludedLeadIds || input.excludeLeadIds);
  if (excludedLeadIds.length > 0) patch.excluded_lead_ids = excludedLeadIds;

  const { data, error } = await admin
    .from('campaigns')
    .update(patch)
    .eq('id', campaignId)
    .eq('organization_id', context.auth.organizationId)
    .select('id, name, status, campaign_type, settings, updated_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Campana no encontrada.');

  return { campaign: data, note: 'Campana actualizada. No se lanzaron envios.' };
}

async function validateCampaignActivation(input: Record<string, unknown>, context: SupliaToolContext) {
  const status = await getCampaignStatus(input, context) as any;
  if (!status.campaign) throw new Error('Campana no encontrada.');
  if (!Array.isArray(status.steps) || status.steps.length === 0) throw new Error('No se puede activar una campana sin pasos configurados.');

  const suppliedPreflight = input.preflight && typeof input.preflight === 'object' ? input.preflight as any : {};
  const suppliedPreflightResult = input.preflight_result && typeof input.preflight_result === 'object' ? input.preflight_result as any : {};
  let preflight: any = null;
  const suppliedStatus = asText(input.preflightStatus || suppliedPreflight.status || suppliedPreflightResult.status).toLowerCase();

  if (suppliedStatus) {
    preflight = { status: suppliedStatus, source: 'approval_payload' };
  } else {
    const sampleMessages = status.steps.slice(0, 3).map((step: any) => ({
      to: asText(input.sampleEmail) || 'review@example.com',
      subject: step.subject_template,
      htmlBody: step.body_template,
    }));
    preflight = await preflightCampaign({ messages: sampleMessages, audienceCount: Number(input.audienceCount || sampleMessages.length), sampleLimit: sampleMessages.length }, context);
  }

  if (String(preflight?.status || '').toLowerCase() === 'blocked') {
    throw new Error('No se puede activar una campana con preflight bloqueado.');
  }

  return { ...status, preflight };
}

async function setCampaignStatus(input: Record<string, unknown>, context: SupliaToolContext, status: 'active' | 'paused') {
  const admin = getSupabaseAdminClient();
  const campaignId = asText(input.campaignId || input.id);
  if (!campaignId) throw new Error('Falta campaignId.');

  const { data, error } = await admin
    .from('campaigns')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('organization_id', context.auth.organizationId)
    .select('id, name, status, campaign_type, updated_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Campana no encontrada.');
  return { campaign: data, note: status === 'active' ? 'Campana activada. El cron de campanas procesara envios segun guardrails.' : 'Campana pausada.' };
}

async function launchCampaign(input: Record<string, unknown>, context: SupliaToolContext) {
  const validation = await validateCampaignActivation(input, context);
  const result = await setCampaignStatus(input, context, 'active');
  return { ...result, preflight: validation.preflight, stepsCount: validation.stepsCount };
}

async function pauseCampaign(input: Record<string, unknown>, context: SupliaToolContext) {
  return setCampaignStatus(input, context, 'paused');
}

async function resumeCampaign(input: Record<string, unknown>, context: SupliaToolContext) {
  const validation = await validateCampaignActivation(input, context);
  const result = await setCampaignStatus(input, context, 'active');
  return { ...result, preflight: validation.preflight, stepsCount: validation.stepsCount };
}

async function bulkSend(input: Record<string, unknown>, context: SupliaToolContext) {
  const { maxBatchSize, perMessageDelayMs, windowStartHour, windowEndHour, timeZone } = getBulkSendConfig();
  const requestedMessages = asObjectArray(input.messages || input.emails || input.items);
  const dedupedMessages = uniqueBy(requestedMessages, (message) => normalizeEmail(asText(message.to || message.email)) || norm(`${message.subject || ''}-${message.company || ''}`));
  const messages = dedupedMessages.slice(0, asLimit(input.limit, 5, maxBatchSize));
  const dryRun = input.dryRun !== false;
  const truncated = requestedMessages.length > messages.length;
  const duplicateCount = Math.max(0, requestedMessages.length - dedupedMessages.length);
  if (messages.length === 0) throw new Error('Bulk send requiere al menos un mensaje valido.');
  if (!dryRun && !isWithinBulkSendWindow()) {
    throw new Error(`Bulk send fuera de ventana horaria permitida (${windowStartHour}:00-${windowEndHour}:00 ${timeZone}).`);
  }
  const samples = messages.slice(0, 5).map((message) => ({
    to: normalizeEmail(asText(message.to || message.email)),
    subject: asText(message.subject),
    hasBody: Boolean(asText(message.htmlBody || message.textBody || message.body)),
    company: asText(message.company),
  }));

  const preflight = await preflightCampaign({ messages, audienceCount: messages.length, sampleLimit: messages.length }, context);
  if ((preflight as any).status === 'blocked') {
    return {
      dryRun: true,
      blocked: true,
      preflight,
      samples,
      summary: {
        requested: requestedMessages.length,
        processed: messages.length,
        truncated,
        duplicatesRemoved: duplicateCount,
        maxBatchSize,
        sent: 0,
        failed: 0,
        excluded: Number((preflight as any).blockedCount || 0),
      },
    };
  }

  if (dryRun) {
    return {
      dryRun: true,
      samples,
      preflight,
      summary: {
        requested: requestedMessages.length,
        processed: messages.length,
        truncated,
        duplicatesRemoved: duplicateCount,
        eligible: Math.max(0, messages.length - Number((preflight as any).blockedCount || 0)),
        reviewCount: Number((preflight as any).reviewCount || 0),
        excluded: Number((preflight as any).blockedCount || 0),
        maxBatchSize,
      },
      note: 'Dry-run generado. Para enviar realmente se requiere aprobacion fuerte y confirmacion ENVIAR.',
    };
  }

  if (asText(input.strongConfirmationText).toUpperCase() !== 'ENVIAR') {
    throw new Error('Bulk send requiere confirmacion fuerte: ENVIAR.');
  }

  const results = [];
  await context.reportProgress?.({ current: 0, total: messages.length, label: 'Bulk send iniciado' });
  for (let index = 0; index < messages.length; index += 1) {
    await context.assertRunnable?.();
    const message = messages[index];
    const to = normalizeEmail(asText(message.to || message.email));
    try {
      const sent = await sendSupliaEmail({
        supabase: context.auth.supabase,
        userId: context.auth.user.id,
        organizationId: context.auth.organizationId,
        conversationId: context.conversationId,
        actionId: context.pendingActionId || null,
        payload: {
          to: message.to || message.email,
          subject: message.subject,
          htmlBody: message.htmlBody || message.body,
          textBody: message.textBody,
          provider: message.provider,
          recipientName: message.recipientName || message.name,
          company: message.company,
          role: message.role || message.title,
          leadId: message.leadId,
        },
      });
      results.push({ status: 'sent', to: sent.to, contactedId: sent.contactedId, provider: sent.provider, index });
    } catch (error: any) {
      results.push({ status: 'failed', to, error: error?.message || 'send_failed', index });
    }
    await context.reportProgress?.({ current: results.length, total: messages.length, label: `Bulk send ${results.length}/${messages.length}` });
    await context.heartbeat?.();
    if (index < messages.length - 1) await sleep(perMessageDelayMs);
  }

  return {
    dryRun: false,
    preflight,
    results,
    summary: {
      requested: requestedMessages.length,
      processed: messages.length,
      truncated,
      duplicatesRemoved: duplicateCount,
      maxBatchSize,
      perMessageDelayMs,
      sendWindow: { startHour: windowStartHour, endHour: windowEndHour, timeZone },
      sent: results.filter((item) => item.status === 'sent').length,
      failed: results.filter((item) => item.status === 'failed').length,
    },
  };
}

async function repliesSync(input: Record<string, unknown>, context: SupliaToolContext) {
  const limit = asLimit(input.limit, 200, 500);
  return syncRepliesForOrganization(getSupabaseAdminClient(), {
    organizationId: context.auth.organizationId,
    userId: context.auth.user.id,
    limit,
  }) as Promise<any>;
}

async function summarizeReplies(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const limit = asLimit(input.limit, 20, 100);
  const { data, error } = await admin
    .from('contacted_leads')
    .select('id, lead_id, name, email, company, subject, replied_at, reply_intent, reply_summary, last_reply_text, evaluation_status')
    .eq('organization_id', context.auth.organizationId)
    .not('replied_at', 'is', null)
    .order('replied_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = data || [];
  const byIntent = rows.reduce((acc: Record<string, number>, row: any) => {
    const key = String(row.reply_intent || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return { replies: rows, count: rows.length, byIntent, summary: `Se encontraron ${rows.length} replies recientes.` };
}

async function classifyRepliesBatch(input: Record<string, unknown>, context: SupliaToolContext) {
  const replies = asObjectArray(input.replies).slice(0, asLimit(input.limit, 20, 100));
  const rows = replies.length > 0 ? replies : (await summarizeReplies({ limit: input.limit || 20 }, context)).replies as any[];
  const results = [];
  await context.reportProgress?.({ current: 0, total: rows.length, label: 'Clasificando replies' });
  for (const reply of rows) {
    await context.assertRunnable?.();
    const text = asText(reply.text || reply.last_reply_text || reply.reply_summary || reply.replyPreview || reply.html);
    const classification = await classifyReply(text);
    results.push({ contactedId: reply.id || reply.contactedId, email: reply.email, classification, preview: extractReplyPreview(text) });
    await context.reportProgress?.({ current: results.length, total: rows.length, label: `Replies ${results.length}/${rows.length}` });
  }
  return { results, count: results.length };
}

async function threadReplyDraft(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const contactedId = asText(input.contactedId || input.contacted_id);
  if (!contactedId) throw new Error('Falta contactedId para redactar respuesta.');
  const draft = await draftAutonomousReply({
    organizationId: context.auth.organizationId,
    userId: context.auth.user.id,
    contactedId,
    rawReply: asText(input.rawReply || input.replyText) || undefined,
    replySubject: asText(input.replySubject || input.subject) || undefined,
  });
  const bodyText = draft.draft?.bodyText || '';
  const bodyHtml = draft.draft?.bodyHtml || '';
  const subject = draft.draft?.subject || `Re: ${draft.contactedLead.subject || ''}`.trim();
  const { data: row, error } = await admin
    .from('suplia_reply_drafts')
    .insert({
      organization_id: context.auth.organizationId,
      job_id: context.jobId || null,
      conversation_id: context.conversationId,
      contacted_id: contactedId,
      thread_key: null,
      to_email: draft.contactedLead.email,
      subject,
      html_body: bodyHtml,
      text_body: bodyText,
      classification: draft.classification?.intent || null,
      reasoning_summary: draft.decision?.reason || draft.classification?.summary || null,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error) throw error;
  return { draftId: row.id, replyDraft: row, source: draft, note: 'Borrador creado. Enviarlo requiere aprobacion.' };
}

async function threadReplySend(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const draftId = asText(input.draftId || input.replyDraftId);
  const contactedId = asText(input.contactedId || input.contacted_id);
  let draft: any = null;
  if (draftId) {
    const { data, error } = await admin
      .from('suplia_reply_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('organization_id', context.auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    draft = data;
  }
  if (!draft && !contactedId) throw new Error('Falta draftId o contactedId para enviar respuesta.');
  const to = normalizeEmail(asText(input.to || draft?.to_email));
  const subject = asText(input.subject || draft?.subject);
  const htmlBody = asText(input.htmlBody || draft?.html_body || input.textBody || draft?.text_body);
  if (!to || !subject || !htmlBody) throw new Error('Faltan datos del borrador para enviar respuesta.');

  const sent = await sendSupliaEmail({
    supabase: context.auth.supabase,
    userId: context.auth.user.id,
    organizationId: context.auth.organizationId,
    conversationId: context.conversationId,
    actionId: context.pendingActionId || null,
    payload: { to, subject, htmlBody, textBody: input.textBody || draft?.text_body, provider: input.provider, recipientName: input.recipientName, company: input.company, leadId: input.leadId },
  });
  if (draftId) {
    await admin
      .from('suplia_reply_drafts')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', draftId)
      .eq('organization_id', context.auth.organizationId);
  }
  return { ...sent, draftId: draftId || null, note: 'Respuesta enviada con aprobacion. El proveedor determino la metadata de hilo disponible.' };
}

async function assignCrmOwner(input: Record<string, unknown>, context: SupliaToolContext) {
  const leadIds = asLeadIds(input);
  const owner = asText(input.owner || input.ownerId || input.assignee);
  if (leadIds.length === 0) throw new Error('Falta leadId o leadIds para asignar owner.');
  if (!owner) throw new Error('Falta owner para asignar.');
  const admin = getSupabaseAdminClient();
  await Promise.all(leadIds.map((leadId) => admin.from('unified_crm_data').upsert({
    id: `lead_saved|${leadId}`,
    organization_id: context.auth.organizationId,
    owner,
    updated_at: new Date().toISOString(),
  } as any)));
  return { leadIds, owner, updatedCount: leadIds.length };
}

async function detectStalledPipeline(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const days = Math.max(3, Math.min(Number(input.days || 14) || 14, 90));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('contacted_leads')
    .select('id, lead_id, name, email, company, role, status, sent_at, replied_at, reply_intent, evaluation_status')
    .eq('organization_id', context.auth.organizationId)
    .lt('sent_at', since)
    .is('replied_at', null)
    .limit(asLimit(input.limit, 25, 100));
  if (error) throw error;
  return { items: data || [], count: (data || []).length, days };
}

async function suggestFollowup(input: Record<string, unknown>, context: SupliaToolContext) {
  const stalled = await detectStalledPipeline(input, context);
  const items = (stalled.items || []).map((lead: any) => ({
    leadId: lead.lead_id || lead.id,
    email: lead.email,
    company: lead.company,
    suggestedAction: lead.reply_intent === 'positive' || lead.evaluation_status === 'action_required' ? 'Responder y proponer reunion' : 'Enviar follow-up breve o revisar fit',
    reason: lead.reply_intent ? `reply_intent:${lead.reply_intent}` : `sin respuesta en ${stalled.days} dias`,
  }));
  return { items, count: items.length };
}

async function createFollowupTasks(input: Record<string, unknown>, context: SupliaToolContext) {
  const tasks = asObjectArray(input.tasks || input.items).slice(0, asLimit(input.limit, 10, 50));
  const created = [];
  for (const task of tasks) {
    const leadId = asText(task.leadId || task.lead_id || task.id);
    if (!leadId) continue;
    await syncLeadAutopilotToCrm(getSupabaseAdminClient(), {
      organizationId: context.auth.organizationId,
      leadId,
      nextAction: asText(task.nextAction || task.suggestedAction || 'Revisar seguimiento'),
      nextActionType: asText(task.nextActionType || 'follow_up'),
      nextActionDueAt: asText(task.nextActionDueAt || task.dueAt) || null,
      lastAutopilotEvent: 'suplia_followup_task',
    });
    created.push({ leadId, nextAction: asText(task.nextAction || task.suggestedAction || 'Revisar seguimiento') });
  }
  return { created, count: created.length };
}

async function searchMemory(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const status = asText(input.status) || 'approved';
  const type = asText(input.memoryType || input.type);
  let query = admin
    .from('suplia_memories')
    .select('*')
    .eq('organization_id', context.auth.organizationId)
    .eq('status', status)
    .order('updated_at', { ascending: false })
    .limit(asLimit(input.limit, 10, 50));
  if (type) query = query.eq('memory_type', type);
  const { data, error } = await query;
  if (error) throw error;
  return { items: data || [], count: (data || []).length };
}

async function proposeMemory(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const items = asObjectArray(input.memories || input.items).length ? asObjectArray(input.memories || input.items) : [input as Record<string, any>];
  const rows = items.map((item) => ({
    organization_id: context.auth.organizationId,
    user_id: context.auth.user.id,
    scope: asText(item.scope) || 'organization',
    memory_type: asText(item.memoryType || item.type) || 'preference',
    key: asText(item.key || item.title) || `memory_${Date.now()}`,
    value: item.value && typeof item.value === 'object' ? item.value : { text: asText(item.value || item.text || item.content) },
    confidence: Math.max(0, Math.min(Number(item.confidence || 0.6) || 0.6, 1)),
    status: 'proposed',
    source_conversation_id: context.conversationId,
    source_job_id: context.jobId || null,
  }));
  const { data, error } = await admin.from('suplia_memories').insert(rows).select('*');
  if (error) throw error;
  return { items: data || [], count: (data || []).length, note: 'Memorias propuestas. Deben aprobarse antes de usarse como memoria confirmada.' };
}

async function saveMemory(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const memoryId = asText(input.memoryId || input.id);
  if (!memoryId) throw new Error('Falta memoryId para aprobar memoria.');
  const { data, error } = await admin
    .from('suplia_memories')
    .update({ status: 'approved', approved_by: context.auth.user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', memoryId)
    .eq('organization_id', context.auth.organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Memoria no encontrada.');
  return { memory: data };
}

async function forgetMemory(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const memoryId = asText(input.memoryId || input.id);
  if (!memoryId) throw new Error('Falta memoryId para olvidar memoria.');
  const { data, error } = await admin
    .from('suplia_memories')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', memoryId)
    .eq('organization_id', context.auth.organizationId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Memoria no encontrada.');
  return { memory: data };
}

function defaultPlaybookSteps(goal: string) {
  return [
    { step_order: 1, step_key: 'planner', step_type: 'agent', agent_name: 'planner', title: 'Plan operativo', description: 'Ordenar el objetivo y decidir el camino seguro.', requires_approval: false, can_run_in_parallel: false, input_payload: { goal } },
    { step_order: 2, step_key: 'icp_strategy', step_type: 'agent', agent_name: 'icp-strategist', title: 'ICP y search plan', description: 'Definir segmentos, roles y criterios antes de consumir creditos.', requires_approval: false, can_run_in_parallel: false, input_payload: { goal } },
    { step_order: 3, step_key: 'prospector_approval', step_type: 'agent', agent_name: 'prospector', title: 'Aprobacion de busqueda', description: 'Preparar busqueda externa para aprobacion humana.', requires_approval: true, can_run_in_parallel: false, input_payload: { goal } },
  ];
}

function normalizePlaybookSteps(value: unknown, goal: string) {
  const rawSteps = asObjectArray(value);
  const steps = rawSteps.length > 0 ? rawSteps : defaultPlaybookSteps(goal);
  return steps.slice(0, 20).map((rawStep, index) => {
    const step = rawStep as Record<string, any>;
    return {
    step_order: Math.max(1, Math.floor(Number(step.step_order || step.order || index + 1) || index + 1)),
    step_key: asText(step.step_key || step.key) || `playbook_step_${index + 1}`,
    step_type: asText(step.step_type || step.type) || 'agent',
    agent_name: asText(step.agent_name || step.agentName) || 'planner',
    title: asText(step.title) || `Step ${index + 1}`,
    description: asText(step.description),
    requires_approval: Boolean(step.requires_approval || step.requiresApproval),
    can_run_in_parallel: Boolean(step.can_run_in_parallel || step.canRunInParallel),
    input_payload: step.input_payload && typeof step.input_payload === 'object' ? step.input_payload : step.inputPayload && typeof step.inputPayload === 'object' ? step.inputPayload : { goal },
    };
  });
}

async function listPlaybooks(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const status = asText(input.status) || 'active';
  let query = admin
    .from('suplia_playbooks')
    .select('id, name, description, playbook_type, status, performance_summary, created_at, updated_at')
    .eq('organization_id', context.auth.organizationId)
    .order('updated_at', { ascending: false })
    .limit(asLimit(input.limit, 10, 50));
  if (status !== 'all') query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return { items: data || [], count: (data || []).length };
}

async function getPlaybook(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const playbookId = asText(input.playbookId || input.id);
  if (!playbookId) throw new Error('Falta playbookId.');
  const { data, error } = await admin
    .from('suplia_playbooks')
    .select('*')
    .eq('id', playbookId)
    .eq('organization_id', context.auth.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Playbook no encontrado.');
  return { playbook: data };
}

async function createPlaybook(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const sourceJobId = asText(input.sourceJobId || input.jobId);
  let sourceJob: any = null;
  let sourceSteps: any[] = [];

  if (sourceJobId) {
    const [jobRes, stepsRes] = await Promise.all([
      admin.from('suplia_jobs').select('*').eq('id', sourceJobId).eq('organization_id', context.auth.organizationId).maybeSingle(),
      admin.from('suplia_job_steps').select('*').eq('job_id', sourceJobId).eq('organization_id', context.auth.organizationId).order('step_order', { ascending: true }),
    ]);
    if (jobRes.error) throw jobRes.error;
    if (stepsRes.error) throw stepsRes.error;
    sourceJob = jobRes.data;
    sourceSteps = stepsRes.data || [];
  }

  const name = asText(input.name || input.title) || sourceJob?.title || 'Playbook SUPL.IA';
  const description = asText(input.description) || sourceJob?.goal || null;
  const steps = normalizePlaybookSteps(input.steps || sourceSteps, sourceJob?.goal || asText(input.goal));
  const guardrails = input.guardrails && typeof input.guardrails === 'object' ? input.guardrails : { approvalsRequired: true, noExternalCreditsWithoutApproval: true };
  const performanceSummary = input.performanceSummary && typeof input.performanceSummary === 'object'
    ? input.performanceSummary
    : { sourceJobId: sourceJobId || null, completedSteps: sourceSteps.filter((step) => step.status === 'completed').length, totalSteps: sourceSteps.length };

  const { data, error } = await admin.from('suplia_playbooks').insert({
    organization_id: context.auth.organizationId,
    user_id: context.auth.user.id,
    name,
    description,
    playbook_type: asText(input.playbookType || input.type) || sourceJob?.job_type || 'general',
    input_schema: input.inputSchema && typeof input.inputSchema === 'object' ? input.inputSchema : {},
    steps,
    guardrails,
    performance_summary: performanceSummary,
    status: asText(input.status) || 'active',
  }).select('*').single();
  if (error) throw error;
  return { playbook: data, note: 'Playbook creado. Aplicarlo crea un nuevo job y mantiene aprobaciones sensibles.' };
}

async function updatePlaybook(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const playbookId = asText(input.playbookId || input.id);
  if (!playbookId) throw new Error('Falta playbookId.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const name = asText(input.name || input.title);
  if (name) patch.name = name;
  const description = asText(input.description);
  if (description) patch.description = description;
  if (input.steps) patch.steps = normalizePlaybookSteps(input.steps, asText(input.goal));
  if (input.guardrails && typeof input.guardrails === 'object') patch.guardrails = input.guardrails;
  if (input.inputSchema && typeof input.inputSchema === 'object') patch.input_schema = input.inputSchema;
  if (input.performanceSummary && typeof input.performanceSummary === 'object') patch.performance_summary = input.performanceSummary;
  const status = asText(input.status);
  if (status) patch.status = status;

  const { data, error } = await admin.from('suplia_playbooks').update(patch).eq('id', playbookId).eq('organization_id', context.auth.organizationId).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Playbook no encontrado.');
  return { playbook: data };
}

async function archivePlaybook(input: Record<string, unknown>, context: SupliaToolContext) {
  return updatePlaybook({ ...input, status: 'archived' }, context);
}

async function applyPlaybook(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const { playbook } = await getPlaybook(input, context) as any;
  if (playbook.status === 'archived') throw new Error('No se puede aplicar un playbook archivado.');
  const goal = asText(input.goal || input.objective) || playbook.description || playbook.name;
  const timestamp = new Date().toISOString();
  const steps = normalizePlaybookSteps(playbook.steps, goal);

  const { data: job, error: jobError } = await admin.from('suplia_jobs').insert({
    conversation_id: context.conversationId,
    organization_id: context.auth.organizationId,
    user_id: context.auth.user.id,
    title: asText(input.title) || `Playbook: ${playbook.name}`,
    goal,
    job_type: playbook.playbook_type || 'general',
    status: 'queued',
    progress_total: steps.length,
    progress_label: 'En cola desde playbook',
    input_payload: { playbookId: playbook.id, playbookName: playbook.name, source: 'playbook.apply' },
    queued_at: timestamp,
    updated_at: timestamp,
  }).select('*').single();
  if (jobError) throw jobError;

  const { error: stepsError } = await admin.from('suplia_job_steps').insert(steps.map((step) => ({
    job_id: job.id,
    conversation_id: context.conversationId,
    organization_id: context.auth.organizationId,
    step_order: step.step_order,
    step_key: step.step_key,
    step_type: step.step_type,
    agent_name: step.agent_name,
    title: step.title,
    description: step.description,
    status: 'queued',
    depends_on_step_ids: [],
    can_run_in_parallel: step.can_run_in_parallel,
    requires_approval: step.requires_approval,
    input_payload: { ...(step.input_payload as Record<string, unknown>), goal, playbookId: playbook.id },
    progress_total: 1,
  })));
  if (stepsError) throw stepsError;

  return { jobId: job.id, playbookId: playbook.id, stepsCount: steps.length, status: job.status, note: 'Job creado desde playbook. Las acciones sensibles siguen requiriendo aprobacion.' };
}

async function createAntoniaMission(input: Record<string, unknown>, context: SupliaToolContext) {
  const admin = getSupabaseAdminClient();
  const title = asText(input.title || input.name) || 'Mision creada por SUPL.IA';
  const goalSummary = asText(input.goalSummary || input.goal || input.description);
  if (!goalSummary) throw new Error('Falta goal o goalSummary para crear la mision.');

  const { data, error } = await admin
    .from('antonia_missions')
    .insert({
      organization_id: context.auth.organizationId,
      user_id: context.auth.user.id,
      title,
      status: 'paused',
      goal_summary: goalSummary,
      params: input.params && typeof input.params === 'object' ? input.params : {
        source: 'suplia',
        prompt: goalSummary,
      },
      daily_search_limit: Math.max(0, Math.min(Number(input.dailySearchLimit || 1) || 1, 10)),
      daily_enrich_limit: Math.max(0, Math.min(Number(input.dailyEnrichLimit || 10) || 10, 100)),
      daily_investigate_limit: Math.max(0, Math.min(Number(input.dailyInvestigateLimit || 5) || 5, 50)),
      daily_contact_limit: Math.max(0, Math.min(Number(input.dailyContactLimit || 0) || 0, 25)),
    })
    .select('id, title, status, goal_summary, daily_search_limit, daily_enrich_limit, daily_investigate_limit, daily_contact_limit, created_at')
    .single();
  if (error) throw error;

  return {
    mission: data,
    note: 'Mision creada pausada. Dispararla requiere una aprobacion separada.',
  };
}

async function getGmailProfile(_input: Record<string, unknown>, context: SupliaToolContext) {
  const accessToken = await getGmailMailboxAccessToken(context.auth);
  const profile = await getGmailMailboxProfile(accessToken);
  return {
    ...profile,
    note: 'Gmail conectado. Esta herramienta solo valida conexion y permiso de lectura.',
  };
}

async function searchGmailMessages(input: Record<string, unknown>, context: SupliaToolContext) {
  const accessToken = await getGmailMailboxAccessToken(context.auth);
  const profile = await getGmailMailboxProfile(accessToken);
  const result = await searchGmailMailboxMessages(accessToken, {
    query: asText(input.query),
    topic: asText(input.topic),
    maxResults: asLimit(input.maxResults, 25, envInt('SUPLIA_GMAIL_READ_MAX_RESULTS', 100, 1, 100)),
    includeBody: Boolean(input.includeBody),
    pageToken: asText(input.pageToken),
    sentOnly: input.sentOnly !== false,
    newerThan: asText(input.newerThan),
    after: asText(input.after),
    before: asText(input.before),
  }, context);
  return { ...result, profileEmail: profile.emailAddress };
}

async function getGmailMessage(input: Record<string, unknown>, context: SupliaToolContext) {
  const accessToken = await getGmailMailboxAccessToken(context.auth);
  const message = await fetchGmailMailboxMessage(accessToken, asText(input.messageId || input.id), { includeBody: Boolean(input.includeBody) });
  return { message, privacyMode: input.includeBody ? 'body_truncated' : 'metadata_snippet' };
}

async function getGmailThread(input: Record<string, unknown>, context: SupliaToolContext) {
  const accessToken = await getGmailMailboxAccessToken(context.auth);
  const thread = await fetchGmailMailboxThread(accessToken, asText(input.threadId || input.id), {
    includeBodies: Boolean(input.includeBodies || input.includeBody),
    maxMessages: asLimit(input.maxMessages, 25, 50),
  });
  return { thread, privacyMode: input.includeBodies || input.includeBody ? 'body_truncated' : 'metadata_snippet' };
}

async function searchGmailThreads(input: Record<string, unknown>, context: SupliaToolContext) {
  const accessToken = await getGmailMailboxAccessToken(context.auth);
  return searchGmailMailboxThreads(accessToken, {
    query: asText(input.query),
    topic: asText(input.topic),
    maxResults: asLimit(input.maxResults, 25, envInt('SUPLIA_GMAIL_READ_MAX_RESULTS', 100, 1, 100)),
    includeBodies: Boolean(input.includeBodies || input.includeBody),
    sentOnly: input.sentOnly !== false,
    newerThan: asText(input.newerThan),
    after: asText(input.after),
    before: asText(input.before),
  }, context);
}

async function findGmailContactedLeadsTool(input: Record<string, unknown>, context: SupliaToolContext) {
  const result = await findGmailContactedLeads(context.auth, {
    topic: asText(input.topic),
    query: asText(input.query),
    maxResults: asLimit(input.maxResults, 50, envInt('SUPLIA_GMAIL_READ_MAX_RESULTS', 100, 1, 100)),
    includeBody: Boolean(input.includeBody),
    sentOnly: input.sentOnly !== false,
    newerThan: asText(input.newerThan) || '12m',
    after: asText(input.after),
    before: asText(input.before),
  }, context);
  return {
    ...result,
    artifactContent: buildGmailContactArtifactContent(result.contacts as any),
  };
}

async function matchGmailCrm(input: Record<string, unknown>, context: SupliaToolContext) {
  return matchGmailMailboxContactsInput(context.auth, input);
}

async function summarizeGmailResults(input: Record<string, unknown>) {
  return summarizeGmailMailboxResultsInput(input);
}

async function sendEmail(input: Record<string, unknown>, context: SupliaToolContext) {
  return sendSupliaEmail({
    supabase: context.auth.supabase,
    userId: context.auth.user.id,
    organizationId: context.auth.organizationId,
    conversationId: context.conversationId,
    actionId: context.pendingActionId || null,
    payload: input,
  });
}

const SUPLIA_TOOLS: Record<string, SupliaToolDefinition> = {
  'app.context.get': {
    name: 'app.context.get',
    description: 'Obtiene contexto basico de usuario, organizacion, conexiones y conteos.',
    inputSchema: '{}',
    handler: getAppContext,
  },
  'profile.get_company_profile': {
    name: 'profile.get_company_profile',
    description: 'Lee el perfil de compania configurado para personalizacion.',
    inputSchema: '{}',
    handler: getCompanyProfile,
  },
  'gmail.profile.get': {
    name: 'gmail.profile.get',
    description: 'Valida que Gmail esta conectado y que el servidor puede leer el perfil de mailbox.',
    inputSchema: '{}',
    handler: getGmailProfile,
  },
  'gmail.search_messages': {
    name: 'gmail.search_messages',
    description: 'Busca mensajes de Gmail con query aprobada. Lee metadata/snippets por defecto y body truncado solo si fue aprobado.',
    inputSchema: '{ "query": string, "maxResults"?: number, "includeBody"?: boolean, "pageToken"?: string }',
    handler: searchGmailMessages,
  },
  'gmail.get_message': {
    name: 'gmail.get_message',
    description: 'Lee un mensaje especifico de Gmail por id con minimizacion de datos.',
    inputSchema: '{ "messageId": string, "includeBody"?: boolean }',
    handler: getGmailMessage,
  },
  'gmail.get_thread': {
    name: 'gmail.get_thread',
    description: 'Lee un hilo de Gmail por id y normaliza mensajes y participantes.',
    inputSchema: '{ "threadId": string, "includeBodies"?: boolean, "maxMessages"?: number }',
    handler: getGmailThread,
  },
  'gmail.search_threads': {
    name: 'gmail.search_threads',
    description: 'Busca mensajes de Gmail y agrupa resultados por thread.',
    inputSchema: '{ "query": string, "maxResults"?: number, "includeBodies"?: boolean }',
    handler: searchGmailThreads,
  },
  'gmail.find_contacted_leads': {
    name: 'gmail.find_contacted_leads',
    description: 'Busca en Gmail enviados para identificar leads contactados sobre un tema y cruzarlos con CRM.',
    inputSchema: '{ "topic": string, "query"?: string, "after"?: string, "before"?: string, "newerThan"?: string, "maxResults"?: number, "includeBody"?: boolean, "sentOnly"?: boolean }',
    handler: findGmailContactedLeadsTool,
  },
  'gmail.match_crm': {
    name: 'gmail.match_crm',
    description: 'Cruza contactos extraidos de Gmail contra leads, contactados y CRM interno.',
    inputSchema: '{ "contacts": object[] }',
    handler: matchGmailCrm,
  },
  'gmail.summarize_results': {
    name: 'gmail.summarize_results',
    description: 'Resume resultados Gmail ya obtenidos sin nuevas lecturas de mailbox.',
    inputSchema: '{ "contacts": object[], "topic"?: string, "query"?: string }',
    handler: summarizeGmailResults,
  },
  'crm.search': {
    name: 'crm.search',
    description: 'Busca leads guardados en el CRM interno sin consumir creditos externos.',
    inputSchema: '{ "query"?: string, "company"?: string, "status"?: string, "limit"?: number }',
    handler: searchCrm,
  },
  'crm.get_lead_detail': {
    name: 'crm.get_lead_detail',
    description: 'Obtiene detalle de un lead y sus ultimos contactos registrados.',
    inputSchema: '{ "leadId"?: string, "email"?: string }',
    handler: getLeadDetail,
  },
  'contacted.search': {
    name: 'contacted.search',
    description: 'Busca contactos ya enviados o gestionados y sus senales principales.',
    inputSchema: '{ "query"?: string, "email"?: string, "company"?: string, "status"?: string, "limit"?: number }',
    handler: searchContacted,
  },
  'contacted.get_timeline': {
    name: 'contacted.get_timeline',
    description: 'Lee historial de contacto y eventos de email para un lead o email.',
    inputSchema: '{ "leadId"?: string, "email"?: string, "limit"?: number }',
    handler: getContactedTimeline,
  },
  'campaigns.list': {
    name: 'campaigns.list',
    description: 'Lista campanas recientes guardadas en la app.',
    inputSchema: '{ "status"?: string, "limit"?: number }',
    handler: listCampaigns,
  },
  'campaigns.get': {
    name: 'campaigns.get',
    description: 'Lee estado, settings y pasos de una campana sin modificarla.',
    inputSchema: '{ "campaignId": string }',
    handler: getCampaignStatus,
  },
  'antonia.missions.list': {
    name: 'antonia.missions.list',
    description: 'Lista misiones recientes de ANTONIA.',
    inputSchema: '{ "status"?: "active" | "paused" | "completed" | "failed", "limit"?: number }',
    handler: listAntoniaMissions,
  },
  'antonia.exceptions.list': {
    name: 'antonia.exceptions.list',
    description: 'Lista excepciones abiertas o recientes de ANTONIA.',
    inputSchema: '{ "status"?: "open" | "approved" | "resolved" | "dismissed", "limit"?: number }',
    handler: listAntoniaExceptions,
  },
  'metrics.overview': {
    name: 'metrics.overview',
    description: 'Obtiene conteos agregados de CRM, contacto, campanas y ANTONIA.',
    inputSchema: '{}',
    handler: getMetricsOverview,
  },
  'privacy.contactability.check': {
    name: 'privacy.contactability.check',
    description: 'Verifica si un email puede ser contactado segun privacidad, bajas, rebotes y dominios bloqueados.',
    inputSchema: '{ "email": string }',
    handler: checkContactability,
  },
  'privacy.batch_contactability.check': {
    name: 'privacy.batch_contactability.check',
    description: 'Verifica por lote si emails pueden ser contactados segun guardrails internos.',
    inputSchema: '{ "emails"?: string[], "leads"?: object[], "limit"?: number }',
    handler: batchContactability,
  },
  'prospecting.suggest_segments': {
    name: 'prospecting.suggest_segments',
    description: 'Sugiere segmentos ICP internos sin consumir creditos externos.',
    inputSchema: '{ "goal"?: string, "industry"?: string, "locations"?: string[] }',
    handler: suggestSegments,
  },
  'prospecting.build_search_plan': {
    name: 'prospecting.build_search_plan',
    description: 'Convierte un ICP en criterios de busqueda aprobables sin llamar proveedores externos.',
    inputSchema: '{ "goal"?: string, "segments"?: object[], "companyQueries"?: string[], "peopleTitles"?: string[], "locations"?: string[], "maxCompanies"?: number, "provider"?: "apollo" | "pdl" }',
    handler: buildSearchPlan,
  },
  'prospecting.dedupe_against_crm': {
    name: 'prospecting.dedupe_against_crm',
    description: 'Deduplica empresas y leads contra CRM/contactados internos sin consumir creditos.',
    inputSchema: '{ "companies"?: object[], "leads"?: object[] }',
    handler: dedupeAgainstCrm,
  },
  'prospecting.create_shortlist': {
    name: 'prospecting.create_shortlist',
    description: 'Crea una shortlist interna desde empresas y leads ya obtenidos.',
    inputSchema: '{ "companies"?: object[], "leads"?: object[], "companyLimit"?: number, "leadLimit"?: number }',
    handler: createShortlist,
  },
  'prospecting.score_companies': {
    name: 'prospecting.score_companies',
    description: 'Puntua empresas contra el ICP y persiste scores del job si aplica.',
    inputSchema: '{ "companies": object[], "strategy"?: object, "limit"?: number }',
    handler: scoreCompanies,
  },
  'prospecting.score_people': {
    name: 'prospecting.score_people',
    description: 'Puntua personas/leads contra el ICP, contactabilidad e historial disponible.',
    inputSchema: '{ "leads": object[], "strategy"?: object, "limit"?: number }',
    handler: scorePeople,
  },
  'prospecting.search_companies': {
    name: 'prospecting.search_companies',
    description: 'Busca empresas en Apollo o PDL. Consume creditos externos y requiere aprobacion humana.',
    inputSchema: '{ "companyName": string, "perPage"?: number, "page"?: number, "provider"?: "apollo" | "pdl" }',
    handler: searchCompanies,
  },
  'prospecting.search_people': {
    name: 'prospecting.search_people',
    description: 'Busca personas decisoras en Apollo o PDL por empresa, dominio, titulo y ubicacion. Consume creditos externos y requiere aprobacion humana.',
    inputSchema: '{ "personTitles"?: string[], "domains"?: string[], "companyNames"?: string[], "personLocations"?: string[], "perPage"?: number, "maxPages"?: number, "provider"?: "apollo" | "pdl" }',
    handler: searchPeople,
  },
  'lead.enrich': {
    name: 'lead.enrich',
    description: 'Enriquece un lead individual. Puede consumir creditos externos y requiere aprobacion.',
    inputSchema: '{ "fullName"?: string, "email"?: string, "linkedinUrl"?: string, "companyName"?: string, "companyDomain"?: string, "provider"?: "pdl" }',
    handler: enrichLead,
  },
  'lead.enrich_batch': {
    name: 'lead.enrich_batch',
    description: 'Enriquece un lote pequeno de leads aprobados. Consume creditos externos y requiere aprobacion.',
    inputSchema: '{ "leads": object[], "provider"?: "pdl", "limit"?: number }',
    handler: enrichLeadBatch,
  },
  'email.personalize_for_lead': {
    name: 'email.personalize_for_lead',
    description: 'Genera un borrador personalizado para un lead. No envia correos.',
    inputSchema: '{ "lead": object, "offerSummary"?: string, "cta"?: string, "subject"?: string }',
    handler: personalizeForLead,
  },
  'email.bulk_variant_preview': {
    name: 'email.bulk_variant_preview',
    description: 'Genera previews personalizados por lote pequeno. No envia correos.',
    inputSchema: '{ "leads": object[], "offerSummary"?: string, "cta"?: string, "limit"?: number }',
    handler: bulkVariantPreview,
  },
  'campaign.preview_for_lead': {
    name: 'campaign.preview_for_lead',
    description: 'Genera preview de campana para un lead sin guardar ni lanzar.',
    inputSchema: '{ "lead": object, "offerSummary"?: string, "cta"?: string }',
    handler: campaignPreviewForLead,
  },
  'campaign.generate_sequence': {
    name: 'campaign.generate_sequence',
    description: 'Genera una secuencia de campana como borrador editable. No guarda ni lanza la campana.',
    inputSchema: '{ "goal"?: string, "companyName"?: string, "targetAudience"?: string, "language"?: string, "campaignType"?: "standard" | "reconnection", "offerName"?: string, "offerSummary"?: string, "offerBenefits"?: string[], "cta"?: string, "tone"?: string }',
    handler: generateCampaignSequence,
  },
  'campaign.create_draft': {
    name: 'campaign.create_draft',
    description: 'Guarda una campana como borrador pausado desde una secuencia editable. Requiere aprobacion y no lanza envios.',
    inputSchema: '{ "name": string, "campaignType"?: "follow_up" | "reconnection", "steps": [{ "name"?: string, "offsetDays": number, "subject": string, "bodyHtml": string }], "excludedLeadIds"?: string[], "settings"?: object }',
    handler: createCampaignDraft,
  },
  'campaign.get_status': {
    name: 'campaign.get_status',
    description: 'Lee estado, settings y pasos de una campana sin modificarla.',
    inputSchema: '{ "campaignId": string }',
    handler: getCampaignStatus,
  },
  'campaign.update': {
    name: 'campaign.update',
    description: 'Actualiza nombre/settings/exclusiones de una campana. Requiere aprobacion.',
    inputSchema: '{ "campaignId": string, "name"?: string, "settings"?: object, "excludedLeadIds"?: string[] }',
    handler: updateCampaign,
  },
  'campaign.launch': {
    name: 'campaign.launch',
    description: 'Activa una campana tras preflight. Requiere aprobacion fuerte y no envia inmediatamente fuera del cron.',
    inputSchema: '{ "campaignId": string, "preflightStatus": "pass" | "review" }',
    handler: launchCampaign,
  },
  'campaign.pause': {
    name: 'campaign.pause',
    description: 'Pausa una campana activa.',
    inputSchema: '{ "campaignId": string }',
    handler: pauseCampaign,
  },
  'campaign.resume': {
    name: 'campaign.resume',
    description: 'Reanuda una campana pausada tras confirmar preflight. Requiere aprobacion fuerte.',
    inputSchema: '{ "campaignId": string, "preflightStatus"?: "pass" | "review" }',
    handler: resumeCampaign,
  },
  'email.bulk_send': {
    name: 'email.bulk_send',
    description: 'Ejecuta dry-run o envio por lote muy limitado con aprobacion fuerte y confirmacion ENVIAR.',
    inputSchema: '{ "messages": object[], "dryRun"?: boolean, "limit"?: number, "strongConfirmationText"?: "ENVIAR" }',
    handler: bulkSend,
  },
  'crm.update_stage': {
    name: 'crm.update_stage',
    description: 'Actualiza el stage CRM de uno o varios leads. Requiere aprobacion.',
    inputSchema: '{ "leadId"?: string, "leadIds"?: string[], "stage": string }',
    handler: updateCrmStage,
  },
  'crm.set_next_action': {
    name: 'crm.set_next_action',
    description: 'Registra la proxima accion comercial para uno o varios leads. Requiere aprobacion.',
    inputSchema: '{ "leadId"?: string, "leadIds"?: string[], "nextAction": string, "nextActionType"?: string, "nextActionDueAt"?: string }',
    handler: setCrmNextAction,
  },
  'crm.add_note': {
    name: 'crm.add_note',
    description: 'Agrega o actualiza una nota operativa en CRM para uno o varios leads. Requiere aprobacion.',
    inputSchema: '{ "leadId"?: string, "leadIds"?: string[], "note": string }',
    handler: addCrmNote,
  },
  'crm.assign_owner': {
    name: 'crm.assign_owner',
    description: 'Asigna owner comercial a uno o varios leads. Requiere aprobacion.',
    inputSchema: '{ "leadId"?: string, "leadIds"?: string[], "owner": string }',
    handler: assignCrmOwner,
  },
  'pipeline.detect_stalled': {
    name: 'pipeline.detect_stalled',
    description: 'Detecta leads contactados sin respuesta o accion reciente.',
    inputSchema: '{ "days"?: number, "limit"?: number }',
    handler: detectStalledPipeline,
  },
  'followup.suggest': {
    name: 'followup.suggest',
    description: 'Sugiere proximas acciones para leads estancados o replies.',
    inputSchema: '{ "days"?: number, "limit"?: number }',
    handler: suggestFollowup,
  },
  'followup.create_tasks': {
    name: 'followup.create_tasks',
    description: 'Crea tareas de seguimiento en CRM. Requiere aprobacion.',
    inputSchema: '{ "tasks": object[], "limit"?: number }',
    handler: createFollowupTasks,
  },
  'compliance.preflight_email': {
    name: 'compliance.preflight_email',
    description: 'Ejecuta preflight de email individual contra contactabilidad, placeholders y copy riesgoso.',
    inputSchema: '{ "to"?: string, "email"?: string, "subject": string, "htmlBody"?: string, "textBody"?: string }',
    handler: preflightEmail,
  },
  'compliance.preflight_campaign': {
    name: 'compliance.preflight_campaign',
    description: 'Ejecuta preflight por muestra de campana y persiste preview si pertenece a un job.',
    inputSchema: '{ "messages"?: object[], "sampleMessages"?: object[], "audienceCount"?: number, "sampleLimit"?: number }',
    handler: preflightCampaign,
  },
  'replies.sync': {
    name: 'replies.sync',
    description: 'Sincroniza replies de Gmail/Outlook para la organizacion.',
    inputSchema: '{ "limit"?: number }',
    handler: repliesSync,
  },
  'replies.summarize': {
    name: 'replies.summarize',
    description: 'Resume replies recientes ya registradas.',
    inputSchema: '{ "limit"?: number }',
    handler: summarizeReplies,
  },
  'replies.classify_batch': {
    name: 'replies.classify_batch',
    description: 'Clasifica replies por lote sin enviar respuestas.',
    inputSchema: '{ "replies"?: object[], "limit"?: number }',
    handler: classifyRepliesBatch,
  },
  'thread.reply_draft': {
    name: 'thread.reply_draft',
    description: 'Crea un borrador de respuesta para un contacted lead. No envia.',
    inputSchema: '{ "contactedId": string, "rawReply"?: string, "replySubject"?: string }',
    handler: threadReplyDraft,
  },
  'thread.reply_send': {
    name: 'thread.reply_send',
    description: 'Envia una respuesta aprobada a partir de un borrador. Requiere aprobacion fuerte.',
    inputSchema: '{ "draftId"?: string, "contactedId"?: string, "to"?: string, "subject"?: string, "htmlBody"?: string, "textBody"?: string }',
    handler: threadReplySend,
  },
  'playbook.list': {
    name: 'playbook.list',
    description: 'Lista playbooks SUPL.IA reutilizables.',
    inputSchema: '{ "status"?: "active" | "draft" | "archived" | "all", "limit"?: number }',
    handler: listPlaybooks,
  },
  'playbook.get': {
    name: 'playbook.get',
    description: 'Lee un playbook SUPL.IA completo.',
    inputSchema: '{ "playbookId": string }',
    handler: getPlaybook,
  },
  'playbook.create': {
    name: 'playbook.create',
    description: 'Crea un playbook desde pasos dados o desde un job exitoso. Requiere aprobacion.',
    inputSchema: '{ "name"?: string, "description"?: string, "sourceJobId"?: string, "steps"?: object[], "guardrails"?: object }',
    handler: createPlaybook,
  },
  'playbook.update': {
    name: 'playbook.update',
    description: 'Actualiza un playbook existente. Requiere aprobacion.',
    inputSchema: '{ "playbookId": string, "name"?: string, "description"?: string, "steps"?: object[], "guardrails"?: object, "status"?: string }',
    handler: updatePlaybook,
  },
  'playbook.archive': {
    name: 'playbook.archive',
    description: 'Archiva un playbook para que no se use por defecto. Requiere aprobacion.',
    inputSchema: '{ "playbookId": string }',
    handler: archivePlaybook,
  },
  'playbook.apply': {
    name: 'playbook.apply',
    description: 'Crea un nuevo job desde un playbook sin saltarse aprobaciones sensibles. Requiere aprobacion.',
    inputSchema: '{ "playbookId": string, "goal"?: string, "title"?: string }',
    handler: applyPlaybook,
  },
  'memory.search': {
    name: 'memory.search',
    description: 'Busca memorias de SUPL.IA por estado/tipo.',
    inputSchema: '{ "status"?: "approved" | "proposed", "memoryType"?: string, "limit"?: number }',
    handler: searchMemory,
  },
  'memory.propose': {
    name: 'memory.propose',
    description: 'Propone memorias editables sin aprobarlas automaticamente.',
    inputSchema: '{ "memories"?: object[], "memoryType"?: string, "key"?: string, "value"?: object | string, "confidence"?: number }',
    handler: proposeMemory,
  },
  'memory.save': {
    name: 'memory.save',
    description: 'Aprueba una memoria propuesta para uso futuro. Requiere aprobacion.',
    inputSchema: '{ "memoryId": string }',
    handler: saveMemory,
  },
  'memory.forget': {
    name: 'memory.forget',
    description: 'Archiva una memoria para dejar de usarla. Requiere aprobacion.',
    inputSchema: '{ "memoryId": string }',
    handler: forgetMemory,
  },
  'antonia.create_mission': {
    name: 'antonia.create_mission',
    description: 'Crea una mision ANTONIA pausada. Requiere aprobacion y no dispara automatizacion.',
    inputSchema: '{ "title": string, "goalSummary"?: string, "goal"?: string, "params"?: object, "dailySearchLimit"?: number, "dailyEnrichLimit"?: number, "dailyInvestigateLimit"?: number, "dailyContactLimit"?: number }',
    handler: createAntoniaMission,
  },
  'email.send': {
    name: 'email.send',
    description: 'Envia un email real por Gmail u Outlook. Requiere aprobacion humana antes de ejecutarse.',
    inputSchema: '{ "to": string, "subject": string, "htmlBody": string, "textBody"?: string, "provider"?: "gmail" | "outlook", "recipientName"?: string, "company"?: string, "role"?: string, "leadId"?: string }',
    handler: sendEmail,
  },
};

export function getSupliaTool(name: string) {
  return SUPLIA_TOOLS[name] || null;
}

export function listSupliaToolSummaries(): Array<Pick<SupliaToolDefinition, 'name' | 'description' | 'inputSchema'> & { policy: SupliaPolicy }> {
  return Object.values(SUPLIA_TOOLS).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    policy: getSupliaPolicy(tool.name),
  }));
}
