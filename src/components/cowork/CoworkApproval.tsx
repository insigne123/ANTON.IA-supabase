'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, CircleSlash, LoaderCircle, Minus, TriangleAlert } from 'lucide-react';
import { coworkSearchCriteriaSchema } from '@/lib/cowork/search-proposal';
import type { CoworkRun } from '@/lib/cowork/contracts';
import {
  coworkProposalLink, coworkProposalOutcome, coworkProposalTimeline, type CoworkOutcome, type CoworkProposalState, type CoworkProposalView,
  type CoworkTimelineState,
} from '@/lib/cowork/presentation';
import { cn } from '@/lib/utils';
import { SendReview } from './SendReview';
import { CampaignReview } from './CampaignReview';
import { CodeReview } from './CodeReview';
import { ProfileReview } from './ProfileReview';
import { SavedSearchReview } from './SavedSearchReview';
import { CampaignStopReview } from './CampaignStopReview';
import { CrmRecordReview } from './CrmRecordReview';
import { CampaignPrepareReview } from './CampaignPrepareReview';
import { CrmAssignReview } from './CrmAssignReview';
import { ExceptionReview } from './ExceptionReview';
import { MissionReview } from './MissionReview';
import { MessageContextReview } from './MessageContextReview';
import { EnrichBatchReview } from './EnrichBatchReview';
import { ContactsImportReview } from './ContactsImportReview';
import { ReplyThreadReview } from './ReplyThreadReview';
import { CampaignRetryReview } from './CampaignRetryReview';
import { PhoneRevealReview } from './PhoneRevealReview';
import { LinkedinBatchResults, LinkedinBatchReview } from './LinkedinBatchReview';
import { ReviewActions, ReviewChips, ReviewField, ReviewFields, ReviewNote, ReviewPaper } from './ReviewParts';
import { DoneMark } from './CoworkActivity';
import { AnimatePresence, CW_EASE, CwCollapse, cwPop, cwSwap, cwVariants, m, useReducedMotion } from './motion';
import { CoworkIcon } from './ui';

type ReviewProps = { runId: string; onApprove: () => void; onReject: () => void; resolving: boolean };

const REVIEWS: Record<string, (props: ReviewProps) => ReactNode> = {
  campaign_create: props => <CampaignReview {...props} />,
  campaign_activate: props => <CampaignReview {...props} />,
  campaign_pause: props => <CampaignReview {...props} />,
  code_execute: props => <CodeReview {...props} />,
  profile_update: props => <ProfileReview {...props} />,
  saved_search_create: props => <SavedSearchReview {...props} />,
  saved_search_update: props => <SavedSearchReview {...props} />,
  saved_search_delete: props => <SavedSearchReview {...props} />,
  campaign_stop_v2: props => <CampaignStopReview {...props} />,
  crm_update_record: props => <CrmRecordReview {...props} />,
  campaign_prepare_draft_v2: props => <CampaignPrepareReview {...props} />,
  crm_assign_lead: props => <CrmAssignReview {...props} />,
  exception_resolve: props => <ExceptionReview {...props} />,
  mission_control: props => <MissionReview {...props} />,
  message_context_update: props => <MessageContextReview {...props} />,
  enrich_batch: props => <EnrichBatchReview {...props} />,
  contacts_import: props => <ContactsImportReview {...props} />,
  reply_thread: props => <ReplyThreadReview {...props} />,
  campaign_retry: props => <CampaignRetryReview {...props} />,
  enrich_phone: props => <PhoneRevealReview {...props} />,
  linkedin_invite_batch: props => <LinkedinBatchReview {...props} />,
  linkedin_message_batch: props => <LinkedinBatchReview {...props} />,
};

const SENIORITY: Record<string, string> = {
  owner: 'Dueño', founder: 'Fundador', c_suite: 'Alta dirección', partner: 'Socio', vp: 'Vicepresidente', head: 'Head',
  director: 'Director', manager: 'Gerente', senior: 'Senior', entry: 'Inicial', intern: 'Práctica',
};

