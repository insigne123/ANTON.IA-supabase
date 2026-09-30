import { corporateDomain, extractEmailAddress, isCompanyColleague, mailboxAccessToken, normalizeEmail, syncColleagueMessage, syncSingleContactRow } from './reply-sync';
import { mailboxSweepDue, SWEEP_COLLEAGUE_BUDGET, SWEEP_MATCH_BUDGET, SWEEP_PAGE_BUDGET, SWEEP_WINDOW_DAYS } from './reply-sync-policy';

/** Mailbox-level history sweep (stage 6.3). Discovery only: every candidate
 * contact goes through the same verified-thread pipeline as the per-row tick.
 * Bounded per tick (pages + matches) and resumable through a durable cursor.
 * Never throws: failures are recorded in the sweep state for the next tick.
 *
 * Stage 6.4: a message from somebody who is not a contact but works at a company we wrote to (same corporate domain) is the
 * company answering, in the thread or not. It is read and recorded as a reply on that company's latest contact, which is what
 * stops the rest of the company (findCompanyReply). */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SENT_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;

export type MailboxSweepResult = {
  provider: 'gmail' | 'outlook';
  due: boolean;
  reason: string;
  pages: number;
  matched: number;
  synced: number;
  /** Messages from somebody else at a contacted company recorded as the company's reply (also counted in `synced`). */
  colleagues: number;
  completedWindow: boolean;
  error?: string;
};

type SweepStateRow = {
  window_days?: number | null;
  page_token?: string | null;
  window_started_at?: string | null;
  last_completed_at?: string | null;
  last_error?: string | null;
};

function clampWindowDays(value: unknown) {
  const days = Number(value);
  if (!Number.isFinite(days)) return SWEEP_WINDOW_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), 90);
}

async function saveState(supabase: any, keys: { organizationId: string; userId: string; provider: string }, patch: Record<string, unknown>) {
  const { error } = await supabase.from('cowork_mailbox_sweep_state').upsert({
    organization_id: keys.organizationId, user_id: keys.userId, provider: keys.provider,
    updated_at: new Date().toISOString(), ...patch,
  }, { onConflict: 'organization_id,user_id,provider' });
  if (error) throw new Error(`sweep_state_persistence_failed:${error.code || 'unknown'}`);
}

async function gmailListPage(accessToken: string, windowDays: number, pageToken: string | null) {
  const params = new URLSearchParams({
    q: `newer_than:${windowDays}d`,
    maxResults: '50',
    fields: 'messages(id,threadId),nextPageToken,resultSizeEstimate',
  });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gmail sweep list failed (${res.status})`);
  return res.json() as Promise<{ messages?: Array<{ id: string; threadId?: string }>; nextPageToken?: string }>;
}

async function gmailFrom(messages: Array<{ id: string }>, accessToken: string) {
  const out = new Map<string, { from: string; internalDateMs: number }>();
  for (let index = 0; index < messages.length; index += 10) {
    const chunk = await Promise.all(messages.slice(index, index + 10).map(async (item) => {
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&fields=id,internalDate,payload/headers`, {
        headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) return null;
        // Provider failures are not evidence that a message is absent: retry this window.
        throw new Error(`Gmail sweep metadata failed (${res.status})`);
      }
      const data = await res.json();
      const from = (data?.payload?.headers || []).find((header: any) => String(header?.name || '').toLowerCase() === 'from')?.value || '';
      return { id: data?.id || item.id, from: extractEmailAddress(from), internalDateMs: Number(data?.internalDate || 0) };
    }));
    for (const item of chunk) if (item?.from) out.set(item.id, item);
  }
  return out;
}

async function graphFetch(accessToken: string, path: string) {
  return fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ConsistencyLevel: 'eventual', Accept: 'application/json' },
    cache: 'no-store',
  });
}

async function outlookListPage(accessToken: string, windowStartIso: string, nextLink: string | null) {
  let path: string | null;
  if (nextLink) {
    if (!nextLink.startsWith(GRAPH_BASE)) throw new Error('Invalid Graph pagination URL');
    path = nextLink.slice(GRAPH_BASE.length);
  } else {
    const params = new URLSearchParams({
      '$filter': `receivedDateTime gt ${windowStartIso}`,
      '$orderby': 'receivedDateTime asc',
      '$top': '50',
      '$select': 'id,conversationId,from,receivedDateTime',
    });
    path = `/me/messages?${params}`;
  }
  const res = await graphFetch(accessToken, path);
  if (!res.ok) throw new Error(`Outlook sweep list failed (${res.status})`);
  const data = await res.json();
  const link = data['@odata.nextLink'];
  if (link && !String(link).startsWith(GRAPH_BASE)) throw new Error('Invalid Graph pagination URL');
  return { messages: (data.value || []) as Array<{ id: string; conversationId?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime?: string }>, nextLink: link ? String(link) : null };
}

