import type { SupabaseClient } from '@supabase/supabase-js';
import type { DropCallScript } from '@/lib/lead-drop-call';
import { dropCallsEmail, dropReadyEmail } from '@/lib/lead-drop-ready-email';
import { dropThread } from '@/lib/lead-drop-thread';
import { dropThreadSubject, type DropItem } from '@/lib/lead-drops';
import { MAIL_PROVIDER_LABEL } from '@/lib/mail-sender';
import { appLinkBase } from '@/lib/server/app-origins';
import { hashApolloCallbackToken } from '@/lib/server/apollo-enrichment-callbacks';
import { readAlertsEmail } from '@/lib/server/daily-alerts';
import { dropPhones, prepareDropCall } from '@/lib/server/lead-drop-call';
import { dropLinkBase, dropLinkUrl } from '@/lib/server/lead-drop-link';
import { readDrop, type DropScope } from '@/lib/server/lead-drops';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import { isTestAddress, sendReportEmail, type SelfEmail } from '@/lib/server/self-email';

/**
 * The answers to what a person does from the morning email of their contacts, sent back into that same conversation (15 Nov 2026,
 * src/lib/lead-drop-ready-email.ts and lead-drop-thread.ts): the contacts whose email was found, with their campaigns to approve,
 * after «Enriquecer los N»; and the mobiles as they land, each with the script of its call.
 *
 * Each contact goes in one email of each kind, once. It is claimed in the drop before the email leaves, under the drop's last
 * write: two answers of the provider that land together, or a second tap, find it claimed and send nothing. A send that fails
 * gives the claim back, so the next occasion tries again. Only drops of several contacts, whose morning email is their own;
 * nobody who turned the app's emails off in «Tu semana», has no address or has a test one gets any, and
 * LEAD_DROPS_CAMPAIGN_EMAIL=off stops them all. Server only.
 */

type Client = SupabaseClient;
type Stamp = 'campaignMailedAt' | 'callMailedAt';
type Env = Record<string, string | undefined>;
export type ReadyDeps = {
  send?: (input: SelfEmail) => Promise<{ ok: boolean }>;
  mailbox?: (client: Client, userId: string) => Promise<{ resolved: 'google' | 'outlook' | null }>;
  /** The script of a call that has none yet (prepareDropCall); `false` sends the mobiles with the scripts there are. */
  prepare?: false | ((leadId: string) => Promise<{ script: DropCallScript } | null>);
  appUrl?: string; env?: Env; now?: Date;
};
const skipped = (reason: string) => ({ sent: false as const, reason });
/** A mobile asked this long ago and still not here does not hold the others back: it may never come. */
const PHONE_WAIT_MS = 10 * 60_000;

/**
 * Marks the contacts as going in an email, and says which ones it marked. Written only if nobody wrote the drop since it was read;
 * otherwise it reads again. Whoever was marked meanwhile is left out.
 */
async function claim(client: Client, scope: DropScope, dropId: string, leadIds: string[], stamp: Stamp, at: string): Promise<string[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const row: any = await client.from('lead_drops').select('items,updated_at').eq('id', dropId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
    if (row.error || !row.data) return [];
    const items = (row.data.items || []) as DropItem[];
    const mine = items.filter(item => leadIds.includes(item.leadId) && !item[stamp]).map(item => item.leadId);
    if (!mine.length) return [];
    const next = items.map(item => mine.includes(item.leadId) ? { ...item, [stamp]: at } : item);
    const written: any = await client.from('lead_drops').update({ items: next, updated_at: new Date().toISOString() })
      .eq('id', dropId).eq('updated_at', row.data.updated_at).select('id');
    if (!written.error && written.data?.length) return mine;
  }
  return [];
}

/** The claim of an email that did not leave, given back: only the marks this try made. */
async function release(client: Client, scope: DropScope, dropId: string, leadIds: string[], stamp: Stamp, at: string) {
  const row: any = await client.from('lead_drops').select('items').eq('id', dropId).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (row.error || !row.data) return;
  const items = ((row.data.items || []) as DropItem[]).map(item => {
    if (!leadIds.includes(item.leadId) || item[stamp] !== at) return item;
    const { [stamp]: _mark, ...rest } = item;
    return rest as DropItem;
  });
  await client.from('lead_drops').update({ items, updated_at: new Date().toISOString() }).eq('id', dropId);
}

