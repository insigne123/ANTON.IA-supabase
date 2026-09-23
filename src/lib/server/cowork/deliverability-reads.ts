import { z } from 'zod';
import { promises as dns } from 'node:dns';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DKIM_SELECTORS, contrastSender, diagnoseBounces, evaluateDkim, evaluateDmarc, evaluateMx, evaluateSpf,
  normalizeDomain, summarizeDomain, topRecipientDomains, type DomainReport,
} from '@/lib/deliverability';
import { mailboxAccessToken } from '@/lib/server/reply-sync';

type Scope = { userId: string; organizationId: string };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DNS_TIMEOUT_MS = 6000;
const SENDER_SAMPLE_LIMIT = 5;

function timeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), DNS_TIMEOUT_MS);
  })]).finally(() => { if (timer) clearTimeout(timer); });
}

/** An absent DNS record is evidence; a resolver failure is not. Never cache a
 * timeout or SERVFAIL as "no SPF/DMARC/MX". */
function emptyOnMissing<T>(promise: Promise<T>, empty: T): Promise<T> {
  return promise.catch((error: { code?: string }) => {
    if (error?.code === 'ENODATA' || error?.code === 'ENOTFOUND' || error?.code === 'ENODOMAIN') return empty;
    throw error;
  });
}

/** Live DNS with injectable resolver for tests. */
export async function lookupDomainDns(domain: string, resolver: {
  mx: (domain: string) => Promise<Array<{ exchange: string }>>;
  txt: (name: string) => Promise<string[][]>;
} = { mx: (name) => dns.resolveMx(name), txt: (name) => dns.resolveTxt(name) }) {
  const settled = await Promise.all([
    timeout(emptyOnMissing(resolver.mx(domain), [] as Array<{ exchange: string }>), 'dns_mx'),
    timeout(emptyOnMissing(resolver.txt(domain), [] as string[][]), 'dns_spf'),
    timeout(emptyOnMissing(resolver.txt(`_dmarc.${domain}`), [] as string[][]), 'dns_dmarc'),
    Promise.all(DKIM_SELECTORS.map((selector) =>
      timeout(emptyOnMissing(resolver.txt(`${selector}._domainkey.${domain}`), [] as string[][]), 'dns_dkim')
        .then((records) => ({ selector, records })))),
  ]);
  return { mx: settled[0], spf: settled[1], dmarc: settled[2], dkim: settled[3] };
}

/** 8.1 Domain deliverability with a 24h organization cache. */
export async function readDeliverabilityCheck(client: SupabaseClient, scope: Scope, value: string, live = lookupDomainDns) {
  const domain = normalizeDomain(z.string().max(120).parse(value));
  if (!domain) throw new Error('Indica un dominio válido, por ejemplo yago.cl.');
  const cached = await client.from('cowork_deliverability_checks')
    .select('result,checked_at').eq('organization_id', scope.organizationId).eq('domain', domain).limit(1);
  if (!cached.error) {
    const row = ((cached.data as Array<{ result?: DomainReport; checked_at?: string }>) || [])[0];
    if (row?.result && row.checked_at && Date.now() - Date.parse(row.checked_at) < CACHE_TTL_MS) {
      return { scope: 'organization_deliverability', report: { ...row.result, source: 'cache' as const } };
    }
  }
  const found = await live(domain);
  // An arbitrary TXT at selector._domainkey is not a DKIM public key.
  const dkimHit = found.dkim.find((entry) => entry.records.some((record) =>
    /(?:^|;)\s*p\s*=\s*[A-Za-z0-9+/=]+(?:;|$)/i.test(record.join(''))))?.selector || null;
  const report = summarizeDomain({
    domain, checkedAt: new Date().toISOString(), source: 'live' as const,
    mx: evaluateMx(found.mx.length),
    spf: evaluateSpf(found.spf),
    dmarc: evaluateDmarc(found.dmarc),
    dkim: evaluateDkim(dkimHit, DKIM_SELECTORS.length),
  });
  await client.from('cowork_deliverability_checks').upsert({
    organization_id: scope.organizationId, domain, result: report,
    checked_at: report.checkedAt, updated_at: report.checkedAt,
  }, { onConflict: 'organization_id,domain' }).then(() => null, () => null);
  return { scope: 'organization_deliverability', report };
}

