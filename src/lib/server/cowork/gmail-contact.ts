import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken } from '@/lib/server-auth-helpers';
import { requireCoworkWorkerAccess } from './access';
import { readGmailContactMessages } from './gmail-contact-reader';

export async function readCoworkGmailContact(client: SupabaseClient,
  scope: { userId: string; organizationId: string }, value: string) {
  const leadId = z.string().uuid().parse(value);
  await requireCoworkWorkerAccess(client, scope);
  const lead = await client.from('leads').select('id,email').eq('id', leadId)
    .eq('organization_id', scope.organizationId).maybeSingle();
  if (lead.error || !lead.data) throw new Error('Contacto no disponible en esta organización.');
  const email = z.string().email().parse(lead.data.email);
  const token = await tokenService.getToken(client, scope.userId, 'google');
  if (!token?.refresh_token) throw new Error('Conecta Gmail con acceso de lectura.');
  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Gmail no está configurado.');
  const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  await requireCoworkWorkerAccess(client, scope);
  const result = await readGmailContactMessages(refreshed.access_token, email);
  await requireCoworkWorkerAccess(client, scope);
  return { leadId, ...result };
}
