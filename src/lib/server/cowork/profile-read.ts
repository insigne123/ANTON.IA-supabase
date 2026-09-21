import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeCoworkSignature } from './signature';

/** Profile identity is global to the owner, not an organization mailbox.
 * Exposes only sanitized channel signatures; never provider credentials. */
export async function readCoworkProfile(client: SupabaseClient, scope: { userId: string; organizationId: string }, value: string) {
  z.literal('').parse(value);
  const userId = z.string().uuid().parse(scope.userId);
  const { data, error } = await client.from('profiles')
    .select('id,full_name,email,company_name,company_domain,job_title,updated_at,signatures')
    .eq('id', userId).maybeSingle();
  if (error) throw new Error('No se pudo consultar tu perfil comercial.');
  if (!data) return { scope: 'own_profile', profile: null };
  if (data.id !== userId) throw new Error('El perfil está fuera del alcance permitido.');
  const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 500) : null;
  const stored = data.signatures && typeof data.signatures === 'object' ? data.signatures as Record<string, unknown> : {};
  const signatures = (['gmail', 'outlook'] as const).flatMap(channel => {
    const value = stored[channel] as Record<string, unknown> | undefined;
    if (!value || typeof value.html !== 'string' || !value.html || value.html.length > 12000) return [];
    try { return [{ channel, enabled: value.enabled === true, ...sanitizeCoworkSignature(value.html) }]; }
    catch { return []; }
  });
  return { scope: 'own_profile', profile: {
    fullName: text(data.full_name), email: text(data.email), companyName: text(data.company_name),
    companyDomain: text(data.company_domain), jobTitle: text(data.job_title), updatedAt: text(data.updated_at),
  }, signatures, mailboxVerified: false };
}