/** The domains of the mailbox itself: what its owner sends is never a company answering (the mailbox lists what was sent too). */
async function ownMailboxDomains(provider: 'gmail' | 'outlook', accessToken: string) {
  const addresses: unknown[] = [];
  if (provider === 'gmail') {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    if (!res.ok) throw new Error(`Gmail sweep profile failed (${res.status})`);
    addresses.push((await res.json())?.emailAddress);
  } else {
    const res = await graphFetch(accessToken, '/me?$select=mail,userPrincipalName');
    if (!res.ok) throw new Error(`Outlook sweep profile failed (${res.status})`);
    const profile = await res.json();
    addresses.push(profile?.mail, profile?.userPrincipalName);
  }
  return new Set(addresses.map(address => corporateDomain(extractEmailAddress(String(address || '')))).filter((domain): domain is string => Boolean(domain)));
}

export async function sweepMailboxForOwner(supabase: any, input: { organizationId: string; userId: string; provider: 'gmail' | 'outlook' }, now = Date.now()): Promise<MailboxSweepResult> {
  const { organizationId, userId, provider } = input;
  const idle: MailboxSweepResult = { provider, due: false, reason: 'cooling_down', pages: 0, matched: 0, synced: 0, colleagues: 0, completedWindow: false };
  try {
    const { data: stateRows, error: stateError } = await supabase.from('cowork_mailbox_sweep_state')
      .select('window_days,page_token,window_started_at,last_completed_at')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('provider', provider).limit(1);
    if (stateError) throw stateError;
    const state = ((stateRows || [])[0] || null) as SweepStateRow | null;
    const due = mailboxSweepDue(state, now);
    if (!due.due) return { ...idle, reason: due.reason };
    const windowDays = clampWindowDays(state?.window_days);
    const resuming = due.reason === 'resume_window' && state?.page_token;

    const accessToken = await mailboxAccessToken(supabase, userId, provider);
    if (!accessToken) return { ...idle, due: true, reason: 'connection_required' };

    const windowStartMs = resuming && state?.window_started_at ? Date.parse(state.window_started_at) : now;
    const windowStartIso = new Date(resuming && Number.isFinite(windowStartMs) ? windowStartMs : now - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: contacts, error: contactsError } = await supabase.from('contacted_leads')
      .select('id, user_id, organization_id, mission_id, lead_id, name, email, company, role, subject, sent_at, status, provider, message_id, thread_id, conversation_id, internet_message_id, lifecycle_state, reply_intent, replied_at')
      .eq('organization_id', organizationId).eq('user_id', userId).eq('provider', provider)
      .not('sent_at', 'is', null)
      .gte('sent_at', new Date(Date.parse(windowStartIso) - SENT_LOOKBACK_MS).toISOString())
      .order('sent_at', { ascending: false }).limit(1000);
    if (contactsError) throw contactsError;
    if ((contacts || []).length >= 1000) throw new Error('contact_history_truncated');
    const byEmail = new Map<string, any[]>();
    for (const row of contacts || []) {
      const email = normalizeEmail(row.email);
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(row);
    }
    // The companies we wrote to, by corporate domain (free mail and shared providers never identify a company).
    const byDomain = new Map<string, any[]>();
    for (const row of contacts || []) {
      const domain = corporateDomain(row.email);
      if (domain) byDomain.set(domain, [...(byDomain.get(domain) || []), row]);
    }
    // Somebody who is not a contact, at a company we wrote to, writing after that contact: the company answering. The row it is
    // recorded on is the company's latest contact from before the message (a bounced address is no place to record an answer).
    const colleagues: Array<{ id: string; domain: string; receivedMs: number; row: any }> = [];
    const collectColleague = (id: string | undefined, from: string, receivedMs: number) => {
      const domain = corporateDomain(from);
      const domainRows = domain ? byDomain.get(domain) : undefined;
      if (!id || !domain || !domainRows || !Number.isFinite(receivedMs)) return;
      const row = domainRows.filter(item => item.status !== 'failed' && Date.parse(item.sent_at) + 1000 < receivedMs)
        .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];
      if (!row || !isCompanyColleague(from, row.email)) return;
      if (row.replied_at && receivedMs <= Date.parse(row.replied_at)) return;
      colleagues.push({ id, domain, receivedMs, row });
    };
    let ownDomains: Set<string> | null = null;

    let cursor: string | null = (resuming ? state?.page_token : null) || null;
    let pages = 0;
    let matched = 0;
    let synced = 0;
    let recordedColleagues = 0;
    const matchedIds: string[] = [];
    const seen = new Set<string>();
    const startedAt = resuming && state?.window_started_at ? state.window_started_at : new Date(now).toISOString();

    for (let page = 0; page < SWEEP_PAGE_BUDGET; page++) {
      let next: string | null;
      if (provider === 'gmail') {
        const listed = await gmailListPage(accessToken, windowDays, cursor);
        const metas = await gmailFrom(listed.messages || [], accessToken);
        for (const [id, meta] of metas) {
          const rows = byEmail.get(meta.from) || [];
          for (const row of rows) {
            const sentAtMs = Date.parse(row.sent_at);
            if (!Number.isFinite(sentAtMs) || !(meta.internalDateMs > sentAtMs + 1000)) continue;
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            matchedIds.push(row.id);
          }
          if (!rows.length) collectColleague(id, meta.from, meta.internalDateMs);
        }
        next = listed.nextPageToken || null;
      } else {
        const listed = await outlookListPage(accessToken, windowStartIso, cursor);
        for (const message of listed.messages) {
          const from = normalizeEmail(message.from?.emailAddress?.address);
          const receivedMs = Date.parse(message.receivedDateTime || '');
          const rows = byEmail.get(from) || [];
          for (const row of rows) {
            const sentAtMs = Date.parse(row.sent_at);
            if (!from || !Number.isFinite(receivedMs) || !(receivedMs > sentAtMs + 1000)) continue;
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            matchedIds.push(row.id);
          }
          if (from && !rows.length) collectColleague(message.id, from, receivedMs);
        }
        next = listed.nextLink;
      }
      // Do not advance past a page that contains more candidates than the
      // processing budget. Otherwise a "complete" sweep silently loses them.
      if (matchedIds.length > SWEEP_MATCH_BUDGET) throw new Error('sweep_match_budget_exceeded');
      const rowById = new Map<string, any>((contacts || []).map((row: any) => [row.id, row] as [string, any]));
      for (const id of matchedIds) {
        const row = rowById.get(id);
        if (!row) continue;
        matched += 1;
        const single = await syncSingleContactRow(supabase, organizationId, row, accessToken);
        synced += single.synced;
        if (single.state !== 'ok') throw new Error(single.state);
      }
      matchedIds.length = 0;
      // What somebody else at a contacted company sent: read in full and recorded as the company's reply. Past the budget, what is
      // left is still unrecorded, so the next window finds it again.
      let read = 0;
      for (const candidate of colleagues.splice(0)) {
        if (read >= SWEEP_COLLEAGUE_BUDGET) break;
        ownDomains ??= await ownMailboxDomains(provider, accessToken);
        if (ownDomains.has(candidate.domain)) continue;
        // A message of this page may already have been recorded for the company, which moves its reply forward.
        if (candidate.row.replied_at && candidate.receivedMs <= Date.parse(candidate.row.replied_at)) continue;
        read += 1;
        let result;
        try { result = await syncColleagueMessage(supabase, candidate.row, accessToken, candidate.id); }
        catch (error) {
          // A message deleted or moved between the listing and the read is gone, not a provider failure: the window goes on.
          if (/\((404|410)\)/.test(String((error as Error)?.message))) continue;
          throw error;
        }
        if (result.recorded) {
          recordedColleagues += 1;
          synced += 1;
          candidate.row.replied_at = new Date(candidate.receivedMs).toISOString();
        }
      }
      pages += 1;
      cursor = next;
      await saveState(supabase, { organizationId, userId, provider }, {
        window_days: windowDays, page_token: cursor, window_started_at: startedAt, last_error: null,
      });
      if (!cursor) break;
    }

    const completedWindow = cursor === null;
    if (completedWindow) {
      await saveState(supabase, { organizationId, userId, provider }, {
        window_days: windowDays, page_token: null, window_started_at: startedAt,
        last_completed_at: new Date(now).toISOString(), last_error: null,
      });
    }
    return { provider, due: true, reason: resuming ? 'resume_window' : 'sweep_window', pages, matched, synced, colleagues: recordedColleagues, completedWindow };
  } catch (err: any) {
    // Refresh failures can contain upstream OAuth details. Persist only a
    // stable code, never tokens, provider bodies or recipient data.
    const raw = String(err?.message || err || 'sweep_failed');
    const message = /refresh|invalid_grant|unauthoriz|AADSTS/i.test(raw) ? 'connection_required'
      : /Gmail sweep (list|profile|metadata) failed|Outlook sweep (list|profile) failed|message lookup failed/.test(raw) ? 'mailbox_provider_unavailable'
      : /sweep_match_budget_exceeded|contact_history_truncated|sync_failed|incomplete_thread/.test(raw)
        ? raw.match(/sweep_match_budget_exceeded|contact_history_truncated|sync_failed|incomplete_thread/)![0]
        : 'sweep_failed';
    await saveState(supabase, { organizationId, userId, provider }, { last_error: message }).catch(() => null);
    return { ...idle, due: true, reason: 'sweep_failed', error: message };
  }
}
