// When Apollo identifies a person but has no email for them, find it ourselves: build the probable addresses from the
// name and the company's domain (patterns.ts) and keep the first one Reoon confirms exists (reoon.ts). Runs on the
// Apollo reconciliation tick, a few leads at a time; claim_email_finder_candidates_v1 picks the leads and
// complete_email_finder_attempt_v1 saves the address on the lead only if it still has none.
import { resolveMx } from 'node:dns/promises';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

import {
  confidentPattern,
  domainEvidence,
  emailCandidates,
  normalizeDomain,
  parseName,
  type DomainEvidence,
} from './patterns';
import { ReoonError, verifyEmailWithReoon, type ReoonStatus } from './reoon';

type ServiceClient = any;

type Lead = {
  attemptId: string;
  claimedAt: string;
  targetTable: 'enriched_leads' | 'people_search_leads';
  targetLeadId: string;
  organizationId: string;
  userId: string;
  fullName: string;
  firstName: string;
  lastName: string;
  domains: string[];
};

type Outcome = {
  status: 'found' | 'guessed' | 'catch_all' | 'not_found' | 'no_domain' | 'no_name' | 'no_mx' | 'suppressed' | 'retry' | 'release';
  domain?: string;
  email?: string;
  emailStatus?: 'verified' | 'extrapolated';
  pattern?: string;
  verifications: number;
  lastResult?: string;
  retryAfterSeconds?: number;
};

type Dependencies = {
  client: ServiceClient;
  apiKey: string;
  maxCandidates: number;
  deadline: number;
  now: Date;
  fetchImpl?: typeof fetch;
  lookupMx: (domain: string) => Promise<boolean>;
};

const CATCH_ALL_MEMORY_DAYS = 30;

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : '';
}

