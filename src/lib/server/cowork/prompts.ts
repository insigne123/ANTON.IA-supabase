import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { COWORK_PROMPTS_PER_PERSON, coworkPromptTitle, type CoworkSavedPrompt } from '@/lib/cowork/saved-prompts';

/**
 * «Pedidos guardados» (COW-06) on the server. Its author deletes one; a shared one, its author or an owner or admin of the
 * organization. Until migration 20261025020000 exists, the list is empty and nothing can be saved.
 */

/** The «/» list shows at most this many: one's own 30 and the team's newest. */
const LIST_LIMIT = 60;

export const coworkPromptInputSchema = z.object({
  title: z.string().trim().max(80).optional(),
  prompt: z.string().trim().min(3).max(4000),
  shared: z.boolean().default(false),
}).strict();

export class CoworkPromptRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Row = { id: string; user_id: string; title: string; prompt: string; shared: boolean; updated_at?: string | null };

export function isMissingPromptsTable(error: unknown) {
  const { code, message } = (error || {}) as { code?: string; message?: string };
  return code === 'PGRST205' || code === '42P01' || /cowork_prompts/.test(String(message || '')) && /(does not exist|could not find)/i.test(String(message || ''));
}

const isManager = (auth: AuthContext) => auth.organizationRole === 'owner' || auth.organizationRole === 'admin';

function item(auth: AuthContext, row: Row): CoworkSavedPrompt {
  const mine = row.user_id === auth.user.id;
  return { id: row.id, title: row.title, prompt: row.prompt, shared: row.shared, mine, canDelete: mine || (row.shared && isManager(auth)) };
}

export async function listCoworkPrompts(auth: AuthContext, admin = getSupabaseAdminClient()) {
  const userId = z.string().uuid().parse(auth.user.id);
  const { data, error } = await admin.from('cowork_prompts').select('id,user_id,title,prompt,shared,updated_at')
    .eq('organization_id', auth.organizationId).or(`user_id.eq.${userId},shared.eq.true`)
    .order('updated_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) {
    if (isMissingPromptsTable(error)) return { available: false, prompts: [] as CoworkSavedPrompt[] };
    throw new Error('No se pudieron leer tus pedidos guardados.');
  }
  // One's own first, then the team's.
  const prompts = ((data || []) as Row[]).map(row => item(auth, row));
  return { available: true, prompts: [...prompts.filter(prompt => prompt.mine), ...prompts.filter(prompt => !prompt.mine)] };
}

export async function saveCoworkPrompt(auth: AuthContext, input: z.input<typeof coworkPromptInputSchema>, admin = getSupabaseAdminClient(), now = Date.now()) {
  const { title, prompt, shared } = coworkPromptInputSchema.parse(input);
  const userId = z.string().uuid().parse(auth.user.id);
  const own = await admin.from('cowork_prompts').select('id,user_id,title,prompt,shared')
    .eq('organization_id', auth.organizationId).eq('user_id', userId).limit(COWORK_PROMPTS_PER_PERSON + 1);
  if (own.error) {
    if (isMissingPromptsTable(own.error)) throw new CoworkPromptRefused('Guardar pedidos aún no está disponible.', 503);
    throw new Error('No se pudo guardar el pedido.');
  }
  const rows = (own.data || []) as Row[];
  // The same request saved again is the one already there, with the name and the sharing chosen now.
  const same = rows.find(row => row.prompt.trim() === prompt);
  if (same) {
    const name = coworkPromptTitle(prompt, title || same.title);
    if (name === same.title && shared === same.shared) return { prompt: item(auth, same), created: false };
    const updated = await admin.from('cowork_prompts').update({ title: name, shared, updated_at: new Date(now).toISOString() })
      .eq('id', same.id).eq('organization_id', auth.organizationId).eq('user_id', userId).select('id,user_id,title,prompt,shared').single();
    if (updated.error || !updated.data) throw new Error('No se pudo guardar el pedido.');
    return { prompt: item(auth, updated.data as Row), created: false };
  }
  if (rows.length >= COWORK_PROMPTS_PER_PERSON) throw new CoworkPromptRefused(`Ya tienes ${COWORK_PROMPTS_PER_PERSON} pedidos guardados. Borra uno para guardar otro.`, 409);
  const at = new Date(now).toISOString();
  const inserted = await admin.from('cowork_prompts').insert({
    organization_id: auth.organizationId, user_id: userId, title: coworkPromptTitle(prompt, title), prompt, shared, created_at: at, updated_at: at,
  }).select('id,user_id,title,prompt,shared').single();
  if (inserted.error || !inserted.data) throw new Error('No se pudo guardar el pedido.');
  return { prompt: item(auth, inserted.data as Row), created: true };
}

export async function deleteCoworkPrompt(auth: AuthContext, id: string, admin = getSupabaseAdminClient()) {
  z.string().uuid().parse(id);
  const { data, error } = await admin.from('cowork_prompts').select('id,user_id,title,prompt,shared')
    .eq('id', id).eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw new Error('No se pudo borrar el pedido.');
  const row = data as Row | null;
  if (!row || (!row.shared && row.user_id !== auth.user.id)) throw new CoworkPromptRefused('Ese pedido ya no está.', 404);
  if (!item(auth, row).canDelete) throw new CoworkPromptRefused('Solo quien lo guardó o un administrador de tu organización puede borrarlo.', 403);
  const removed = await admin.from('cowork_prompts').delete().eq('id', id).eq('organization_id', auth.organizationId);
  if (removed.error) throw new Error('No se pudo borrar el pedido.');
  return { deleted: true };
}