/** 8.2 Bounce causes against the 2% threshold. */
export async function readDeliverabilityBounces(client: SupabaseClient, scope: Scope) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [bounced, sent] = await Promise.all([
    client.from('contacted_leads').select('bounce_category,email').eq('organization_id', scope.organizationId)
      .not('bounced_at', 'is', null).gte('bounced_at', since).limit(1000),
    client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId).gte('sent_at', since),
  ]);
  const failed = [bounced, sent].find((result) => result.error)?.error;
  if (failed) throw new Error('No se pudieron diagnosticar los rebotes.');
  const rows = (bounced.data as Array<{ bounce_category?: string | null; email?: string | null }>) || [];
  return { scope: 'organization_deliverability', period: 'last_30_days',
    ...diagnoseBounces({ categories: rows.map((row) => row.bounce_category), sent: Number((sent as { count?: number }).count || 0) }),
    recipientDomains: topRecipientDomains(rows.map((row) => row.email)),
    limitation: 'Dominios destinatarios agregados; los buzones individuales no salen de esta lectura.' };
}

function headerValue(headers: Array<{ name?: string; value?: string }>, name: string) {
  return (headers || []).filter((header) => String(header?.name || '').toLowerCase() === name.toLowerCase())
    .map((header) => String(header?.value || '')).join(' ');
}

/** 8.3 Declared profile identity vs the headers providers actually stamped. */
export async function readDeliverabilitySender(client: SupabaseClient, scope: Scope) {
  const profile = await client.from('profiles').select('email,full_name,company_domain').eq('id', scope.userId).maybeSingle();
  if (profile.error) throw new Error('No se pudo contrastar el remitente.');
  const declared = (profile.data as { email?: string | null; full_name?: string | null; company_domain?: string | null }) || null;
  const sent = await client.from('contacted_leads').select('message_id,provider,subject,sent_at')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .in('provider', ['gmail', 'outlook']).not('message_id', 'is', null)
    .order('sent_at', { ascending: false }).limit(SENDER_SAMPLE_LIMIT);
  if (sent.error) throw new Error('No se pudo contrastar el remitente.');
  const rows = (sent.data as Array<{ message_id?: string | null; provider?: string | null; subject?: string | null; sent_at?: string | null }>) || [];
  const samples = [];
  let unavailable = 0;
  for (const row of rows) {
    try {
      const accessToken = await mailboxAccessToken(client as never, scope.userId, String(row.provider || ''));
      if (!accessToken || !row.message_id) { unavailable += 1; continue; }
      const headers = row.provider === 'gmail'
        ? await gmailSentHeaders(accessToken, String(row.message_id))
        : await outlookSentHeaders(accessToken, String(row.message_id));
      samples.push(contrastSender({
        profileEmail: declared?.email, profileDomain: declared?.company_domain,
        from: headerValue(headers, 'From'), returnPath: headerValue(headers, 'Return-Path'),
        authHeader: headerValue(headers, 'Authentication-Results'),
        messageId: row.message_id, subject: row.subject, sentAt: row.sent_at,
      }));
    } catch { unavailable += 1; }
  }
  const identities = samples.map((sample) => sample.identity);
  return { scope: 'organization_deliverability',
    declared: declared ? { email: declared.email, name: declared.full_name, domain: declared.company_domain } : null,
    samples, unavailable,
    verdict: samples.length === 0 ? 'unverified'
      : identities.every((identity) => identity === 'matches_profile') ? 'consistent'
      : identities.some((identity) => identity === 'differs_from_profile') ? 'inconsistent' : 'unverified',
    limitation: 'Muestra de los últimos envíos con identificador; lo no muestreado no se afirma.' };
}

async function gmailSentHeaders(accessToken: string, messageId: string) {
  const params = new URLSearchParams({ format: 'metadata', fields: 'payload/headers' });
  for (const name of ['From', 'Return-Path', 'Authentication-Results', 'DKIM-Signature', 'Message-ID', 'Subject']) params.append('metadataHeaders', name);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gmail sent lookup failed (${res.status})`);
  const data = await res.json();
  return (data?.payload?.headers || []) as Array<{ name?: string; value?: string }>;
}

async function outlookSentHeaders(accessToken: string, messageId: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=from,subject,sentDateTime,internetMessageHeaders`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Outlook sent lookup failed (${res.status})`);
  const data = await res.json();
  return (data?.internetMessageHeaders || []) as Array<{ name?: string; value?: string }>;
}
