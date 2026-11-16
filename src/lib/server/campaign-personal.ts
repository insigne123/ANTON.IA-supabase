import { z } from 'zod';
import { generateStructured } from '@/ai/openai-json';
import { PersonalizeInputSchema, sequenceDays, type PersonalEmails, type PersonalizeResult } from '@/lib/bulk-campaign-personal';
import type { DropItem } from '@/lib/lead-drops';
import { firstNameOf } from '@/lib/lead-name';
import type { AuthContext } from '@/lib/server/auth-utils';
import { ENRICHED_COLUMNS } from '@/lib/server/bulk-campaign-audience';
import { loadCoworkUserContext } from '@/lib/server/cowork/user-context';
import { readLeadFitResearch } from '@/lib/server/lead-fit';
import { dropSellerOf } from '@/lib/server/lead-drop-seller';
import { writeSequence, type DropSeller, type SequencePlan } from '@/lib/server/lead-drop-writer';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { voiceSamplesFor } from '@/lib/server/voice-own-samples';
import { pickOwnVoiceSamples } from '@/lib/voice-own-samples';

/**
 * The emails of a campaign, written for each recipient (src/lib/bulk-campaign-personal.ts tells why). For every person of a request:
 * what is saved of them (their role, their company and what it does, their LinkedIn headline, and the research the user ran, when
 * there is one), who sells (the same profile the recommended contacts use) and the campaign (its objective and its texts, as a
 * guide). The writer is the one of the recommended contacts (lead-drop-writer.ts) with the campaign's own number of emails and days.
 *
 * Nothing here decides who may receive the campaign: saving it checks every recipient again (saveBulkCampaign). A person the writer
 * fails with comes back in `failed` and keeps the guide.
 */

type Generate = Parameters<typeof writeSequence>[0]['generate'];
/** What is saved of a recipient, from the enriched contact or, without it, from the saved lead. */
export type PersonalRecipient = {
  email: string; name: string; title: string; company: string; industry: string; size: string; seniority: string; departments: string[];
  city: string; region: string; country: string; headline: string; about: string; leadRef: string;
};
export type PersonalDeps = {
  recipients: (auth: AuthContext, emails: string[]) => Promise<Map<string, PersonalRecipient>>;
  /** The passages of the research the user ran on each of them, by email. */
  research: (auth: AuthContext, people: PersonalRecipient[]) => Promise<Map<string, string[]>>;
  seller: (auth: AuthContext) => Promise<DropSeller | null>;
  samples: (auth: AuthContext) => Promise<string[]>;
  generate: Generate;
};

const text = (...values: unknown[]) => { for (const value of values) { const clean = String(value ?? '').replace(/\s+/g, ' ').trim(); if (clean) return clean; } return ''; };
const strings = (value: unknown) => (Array.isArray(value) ? value.map(entry => text(entry)).filter(Boolean) : []);
/** ILIKE finds the address whatever its case. Its `_` also matches any character, so what comes back is compared again, exactly. */
const likeExact = (email: string) => `email.ilike."${email}"`;

export function personalRecipientOf(row: any): PersonalRecipient {
  return {
    email: String(row.email || '').trim().toLowerCase(), name: text(row.full_name, row.name), title: text(row.title, row.role),
    company: text(row.company_name, row.organization_name, row.company),
    industry: text(row.organization_industry, row.data_industry, row.org_industry, row.industry, row.data?.industry),
    size: text(row.organization_size, row.company_size, row.data?.companySize), seniority: text(row.seniority, row.data?.seniority),
    departments: strings(row.departments), city: text(row.city), region: text(row.state), country: text(row.country, row.data?.country),
    headline: text(row.headline), about: text(row.about), leadRef: text(row.lead_id, row.id),
  };
}

/** The people of a request as the user may see them (their session reads): the enriched contact first, then the saved lead. */
async function readRecipients(auth: AuthContext, emails: string[]) {
  const found = new Map<string, PersonalRecipient>();
  const take = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      const person = personalRecipientOf(row);
      const prior = found.get(person.email);
      if (!emails.includes(person.email)) continue;
      if (!prior) { found.set(person.email, person); continue; }
      for (const key of ['name', 'title', 'company', 'industry', 'size', 'seniority', 'city', 'region', 'country', 'headline', 'about'] as const) if (!prior[key]) prior[key] = person[key];
    }
  };
  const read = async (table: string, columns: string) => {
    const { data, error } = await auth.supabase.from(table).select(columns).eq('organization_id', auth.organizationId).or(emails.map(likeExact).join(',')).limit(200);
    if (error) throw error;
    return data as any[];
  };
  take(await read('enriched_leads', ENRICHED_COLUMNS));
  // The saved lead and the contacted one fill what the enriched contact lacks, and stand for whoever was never enriched.
  const [leads, contacted] = await Promise.all([read('leads', '*').catch(() => []), read('contacted_leads', '*').catch(() => [])]);
  take(leads); take(contacted);
  return found;
}

async function readResearch(auth: AuthContext, people: PersonalRecipient[]) {
  const found = await readLeadFitResearch(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId },
    people.map(person => ({ key: person.email, lead: { leadId: person.leadRef || null, email: person.email } })));
  return new Map([...found].map(([email, research]) => [email, research.extractos]));
}

