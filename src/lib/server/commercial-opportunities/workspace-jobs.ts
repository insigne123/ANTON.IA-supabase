import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@/lib/server/auth-utils';
import { opportunityAutomationEnabled, opportunityWorkspaceEnabled, opportunityLocalClock, type WorkScope } from '@/lib/commercial-opportunities/workspace';
import { opportunityDb } from './workspace-store';
import { assertOpportunityAdmin } from './workspace-access';
import { opportunityGenerate, type OpportunityJob } from './workspace-ai';
import { criteriaSchema, captureOpportunityLinkedIn, captureOpportunityTenders, evaluateOpportunityBatch } from './workspace-sources';
import { runOpportunityResearch, runOpportunityChat } from './workspace-research';
import { applyAutomaticMove, runPipelineReview } from './workspace-pipeline';
import { runOpportunityOffer } from './workspace-offer';
import { enqueueMonthlyDemand, runOpportunityDemand } from './purchase-plan';
import { runOpportunityAssistant } from './workspace-assistant';
import { runTenderProfileSuggestion } from './workspace-tender-profile';
import { enqueueFitAfterReport, runRequirementFit } from './workspace-fit';
import { enqueueMonthlyContracts, runMarketContracts, runWinPlan } from './workspace-market';

export async function enqueueOpportunityDiscovery(client: SupabaseClient, scope: WorkScope, manual = false) {
  assertOpportunityAdmin(scope);
  const context = opportunityDb(await client.from('opportunity_company_context').select('*').eq('organization_id', scope.organizationId).maybeSingle());
  if (!context) throw new AuthError('Confirma primero la oferta del workspace.', 409);
  const clock = opportunityLocalClock();
  if (!manual && (!context.automation || clock.hour < context.hour)) return 0;
  const prefix = `daily:${clock.day}:${context.revision}`;
  const kinds = context.criteria?.postQueries?.length ? ['tenders', ...(context.criteria?.roles?.length ? ['hiring'] : []), 'posts'] : ['criteria'];
  for (const kind of kinds) opportunityDb(await client.from('opportunity_jobs').upsert({ organization_id: scope.organizationId, requested_by: scope.userId,
    kind, dedupe_key: `${prefix}:${kind}`, payload: { revision: context.revision } }, { onConflict: 'organization_id,dedupe_key', ignoreDuplicates: true }));
  // «Demanda futura» reads the Plan Anual de Compras once a month, once the words exist; «Contratos por vencer» too.
  await enqueueMonthlyDemand(client, scope, context, clock.day);
  await enqueueMonthlyContracts(client, scope, context, clock.day).catch(() => undefined);
  return kinds.length;
}
export async function enqueueDailyOpportunityWork(client: SupabaseClient) {
  if (!opportunityAutomationEnabled()) return 0;
  // Stable keyset pagination, not a permanent first-50 cap. Tick workers claim independently.
  let after = ''; let count = 0;
  for (let page = 0; page < 20; page++) {
    let query = client.from('opportunity_company_context').select('organization_id,approved_by').eq('automation', true).order('organization_id').limit(100);
    if (after) query = query.gt('organization_id', after);
    const rows = opportunityDb(await query) || [];
    for (const context of rows) {
      const member = opportunityDb(await client.from('organization_members').select('role').eq('organization_id', context.organization_id).eq('user_id', context.approved_by).maybeSingle());
      if (member?.role === 'admin' || member?.role === 'owner') count += await enqueueOpportunityDiscovery(client, { organizationId: context.organization_id, userId: context.approved_by, role: member.role });
    }
    if (rows.length < 100) break; after = rows.at(-1)!.organization_id;
  }
  return count;
}
export async function opportunityWorkerTick(client: SupabaseClient) {
  if (!opportunityWorkspaceEnabled()) return { processed: 0, disabled: true };
  const claimed = opportunityDb(await client.rpc('opportunity_claim_job')) as OpportunityJob[];
  const job = claimed?.[0];
  if (!job) return { processed: 0 };
  return runOpportunityJob(client, job);
}
/**
 * A chat question answered while the person waits, like a conversation: its own job, taken here only while still queued
 * (the same conditional update the claim makes), so a worker that took it first answers it instead and nothing runs twice.
 */
