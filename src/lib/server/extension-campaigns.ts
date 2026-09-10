import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';

// Fixed API adapter: extension-only releases do not activate the bulk campaign
// implementation or its migrations. The campaign service remains authoritative.
type Call = (path: string, method?: 'GET' | 'PUT', body?: unknown) => Promise<any>;
type Scope = { organizationId: string; userId: string };
export async function listExtensionCampaigns(call: Call, email: string) {
  const payload = await call('/api/campaigns/bulk');
  return (payload.campaigns || []).map((campaign: any) => ({
    id: campaign.id, revision: campaign.revision, name: campaign.definition.name,
    status: campaign.status, recipientCount: campaign.definition.emails.length,
    alreadyAdded: campaign.definition.emails.some((value: string) => value.toLowerCase() === email.toLowerCase()),
    editable: ['draft', 'rejected'].includes(campaign.status),
  }));
}

export async function addExtensionCampaignLead(input: Scope & {
  campaignId: string; revision: number; email: string;
}, call: Call) {
  const id = z.string().uuid().parse(input.campaignId);
  const email = z.string().trim().email().parse(input.email).toLowerCase();
  const path = `/api/campaigns/bulk/${id}`;
  const { campaign } = await call(path);
  if (!campaign || campaign.organization_id !== input.organizationId || campaign.user_id !== input.userId) {
    throw new AuthError('No encontramos esta campaña en tu cuenta.', 404);
  }
  if (campaign.definition.emails.some((value: string) => value.toLowerCase() === email)) {
    return { alreadyAdded: true, campaignId: id, revision: campaign.revision };
  }
  if (!['draft', 'rejected'].includes(campaign.status)) throw new AuthError('Solo puedes añadir contactos a campañas pendientes de aprobación.', 409);
  if (campaign.revision !== input.revision) throw new AuthError('La campaña cambió. Actualiza la lista antes de añadir el lead.', 409);
  if (campaign.definition.emails.length >= 100) throw new AuthError('La campaña ya tiene 100 destinatarios.', 409);
  // PUT revalidates the whole audience and atomically compares the revision.
  // No approve/process endpoint is invoked, and no criteria are widened.
  const result = await call(path, 'PUT', { revision: input.revision,
    definition: { ...campaign.definition, emails: [...campaign.definition.emails, email] } });
  return { alreadyAdded: false, campaignId: id, revision: result.campaign.revision };
}

export function extensionCampaignApi(origin: string, cookie: string, fetcher: typeof fetch = fetch): Call {
  return async (path, method = 'GET', body) => {
    if (!/^\/api\/campaigns\/bulk(?:\/[a-f0-9-]{36})?$/.test(path)) throw new Error('INVALID_CAMPAIGN_PATH');
    const response = await fetcher(new URL(path, origin), { method, redirect: 'error', cache: 'no-store',
      headers: { cookie, origin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 404 || payload?.setupRequired) throw new AuthError('Las campañas colectivas todavía no están disponibles en esta app.', 409);
      throw new AuthError(payload?.error || 'No se pudo actualizar la campaña.', response.status);
    }
    return payload;
  };
}
