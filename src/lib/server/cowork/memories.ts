import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { memoryValueText } from '@/lib/server/suplia-context';

/**
 * «Lo que Cowork recuerda» (Plan 13): the memories its turns read (user-context.ts: approved, not expired, the organization's
 * and your own), so you can see them and make it forget one, as in Claude or ChatGPT. Forgetting archives the row: no turn
 * reads it again, and it is not deleted. Your own memories are yours to forget; the organization's, the author's or an
 * owner's or admin's of the organization.
 */

export type CoworkMemoryItem = {
  id: string;
  text: string;
  scope: 'personal' | 'organization';
  /** You saved it (or approved the card that saved it). */
  mine: boolean;
  canForget: boolean;
  updatedAt: string | null;
};

type Row = { id: string; scope?: string | null; user_id?: string | null; memory_type?: string | null; key?: string | null; value?: unknown;
  expires_at?: string | null; updated_at?: string | null; status?: string | null };

/** At most this many in the list: the turns read the newest eight. */
export const COWORK_MEMORY_LIST_LIMIT = 50;

const isManager = (auth: AuthContext) => auth.organizationRole === 'owner' || auth.organizationRole === 'admin';

const MEMORY_LENGTH = 240;
/** «tono: tutear a todos» or the text alone; an internal name (cowork_preference, tone_pref) never reaches the screen. */
function memoryText(row: Row) {
  const label = memoryValueText(row.key);
  const readable = label && !/^[\w.-]*[_.][\w.-]*$/.test(label) ? label : '';
  const body = memoryValueText(row.value);
  const line = body && readable && !body.toLowerCase().startsWith(readable.toLowerCase()) ? `${readable}: ${body}` : body || readable;
  return line.length > MEMORY_LENGTH ? `${line.slice(0, MEMORY_LENGTH - 1).trimEnd()}…` : line;
}

function item(auth: AuthContext, row: Row): CoworkMemoryItem {
  const organization = row.scope === 'organization';
  const mine = row.user_id === auth.user.id;
  return { id: row.id, text: memoryText(row), scope: organization ? 'organization' : 'personal', mine,
    canForget: organization ? mine || isManager(auth) : mine, updatedAt: row.updated_at ?? null };
}

const visible = (auth: AuthContext, row: Row, now: number) => (row.scope === 'organization' || row.user_id === auth.user.id)
  && !(row.expires_at && Date.parse(row.expires_at) <= now);

export async function listCoworkMemories(auth: AuthContext, admin = getSupabaseAdminClient(), now = Date.now()): Promise<CoworkMemoryItem[]> {
  const userId = z.string().uuid().parse(auth.user.id);
  const { data, error } = await admin.from('suplia_memories').select('id,scope,user_id,memory_type,key,value,expires_at,updated_at')
    .eq('organization_id', auth.organizationId).eq('status', 'approved')
    .or(`scope.eq.organization,user_id.eq.${userId}`)
    .order('updated_at', { ascending: false }).limit(COWORK_MEMORY_LIST_LIMIT);
  if (error) throw new Error('No se pudo leer lo que Cowork recuerda.');
  return ((data || []) as Row[]).filter(row => visible(auth, row, now)).map(row => item(auth, row)).filter(memory => memory.text);
}

export class CoworkMemoryRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Forgets one memory you can see and may forget. Forgetting it twice is harmless. */
export async function forgetCoworkMemory(auth: AuthContext, id: string, admin = getSupabaseAdminClient(), now = Date.now()) {
  z.string().uuid().parse(id);
  const { data, error } = await admin.from('suplia_memories').select('id,scope,user_id,status,expires_at')
    .eq('id', id).eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw new Error('No se pudo olvidar ese recuerdo.');
  const row = data as Row | null;
  if (!row || !visible(auth, row, now) || (row.status !== 'approved' && row.status !== 'archived')) {
    throw new CoworkMemoryRefused('Ese recuerdo ya no está disponible.', 404);
  }
  if (!item(auth, row).canForget) throw new CoworkMemoryRefused('Solo quien lo guardó o un administrador de tu organización puede olvidarlo.', 403);
  if (row.status === 'archived') return { forgotten: true };
  const updated = await admin.from('suplia_memories').update({ status: 'archived', updated_at: new Date(now).toISOString() })
    .eq('id', id).eq('organization_id', auth.organizationId).eq('status', 'approved').select('id').maybeSingle();
  if (updated.error) throw new Error('No se pudo olvidar ese recuerdo.');
  return { forgotten: true };
}
