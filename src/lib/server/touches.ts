import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateStructured } from '@/ai/openai-json';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import {
  TOUCH_LOOKBACK_DAYS, cadenceRules, cadenceToSave, callScriptSchema, chileDay, dueRulesFor, linkedinHref, linkedinScriptSchema, readTouchCadence, telHref,
  touchCancelReason, touchDueAt, touchExpired, touchScriptPrompt, touchesForToday, validOutcome,
  type CallScript, type CallSummary, type LinkedinScript, type TouchCadence, type TouchChannel,
} from '@/lib/touches';

type Scope = { organizationId: string; userId: string };
type Client = Pick<SupabaseClient, 'from'>;
const TABLE = 'contact_touches';
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);
const DAY = 86_400_000;
const CONTACT_COLUMNS = 'id,lead_id,name,email,company,role,industry,subject,sent_at,replied_at,conversation_resolved_at,bounced_at,status,delivery_status,data';

export class TouchError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'TouchError'; }
}

/** The model of the scripts and the call summaries: Haiku, or another allowed one in an environment without Claude. */
export function touchModel(env: Record<string, string | undefined> = process.env) {
  const wanted = env.TOUCHES_MODEL || 'claude-haiku-5-5';
  if (!['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-6-luna'].includes(wanted)) throw new TouchError('El modelo configurado no está permitido.', 503);
  return wanted;
}

type ContactRow = { id: string; lead_id: string | null; name: string | null; email: string | null; company: string | null; role: string | null; industry: string | null;
  subject: string | null; sent_at: string | null; replied_at: string | null; conversation_resolved_at: string | null; bounced_at: string | null; status: string | null;
  delivery_status: string | null; data: any; conversation_close_outcome?: string | null };

async function readContacts(client: Client, scope: Scope, filter: { since?: string; ids?: string[] }) {
  const query = (columns: string) => {
    let builder = client.from('contacted_leads').select(columns).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).not('sent_at', 'is', null);
    if (filter.since) builder = builder.gte('sent_at', filter.since);
    if (filter.ids) builder = builder.in('id', filter.ids);
    return builder.order('sent_at', { ascending: false }).limit(1000);
  };
  let result: any = await query(`${CONTACT_COLUMNS},conversation_close_outcome`);
  if (result.error?.code === '42703') result = await query(CONTACT_COLUMNS);
  if (result.error) throw new TouchError('No pudimos revisar tus contactos.', 503);
  return (result.data || []) as ContactRow[];
}

const contactState = (row: ContactRow) => ({ sentAt: row.sent_at, repliedAt: row.replied_at, closeOutcome: row.conversation_close_outcome ?? null,
  resolvedAt: row.conversation_resolved_at, bouncedAt: row.bounced_at, status: row.status, deliveryStatus: row.delivery_status });

/** Phones and LinkedIn profiles of the contacts: from their saved lead and the enrichment, by email. */
async function readReach(client: Client, scope: Scope, rows: ContactRow[]) {
  const emails = [...new Set(rows.map(row => String(row.email || '').trim().toLowerCase()).filter(Boolean))];
  const leadIds = [...new Set(rows.map(row => String(row.lead_id || '')).filter(Boolean))];
  const byEmail = new Map<string, { phone: string | null; linkedin: string | null }>();
  for (let index = 0; index < emails.length; index += 200) {
    const result: any = await client.from('enriched_leads').select('email,primary_phone,phone_numbers,linkedin_url').eq('organization_id', scope.organizationId)
      .in('email', emails.slice(index, index + 200)).limit(1000);
    if (result.error) break;
    for (const row of result.data || []) {
      const phones = Array.isArray(row.phone_numbers) ? row.phone_numbers.map((item: any) => (typeof item === 'string' ? item : item?.sanitized_number || item?.raw_number || item?.number)).filter(Boolean) : [];
      const entry = byEmail.get(String(row.email).toLowerCase()) || { phone: null, linkedin: null };
      entry.phone ||= row.primary_phone || phones[0] || null;
      entry.linkedin ||= row.linkedin_url || null;
      byEmail.set(String(row.email).toLowerCase(), entry);
    }
  }
  const byLead = new Map<string, string>();
  for (let index = 0; index < leadIds.length; index += 200) {
    const result: any = await client.from('leads').select('id,linkedin_url').eq('organization_id', scope.organizationId).in('id', leadIds.slice(index, index + 200));
    if (result.error) break;
    for (const row of result.data || []) if (row.linkedin_url) byLead.set(String(row.id), row.linkedin_url);
  }
  return (row: ContactRow) => {
    const found = byEmail.get(String(row.email || '').trim().toLowerCase());
    return { phone: telHref(found?.phone) ? String(found!.phone) : null, linkedin: (row.lead_id && byLead.get(String(row.lead_id))) || found?.linkedin || null };
  };
}

