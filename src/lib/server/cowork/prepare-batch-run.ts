import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  COWORK_PREPARE_BATCH_EFFECT, coworkPrepareBatchSummary, coworkPrepareCost, coworkPrepareStatus, hashCoworkPrepareBatch,
  type CoworkPrepareResult, type CoworkPrepareStepResult,
} from '@/lib/cowork/prepare-batch';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';
import { insertCoworkContact } from './save-contact';
import { enrichCoworkSavedLead } from './enrich-contact';
import { startCoworkResearchForLead } from './start-research';
import { coworkPrepareBatchEnabled, parseCoworkPrepareBatchTarget, readStaged } from './prepare-batch';

/** The approved «preparar contactos» batch, several people at a time (docs/cowork-preparar-contactos.md). Apart from the staging
 * module so the worker, which only proposes, does not load the provider and research code. */

/** The approved batch runs inside the worker's two minutes: no new provider call starts after this. */
const RUN_BUDGET_MS = 75_000;
/**
 * People prepared at the same time. An email lookup takes about 4 s in production (27 Oct: 10 lookups in 42 to 49 s, one after the
 * other), so a batch of 50 takes about 35 s, or 65 s when it researches too, within the budget and under the gateway's 60 lookups
 * a minute (APOLLO_BACKEND_ENRICH_MAX_REQUESTS). A second batch in the same minute waits for the next one (lookup below).
 */
const PARALLEL = 6;
const LATE = 'No alcanzó el tiempo de esta tanda: pídelo de nuevo y sigue donde quedó, sin pagar dos veces.';
/** The longest pause a batch waits for the provider's next minute of lookups (CoworkLookupBusyError). */
const BUSY_WAIT_MAX_MS = 30_000;
const BUSY = 'El proveedor estaba ocupado y no alcanzó el tiempo de esta tanda: pídelo de nuevo y sigue donde quedó, sin pagar dos veces.';

const reasonOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback).slice(0, 240);

const researchMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'COWORK_RESEARCH_EMAIL_REQUIRED') return 'No se investigó: primero hay que buscar su correo.';
  if (message === 'COWORK_RESEARCH_IDENTITY_INSUFFICIENT') return 'Faltan datos para investigarlo (nombre, empresa o LinkedIn).';
  return reasonOf(error, 'No se pudo encolar su investigación.');
};

/**
 * Run the approved batch, several people at a time and each one in order: save, look up the email, research; each step only if
 * it is still missing, and each one with the same rules, quotas and operation ids as the single action, so running it again
 * reuses instead of paying twice. A quota that runs out stops that step for whoever has not reached it, with the reason; nothing
 * is done for someone who was taken off.
 */