function bounded(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseLead(row: any): Lead | null {
  const targetTable = row?.target_table;
  const attemptId = text(row?.attempt_id, 36);
  const claimedAt = text(row?.claimed_at, 64);
  if ((targetTable !== 'enriched_leads' && targetTable !== 'people_search_leads') || !attemptId || !claimedAt) return null;
  const domains = [row?.lead_domain, row?.website_domain, row?.company_domain].map(normalizeDomain).filter(Boolean);
  return {
    attemptId,
    claimedAt,
    targetTable,
    targetLeadId: text(row?.target_lead_id, 255),
    organizationId: text(row?.organization_id, 36),
    userId: text(row?.user_id, 36),
    fullName: text(row?.full_name, 300),
    firstName: text(row?.first_name, 150),
    lastName: text(row?.last_name, 150),
    domains: [...new Set(domains)],
  };
}

async function defaultLookupMx(domain: string) {
  try {
    return (await resolveMx(domain)).some(record => Boolean(record.exchange));
  } catch (error: any) {
    if (['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes(error?.code)) return false;
    throw error;
  }
}

/** Verified addresses already known at the domain, as evidence of the company's format. Only the format is kept. */
async function loadEvidence(client: ServiceClient, domain: string, lead: Lead): Promise<DomainEvidence> {
  const reads = await Promise.all([
    client.from('enriched_leads').select('id,email,first_name,last_name,full_name')
      .eq('email_status', 'verified').ilike('email', `%@${domain}`).limit(60),
    client.from('people_search_leads').select('id,email,first_name,last_name,name')
      .eq('email_status', 'verified').ilike('email', `%@${domain}`).limit(60),
  ]);
  const examples: Array<{ local: string; name: ReturnType<typeof parseName> }> = [];
  const seen = new Set<string>();
  for (const { data, error } of reads) {
    if (error) throw error;
    for (const row of data || []) {
      if (row.id === lead.targetLeadId) continue;
      const email = String(row.email || '').trim().toLowerCase();
      const [local, host] = email.split('@');
      if (host !== domain || !local || seen.has(email)) continue;
      seen.add(email);
      examples.push({ local, name: parseName({ fullName: row.full_name || row.name, firstName: row.first_name, lastName: row.last_name }) });
    }
  }
  return domainEvidence(examples);
}

async function knownCatchAll(client: ServiceClient, domain: string, now: Date) {
  const since = new Date(now.getTime() - CATCH_ALL_MEMORY_DAYS * 86_400_000).toISOString();
  const { data, error } = await client.from('email_finder_attempts').select('id')
    .eq('domain', domain).in('status', ['catch_all', 'guessed']).gte('updated_at', since).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function suppressed(client: ServiceClient, lead: Lead, emails: string[]) {
  const { data, error } = await client.rpc('has_apollo_enrichment_email_suppression_v1', {
    p_user_id: lead.userId,
    p_organization_id: lead.organizationId,
    p_emails: emails,
  });
  if (error) throw error;
  return data === true;
}

async function findEmail(lead: Lead, deps: Dependencies): Promise<Outcome> {
  const name = parseName({ fullName: lead.fullName, firstName: lead.firstName, lastName: lead.lastName });
  if (!name) return { status: 'no_name', verifications: 0 };
  let domain = '';
  for (const option of lead.domains) {
    if (await deps.lookupMx(option)) {
      domain = option;
      break;
    }
  }
  if (!domain) return { status: lead.domains.length ? 'no_mx' : 'no_domain', domain: lead.domains[0], verifications: 0 };

  const evidence = await loadEvidence(deps.client, domain, lead);
  const candidates = emailCandidates(name, domain, evidence, deps.maxCandidates);
  if (!candidates.length) return { status: 'no_name', domain, verifications: 0 };
  if (await suppressed(deps.client, lead, candidates.map(candidate => candidate.email))) {
    return { status: 'suppressed', domain, verifications: 0 };
  }

  const catchAll = (verifications: number, lastResult?: string): Outcome => {
    const pattern = confidentPattern(evidence);
    const guess = pattern && candidates.find(candidate => candidate.pattern === pattern);
    return guess
      ? { status: 'guessed', domain, email: guess.email, emailStatus: 'extrapolated', pattern, verifications, lastResult }
      : { status: 'catch_all', domain, verifications, lastResult };
  };
  // The domain accepts any address, so Reoon cannot tell which one is real: don't spend a check on it again.
  if (await knownCatchAll(deps.client, domain, deps.now)) return catchAll(0, 'catch_all_known');

  let verifications = 0;
  let unknown = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deps.deadline) return { status: 'release', domain, verifications };
    let result: ReoonStatus;
    try {
      result = await verifyEmailWithReoon(candidate.email, { apiKey: deps.apiKey, fetchImpl: deps.fetchImpl });
    } catch (error) {
      if (error instanceof ReoonError) Object.assign(error, { verifications });
      throw error;
    }
    verifications += 1;
    if (result === 'safe') {
      return { status: 'found', domain, email: candidate.email, emailStatus: 'verified', pattern: candidate.pattern, verifications, lastResult: result };
    }
    // The mailbox exists but is full right now: keep it, marked as not confirmed.
    if (result === 'inbox_full') {
      return { status: 'found', domain, email: candidate.email, emailStatus: 'extrapolated', pattern: candidate.pattern, verifications, lastResult: result };
    }
    if (result === 'catch_all') return catchAll(verifications, result);
    if (result === 'unknown') unknown += 1;
  }
  // Every answer was "unknown" (the server did not answer): try again later rather than give up.
  if (unknown && unknown === verifications) return { status: 'retry', domain, verifications, lastResult: 'unknown', retryAfterSeconds: 6 * 3600 };
  return { status: 'not_found', domain, verifications, lastResult: 'invalid' };
}

async function complete(client: ServiceClient, lead: Lead, outcome: Outcome) {
  const { data, error } = await client.rpc('complete_email_finder_attempt_v1', {
    p_attempt_id: lead.attemptId,
    p_claimed_at: lead.claimedAt,
    p_status: outcome.status,
    p_domain: outcome.domain || null,
    p_email: outcome.email || null,
    p_email_status: outcome.emailStatus || null,
    p_pattern: outcome.pattern || null,
    p_verifications: outcome.verifications,
    p_last_result: outcome.lastResult || null,
    p_retry_after_seconds: outcome.retryAfterSeconds ?? 0,
  });
  if (error) throw error;
  return String(data || '');
}

export async function runEmailFinderTick(input: {
  client?: ServiceClient;
  environment?: Record<string, string | undefined>;
  now?: Date;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  lookupMx?: (domain: string) => Promise<boolean>;
} = {}) {
  const environment = input.environment || process.env;
  const apiKey = String(environment.REOON_API_KEY || '').trim();
  if (environment.EMAIL_FINDER_ENABLED !== 'true' || !apiKey) return { enabled: false as const };

  const client = input.client || getSupabaseAdminClient();
  const now = input.now || new Date();
  const lookbackDays = bounded(environment.EMAIL_FINDER_LOOKBACK_DAYS, 1, 120, 60);
  const { data, error } = await client.rpc('claim_email_finder_candidates_v1', {
    p_limit: bounded(environment.EMAIL_FINDER_BATCH, 1, 25, 10),
    p_since: new Date(now.getTime() - lookbackDays * 86_400_000).toISOString(),
    p_claim_before: new Date(now.getTime() - 15 * 60_000).toISOString(),
  });
  if (error) throw error;
  const leads = (Array.isArray(data) ? data : []).map(parseLead).filter((lead): lead is Lead => lead !== null);

  const deps: Dependencies = {
    client,
    apiKey,
    maxCandidates: bounded(environment.EMAIL_FINDER_MAX_CANDIDATES, 1, 10, 6),
    deadline: Date.now() + (input.budgetMs ?? 120_000),
    now,
    fetchImpl: input.fetchImpl,
    lookupMx: input.lookupMx || defaultLookupMx,
  };
  const summary = { enabled: true as const, claimed: leads.length, verifications: 0, stoppedBy: '' as string,
    outcomes: {} as Record<string, number> };
  for (const lead of leads) {
    let outcome: Outcome;
    if (summary.stoppedBy) {
      outcome = { status: 'release', verifications: 0, retryAfterSeconds: 3600 };
    } else {
      try {
        outcome = await findEmail(lead, deps);
      } catch (error) {
        const verifications = Number((error as any)?.verifications) || 0;
        if (error instanceof ReoonError && error.fatal) {
          summary.stoppedBy = error.code;
          // Wait an hour before asking Reoon again (credits, key or rate limit).
          outcome = { status: 'release', verifications, lastResult: error.code, retryAfterSeconds: 3600 };
        } else {
          outcome = { status: 'retry', verifications, lastResult: error instanceof ReoonError ? error.code : 'error', retryAfterSeconds: 1800 };
        }
      }
    }
    summary.verifications += outcome.verifications;
    const saved = await complete(client, lead, outcome);
    summary.outcomes[saved] = (summary.outcomes[saved] || 0) + 1;
  }
  return summary;
}