async function readCadence(client: Client, scope: Scope) {
  const result: any = await client.from('profiles').select('signatures,full_name,company_name,company_domain,job_title').eq('id', scope.userId).maybeSingle();
  if (result.error) throw new TouchError('No pudimos leer tu perfil.', 503);
  return { cadence: readTouchCadence(result.data?.signatures), profile: result.data };
}

export type TouchView = {
  id: string; channel: TouchChannel; dueAt: string; day: number | null; manual: boolean;
  contact: { contactedId: string; name: string; role: string | null; company: string | null; email: string | null; phone: string | null; tel: string | null;
    linkedin: { href: string; search: boolean } };
  firstEmail: { subject: string | null; sentAt: string | null };
  script: CallScript | LinkedinScript | null;
  callSummary: CallSummary | null;
};

/**
 * «Llamadas y LinkedIn» for «Hoy»: creates the touches whose day came (from the cadence), cancels the ones an answer, a
 * closed conversation or a bounce made unnecessary, retires the ones a week late, and returns what is due today.
 */
export async function readTouches(client: Client, scope: Scope, now = new Date()) {
  const { cadence } = await readCadence(client, scope);
  const open: any = await client.from(TABLE).select('id,contacted_id,rule_key,channel,due_at,script,call_summary').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('state', 'open').order('due_at', { ascending: true }).limit(500);
  if (open.error) {
    if (MISSING_TABLE.has(String(open.error.code))) return { available: false as const, cadence, touches: [] as TouchView[], waiting: 0, doneToday: 0, writesToPeople: false };
    throw new TouchError('No pudimos revisar tus llamadas y LinkedIn.', 503);
  }
  const rules = cadenceRules(cadence);
  // Without a cadence, «Hoy» only invites to turn it on, and only to someone who writes to people.
  if (!rules.length && !(open.data || []).length) {
    const recent: any = await client.from('contacted_leads').select('id', { count: 'exact', head: true }).eq('organization_id', scope.organizationId)
      .eq('user_id', scope.userId).gte('sent_at', new Date(now.getTime() - TOUCH_LOOKBACK_DAYS * DAY).toISOString());
    return { available: true as const, cadence, touches: [] as TouchView[], waiting: 0, doneToday: 0, writesToPeople: (recent.count || 0) > 0 };
  }
  const since = new Date(Math.max(now.getTime() - TOUCH_LOOKBACK_DAYS * DAY, cadence ? Date.parse(`${cadence.since}T00:00:00-03:00`) : now.getTime())).toISOString();
  const recent = rules.length ? await readContacts(client, scope, { since }) : [];
  const reach = await readReach(client, scope, recent);
  const due = recent.flatMap(row => dueRulesFor({ ...contactState(row), hasPhone: Boolean(reach(row).phone) }, cadence, now)
    .map(rule => ({ organization_id: scope.organizationId, user_id: scope.userId, contacted_id: row.id, rule_key: rule.key, channel: rule.channel,
      due_at: touchDueAt(row.sent_at!, rule.day) })));
  for (let index = 0; index < due.length; index += 200) {
    const saved: any = await client.from(TABLE).upsert(due.slice(index, index + 200), { onConflict: 'contacted_id,rule_key', ignoreDuplicates: true });
    if (saved.error) throw new TouchError('No pudimos preparar tus llamadas y LinkedIn.', 503);
  }
  // What is open now, with the state of each contact: an answer or a closed conversation cancels it, a week late retires it.
  const fresh: any = due.length ? await client.from(TABLE).select('id,contacted_id,rule_key,channel,due_at,script,call_summary').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('state', 'open').order('due_at', { ascending: true }).limit(500) : open;
  if (fresh.error) throw new TouchError('No pudimos revisar tus llamadas y LinkedIn.', 503);
  const rows = (fresh.data || []) as Array<{ id: string; contacted_id: string; rule_key: string; channel: TouchChannel; due_at: string; script: any; call_summary: any }>;
  const contacts = new Map((await readContacts(client, scope, { ids: [...new Set(rows.map(row => row.contacted_id))].slice(0, 500) })).map(row => [row.id, row]));
  const closing: Array<{ id: string; state: string; reason: string }> = [];
  const live = rows.filter(row => {
    const contact = contacts.get(row.contacted_id);
    const reason = contact ? touchCancelReason(contactState(contact)) : 'closed';
    if (reason) { closing.push({ id: row.id, state: 'cancelled', reason }); return false; }
    if (touchExpired(row.due_at, now)) { closing.push({ id: row.id, state: 'skipped', reason: 'expired' }); return false; }
    return true;
  });
  for (const item of closing) {
    await client.from(TABLE).update({ state: item.state, reason: item.reason, updated_at: now.toISOString() }).eq('id', item.id).eq('organization_id', scope.organizationId)
      .eq('user_id', scope.userId).eq('state', 'open');
  }
  const today = chileDay(now);
  const doneLinkedin: any = await client.from(TABLE).select('done_at').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('channel', 'linkedin')
    .eq('state', 'done').gte('done_at', new Date(now.getTime() - 2 * DAY).toISOString()).limit(200);
  const doneToday = ((doneLinkedin.data || []) as Array<{ done_at: string }>).filter(row => chileDay(row.done_at) === today).length;
  const { shown, waiting } = touchesForToday(live.map(row => ({ ...row, id: row.id, channel: row.channel, dueAt: row.due_at })), doneToday, now);
  const shownContacts = shown.map(row => contacts.get(row.contacted_id)!).filter(Boolean);
  const reachOf = await readReach(client, scope, shownContacts);
  const touches: TouchView[] = shown.map(row => {
    const contact = contacts.get(row.contacted_id)!;
    const found = reachOf(contact);
    const name = String(contact.name || contact.email || 'Contacto').trim();
    return {
      id: row.id, channel: row.channel, dueAt: row.due_at, day: /^(call|linkedin):\d+$/.test(row.rule_key) ? Number(row.rule_key.split(':')[1]) : null,
      manual: row.rule_key.startsWith('manual:'),
      contact: { contactedId: contact.id, name, role: contact.role, company: contact.company, email: contact.email, phone: found.phone, tel: telHref(found.phone),
        linkedin: linkedinHref(found.linkedin, name, contact.company) },
      firstEmail: { subject: contact.subject, sentAt: contact.sent_at },
      script: row.script ?? null, callSummary: row.call_summary ?? null,
    };
  });
  return { available: true as const, cadence, touches, waiting, doneToday, writesToPeople: true };
}

