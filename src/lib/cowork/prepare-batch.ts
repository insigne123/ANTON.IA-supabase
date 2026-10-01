import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * «Preparar contactos»: several people of a conversation saved, with their email looked up and researched, approved with one
 * decision instead of one card per person and step (docs/cowork-preparar-contactos.md). Only the rules live here: what the model
 * may propose, what each person still needs (what is done is skipped, never charged twice), the hash of the list and how the result
 * reads. The server reads the real state of each person and runs it (server/cowork/prepare-batch.ts).
 */

export type CoworkPrepareGoal = 'save' | 'email' | 'research';
export type CoworkPrepareStep = 'save' | 'enrich' | 'research';
export const COWORK_PREPARE_STEPS: readonly CoworkPrepareStep[] = ['save', 'enrich', 'research'];
export const COWORK_PREPARE_BATCH_EFFECT = 'lead_prepare_batch';
/** Saving is a write per person; looking up an email and researching call the provider, so they go in smaller batches. */
export const COWORK_PREPARE_MAX: Record<CoworkPrepareGoal, number> = { save: 50, email: 10, research: 10 };

const PROVIDER_ID = /^apollo:[A-Za-z0-9_-]{1,200}$/;

/** contacts.prepare_batch: the goal and the people, each a search result (providerId) or a saved contact (leadId) seen in this conversation. */
export const coworkPrepareBatchSchema = z.object({
  goal: z.enum(['save', 'email', 'research']),
  people: z.array(z.object({
    providerId: z.string().regex(PROVIDER_ID).nullable().optional(),
    leadId: z.string().uuid().nullable().optional(),
  }).strict()).min(1).max(COWORK_PREPARE_MAX.save),
}).strict();
export type CoworkPrepareBatchInput = z.infer<typeof coworkPrepareBatchSchema>;
export type CoworkPreparePerson = { providerId: string } | { leadId: string };

const GOAL_TEXT: Record<CoworkPrepareGoal, string> = { save: 'guardar', email: 'buscar correos', research: 'investigar' };

/** The goal and the people of a proposal, each once. Throws in words the model can pass on. */
export function coworkPrepareBatchPeople(input: unknown): { goal: CoworkPrepareGoal; people: CoworkPreparePerson[] } {
  const parsed = coworkPrepareBatchSchema.parse(input);
  const max = COWORK_PREPARE_MAX[parsed.goal];
  if (parsed.people.length > max) throw new Error(`Un lote para ${GOAL_TEXT[parsed.goal]} lleva hasta ${max} personas: propón el resto en otro lote.`);
  const people = parsed.people.map((person): CoworkPreparePerson => {
    if (Boolean(person.providerId) === Boolean(person.leadId)) {
      throw new Error('Cada persona del lote va con providerId (un resultado de búsqueda) o con leadId (un contacto guardado), una de las dos.');
    }
    return person.leadId ? { leadId: person.leadId } : { providerId: person.providerId! };
  });
  const keys = people.map(person => ('leadId' in person ? person.leadId : person.providerId));
  if (new Set(keys).size !== keys.length) throw new Error('Hay personas repetidas en el lote: cada una va una sola vez.');
  return { goal: parsed.goal, people };
}

/** What a person already has: saved, an email or a lookup already tried, a research done or under way. */
export type CoworkPrepareState = { saved: boolean; emailChecked: boolean; researched: boolean };

const wanted = (goal: CoworkPrepareGoal, step: CoworkPrepareStep) =>
  step === 'save' || (step === 'enrich' && goal !== 'save') || (step === 'research' && goal === 'research');

/** The steps a person still needs for the goal, in order. Researching needs the email looked up first, and both need the contact saved. */
export function coworkPrepareSteps(goal: CoworkPrepareGoal, state: CoworkPrepareState): CoworkPrepareStep[] {
  return COWORK_PREPARE_STEPS.filter(step => wanted(goal, step)
    && !(step === 'save' ? state.saved : step === 'enrich' ? state.emailChecked : state.researched));
}

/** Only what is needed to save a search result as it was seen in the conversation. */
export type CoworkPrepareContact = {
  industry?: string | null; location?: string | null; linkedinUrl?: string | null; companyWebsite?: string | null; companyLinkedin?: string | null;
};

export type CoworkPrepareItem = {
  /** The saved contact, or the id it gets when it is saved. */
  id: string;
  /** apollo:… while the person is still a search result. */
  providerId?: string;
  name: string | null; company: string | null; title: string | null;
  /** What will run for this person, in order. */
  steps: CoworkPrepareStep[];
  /** What was already done and is skipped. */
  done: CoworkPrepareStep[];
  contact?: CoworkPrepareContact;
};
/** Someone with nothing left to do: shown on the card, never run. */
export type CoworkPrepareReady = { id: string; name: string | null; company: string | null; reason: string };

export type CoworkPrepareCandidate = Omit<CoworkPrepareItem, 'steps' | 'done'> & { state: CoworkPrepareState };

const READY_REASON: Record<CoworkPrepareGoal, string> = {
  save: 'Ya está en tus contactos.',
  email: 'Ya está guardado y su correo ya se buscó.',
  research: 'Ya está guardado, con su correo buscado y su investigación hecha o en curso.',
};

