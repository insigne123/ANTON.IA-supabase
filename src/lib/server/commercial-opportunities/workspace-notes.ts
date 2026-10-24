import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { isOpportunityAdmin, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { isEditableNote, mentionedPeople, type MentionPerson } from '@/lib/commercial-opportunities/activity-notes';
import { assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, opportunityDb, workspaceMembers } from './workspace-store';
import { notifyPeople } from './workspace-decisions';

type Row = Record<string, any>;

/** Who a note can name: the team of the opportunity and the administrators, who can all read it; and the name of whoever writes. */
async function people(client: SupabaseClient, scope: WorkScope, id: string): Promise<{ mentionable: MentionPerson[]; author: string }> {
  const [members, team] = await Promise.all([
    workspaceMembers(client, scope),
    client.from('opportunity_participants').select('user_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).limit(200)
      .then(result => new Set(((opportunityDb(result) || []) as Row[]).map(row => String(row.user_id)))),
  ]);
  return {
    mentionable: members.filter(member => team.has(member.user_id) || isOpportunityAdmin(member.role)).map(({ user_id, name }) => ({ user_id, name })),
    author: members.find(member => member.user_id === scope.userId)?.name || 'Alguien del equipo',
  };
}
/** «Diego Fuentes te mencionó: <oportunidad>» on «Novedades», once per note and person. */
async function tellMentioned(client: SupabaseClient, scope: WorkScope, id: string, users: string[], author: string, key: string) {
  if (!users.length) return;
  const item = opportunityDb(await client.from('commercial_opportunities').select('title').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle()) as Row | null;
  await notifyPeople(client, scope, id, users, `${author} te mencionó: ${String(item?.title || 'Oportunidad').replace(/\s+/g, ' ').trim().slice(0, 300)}`, `mention:${key}`);
}

/** A note in the activity (OPP-28). Whoever it names with «@» hears about it; returns them, for the email after the answer. */
export async function addOpportunityNote(client: SupabaseClient, scope: WorkScope, id: string, text: string) {
  await assertOpportunityRead(client, scope, id);
  const { mentionable, author } = await people(client, scope, id);
  const mentions = mentionedPeople(text, mentionable).filter(user => user !== scope.userId);
  const key = `note:${randomUUID()}`;
  await addOpportunityActivity(client, scope, id, 'note', text, mentions.length ? { mentions } : {}, key);
  await tellMentioned(client, scope, id, mentions, author, key);
  return { mentioned: mentions };
}

async function ownNote(client: SupabaseClient, scope: WorkScope, id: string, noteId: string) {
  await assertOpportunityRead(client, scope, id);
  const row = opportunityDb(await client.from('opportunity_activity').select('id,actor_id,kind,data,event_key').eq('organization_id', scope.organizationId)
    .eq('opportunity_id', id).eq('id', noteId).maybeSingle()) as Row | null;
  if (!row) throw new AuthError('Esa nota ya no existe. Actualiza la oportunidad.', 404);
  if (!isEditableNote(row, scope.userId)) throw new AuthError('Solo puedes cambiar las notas que escribiste.', 403);
  return row;
}

/** Corrects one's own note; it says «editada». Only whoever it names for the first time hears about it. */
export async function editOpportunityNote(client: SupabaseClient, scope: WorkScope, id: string, input: { id: string; text: string }) {
  const row = await ownNote(client, scope, id, input.id);
  const { mentionable, author } = await people(client, scope, id);
  const mentions = mentionedPeople(input.text, mentionable).filter(user => user !== scope.userId);
  const { mentions: before, ...data } = (row.data && typeof row.data === 'object' ? row.data : {}) as Row;
  opportunityDb(await client.from('opportunity_activity').update({ body: input.text, data: { ...data, ...(mentions.length ? { mentions } : {}), editedAt: new Date().toISOString() } })
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.id));
  const told = new Set(Array.isArray(before) ? before.map(String) : []);
  const fresh = mentions.filter(user => !told.has(user));
  await tellMentioned(client, scope, id, fresh, author, String(row.event_key || row.id));
  return { mentioned: fresh };
}

/** Deletes one's own note. */
export async function deleteOpportunityNote(client: SupabaseClient, scope: WorkScope, id: string, noteId: string) {
  await ownNote(client, scope, id, noteId);
  opportunityDb(await client.from('opportunity_activity').delete().eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', noteId));
  return { deleted: true };
}