async function readSeller(auth: AuthContext) {
  const scope = { organizationId: auth.organizationId, userId: auth.user.id };
  const admin = getSupabaseAdminClient();
  return dropSellerOf(admin, scope, await loadCoworkUserContext(admin, scope, { memories: false, mailbox: false }));
}

const defaults: PersonalDeps = {
  recipients: readRecipients, research: readResearch, seller: readSeller,
  samples: auth => voiceSamplesFor({ userId: auth.user.id, organizationId: auth.organizationId }).catch(() => [] as string[]),
  generate: options => generateStructured({ ...options, allowDefaultModelFallback: false, maxAttempts: 1 }),
};

/** The recipient as the writer reads a contact: what its company does, and what else is known as facts. */
export function personalItem(person: PersonalRecipient, research: string[] = []): DropItem {
  const digits = person.size.trim().replace(/[.,]/g, '');
  const facts = [
    person.headline && person.headline.toLowerCase() !== person.title.toLowerCase() ? `Así se presenta en LinkedIn: ${person.headline}` : '',
    person.size && !/^\d+$/.test(digits) ? `Tamaño de la empresa: ${person.size}` : '',
    ...research,
  ].filter(Boolean);
  return {
    leadId: person.leadRef || person.email, name: person.name, title: person.title || null, company: person.company || null,
    domain: person.email.split('@')[1] || null, industry: person.industry || null, size: /^\d+$/.test(digits) ? Number(digits) : null,
    city: person.city || person.region || null, country: person.country || null, hasEmail: true, hasPhone: false, why: '', research: facts, draft: null,
    seniority: person.seniority || null, department: person.departments.slice(0, 2).join(', ') || null, summary: person.about || null,
  };
}

/**
 * The emails as the campaign keeps them: the greeting with the person's first name (or none, when the saved name is not one), plain
 * text and no variable left, since an edit of a person is sent as it is.
 */
export function personalMessages(emails: Array<{ subject: string; body: string }>, name: string): PersonalEmails['messages'] | null {
  const first = firstNameOf(name) || '';
  const messages = emails.map(email => ({
    subject: email.subject.replace(/\{\{\s*nombre\s*\}\}/gi, first).replace(/\s+/g, ' ').trim().slice(0, 300),
    body: (first ? email.body.replace(/\{\{\s*nombre\s*\}\}/gi, first) : email.body.replace(/^hola\s+\{\{\s*nombre\s*\}\}\s*,?/i, 'Hola,').replace(/\s*\{\{\s*nombre\s*\}\}/gi, '')).trim().slice(0, 12000),
  }));
  return messages.every(message => message.subject && message.body && !/\{\{|\}\}/.test(message.subject + message.body)) ? messages : null;
}

const reasonOf = (error: unknown) => (error instanceof z.ZodError ? 'La IA no devolvió todos los correos.'
  : error instanceof Error && /timeout|timed out|abort/i.test(`${error.name} ${error.message}`) ? 'La IA tardó más de lo esperado.'
    : 'No se pudieron escribir sus correos.');

export async function personalizeRecipients(auth: AuthContext, raw: unknown, overrides: Partial<PersonalDeps> = {}): Promise<PersonalizeResult> {
  const input = PersonalizeInputSchema.parse(raw);
  const deps = { ...defaults, ...overrides };
  const [people, seller, samples] = await Promise.all([deps.recipients(auth, input.emails), deps.seller(auth).catch(() => null), deps.samples(auth).catch(() => [] as string[])]);
  const known = input.emails.flatMap(email => { const person = people.get(email); return person ? [person] : []; });
  const research = known.length ? await deps.research(auth, known).catch(() => new Map<string, string[]>()) : new Map<string, string[]>();
  const plan: SequencePlan = {
    days: sequenceDays(input.messages), sign: false, timeouts: [55_000, 40_000],
    campaign: { objective: input.objective, audience: input.description, recontact: input.relationship === 'previously_contacted',
      guide: input.messages.map(message => ({ subject: message.subject, body: message.body })) },
  };
  // «Tu voz»: the emails the person chose as samples of how they write, the same ones for the whole campaign.
  const ownSamples = pickOwnVoiceSamples(samples, input.messages[0].subject, 3);
  const result: PersonalizeResult = { written: [], failed: [] };
  await Promise.all(input.emails.map(async (email, index) => {
    const person = people.get(email);
    if (!person) { result.failed.push({ email, reason: 'No encontramos sus datos guardados.' }); return; }
    try {
      const { emails } = await writeSequence({ item: personalItem(person, (research.get(email) || []).slice(0, 5)), seller, generate: deps.generate,
        ownSamples, variant: input.offset + index, plan });
      const messages = personalMessages(emails, person.name);
      if (!messages || messages.length !== input.messages.length) throw new z.ZodError([]);
      result.written.push({ email, messages });
    } catch (error) {
      result.failed.push({ email, reason: reasonOf(error) });
    }
  }));
  const order = (entry: { email: string }) => input.emails.indexOf(entry.email);
  result.written.sort((a, b) => order(a) - order(b)); result.failed.sort((a, b) => order(a) - order(b));
  return result;
}