/** Whom the app may write to about this drop, and from where its links open. Null when nobody should get the email. */
async function reach(client: Client, scope: DropScope, dropId: string, deps: ReadyDeps) {
  const env = deps.env ?? process.env;
  const profile: any = await client.from('profiles').select('email,full_name,signatures').eq('id', scope.userId).maybeSingle();
  const to = String(profile.data?.email || '').trim();
  if (!to || isTestAddress(to) || !readAlertsEmail(profile.data?.signatures)) return null;
  const appUrl = deps.appUrl ?? appLinkBase(String(env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai'), env);
  const link = dropLinkUrl(appUrl, dropId, { now: deps.now, env });
  // Without a way in that needs no session there is no «from the inbox»: the app shows the same.
  if (!link) return null;
  return { to, name: String(profile.data?.full_name || ''), link, appUrl: dropLinkBase(appUrl, env) };
}

const send = (client: Client, deps: ReadyDeps) => deps.send ?? ((input: SelfEmail) => sendReportEmail(client, input));
const threadOf = (drop: { id: string; drop_date: string; items: DropItem[]; criteria?: { subject?: string | null } | null }, now: Date) =>
  dropThread({ dropId: drop.id, date: drop.drop_date, subject: dropThreadSubject(drop), reply: true, now });

/**
 * «Listos»: every contact of the drop that has its email and its campaign written and was not sent to the person's inbox yet, in
 * one email. `phones`: their mobiles were asked too, and the email says they follow.
 */
export async function mailDropReady(client: Client, scope: DropScope, dropId: string, options: { phones?: boolean } = {}, deps: ReadyDeps = {}) {
  const env = deps.env ?? process.env;
  if (env.LEAD_DROPS_CAMPAIGN_EMAIL === 'off') return skipped('off');
  const now = deps.now ?? new Date();
  const drop = await readDrop(client, scope, dropId);
  if (drop.items.length < 2) return skipped('single');
  const due = drop.items.filter(item => item.draft && item.savedLeadId && !item.campaign && !item.campaignMailedAt);
  if (!due.length) return skipped('not_due');
  const rows: any = await client.from('enriched_leads').select('id,email').in('id', due.map(item => String(item.savedLeadId)))
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  if (rows.error) return skipped('unreadable');
  const emails = new Map<string, string>(((rows.data || []) as any[]).map(row => [String(row.id), String(row.email || '').trim().toLowerCase()]));
  const found = due.filter(item => emails.get(String(item.savedLeadId)));
  if (!found.length) return skipped('not_due');
  const [target, mailbox] = await Promise.all([reach(client, scope, dropId, deps), (deps.mailbox ?? readMailSenderPreference)(client, scope.userId).catch(() => ({ resolved: null }))]);
  if (!target) return skipped('unreachable');

  const at = now.toISOString();
  const mine = await claim(client, scope, dropId, found.map(item => item.leadId), 'campaignMailedAt', at);
  if (!mine.length) return skipped('not_due');
  const email = dropReadyEmail(found.filter(item => mine.includes(item.leadId)).map(item => ({ item, email: emails.get(String(item.savedLeadId))! })), {
    link: target.link, appUrl: target.appUrl, name: target.name, mailbox: mailbox.resolved ? MAIL_PROVIDER_LABEL[mailbox.resolved] : null,
    total: drop.items.length, missed: drop.items.filter(item => !item.savedLeadId && item.lookup?.missed), phones: options.phones, now,
  });
  const thread = threadOf(drop, now);
  const sent = email ? await send(client, deps)({ userId: scope.userId, to: target.to, subject: thread.subject, headers: thread.headers, html: email.html, text: email.text }).catch(() => ({ ok: false })) : { ok: false };
  if (!sent.ok) { await release(client, scope, dropId, mine, 'campaignMailedAt', at); return skipped('send_failed'); }
  return { sent: true as const, count: mine.length };
}

/**
 * «Para llamar»: the mobiles asked from the drop that are here now, each with the script of its call, in one email; those that were
 * asked and did not come are named in it. While a mobile asked in the last minutes is still on its way, nothing is sent: the
 * answer that brings it sends them all together.
 */
export async function mailDropCalls(client: Client, scope: DropScope, dropId: string, deps: ReadyDeps = {}) {
  const env = deps.env ?? process.env;
  if (env.LEAD_DROPS_CAMPAIGN_EMAIL === 'off') return skipped('off');
  const now = deps.now ?? new Date();
  const drop = await readDrop(client, scope, dropId);
  if (drop.items.length < 2) return skipped('single');
  const asked = drop.items.filter(item => item.savedLeadId && item.phoneLookup && !item.callMailedAt);
  if (!asked.length) return skipped('not_due');
  const phones = await dropPhones(client, scope, asked, now);
  const stateOf = (item: DropItem) => phones[item.leadId]?.state ?? 'pending';
  const recent = (item: DropItem) => now.getTime() - Date.parse(item.phoneLookup!.at) < PHONE_WAIT_MS;
  if (asked.some(item => stateOf(item) === 'pending' && recent(item))) return skipped('waiting');
  const settled = asked.filter(item => stateOf(item) !== 'pending');
  if (!settled.length) return skipped('not_due');
  const target = await reach(client, scope, dropId, deps);
  if (!target) return skipped('unreachable');

  // The scripts first, the claim after: writing one takes a model some seconds, and nothing that slow should stand between
  // marking the contacts and sending their email. Three at a time.
  const prepare = deps.prepare ?? ((leadId: string) => prepareDropCall(client, scope, dropId, leadId).catch(() => null));
  const scripts = new Map<string, DropCallScript | null>();
  const dialled = settled.filter(item => stateOf(item) === 'found');
  for (let index = 0; index < dialled.length; index += 3) {
    await Promise.all(dialled.slice(index, index + 3).map(async item => {
      scripts.set(item.leadId, item.call?.script ?? (prepare ? (await prepare(item.leadId))?.script ?? null : null));
    }));
  }
  const at = (deps.now ?? new Date()).toISOString();
  const mine = await claim(client, scope, dropId, settled.map(item => item.leadId), 'callMailedAt', at);
  if (!mine.length) return skipped('not_due');
  const claimed = settled.filter(item => mine.includes(item.leadId));
  const found = claimed.filter(item => stateOf(item) === 'found');
  const email = dropCallsEmail(found.map(item => { const phone = phones[item.leadId]; return { item, number: phone?.state === 'found' ? phone.number : '', script: scripts.get(item.leadId) ?? null }; }),
    { link: target.link, appUrl: target.appUrl, name: target.name, missed: claimed.filter(item => stateOf(item) === 'none') });
  const thread = threadOf(drop, now);
  const sent = email ? await send(client, deps)({ userId: scope.userId, to: target.to, subject: thread.subject, headers: thread.headers, html: email.html, text: email.text }).catch(() => ({ ok: false })) : { ok: false };
  if (!sent.ok) { await release(client, scope, dropId, mine, 'callMailedAt', at); return skipped('send_failed'); }
  return { sent: true as const, count: found.length };
}

/** The scripts of the calls of every saved contact that has none yet, three at a time: asked with their mobiles, they are ready when those land. */
export async function prepareDropCalls(client: Client, scope: DropScope, dropId: string, prepare?: (leadId: string) => Promise<unknown>) {
  const drop = await readDrop(client, scope, dropId);
  const due = drop.items.filter(item => item.savedLeadId && !item.call);
  const one = prepare ?? ((leadId: string) => prepareDropCall(client, scope, dropId, leadId));
  let ready = 0;
  for (let index = 0; index < due.length; index += 3) {
    const done = await Promise.all(due.slice(index, index + 3).map(item => one(item.leadId).then(() => true, () => false)));
    ready += done.filter(Boolean).length;
  }
  return { ready, asked: due.length };
}

/** How far back a contact's drop is looked for when its mobile lands: the links of its emails last two weeks. */
const DROP_WINDOW_DAYS = 15;

/**
 * The provider answered a lookup (src/app/api/apollo-webhook/[token]): when it was the mobile of a contact of someone's drop, the
 * mobiles of that drop that are ready go to their inbox. Anything else — another table, a lookup without a mobile, a contact that
 * is in no recent drop — does nothing.
 */
export async function mailDropCallsForCallback(client: Client, token: string, deps: ReadyDeps = {}) {
  let tokenHash: string;
  try { tokenHash = hashApolloCallbackToken(token); } catch { return skipped('unknown'); }
  const callback: any = await client.from('apollo_enrichment_callbacks').select('user_id,organization_id,target_table,target_lead_id,reveal_phone').eq('token_hash', tokenHash).maybeSingle();
  if (callback.error || !callback.data || callback.data.target_table !== 'enriched_leads' || !callback.data.reveal_phone) return skipped('not_a_drop');
  const scope = { organizationId: String(callback.data.organization_id), userId: String(callback.data.user_id) };
  const leadId = String(callback.data.target_lead_id);
  const since = new Date((deps.now ?? new Date()).getTime() - DROP_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const drops: any = await client.from('lead_drops').select('id,items').eq('organization_id', scope.organizationId).eq('user_id', scope.userId)
    .in('status', ['ready', 'sent']).gte('drop_date', since).order('drop_date', { ascending: false }).limit(DROP_WINDOW_DAYS);
  if (drops.error) return skipped('unreadable');
  const drop = ((drops.data || []) as Array<{ id: string; items: DropItem[] }>).find(row => (row.items || []).some(item => item.savedLeadId === leadId && item.phoneLookup));
  if (!drop) return skipped('not_a_drop');
  return mailDropCalls(client, scope, String(drop.id), deps);
}
