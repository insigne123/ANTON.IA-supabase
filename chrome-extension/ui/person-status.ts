import { reportPending, reportReady } from './research-state';

/**
 * What the person card says about the contact on screen (plan 8, phase 4, PR-4a): where it stands as a few chips, and the one
 * next step as the main button. Computed apart so the panel and its tests read the same thing.
 */
export type ChipTone = 'success' | 'info' | 'warning' | 'neutral';
export type PersonChip = { key: string; label: string; tone: ChipTone };
export type NextStepId = 'enrich' | 'save' | 'find-email' | 'research' | 'write';
export type NextStep = { id: NextStepId; label: string; hint: string };

export type PersonState = {
  saved: boolean;
  /** The data was looked up or the person chose to fill it in by hand: saving comes next. */
  enrichedReady: boolean;
  email: string;
  emailStatus: string;
  research: any;
  researchEnabled: boolean;
  phonePending: boolean;
  /** The LinkedIn send was confirmed in this session. */
  sent: boolean;
  hasMessage: boolean;
  /** What the organization knows of the person (PR-4b): someone else working it, a reply, the last contact. */
  presence?: { label: string; tone: ChipTone; blocks: boolean } | null;
};

const researchFailed = (research: any) => research?.status === 'failed' || research?.reportSynthesisV2?.status === 'failed_permanent';

export function personChips(state: PersonState): PersonChip[] {
  const chips: PersonChip[] = [state.saved
    ? { key: 'saved', label: 'Guardado', tone: 'success' }
    : { key: 'saved', label: 'Sin guardar', tone: 'neutral' }];
  if (state.email) chips.push(state.emailStatus === 'verified'
    ? { key: 'email', label: 'Correo verificado', tone: 'success' }
    : { key: 'email', label: 'Con correo', tone: 'info' });
  else if (state.saved) chips.push({ key: 'email', label: 'Sin correo', tone: 'neutral' });
  if (state.phonePending) chips.push({ key: 'phone', label: 'Teléfono pendiente', tone: 'info' });
  if (reportReady(state.research)) {
    chips.push(state.research.reportDocumentV2.synthesis.status === 'partial'
      ? { key: 'research', label: 'Investigación parcial', tone: 'info' }
      : { key: 'research', label: 'Investigado', tone: 'success' });
  } else if (reportPending(state.research)) chips.push({ key: 'research', label: 'Investigando…', tone: 'info' });
  else if (researchFailed(state.research)) chips.push({ key: 'research', label: 'Investigación con problemas', tone: 'warning' });
  if (state.sent) chips.push({ key: 'sent', label: 'Mensaje enviado', tone: 'success' });
  // Being saved is already its own chip; the rest of what the organization knows is new here.
  if (state.presence && !/^Guardado( en tu organización)?$/.test(state.presence.label)) {
    chips.push({ key: 'team', label: state.presence.label, tone: state.presence.tone });
  }
  return chips;
}

/**
 * The one thing to do next, in the order a contact gets ready: its data, saved, its email, researched, written to. Nothing while
 * the research runs or once the message went out: the chips say so.
 */
export function personNextStep(state: PersonState): NextStep | null {
  if (!state.saved && !state.enrichedReady) {
    return { id: 'enrich', label: 'Enriquecer perfil', hint: 'Busca su correo y sus datos profesionales con los créditos de tu cuenta.' };
  }
  if (!state.saved) return { id: 'save', label: 'Guardar lead', hint: 'Queda en los contactos de tu organización, a la vista de tu equipo.' };
  if (!state.email) return { id: 'find-email', label: 'Buscar correo', hint: 'Usa créditos de tu cuenta. Sin correo puedes escribirle por LinkedIn.' };
  if (state.researchEnabled && !state.research) {
    return { id: 'research', label: 'Investigar lead', hint: 'Busca fuentes de su empresa y de su rol; sigue aunque cierres el panel.' };
  }
  if (reportPending(state.research) || state.sent) return null;
  return state.hasMessage
    ? { id: 'write', label: 'Revisar el mensaje', hint: 'Tu borrador para LinkedIn está listo para revisar y enviar.' }
    : { id: 'write', label: 'Escribir mensaje', hint: reportReady(state.research) ? 'Con lo que encontró la investigación.' : 'A partir de su perfil.' };
}

export type ResearchStep = { key: 'research' | 'writing' | 'ready'; label: string; state: 'done' | 'current' | 'pending' };

/** The same three steps the app shows while a report is prepared (ResearchReportProgress): nothing finer is known. */
export function researchSteps(research: any): ResearchStep[] | null {
  if (!research || researchFailed(research)) return null;
  const ready = reportReady(research);
  const collecting = ['queued', 'running'].includes(research.status);
  if (!ready && !reportPending(research)) return null;
  return [
    { key: 'research', label: 'Buscar y leer fuentes', state: collecting ? 'current' : 'done' },
    { key: 'writing', label: 'Escribir y revisar el informe', state: ready ? 'done' : collecting ? 'pending' : 'current' },
    { key: 'ready', label: 'Listo para escribirle', state: ready ? 'done' : 'pending' },
  ];
}