export async function executeCoworkPrepareBatch(auth: AuthContext, runId: string, targetId: string) {
  if (!coworkPrepareBatchEnabled()) throw new Error('Preparar contactos en lote está desactivado por ahora: no se hizo nada.');
  const target = parseCoworkPrepareBatchTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El lote aprobado ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (proposal.error || proposal.data?.status !== 'executing' || proposal.data.kind !== COWORK_PREPARE_BATCH_EFFECT || proposal.data.target_id !== targetId) {
    throw new Error('La autorización del lote ya no está vigente.');
  }
  const staged = await readStaged(client, scope, runId);
  if (!staged) throw new Error('El lote aprobado ya no está disponible.');
  if (staged.patch_hash !== target.hash || hashCoworkPrepareBatch(runId, staged.items) !== target.hash) {
    throw new Error('El lote cambió desde tu revisión. Pide una nueva revisión.');
  }
  const removed = new Set(staged.excluded || []);
  const startedAt = Date.now();
  const late = () => Date.now() - startedAt > RUN_BUDGET_MS;
  let lookupsStopped: string | null = null;
  let researchStopped: string | null = null;
  // A lookup the provider had no room for this minute is retried once after its pause, if this batch has the time: nothing was
  // asked nor paid (enrich-contact.ts). Otherwise it says so, and asking again continues where it was.
  const lookup = async (leadId: string) => {
    try {
      return await enrichCoworkSavedLead(auth, runId, leadId);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'CoworkLookupBusyError') throw error;
      const wait = Math.min(BUSY_WAIT_MAX_MS, Math.max(1, Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds) || 1) * 1000);
      if (Date.now() + wait - startedAt > RUN_BUDGET_MS) throw new Error(BUSY);
      await new Promise(resolve => setTimeout(resolve, wait));
      return enrichCoworkSavedLead(auth, runId, leadId);
    }
  };
  const prepare = async (item: (typeof staged.items)[number]): Promise<CoworkPrepareResult> => {
    if (removed.has(item.id)) return { id: item.id, name: item.name, company: item.company, status: 'removed', steps: [] };
    const steps: CoworkPrepareStepResult[] = [];
    const result: CoworkPrepareResult = { id: item.id, name: item.name, company: item.company, status: 'ready', steps };
    let leadId: string | null = item.steps.includes('save') ? null : item.id;
    if (item.steps.includes('save')) {
      try {
        if (!item.providerId) throw new Error('Falta el resultado de búsqueda de esta persona.');
        const saved = await insertCoworkContact(auth, item.providerId, { name: item.name, company: item.company, title: item.title,
          industry: item.contact?.industry, location: item.contact?.location, linkedin_url: item.contact?.linkedinUrl,
          company_website: item.contact?.companyWebsite, company_linkedin: item.contact?.companyLinkedin });
        leadId = String((saved.lead as { id?: unknown }).id);
        result.id = leadId;
        steps.push({ step: 'save', status: saved.reused ? 'reused' : 'done' });
      } catch (error) {
        steps.push({ step: 'save', status: 'failed', detail: reasonOf(error, 'No se pudo guardar.') });
      }
    }
    if (item.steps.includes('enrich')) {
      if (!leadId) steps.push({ step: 'enrich', status: 'skipped', detail: 'No se buscó su correo porque no se pudo guardar.' });
      else if (lookupsStopped) steps.push({ step: 'enrich', status: 'skipped', detail: lookupsStopped });
      else if (late()) steps.push({ step: 'enrich', status: 'skipped', detail: LATE });
      else {
        try {
          const found = await lookup(leadId);
          if (found.fullName) result.name = found.fullName;
          Object.assign(result, { email: found.email, emailStatus: found.emailStatus, linkedinUrl: found.linkedinUrl ?? null, emailWarning: found.emailWarning ?? null });
          steps.push({ step: 'enrich', status: found.reused ? 'reused' : 'done', ...(found.found ? {} : { detail: 'El proveedor no encontró su correo.' }) });
        } catch (error) {
          const message = reasonOf(error, 'No se pudo buscar su correo.');
          if (/cupo diario/i.test(message)) lookupsStopped = 'Se alcanzó el cupo diario de búsquedas de correo; se renueva mañana.';
          steps.push(/Ya existe una solicitud/.test(message)
            ? { step: 'enrich', status: 'skipped', detail: 'Ya había una búsqueda de su correo en curso: llega sola, sin pagar dos veces.' }
            : message === BUSY ? { step: 'enrich', status: 'skipped', detail: BUSY }
              : { step: 'enrich', status: 'failed', detail: lookupsStopped || message });
        }
      }
    }
    if (item.steps.includes('linkedin')) {
      // The same provider lookup as the email's: it brings the profile (and fills only the contact's gaps).
      if (!leadId) steps.push({ step: 'linkedin', status: 'skipped', detail: 'No se buscó su LinkedIn porque no se pudo guardar.' });
      else if (lookupsStopped) steps.push({ step: 'linkedin', status: 'skipped', detail: lookupsStopped });
      else if (late()) steps.push({ step: 'linkedin', status: 'skipped', detail: LATE });
      else {
        try {
          const found = await lookup(leadId);
          if (found.fullName) result.name = found.fullName;
          Object.assign(result, { email: found.email, emailStatus: found.emailStatus, linkedinUrl: found.linkedinUrl ?? null, emailWarning: found.emailWarning ?? null });
          steps.push({ step: 'linkedin', status: found.reused ? 'reused' : 'done', ...(found.linkedinUrl ? {} : { detail: 'El proveedor no encontró su perfil de LinkedIn.' }) });
        } catch (error) {
          const message = reasonOf(error, 'No se pudo buscar su LinkedIn.');
          if (/cupo diario/i.test(message)) lookupsStopped = 'Se alcanzó el cupo diario de búsquedas; se renueva mañana.';
          steps.push(/Ya existe una solicitud/.test(message)
            ? { step: 'linkedin', status: 'skipped', detail: 'Ya había una búsqueda de esta persona en curso: llega sola, sin pagar dos veces.' }
            : message === BUSY ? { step: 'linkedin', status: 'skipped', detail: BUSY }
              : { step: 'linkedin', status: 'failed', detail: lookupsStopped || message });
        }
      }
    }
    if (item.steps.includes('research')) {
      const lookupMissing = steps.some(step => step.step === 'enrich' && (step.status === 'failed' || step.status === 'skipped'));
      if (!leadId) steps.push({ step: 'research', status: 'skipped', detail: 'No se investigó porque no se pudo guardar.' });
      else if (lookupMissing) steps.push({ step: 'research', status: 'skipped', detail: 'No se investigó: primero hay que buscar su correo.' });
      else if (researchStopped) steps.push({ step: 'research', status: 'skipped', detail: researchStopped });
      else if (late()) steps.push({ step: 'research', status: 'skipped', detail: LATE });
      else {
        try {
          const started = await startCoworkResearchForLead(auth, runId, leadId);
          result.research = started.status === 'completed' ? 'completed' : 'queued';
          steps.push({ step: 'research', status: started.reused ? 'reused' : 'done' });
        } catch (error) {
          const message = researchMessage(error);
          if (/cupo/i.test(message)) researchStopped = 'Se alcanzó el cupo diario de investigaciones; se renueva mañana.';
          steps.push({ step: 'research', status: 'failed', detail: researchStopped || message });
        }
      }
    }
    result.status = coworkPrepareStatus(steps);
    return result;
  };
  // The results keep the order of the list, whoever finished first.
  const results: CoworkPrepareResult[] = new Array(staged.items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, staged.items.length) }, async () => {
    while (next < staged.items.length) {
      const index = next++;
      results[index] = await prepare(staged.items[index]);
    }
  }));
  const ran = results.filter(result => result.status !== 'removed');
  if (ran.length && ran.every(result => result.status === 'failed')) {
    const reasons = [...new Set(ran.flatMap(result => result.steps.flatMap(step => step.detail ? [step.detail] : [])))].slice(0, 3).join(' · ');
    throw new Error(`No se pudo preparar a nadie del lote. ${reasons}`.slice(0, 480));
  }
  return { reply: coworkPrepareBatchSummary(results), result: { items: results, cost: coworkPrepareCost(staged.items) } };
}