/** Saves the cadence in the profile, next to the signature; the start day stays when only the days change. */
export async function saveTouchCadence(client: Client, scope: Scope, input: { call: { on: boolean; day: number }; linkedin: { on: boolean; day: number }; phone?: string | null }, now = new Date()) {
  const current: any = await client.from('profiles').select('signatures').eq('id', scope.userId).maybeSingle();
  if (current.error) throw new TouchError('No pudimos leer tu perfil.', 503);
  const signatures = current.data?.signatures && typeof current.data.signatures === 'object' ? current.data.signatures : {};
  const cadence = cadenceToSave(input, readTouchCadence(signatures), chileDay(now));
  const saved: any = await client.from('profiles').update({ signatures: { ...signatures, touches: cadence } }).eq('id', scope.userId);
  if (saved.error) throw new TouchError('No pudimos guardar la cadencia.', 503);
  return { cadence };
}

async function readTouch(client: Client, scope: Scope, id: string) {
  const result: any = await client.from(TABLE).select('id,contacted_id,rule_key,channel,state,due_at,script,call_summary').eq('organization_id', scope.organizationId)
    .eq('user_id', scope.userId).eq('id', id).maybeSingle();
  if (result.error) throw new TouchError('No pudimos leer esa tarea.', 503);
  if (!result.data) throw new TouchError('Esa tarea ya no está.', 404);
  return result.data as { id: string; contacted_id: string; rule_key: string; channel: TouchChannel; state: string; due_at: string; script: any; call_summary: any };
}

/** «Hecho» with what happened, or «Saltar». A finished touch stays as it was. */
export async function finishTouch(client: Client, scope: Scope, id: string, input: { action: 'done'; outcome: string; note?: string } | { action: 'skip' }, now = new Date()) {
  const touch = await readTouch(client, scope, id);
  if (input.action === 'done' && !validOutcome(touch.channel, input.outcome)) throw new TouchError('Elige qué pasó.', 400);
  const values = input.action === 'done'
    ? { state: 'done', outcome: input.outcome, note: input.note?.trim().slice(0, 2000) || null, done_at: now.toISOString(), updated_at: now.toISOString() }
    : { state: 'skipped', reason: 'skipped', done_at: now.toISOString(), updated_at: now.toISOString() };
  const saved: any = await client.from(TABLE).update(values).eq('id', id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId).eq('state', 'open')
    .select('id,state').maybeSingle();
  if (saved.error) throw new TouchError('No pudimos guardar.', 503);
  return { id, state: saved.data?.state ?? touch.state };
}

