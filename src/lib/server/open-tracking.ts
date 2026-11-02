/**
 * «Medir aperturas» (plan de uso M4, 2 Nov 2026): whether an organization measures the opens of the emails its people send one by
 * one from ANTON.IA. In 90 days 36 of those emails went out and none could be opened as far as anyone knew: the pixel was never
 * asked for. Off by default; owners and administrators turn it on in Administración › Empresa. Only the open pixel, never rewritten
 * links (src/lib/email-tracking.ts). The column (20261102130000) may not exist yet: then it is off.
 */
type Client = any;
const MISSING = new Set(['42703', 'PGRST204', '42P01', 'PGRST205']);

export class OpenTrackingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * Whether the organization measures opens (off when it cannot be read), and whether it can: before the column exists the
 * switch is not offered, rather than one that always fails.
 */
export async function readOpenTrackingState(client: Client, organizationId: string): Promise<{ enabled: boolean; available: boolean }> {
  try {
    const result = await client.from('organizations').select('open_tracking_enabled').eq('id', organizationId).maybeSingle();
    if (result.error) return { enabled: false, available: !MISSING.has(String(result.error.code || '')) };
    return { enabled: result.data?.open_tracking_enabled === true, available: true };
  } catch {
    return { enabled: false, available: false };
  }
}

/** Whether the organization measures opens; off when it cannot be read. */
export async function readOpenTracking(client: Client, organizationId: string): Promise<boolean> {
  return (await readOpenTrackingState(client, organizationId)).enabled;
}

/** Turns it on or off, for owners and administrators of the organization only. */
export async function saveOpenTracking(client: Client, scope: { organizationId: string; userId: string }, on: boolean) {
  const member = await client.from('organization_members').select('role').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
  if (member.error) throw new OpenTrackingError('No pudimos comprobar tu rol.', 503);
  if (!['owner', 'admin'].includes(String(member.data?.role || ''))) throw new OpenTrackingError('Solo un administrador puede cambiar esto.', 403);
  const saved = await client.from('organizations').update({ open_tracking_enabled: on }).eq('id', scope.organizationId);
  if (saved.error) {
    throw new OpenTrackingError(MISSING.has(String(saved.error.code || '')) ? 'La medición de aperturas aún no está disponible.' : 'No pudimos guardar el cambio.', 503);
  }
  return { enabled: on };
}

/**
 * What one send measures: what the request asked for, else the organization's choice for the emails sent one by one (a new
 * message, not a reply in a conversation). Clicks only when asked for.
 */
export function sendTracking(input: { open?: boolean; clicks?: boolean; organizationOpens: boolean; newMessage: boolean }) {
  const opens = input.open ?? (input.newMessage && input.organizationOpens);
  const clicks = input.clicks === true;
  return { track: opens || clicks, links: clicks };
}