/** Who gets what, in the order given: each person only with the steps still missing; whoever has nothing left waits aside, with why. */
export function planCoworkPrepareBatch(goal: CoworkPrepareGoal, candidates: CoworkPrepareCandidate[]) {
  const items: CoworkPrepareItem[] = [];
  const ready: CoworkPrepareReady[] = [];
  for (const { state, contact, providerId, ...person } of candidates) {
    const steps = coworkPrepareSteps(goal, state);
    if (!steps.length) { ready.push({ id: person.id, name: person.name, company: person.company, reason: READY_REASON[goal] }); continue; }
    const done = COWORK_PREPARE_STEPS.filter(step => wanted(goal, step) && !steps.includes(step));
    items.push({ ...person, ...(providerId && steps.includes('save') ? { providerId } : {}), steps, done,
      ...(contact && steps.includes('save') ? { contact } : {}) });
  }
  return { items, ready };
}

/** What the approval binds: the run and, for each person, who and which steps. Names are for the card only. */
export function hashCoworkPrepareBatch(runId: string, items: Array<Pick<CoworkPrepareItem, 'id' | 'providerId' | 'steps'>>) {
  return createHash('sha256')
    .update(JSON.stringify(['cowork|prepare-batch', runId, items.map(item => [item.id, item.providerId ?? null, item.steps])])).digest('hex');
}

export type CoworkPrepareCost = { saves: number; lookups: number; research: number };
export function coworkPrepareCost(items: Array<Pick<CoworkPrepareItem, 'steps'>>): CoworkPrepareCost {
  const count = (step: CoworkPrepareStep) => items.filter(item => item.steps.includes(step)).length;
  return { saves: count('save'), lookups: count('enrich'), research: count('research') };
}

const people = (count: number) => `${count} ${count === 1 ? 'persona' : 'personas'}`;
const joined = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${/^i/i.test(parts[parts.length - 1]) ? 'e' : 'y'} ${parts[parts.length - 1]}` : parts[0] || '');

/** «Guardar a 3 personas», «Buscar el correo de 2 personas», «Preparar a 2 personas: guardar, buscar su correo e investigar». */
export function coworkPrepareBatchLabel(items: Array<Pick<CoworkPrepareItem, 'steps'>>) {
  const cost = coworkPrepareCost(items);
  const parts = [cost.saves ? 'guardar' : '', cost.lookups ? 'buscar su correo' : '', cost.research ? 'investigar' : ''].filter(Boolean);
  if (parts.length === 1 && cost.saves) return `Guardar a ${people(items.length)}`;
  if (parts.length === 1 && cost.lookups) return `Buscar el correo de ${people(items.length)}`;
  if (parts.length === 1) return `Investigar a ${people(items.length)}`;
  return `Preparar a ${people(items.length)}: ${joined(parts)}`;
}

export type CoworkPrepareStepResult = { step: CoworkPrepareStep; status: 'done' | 'reused' | 'failed' | 'skipped'; detail?: string };
export type CoworkPrepareResult = {
  /** The saved contact after running (the one saved now, or the one that already existed). */
  id: string;
  name: string | null; company: string | null;
  status: 'ready' | 'partial' | 'failed' | 'removed';
  steps: CoworkPrepareStepResult[];
  email?: string | null; emailStatus?: string | null; linkedinUrl?: string | null; emailWarning?: string | null;
  /** queued: under way; completed: already available. */
  research?: string | null;
};

/** ready when every step went (or was already done), failed when none did, partial in between. */
export function coworkPrepareStatus(steps: CoworkPrepareStepResult[]): CoworkPrepareResult['status'] {
  const ok = steps.filter(step => step.status === 'done' || step.status === 'reused').length;
  return ok === steps.length ? 'ready' : ok === 0 ? 'failed' : 'partial';
}

/** The reply after running a batch: counts first, then the people that need to be told something, by name. */
export function coworkPrepareBatchSummary(results: CoworkPrepareResult[]) {
  const ran = results.filter(result => result.status !== 'removed');
  const stepOk = (step: CoworkPrepareStep) => ran.filter(result => result.steps.some(item => item.step === step && (item.status === 'done' || item.status === 'reused'))).length;
  const asked = (step: CoworkPrepareStep) => ran.filter(result => result.steps.some(item => item.step === step)).length;
  const withEmail = ran.filter(result => result.email).length;
  const parts = [
    asked('save') ? `${stepOk('save')} ${stepOk('save') === 1 ? 'quedó guardada' : 'quedaron guardadas'}` : '',
    asked('enrich') ? `${withEmail} de ${asked('enrich')} con correo` : '',
    asked('research') ? `${stepOk('research')} ${stepOk('research') === 1 ? 'investigación en curso o lista' : 'investigaciones en curso o listas'}` : '',
  ].filter(Boolean);
  const ready = ran.filter(result => result.status === 'ready').length;
  const notes = ran.flatMap(result => {
    const problem = result.steps.find(step => step.status === 'failed' || step.status === 'skipped') || result.steps.find(step => step.detail);
    return problem?.detail ? [`${result.name || 'Sin nombre'}: ${problem.detail.replace(/[.\s]+$/, '')}`] : [];
  }).slice(0, 4);
  const removed = results.length - ran.length;
  return `Listo con ${ready} de ${ran.length} ${ran.length === 1 ? 'persona' : 'personas'}${parts.length ? `: ${joined(parts)}` : ''}.`
    + (notes.length ? ` ${notes.join(' · ')}.` : '')
    + (removed ? ` ${removed === 1 ? 'Quitaste a 1 persona' : `Quitaste a ${removed} personas`} de la lista.` : '');
}