/** «Programar llamada» or «LinkedIn» by hand, from a conversation: one more task on the day chosen. */
export async function scheduleTouch(client: Client, scope: Scope, input: { contactedId: string; channel: TouchChannel; dueAt: string }) {
  const [contact] = await readContacts(client, scope, { ids: [input.contactedId] });
  if (!contact) throw new TouchError('Ese contacto no está en tus conversaciones.', 404);
  const due = Date.parse(input.dueAt);
  if (!Number.isFinite(due)) throw new TouchError('Elige una fecha.', 400);
  const saved: any = await client.from(TABLE).insert({ organization_id: scope.organizationId, user_id: scope.userId, contacted_id: contact.id,
    rule_key: `manual:${randomUUID()}`, channel: input.channel, due_at: new Date(due).toISOString() }).select('id').single();
  if (saved.error) throw new TouchError(MISSING_TABLE.has(String(saved.error.code)) ? 'Las llamadas y LinkedIn aún no están disponibles.' : 'No pudimos programarlo.', 503);
  return { id: saved.data.id as string };
}

/** The seller, as the scripts and the summaries say it. */
function sellerOf(profile: any) {
  const form = mapProfileToForm(profile as any);
  const offer = [form.valueProposition, form.description, form.services].map(value => String(value || '').trim()).filter(Boolean).join('. ');
  return { name: String(form.name || profile?.full_name || '').trim().split(/\s+/)[0] || '', company: String(form.companyName || profile?.company_name || '').trim(), offer };
}

/** The first email's body, when the conversation kept it. */
function firstEmailBody(contact: ContactRow) {
  const data = contact.data && typeof contact.data === 'object' ? contact.data : {};
  return String(data.body || data.bodyText || data.message?.body || data.preview || '').replace(/<[^>]+>/g, ' ').slice(0, 2000) || null;
}

/** The script of a touch, prepared once by the model and kept with it; «Otra versión» asks again. */
export async function prepareTouchScript(client: Client, scope: Scope, id: string, options: { fresh?: boolean } = {}, generate = generateStructured) {
  const touch = await readTouch(client, scope, id);
  if (touch.script && !options.fresh) return { script: touch.script };
  const [contact] = await readContacts(client, scope, { ids: [touch.contacted_id] });
  if (!contact) throw new TouchError('Ese contacto ya no está en tus conversaciones.', 404);
  const { profile } = await readCadence(client, scope);
  const day = touch.rule_key.startsWith('manual:') || !contact.sent_at
    ? Math.max(1, Math.round((Date.parse(touch.due_at) - Date.parse(contact.sent_at || touch.due_at)) / DAY))
    : Number(touch.rule_key.split(':')[1]);
  const prompt = touchScriptPrompt({ channel: touch.channel, day, seller: sellerOf(profile),
    contact: { name: String(contact.name || contact.email || ''), role: contact.role, company: contact.company, industry: contact.industry },
    firstEmail: { subject: contact.subject, body: firstEmailBody(contact), sentAt: contact.sent_at } });
  let script: CallScript | LinkedinScript;
  try {
    script = touch.channel === 'call'
      ? await generate({ schema: callScriptSchema, prompt, systemPrompt: 'Preparas contactos comerciales breves y honestos. Responde JSON conforme al contrato.', openAiModel: touchModel(),
        allowDefaultModelFallback: false, reasoningEffort: 'low', maxAttempts: 2, timeoutMs: 60_000, maxOutputTokens: 1200 })
      : await generate({ schema: linkedinScriptSchema, prompt, systemPrompt: 'Preparas contactos comerciales breves y honestos. Responde JSON conforme al contrato.', openAiModel: touchModel(),
        allowDefaultModelFallback: false, reasoningEffort: 'low', maxAttempts: 2, timeoutMs: 60_000, maxOutputTokens: 1000 });
  } catch {
    throw new TouchError('La IA no pudo preparar el guion. Intenta de nuevo en un momento.', 503);
  }
  if (touch.channel === 'linkedin') {
    const linkedin = script as LinkedinScript;
    // LinkedIn cuts an invitation note at 300 characters.
    script = { ...linkedin, invitation: linkedin.invitation.slice(0, 300) };
  }
  await client.from(TABLE).update({ script, updated_at: new Date().toISOString() }).eq('id', id).eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  return { script };
}

export { readCadence as readTouchProfile, readTouch, readContacts as readTouchContacts, sellerOf as touchSeller };
export type { Scope as TouchScope, ContactRow as TouchContactRow, TouchCadence };
