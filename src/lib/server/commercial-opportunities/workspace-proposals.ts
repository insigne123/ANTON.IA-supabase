import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import type { ActivityLike, fitProposalSchema } from '@/lib/commercial-opportunities/member-work';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { assertOpportunityRead } from './workspace-access';
import { notifyManagers, notifyPeople } from './workspace-decisions';
import { answerFitQuestion } from './workspace-fit';
import { addOpportunityActivity, opportunityDb } from './workspace-store';

type Row = Record<string, any>;
const tidy = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What a member answers to «¿Cumplimos?» is a claim about the company (a certificate, an experience, who owns it), and the offers
 * built on the ficha are public. So it does not go into the ficha: it waits, in the activity, for an administrator to confirm it.
 * The same person answering the same question again replaces their earlier answer.
 */
export async function proposeFitAnswer(client: SupabaseClient, scope: WorkScope, id: string, input: z.infer<typeof fitProposalSchema>) {
  await assertOpportunityRead(client, scope, id);
  const question = tidy(input.question, 320), answer = tidy(input.answer, 500);
  const lines = (opportunityDb(await client.from('opportunity_activity').select('id,kind,body,actor_id,created_at,data')
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('kind', 'fit_proposal').order('created_at', { ascending: false }).limit(60)) || []) as ActivityLike[];
  const body = `Propone para la ficha: «${question}» → ${answer}`.slice(0, 900);
  const again = lines.find(line => line.actor_id === scope.userId && line.data?.status === 'pending' && line.data?.question === question);
  if (again) {
    opportunityDb(await client.from('opportunity_activity').update({ body, data: { question, answer, status: 'pending' } }).eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', again.id));
    return again.id;
  }
  const key = `fit-proposal:${randomUUID()}`;
  await addOpportunityActivity(client, scope, id, 'fit_proposal', body, { question, answer, status: 'pending' }, key);
  await notifyManagers(client, scope, id, 'Respuesta para la ficha', key);
  return key;
}

/**
 * An administrator confirms an answer (it goes into the company's ficha, as if they had typed it) or drops it. Either way the person
 * who gave it is told, and the proposal stops waiting. Returns the answer when it was accepted, so the requirements can be read again.
 */
export async function resolveFitProposal(client: SupabaseClient, scope: WorkScope, id: string, input: { activityId: string; accept: boolean }) {
  await assertOpportunityRead(client, scope, id);
  const row = opportunityDb(await client.from('opportunity_activity').select('id,kind,actor_id,data')
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.activityId).eq('kind', 'fit_proposal').maybeSingle()) as Row | null;
  if (!row) throw new AuthError('No encontramos esa respuesta.', 404);
  const { question, answer, status } = (row.data || {}) as Row;
  if (status !== 'pending' || typeof question !== 'string' || typeof answer !== 'string') throw new AuthError('Esa respuesta ya se revisó.', 409);
  // Taken first, so two administrators confirming at once write the ficha once.
  const taken = opportunityDb(await client.from('opportunity_activity').update({ data: { question, answer, status: input.accept ? 'accepted' : 'rejected', resolvedBy: scope.userId, resolvedAt: new Date().toISOString() } })
    .eq('organization_id', scope.organizationId).eq('opportunity_id', id).eq('id', input.activityId).eq('data->>status', 'pending').select('id').maybeSingle());
  if (!taken) throw new AuthError('Esa respuesta ya se revisó.', 409);
  if (input.accept) await answerFitQuestion(client, scope, id, { question, answer });
  await addOpportunityActivity(client, scope, id, 'fit_proposal_resolved', `${input.accept ? 'Confirmada en la ficha' : 'Descartada'}: «${tidy(question, 200)}»`, { activityId: input.activityId, accepted: input.accept });
  const title = opportunityDb(await client.from('commercial_opportunities').select('title').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle()) as Row | null;
  await notifyPeople(client, scope, id, [row.actor_id], `${input.accept ? 'Confirmaron tu respuesta para la ficha' : 'Descartaron tu respuesta para la ficha'}: ${tidy(String(title?.title || 'Oportunidad'), 300)}`, `fit-resolved:${input.activityId}`);
  return input.accept ? { question, answer } : null;
}
