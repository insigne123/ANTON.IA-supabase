import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { decisionBody, openDecision, replyBody, type ActivityLike, type decisionReplySchema, type decisionSchema } from '@/lib/commercial-opportunities/member-work';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { addOpportunityActivity, opportunityDb } from './workspace-store';

type Row = Record<string, any>;

/** Tells people on «Novedades» that something needs them on an opportunity; once per person and event. */
export async function notifyPeople(client: SupabaseClient, scope: WorkScope, id: string, users: Array<string | null | undefined>, title: string, eventKey: string) {
  const to = [...new Set(users.filter((user): user is string => Boolean(user) && user !== scope.userId))];
  if (!to.length) return;
  opportunityDb(await client.from('opportunity_notifications').upsert(
    to.map(user => ({ organization_id: scope.organizationId, opportunity_id: id, user_id: user, title: title.slice(0, 480), kind: 'task', event_key: eventKey })),
    { onConflict: 'organization_id,user_id,event_key', ignoreDuplicates: true }));
}
async function opportunityTitle(client: SupabaseClient, scope: WorkScope, id: string) {
  const row = opportunityDb(await client.from('commercial_opportunities').select('title').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle()) as Row | null;
  return String(row?.title || 'Oportunidad').replace(/\s+/g, ' ').trim().slice(0, 300);
}
async function responsibleOf(client: SupabaseClient, scope: WorkScope, id: string) {
  const row = opportunityDb(await client.from('opportunity_work').select('responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle()) as Row | null;
  return (row?.responsible_id as string | null) ?? null;
}

/** Tells the administrators and whoever is in charge that something on the opportunity needs them. */
export async function notifyManagers(client: SupabaseClient, scope: WorkScope, id: string, headline: string, eventKey: string) {
  const [title, responsible, admins] = await Promise.all([
    opportunityTitle(client, scope, id), responsibleOf(client, scope, id),
    client.from('organization_members').select('user_id').eq('organization_id', scope.organizationId).in('role', ['owner', 'admin']).limit(200).then(result => (opportunityDb(result) || []) as Row[]),
  ]);
  await notifyPeople(client, scope, id, [...admins.map(row => String(row.user_id)), responsible], `${headline}: ${title}`, eventKey);
}

/**
 * A person working the opportunity puts a decision to the administrators: «Propongo no postular» or «Necesito que decidan…», with its reason
 * and, when it has one, the date it is needed by. It stays in the activity, and the administrators and whoever is in charge are told.
 */
export async function recordDecision(client: SupabaseClient, scope: WorkScope, id: string, input: z.infer<typeof decisionSchema>) {
  await assertOpportunityRead(client, scope, id);
  const key = `decision:${randomUUID()}`;
  await addOpportunityActivity(client, scope, id, 'decision', decisionBody(input.type, input.text), { type: input.type, dueAt: input.dueAt }, key);
  await notifyManagers(client, scope, id, input.type === 'no_go' ? 'Propuesta de no postular' : 'Decisión pedida', key);
}

/** An administrator answers the decision waiting on the opportunity; whoever asked (and whoever is in charge) is told. */
export async function replyToDecision(client: SupabaseClient, scope: WorkScope, id: string, input: z.infer<typeof decisionReplySchema>) {
  await assertOpportunityRead(client, scope, id);
  const lines = (opportunityDb(await client.from('opportunity_activity').select('id,kind,body,actor_id,created_at,data')
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('kind', 'decision').order('created_at', { ascending: false }).limit(20)) || []) as ActivityLike[];
  const waiting = openDecision(lines);
  if (!waiting) throw new AuthError('No hay una decisión pendiente en esta oportunidad.', 409);
  const key = `decision:${randomUUID()}`;
  await addOpportunityActivity(client, scope, id, 'decision', replyBody(input.text), { type: 'reply', to: waiting.id }, key);
  const [title, responsible] = await Promise.all([opportunityTitle(client, scope, id), responsibleOf(client, scope, id)]);
  await notifyPeople(client, scope, id, [waiting.actorId, responsible], `Respondieron tu decisión: ${title}`, key);
}
