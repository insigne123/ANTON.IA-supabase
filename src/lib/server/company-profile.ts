import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  companyFieldsFromProfile, companyProfileFields, companyProfileHasOffer, type CompanyProfile, type CompanyProfileFields,
} from '@/lib/profile/company-profile';

/** «Ficha de la empresa» on the server (organization_company_profile, APP-06): read by every member, saved by owners and admins. */
type Scope = { organizationId: string; userId: string };

export class CompanyProfileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CompanyProfileError';
  }
}

/** The table is not there yet (migration 20261025050000 not applied): the app reads as if no profile existed. */
const missingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /organization_company_profile/.test(String(error.message || '')) && /does not exist|schema cache/.test(String(error.message || ''))));

/** The organization's profile, with the name of whoever reviewed it last; null when there is none (or no table yet). */
export async function readCompanyProfile(client: SupabaseClient, organizationId: string): Promise<CompanyProfile | null> {
  const { data, error } = await client.from('organization_company_profile')
    .select('fields,revision,reviewed_at,reviewed_by').eq('organization_id', organizationId).maybeSingle();
  if (missingTable(error)) return null;
  if (error) throw new CompanyProfileError('No pudimos leer la ficha de la empresa.', 503);
  if (!data) return null;
  const row = data as { fields?: unknown; revision?: number; reviewed_at?: string | null; reviewed_by?: string | null };
  let reviewedBy: string | null = null;
  if (row.reviewed_by) {
    const person: any = await client.from('profiles').select('full_name').eq('id', row.reviewed_by).maybeSingle();
    reviewedBy = String(person.data?.full_name || '').trim() || null;
  }
  return { fields: companyProfileFields(row.fields), revision: Number(row.revision) || 1, reviewedAt: row.reviewed_at ?? null, reviewedBy };
}

/** Whether the person may edit it: an owner or an admin of the organization, checked with the server's client. */
export async function canEditCompanyProfile(client: SupabaseClient, scope: Scope) {
  const { data, error } = await client.from('organization_members').select('role')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (error) throw new CompanyProfileError('No pudimos comprobar tu rol.', 503);
  return ['owner', 'admin'].includes(String((data as { role?: string } | null)?.role));
}

export const companyProfileSaveSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  /** The revision the page showed; 0 when there was no profile yet. */
  revision: z.number().int().min(0),
});

/**
 * Saves it, and saving is reviewing: the date and who did it change too. A profile that changed since the page read it is
 * not overwritten (409): the person sees the other change first. One without an offer is refused: it would leave prospecting,
 * Cowork and Oportunidades with nothing to say.
 */
export async function saveCompanyProfile(client: SupabaseClient, scope: Scope, input: unknown, now = new Date()) {
  const parsed = companyProfileSaveSchema.parse(input);
  if (!await canEditCompanyProfile(client, scope)) throw new CompanyProfileError('Solo un dueño o un administrador edita la ficha de la empresa.', 403);
  const fields = companyProfileFields(parsed.fields);
  if (!companyProfileHasOffer(fields)) throw new CompanyProfileError('Escribe al menos qué vende la empresa: sus productos y servicios, su propuesta de valor o una descripción.', 400);
  const current = await readCompanyProfile(client, scope.organizationId);
  if ((current?.revision ?? 0) !== parsed.revision) throw new CompanyProfileError('Otra persona cambió la ficha mientras la editabas. Recarga para ver su versión antes de guardar.', 409);
  const at = now.toISOString();
  const row = { fields, revision: parsed.revision + 1, reviewed_at: at, reviewed_by: scope.userId, updated_at: at, updated_by: scope.userId };
  // The revision in the filter is the lock: a save that lost the race changes no row.
  const saved = current
    ? await client.from('organization_company_profile').update(row).eq('organization_id', scope.organizationId).eq('revision', parsed.revision).select('revision')
    : await client.from('organization_company_profile').insert({ organization_id: scope.organizationId, ...row }).select('revision');
  if (missingTable(saved.error)) throw new CompanyProfileError('La ficha de la empresa todavía no está disponible.', 503);
  if (saved.error?.code === '23505' || (!saved.error && !(saved.data as unknown[] | null)?.length)) {
    throw new CompanyProfileError('Otra persona cambió la ficha mientras la editabas. Recarga para ver su versión antes de guardar.', 409);
  }
  if (saved.error) throw new CompanyProfileError('No pudimos guardar la ficha de la empresa.', 503);
  return { fields, revision: parsed.revision + 1, reviewedAt: at };
}

export type CompanyProfileSuggestion = { source: 'person' | 'opportunities'; label: string; fields: Partial<CompanyProfileFields> };

/**
 * What the team already wrote, for an admin to bring into the profile instead of starting from nothing: each member's own
 * «Tu oferta» (by name; several people often sell different things) and the offer confirmed in Oportunidades. Only for owners
 * and admins; only the fields about the company, never a person's contact data.
 */
export async function companyProfileSuggestions(client: SupabaseClient, organizationId: string): Promise<CompanyProfileSuggestion[]> {
  const [members, opportunity]: any[] = await Promise.all([
    client.from('organization_members').select('user_id').eq('organization_id', organizationId).limit(500),
    client.from('opportunity_company_context').select('offer,services,territories').eq('organization_id', organizationId).maybeSingle(),
  ]);
  if (members.error) throw new CompanyProfileError('No pudimos leer el equipo.', 503);
  const ids = [...new Set<string>((members.data || []).map((row: { user_id: string }) => String(row.user_id)))];
  const profiles: any = ids.length ? await client.from('profiles').select('id,full_name,company_name,company_domain,job_title,signatures').in('id', ids) : { data: [] };
  if (profiles.error) throw new CompanyProfileError('No pudimos leer los perfiles del equipo.', 503);
  const suggestions: CompanyProfileSuggestion[] = [];
  const seen = new Set<string>();
  for (const profile of (profiles.data || []) as Array<Record<string, unknown>>) {
    const fields = companyFieldsFromProfile(profile as never);
    if (!companyProfileHasOffer(fields)) continue;
    // The same text from two people is one suggestion.
    const key = `${fields.services}\n${fields.valueProposition}\n${fields.description}`.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const offered = Object.fromEntries(Object.entries(fields).filter(([, value]) => value)) as Partial<CompanyProfileFields>;
    suggestions.push({ source: 'person', label: String(profile.full_name || '').trim() || 'Una persona del equipo', fields: offered });
  }
  const confirmed = opportunity.error ? null : opportunity.data as { offer?: string | null; services?: string[] | null; territories?: string[] | null } | null;
  if (confirmed && (confirmed.offer || confirmed.services?.length)) {
    suggestions.unshift({ source: 'opportunities', label: 'La oferta confirmada en Oportunidades', fields: {
      ...(confirmed.offer ? { valueProposition: String(confirmed.offer).trim() } : {}),
      ...(confirmed.services?.length ? { services: confirmed.services.join('\n') } : {}),
      ...(confirmed.territories?.length ? { targetLocations: confirmed.territories.join(', ') } : {}),
    } });
  }
  return suggestions;
}