function SearchDetails({ criteria }: { criteria: unknown }) {
  const parsed = coworkSearchCriteriaSchema.safeParse(criteria);
  if (!parsed.success) return <ReviewNote ok={false}>No se pudieron leer los criterios de la búsqueda. Descártala y pide una nueva.</ReviewNote>;
  const data = parsed.data;
  return <div className="space-y-4">
    <ReviewFields>
      <ReviewField label="Buscar">{data.target === 'companies' ? 'Empresas' : 'Personas'}</ReviewField>
      <ReviewField label="Cargos"><ReviewChips values={data.titles} /></ReviewField>
      <ReviewField label="Sectores"><ReviewChips values={data.industries} /></ReviewField>
      <ReviewField label="Ubicación de la persona"><ReviewChips values={data.locations} /></ReviewField>
      {!!data.seniorities?.length && <ReviewField label="Nivel de responsabilidad"><ReviewChips values={data.seniorities.map(value => SENIORITY[value] || value)} /></ReviewField>}
      {!!data.companyLocations?.length && <ReviewField label="Ubicación de la empresa"><ReviewChips values={data.companyLocations} /></ReviewField>}
      {!!data.employeeRanges?.length && <ReviewField label="Número de empleados"><ReviewChips values={data.employeeRanges} /></ReviewField>}
      {!!data.companyDomains?.length && <ReviewField label="Dominios de empresas"><ReviewChips values={data.companyDomains} /></ReviewField>}
      {data.rolePolicy && <ReviewField label="Clasificación por cargo">
        <span className="block space-y-1 text-[13px]">
          <span className="block"><span className="text-cw-muted">Posibles compradores:</span> {data.rolePolicy.decisionTerms.join(', ') || 'Sin criterio'}</span>
          <span className="block"><span className="text-cw-muted">Usuarios:</span> {data.rolePolicy.userTerms.join(', ') || 'Sin criterio'}</span>
          <span className="block"><span className="text-cw-muted">Referidores:</span> {data.rolePolicy.referralTerms.join(', ') || 'Sin criterio'}</span>
          <span className="block"><span className="text-cw-muted">Excluir:</span> {data.rolePolicy.excludeTerms.join(', ') || 'Ninguno'}</span>
        </span>
      </ReviewField>}
    </ReviewFields>
  </div>;
}

const TIMELINE_TEXT: Record<CoworkTimelineState, string> = { done: 'hecho', current: 'en curso', pending: 'pendiente', skipped: 'no se hizo', failed: 'falló' };

/** One step of the timeline: done draws its check, the approval waits still, the execution spins. */
function TimelineMarker({ state, waiting, live }: { state: CoworkTimelineState; waiting: boolean; live: boolean }) {
  return <span className="relative block h-4 w-4" aria-hidden="true">
    <AnimatePresence initial={false}>
      <m.span key={`${state}-${waiting}`} className="absolute inset-0 flex items-center justify-center" {...cwVariants(cwPop, live)}>
        {state === 'done' ? <DoneMark live={live} size={16} />
          : state === 'failed' ? <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cw-danger text-cw-bg"><TriangleAlert className="h-2.5 w-2.5" strokeWidth={3} /></span>
            : state === 'current' && waiting ? <span className="flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-cw-warning bg-cw-elevated"><span className="h-1.5 w-1.5 rounded-full bg-cw-warning" /></span>
              : state === 'current' ? <LoaderCircle className="h-4 w-4 text-cw-accent motion-safe:animate-spin" />
                : state === 'skipped' ? <span className="flex h-4 w-4 items-center justify-center rounded-full border border-cw-border bg-cw-elevated text-cw-faint"><Minus className="h-2.5 w-2.5" /></span>
                  : <span className="block h-4 w-4 rounded-full border-[1.5px] border-cw-border-strong bg-cw-elevated" />}
      </m.span>
    </AnimatePresence>
  </span>;
}

/** Proposal → your approval → execution → result: where this proposal is, with the track filled up to it. */
function ApprovalTimeline({ state, live }: { state: CoworkProposalState; live: boolean }) {
  const reduce = useReducedMotion();
  const steps = coworkProposalTimeline(state);
  const reached = steps.reduce((last, step, index) => step.state === 'skipped' || step.state === 'pending' ? last : index, 0);
  return <ol aria-label="Estado de la propuesta" className="relative grid grid-cols-4">
    <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[7.5px] h-px bg-cw-border" />
    <m.span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[7.5px] h-px origin-left bg-cw-accent"
      initial={false} animate={{ scaleX: reached / (steps.length - 1) }} transition={reduce || !live ? { duration: 0 } : { duration: 0.45, ease: CW_EASE }} />
    {steps.map((step, index) => <li key={step.label} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center">
      <TimelineMarker state={step.state} waiting={index === 1} live={live} />
      <span className={cn('max-w-full truncate text-[11.5px] leading-4 transition-colors duration-200',
        step.state === 'current' ? 'font-medium text-cw-text' : step.state === 'failed' ? 'font-medium text-cw-danger' : step.state === 'done' ? 'text-cw-muted' : 'text-cw-faint')}>
        {step.label}<span className="sr-only"> ({TIMELINE_TEXT[step.state]})</span>
      </span>
    </li>)}
  </ol>;
}

