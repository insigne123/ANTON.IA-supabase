import { createHash } from 'node:crypto';
import { z } from 'zod';

export type CoworkMailProvider = 'google' | 'outlook';

/** Mailbox identity comes from the provider, never the editable sales profile.
 * Pure module: no server dependencies, safe to unit test in plain Node. */
export async function coworkMailboxIdentity(provider: CoworkMailProvider, accessToken: string) {
  if (!accessToken) throw new Error('No se pudo comprobar la cuenta de correo.');
  const response = await fetch(provider === 'google'
    ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
    : 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('No se pudo comprobar la cuenta de correo. Reconéctala.');
  const body = await response.json();
  const email = z.string().email().max(320).parse(provider === 'google'
    ? body.emailAddress : body.mail || body.userPrincipalName).toLowerCase();
  const identity = provider === 'outlook' ? z.string().min(1).parse(body.id) : email;
  return { provider, email, identityHash: createHash('sha256').update(`${provider}\n${identity}\n${email}`).digest('hex') };
}
