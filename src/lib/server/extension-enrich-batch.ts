import type { AuthContext } from '@/lib/server/auth-utils';
import type { ExtensionProfile } from '@/lib/extension-contracts';
import { findExtensionLead } from '@/lib/server/extension-leads';
import { saveExtensionBatch } from '@/lib/server/extension-batch';

/** What happened to each person of the batch, in the order chosen. */
export type EnrichOutcome = 'email' | 'phone' | 'pending' | 'not_found' | 'had_email' | 'teammate' | 'blocked' | 'failed';
export type EnrichedPerson = { linkedinUrl: string; fullName: string; outcome: EnrichOutcome; email?: string; phone?: string; reason?: string };
/** One saved contact to look up: the enriched lead the batch just saved (or the person already had). */
export type LookupLead = { id: string; fullName: string; linkedinUrl: string; companyName: string; title: string };
export type LookupResult = { enriched: any[]; consumed: number; error?: string };
type Deps = {
  saveBatch: typeof saveExtensionBatch;
  findLead: typeof findExtensionLead;
  /** «Buscar correo» of «Por escribir»: the same lookup, credits and daily allowance, written onto each contact. */
  lookUp: (leads: LookupLead[], revealPhone: boolean) => Promise<LookupResult>;
};

const PENDING = /^pending/;

/** Why the lookup did not run, in the words the person needs. */
export function lookupErrorMessage(payload: { error?: unknown; message?: unknown }) {
  const code = String(payload?.error || '');
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (/QUOTA|LIMIT/i.test(code)) return 'Se acabaron tus créditos de hoy: se renuevan mañana. Quedaron guardados para buscarlos después.';
  if (/NOT_CONFIGURED/.test(code)) return 'La búsqueda de correos no está disponible ahora. Quedaron guardados para buscarlos después.';
  return 'No se pudo buscar los correos. Quedaron guardados: vuelve a intentarlo.';
}

/**
 * enrich-batch: the people chosen from a LinkedIn search, saved and looked up in one go, so they reach «Por escribir» with
 * their email. It saves like save-batch (someone another member works is not saved; a richer record is never overwritten),
 * then looks up the email (and the phone when asked) of the saved contacts of this person that have none. Who already had
 * an email, or belongs to a teammate, is not looked up and spends nothing.
 */
export async function enrichExtensionBatch(auth: AuthContext, input: { profiles: ExtensionProfile[]; revealPhone: boolean }, deps: Deps) {
  const saved = await deps.saveBatch(auth, input.profiles);
  const people = new Map<string, EnrichedPerson>();
  for (const item of saved.blocked) people.set(item.linkedinUrl, { ...item, outcome: 'blocked' });
  for (const item of saved.failed) people.set(item.linkedinUrl, { ...item, outcome: 'failed', reason: item.error });

  const toLookUp: LookupLead[] = [];
  for (const item of [...saved.saved, ...saved.already]) {
    const profile = input.profiles.find((candidate) => candidate.linkedinUrl === item.linkedinUrl);
    const row = profile ? await deps.findLead(auth, profile).catch(() => null) : null;
    if (!row) { people.set(item.linkedinUrl, { ...item, outcome: 'failed', reason: 'No se encontró el contacto guardado.' }); continue; }
    if (row.email) { people.set(item.linkedinUrl, { ...item, outcome: 'had_email', email: row.email }); continue; }
    // A teammate's contact keeps its owner: the lookup writes onto contacts of this person only.
    if (row.user_id && row.user_id !== auth.user.id) { people.set(item.linkedinUrl, { ...item, outcome: 'teammate' }); continue; }
    toLookUp.push({ id: String(row.id), fullName: row.full_name || item.fullName, linkedinUrl: row.linkedin_url || item.linkedinUrl,
      companyName: row.company_name || profile?.companyName || '', title: row.title || profile?.title || '' });
  }

  let consumed = 0;
  let warning = '';
  if (toLookUp.length) {
    const result = await deps.lookUp(toLookUp, input.revealPhone).catch((error: unknown) => ({
      enriched: [], consumed: 0, error: error instanceof Error ? error.message : 'No se pudo buscar los correos.',
    }));
    consumed = result.consumed;
    warning = result.error || '';
    for (const lead of toLookUp) {
      const item = result.enriched.find((row: any) => row?.id === lead.id);
      const base = { linkedinUrl: input.profiles.find((profile) => profile.linkedinUrl === lead.linkedinUrl)?.linkedinUrl || lead.linkedinUrl, fullName: lead.fullName };
      const email = typeof item?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email) ? item.email : '';
      const phone = typeof item?.primaryPhone === 'string' ? item.primaryPhone : '';
      const outcome: EnrichOutcome = !item ? (result.error ? 'failed' : 'not_found')
        : email ? 'email' : phone ? 'phone' : PENDING.test(String(item.enrichmentStatus || '')) ? 'pending' : 'not_found';
      people.set(lead.linkedinUrl, { ...base, outcome, ...(email ? { email } : {}), ...(phone ? { phone } : {}),
        ...(outcome === 'failed' ? { reason: result.error } : {}) });
    }
  }
  // The order the person chose them in.
  const ordered = input.profiles.map((profile) => people.get(profile.linkedinUrl)).filter((item): item is EnrichedPerson => Boolean(item));
  return { people: ordered, consumed, ...(warning ? { warning } : {}) };
}