/** «Qué va a pasar» and «Qué no pasa», before the details. */
function Outcome({ outcome }: { outcome: CoworkOutcome }) {
  return <div className="grid gap-2 rounded-xl border border-cw-border bg-cw-panel px-3.5 py-3 text-[13.5px] leading-5 sm:grid-cols-2 sm:gap-4">
    <p><span className="block text-[12px] font-medium text-cw-muted">Qué va a pasar</span>{outcome.happens}</p>
    <p><span className="block text-[12px] font-medium text-cw-muted">Qué no pasa</span>{outcome.not}</p>
  </div>;
}

/**
 * Inline approval, like a permission prompt: what will happen and what will not,
 * the exact details, then decide. The same card then follows the proposal through
 * approval, execution and result, so the decision never jumps to another place:
 * the details fold away, the timeline moves on and the heading says where it is.
 * Discarded or left unresolved, it folds into one line.
 */
export function CoworkApproval({ run, proposal, resolving, interactive, onResolve, live = false }: {
  run: Pick<CoworkRun, 'id' | 'status'>;
  proposal: CoworkProposalView;
  resolving: boolean;
  interactive: boolean;
  onResolve: (approve: boolean) => void;
  /** It appeared or changed while you watch: it comes in and moves; history stays still. */
  live?: boolean;
}) {
  const rawLabel = proposal.type === 'effect' && proposal.label && proposal.label !== proposal.title ? proposal.label : '';
  // «Guardar contacto Ana (Sur)» under the title «Guardar contacto» reads as «Ana (Sur)».
  const label = rawLabel.toLocaleLowerCase('es').startsWith(proposal.title.toLocaleLowerCase('es'))
    ? rawLabel.slice(proposal.title.length).replace(/^[\s:·-]+/, '') : rawLabel;
  const { state } = proposal;
  const search = proposal.type === 'search';
  const deciding = state === 'pending' && interactive;
  const folded = state === 'discarded' || (state === 'pending' && !interactive);
  const link = coworkProposalLink(proposal);

  const heading = state === 'pending' ? (interactive ? proposal.title : `Propuesta sin resolver: ${proposal.title}`)
    : state === 'approved' ? (search ? 'Búsqueda aprobada' : `Aprobado: ${proposal.title}`)
      : state === 'running' ? (search ? 'Buscando en el proveedor…' : `Ejecutando: ${proposal.title}`)
        : state === 'done' ? (search ? 'Búsqueda realizada' : `Aprobaste: ${proposal.title}`)
          : state === 'discarded' ? `Descartaste: ${proposal.title}` : `No se pudo completar: ${proposal.title}`;
  const detail = state === 'approved' ? (search ? 'La búsqueda está aprobada y espera su turno. Puedes cerrar esta pestaña y volver al trabajo.'
    : 'La acción está aprobada y en cola. Puedes cerrar esta pestaña y volver al trabajo.')
    : state === 'running' ? (search ? 'La búsqueda está en curso. Puedes cerrar esta pestaña y volver al trabajo.'
      : 'La acción está en curso. Puedes cerrar esta pestaña y volver al trabajo.')
      : state === 'discarded' ? 'No se ejecutó ningún cambio.' : '';

  const kind = String(proposal.payload.kind || '');
  const approve = () => onResolve(true);
  const reject = () => onResolve(false);
  let body: ReactNode = null;
  if (deciding) {
    if (search) {
      body = <div className="space-y-4">
        <SearchDetails criteria={proposal.payload.criteria} />
        <ReviewActions onReject={reject} onApprove={approve} resolving={resolving} rejectLabel="Descartar búsqueda"
          approveLabel={(proposal.payload.criteria as { target?: string } | undefined)?.target === 'companies' ? 'Buscar empresas' : 'Buscar contactos'} />
      </div>;
    } else if (proposal.type === 'note') {
      body = <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="mb-1.5 text-[12.5px] font-medium text-cw-muted">Nota actual</p><ReviewPaper className="text-cw-muted">{String(proposal.payload.previousNote || 'Sin nota')}</ReviewPaper></div>
          <div><p className="mb-1.5 text-[12.5px] font-medium text-cw-muted">Nueva nota</p><ReviewPaper>{String(proposal.payload.proposedNote || '')}</ReviewPaper></div>
        </div>
        <ReviewActions onReject={reject} onApprove={approve} approveLabel="Guardar nueva nota" resolving={resolving} resolvingLabel="Guardando decisión…" />
      </div>;
    } else if (kind === 'send_email') {
      body = <SendReview runId={run.id} draftId={String(proposal.payload.targetId || '').split(':')[0]} onApprove={approve} onReject={reject} resolving={resolving} />;
    } else if (REVIEWS[kind]) {
      body = REVIEWS[kind]({ runId: run.id, onApprove: approve, onReject: reject, resolving });
    } else {
      body = <ReviewActions onReject={reject} onApprove={approve} approveLabel="Aprobar y ejecutar" resolving={resolving} />;
    }
  }

  const icon = state === 'done' ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-success-soft text-cw-success"><Check className="h-4 w-4" strokeWidth={2.5} /></span>
    : state === 'failed' ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-danger-soft text-cw-danger"><TriangleAlert className="h-4 w-4" /></span>
      : folded ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-panel text-cw-muted"><CircleSlash className="h-4 w-4" /></span>
        : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent"><CoworkIcon name={proposal.icon} className="h-4 w-4" /></span>;

  return <section id={deciding ? 'cowork-decision' : undefined} tabIndex={deciding ? -1 : undefined}
    aria-label={search ? 'Revisar búsqueda externa' : proposal.type === 'note' ? 'Revisar cambio de nota' : 'Revisar acción propuesta'}
    className={cn('overflow-hidden rounded-2xl border bg-cw-elevated transition-[border-color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]',
      deciding ? 'border-cw-border-strong shadow-[var(--cw-shadow)]' : 'border-cw-border shadow-[var(--cw-shadow-sm)]',
      live && deciding && 'cw-rise-attention')}>
    <header className={cn('flex items-start gap-3 px-4 py-3 transition-colors duration-300', !folded && 'border-b border-cw-border', deciding && 'bg-cw-panel')}>
      <AnimatePresence initial={false} mode="wait">
        <m.span key={state === 'done' ? 'done' : state === 'failed' ? 'failed' : folded ? 'folded' : 'open'} {...cwVariants(cwPop, live)} aria-hidden="true">{icon}</m.span>
      </AnimatePresence>
      <div className="min-w-0 flex-1">
        {deciding && <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-cw-warning">Necesita tu aprobación</p>}
        <AnimatePresence initial={false} mode="wait">
          <m.h3 key={heading} {...cwVariants(cwSwap, live)} className={cn('text-[15px] font-semibold leading-snug tracking-tight',
            state === 'failed' ? 'text-cw-danger' : folded ? 'text-cw-muted' : 'text-cw-text')}>{heading}</m.h3>
        </AnimatePresence>
        {(label || (folded && detail)) && <p className="mt-0.5 break-words text-[13px] text-cw-muted">{[label, folded ? detail : ''].filter(Boolean).join(' · ')}</p>}
      </div>
    </header>
    {/* A screen reader hears each change of state once. */}
    {state !== 'pending' && <p role="status" className="sr-only">{[heading, detail].filter(Boolean).join('. ')}</p>}
    {/* What approving does and the details leave at once when you decide: a button that is
        folding away must never take a second click. The timeline stays and moves on. */}
    {deciding && <div className="px-4 pt-4"><Outcome outcome={coworkProposalOutcome(proposal)} /></div>}
    <CwCollapse show={!folded} animateIn={false}>
      <div className="space-y-3 px-4 py-4">
        <ApprovalTimeline state={state} live={live} />
        {state === 'done' && (kind === 'linkedin_invite_batch' || kind === 'linkedin_message_batch') && <LinkedinBatchResults runId={run.id} />}
        {!deciding && (detail || link) && <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] leading-5 text-cw-muted">
          {detail && <span>{detail}</span>}
          {link && <a href={link.href} className="inline-flex items-center gap-1 rounded font-medium text-cw-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cw-accent-ring)]">{link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></a>}
        </p>}
      </div>
    </CwCollapse>
    {deciding && <div className="px-4 pb-4">{body}</div>}
  </section>;
}
