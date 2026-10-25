import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { withCompanyProfile } from '@/lib/profile/company-profile';
import { readCompanyFields } from '@/lib/server/company-profile';
import { sanitizeCoworkSignature } from './signature';

/** Profile identity is global to the owner, not an organization mailbox.
 * Exposes only sanitized channel signatures; never provider credentials. The commercial fields
 * are the ones «Perfil» saves, with the same names profile.update uses. */
export async function readCoworkProfile(client: SupabaseClient, scope: { userId: string; organizationId: string }, value: string) {
  z.literal('').parse(value);
  const userId = z.string().uuid().parse(scope.userId);
  const [{ data: row, error }, company] = await Promise.all([
    client.from('profiles').select('id,full_name,email,company_name,company_domain,job_title,updated_at,signatures').eq('id', userId).maybeSingle(),
    readCompanyFields(client, scope.organizationId),
  ]);
  if (error) throw new Error('No se pudo consultar tu perfil comercial.');
  if (!row) return { scope: 'own_profile', profile: null };
  // With a «Ficha de la empresa», what the company is, sells and to whom is the team's: profile.update changes only the person.
  const data = withCompanyProfile(row, company);
  if (data.id !== userId) throw new Error('El perfil está fuera del alcance permitido.');
  const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 500) : null;
  const stored = data.signatures && typeof data.signatures === 'object' ? data.signatures as Record<string, unknown> : {};
  const signatures = (['gmail', 'outlook'] as const).flatMap(channel => {
    const value = stored[channel] as Record<string, unknown> | undefined;
    if (!value || typeof value.html !== 'string' || !value.html || value.html.length > 12000) return [];
    try { return [{ channel, enabled: value.enabled === true, ...sanitizeCoworkSignature(value.html) }]; }
    catch { return []; }
  });
  const form = mapProfileToForm(data);
  const commercialEntries = (['role', 'sector', 'description', 'services', 'valueProposition', 'proofPoints'] as const)
    .map(field => [field, form[field].trim() ? form[field].trim().slice(0, 500) : null] as const);
  // Fields added to «Perfil» later are listed only when filled, so older profiles read exactly as before.
  const addedEntries = (['painPoints', 'differentiators', 'referenceClients', 'targetRoles', 'targetIndustries', 'targetCompanySize', 'targetLocations'] as const)
    .flatMap(field => (form[field].trim() ? [[field, form[field].trim().slice(0, 500)] as const] : []));
  const allEntries = [...commercialEntries, ...addedEntries];
  const commercial = allEntries.some(([, value]) => value) ? Object.fromEntries(allEntries) : null;
  return { scope: 'own_profile', profile: {
    fullName: text(data.full_name), email: text(data.email), companyName: text(data.company_name),
    companyDomain: text(data.company_domain), jobTitle: text(data.job_title), updatedAt: text(data.updated_at),
  }, commercial, signatures, mailboxVerified: false,
  companyFrom: company ? 'Ficha de la empresa: la misma para todo el equipo; la editan los dueños y administradores en Administración → Empresa.' : undefined };
}