export async function answerOpportunityChatNow(client: SupabaseClient, organizationId: string, dedupeKey: string) {
  const done = await runQueuedOpportunityJobNow(client, organizationId, dedupeKey, 'chat');
  return done?.processed === 1 && done.state === 'ready';
}
/** A queued job taken in the same request, only while still queued: a worker that took it first keeps it. */
export async function runQueuedOpportunityJobNow(client: SupabaseClient, organizationId: string, dedupeKey: string, kind: 'chat' | 'evaluate' | 'assistant' | 'profile' | 'fit') {
  const job = opportunityDb(await client.from('opportunity_jobs')
    .update({ state: 'running', lease_token: randomUUID(), lease_until: new Date(Date.now() + 5 * 60_000).toISOString(), attempts: 1, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId).eq('dedupe_key', dedupeKey).eq('kind', kind).eq('state', 'queued').select('*').maybeSingle()) as OpportunityJob | null;
  return job ? runOpportunityJob(client, job) : null;
}
/** One claimed job, run and committed with its lease: the worker's tick and the chat answered now share it. */
export async function runOpportunityJob(client: SupabaseClient, job: OpportunityJob) {
  let result: any = null; let state = 'ready'; let error: string | null = null;
  try {
    const context = opportunityDb(await client.from('opportunity_company_context').select('*').eq('organization_id', job.organization_id).maybeSingle());
    if (!context) throw new AuthError('Falta la oferta compartida del workspace.', 409);
    if (job.payload.revision && job.payload.revision !== context.revision) throw new AuthError('Los criterios cambiaron; se preparará una búsqueda actualizada.', 409);
    if (job.kind === 'criteria') {
      const criteria = await opportunityGenerate(client, job, { role: 'screen', category: 'evaluation', step: 'criteria', schema: criteriaSchema, output: 3000,
        prompt: `Deriva criterios comerciales desde la oferta confirmada, sin inventar servicios. roles son cargos que aparecen en avisos de trabajo y revelan que una empresa necesita esta oferta (por ejemplo, cargos que se contratan en volumen o la creación de un área), nunca los cargos de quienes deciden la compra; esos van en decisionMakerTitles. Genera también palabras/categorías de compras públicas y 5 consultas de publicaciones LinkedIn, cada una sobre una necesidad distinta. Los posts deben buscar compradores/necesidades, no promoción de proveedores: frases cortas entre comillas unidas por OR, a lo más un AND, y excluye a quien busca empleo con NOT ("busco trabajo" OR opentowork). Consultas de hasta 400 caracteres/5 operadores, sin site: (se enviarán al buscador LinkedIn). Datos: ${JSON.stringify({ offer: context.offer, services: context.services, territories: context.territories, exclusions: context.exclusions, priority: context.priority })}` });
      opportunityDb(await client.from('opportunity_company_context').update({ criteria }).eq('organization_id', job.organization_id).eq('revision', context.revision));
      result = { criteriaReady: true };
      if (context.automation && opportunityAutomationEnabled()) await enqueueOpportunityDiscovery(client, { organizationId: job.organization_id, userId: job.requested_by, role: 'admin' }, true);
    } else if (job.kind === 'evaluate' && job.payload.pipeline) {
      result = await runPipelineReview(client, job);
    } else if (['tenders', 'hiring', 'posts', 'evaluate'].includes(job.kind)) {
      if (!opportunityAutomationEnabled()) throw new AuthError('La búsqueda automática aún no está activada.', 409);
      if (job.kind === 'tenders') { result = await captureOpportunityTenders(client, job, context);if(result.waiting)state='waiting'; }
      else if (job.kind === 'evaluate') result = await evaluateOpportunityBatch(client, job, context);
      else { result = await captureOpportunityLinkedIn(client, job, context); if (result.waiting) state = 'waiting'; }
    } else if (job.kind === 'research') {
      const research = await runOpportunityResearch(client, job, Date.now());
      if (research.waiting) { state = 'waiting'; result = { progress: 'Lectura documental en curso' }; }
      else result = research.report;
    } else if (job.kind === 'chat') result = await runOpportunityChat(client, job);
    else if (job.kind === 'assistant') result = await runOpportunityAssistant(client, job);
    else if (job.kind === 'profile') result = await runTenderProfileSuggestion(client, job);
    else if (job.kind === 'fit') result = await runRequirementFit(client, job);
    else if (job.kind === 'offer') result = await runOpportunityOffer(client, job);
    else if (job.kind === 'demand') {
      const demand = await runOpportunityDemand(client, job, context, Date.now());
      if (demand.waiting) { state = 'waiting'; result = { progress: 'Leyendo el Plan Anual de Compras' }; }
      else result = demand;
    }
    else if (job.kind === 'winplan') result = await runWinPlan(client, job);
    else if (job.kind === 'contracts') {
      const contracts = await runMarketContracts(client, job, context, Date.now());
      if (contracts.waiting) { state = 'waiting'; result = { progress: 'Revisando contratos por vencer' }; }
      else result = contracts;
    }
    else throw new AuthError('El tipo de trabajo no está disponible.', 400);
  } catch (failure) {
    state = failure instanceof AuthError && [402, 409, 422].includes(failure.status) ? 'blocked' : 'failed';
    error = failure instanceof AuthError ? failure.message : 'El trabajo no pudo terminar. Los documentos y reservas se conservan.';
  }
  const committed = opportunityDb(await client.rpc('opportunity_finish_job', { p_id: job.id, p_lease: job.lease_token, p_state: state, p_result: result, p_error: error }));
  if (committed && state === 'ready' && job.kind === 'research' && job.opportunity_id) {
    await notifyReportReady(client, job).catch(() => undefined);
    // A report ready moves an assigned opportunity into preparation (pipeline.ts).
    await applyAutomaticMove(client, { organizationId: job.organization_id, userId: job.requested_by }, job.opportunity_id, { kind: 'report_ready' }).catch(() => null);
    // Its requirements are read against the company's tender profile, when there is one (workspace-fit.ts).
    await enqueueFitAfterReport(client, job);
  }
  return { processed: committed ? 1 : 0, state, kind: job.kind };
}
/** Whoever asked for the report hears it is ready, even without a team assigned (participants already get it). */
async function notifyReportReady(client: SupabaseClient, job: OpportunityJob) {
  const item = opportunityDb(await client.from('commercial_opportunities').select('title').eq('organization_id', job.organization_id).eq('id', job.opportunity_id).maybeSingle());
  await client.from('opportunity_notifications').upsert({ organization_id: job.organization_id, opportunity_id: job.opportunity_id, user_id: job.requested_by,
    title: `Informe listo: ${String(item?.title || 'oportunidad').slice(0, 470)}`, kind: 'report', event_key: `report:${job.id}` },
    { onConflict: 'organization_id,user_id,event_key', ignoreDuplicates: true });
}
export const opportunityManifestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
