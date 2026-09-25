'use client';

import type { ReactNode } from 'react';
import { Check, CircleSlash, LoaderCircle, TriangleAlert } from 'lucide-react';
import { coworkSearchCriteriaSchema } from '@/lib/cowork/search-proposal';
import type { CoworkRun } from '@/lib/cowork/contracts';
import { coworkEffectCopy, type CoworkProposalView } from '@/lib/cowork/presentation';
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
import { ReviewActions, ReviewChips, ReviewField, ReviewFields, ReviewNote, ReviewPaper } from './ReviewParts';
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
    <ReviewNote>Hasta {data.limit} {data.target === 'companies' ? 'empresas' : 'contactos'}. Consume una operación de tu cuota de búsqueda. No revela correos ni teléfonos y no guarda contactos ni envía mensajes.</ReviewNote>
  </div>;
}

function StatusRow({ icon, tone, title, children }: { icon: ReactNode; tone: 'progress' | 'success' | 'muted' | 'danger'; title: string; children?: ReactNode }) {
  return <div role="status" className={cn('flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13.5px]',
    tone === 'danger' ? 'border-cw-border bg-cw-danger-soft' : 'border-cw-border bg-cw-panel')}>
    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
      tone === 'success' ? 'bg-cw-success text-cw-bg' : tone === 'danger' ? 'text-cw-danger' : tone === 'progress' ? 'text-cw-accent' : 'text-cw-muted')}>{icon}</span>
    <div className="min-w-0">
      <p className={cn('font-medium', tone === 'danger' ? 'text-cw-danger' : 'text-cw-text')}>{title}</p>
      {children && <div className="mt-0.5 text-[12.5px] leading-5 text-cw-muted">{children}</div>}
    </div>
  </div>;
}

/** Inline approval, like a permission prompt: what will happen, exact details, then decide. */
export function CoworkApproval({ run, proposal, resolving, interactive, onResolve }: {
  run: Pick<CoworkRun, 'id' | 'status'>;
  proposal: CoworkProposalView;
  resolving: boolean;
  interactive: boolean;
  onResolve: (approve: boolean) => void;
}) {
  const rawLabel = proposal.type === 'effect' && proposal.label && proposal.label !== proposal.title ? proposal.label : '';
  // «Guardar contacto Ana (Sur)» under the title «Guardar contacto» reads as «Ana (Sur)».
  const label = rawLabel.toLocaleLowerCase('es').startsWith(proposal.title.toLocaleLowerCase('es'))
    ? rawLabel.slice(proposal.title.length).replace(/^[\s:·-]+/, '') : rawLabel;

  if (proposal.state === 'approved' || proposal.state === 'running') {
    return <StatusRow tone="progress" icon={<LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
      title={proposal.type === 'search'
        ? (proposal.state === 'running' ? 'Buscando en el proveedor…' : 'Búsqueda aprobada')
        : `${proposal.state === 'running' ? 'Ejecutando' : 'Aprobado'}: ${proposal.title}`}>
      {proposal.type === 'search'
        ? (proposal.state === 'running' ? 'La búsqueda está en curso. Puedes cerrar esta pestaña y volver al trabajo.' : 'La búsqueda está aprobada y espera su turno. Puedes cerrar esta pestaña y volver al trabajo.')
        : `${label ? `${label}. ` : ''}La acción está aprobada y en curso. Puedes cerrar esta pestaña y volver al trabajo.`}
    </StatusRow>;
  }
  if (proposal.state === 'done') {
    return <StatusRow tone="success" icon={<Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />} title={proposal.type === 'search' ? 'Búsqueda realizada' : `Aprobaste: ${proposal.title}`}>{label || null}</StatusRow>;
  }
  if (proposal.state === 'discarded') {
    return <StatusRow tone="muted" icon={<CircleSlash className="h-4 w-4" aria-hidden="true" />} title={`Descartaste: ${proposal.title}`}>{label || 'No se ejecutó ningún cambio.'}</StatusRow>;
  }
  if (proposal.state === 'failed') {
    return <StatusRow tone="danger" icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />} title={`No se pudo completar: ${proposal.title}`}>{label || null}</StatusRow>;
  }
  if (!interactive) {
    return <StatusRow tone="muted" icon={<CircleSlash className="h-4 w-4" aria-hidden="true" />} title={`Propuesta sin resolver: ${proposal.title}`} />;
  }

  const kind = String(proposal.payload.kind || '');
  const approve = () => onResolve(true);
  const reject = () => onResolve(false);
  let body: ReactNode;
  if (proposal.type === 'search') {
    body = <div className="space-y-4">
      <SearchDetails criteria={proposal.payload.criteria} />
      <ReviewActions onReject={reject} onApprove={approve} resolving={resolving} rejectLabel="Descartar búsqueda"
        approveLabel={(proposal.payload.criteria as { target?: string } | undefined)?.target === 'companies' ? 'Buscar empresas' : 'Buscar contactos'} />
    </div>;
  } else if (proposal.type === 'note') {
    body = <div className="space-y-4">
      <p className="text-[13.5px]"><span className="font-medium">{String(proposal.payload.leadName || 'Contacto')}</span> <span className="text-cw-muted">· Se reemplazará la nota de este contacto en el CRM.</span></p>
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
    body = <div className="space-y-4">
      <ReviewNote>{coworkEffectCopy(kind).help}</ReviewNote>
      <ReviewActions onReject={reject} onApprove={approve} approveLabel="Aprobar y ejecutar" resolving={resolving} />
    </div>;
  }

  return <section aria-label={proposal.type === 'search' ? 'Revisar búsqueda externa' : proposal.type === 'note' ? 'Revisar cambio de nota' : 'Revisar acción propuesta'}
    className="cw-rise overflow-hidden rounded-2xl border border-cw-border-strong bg-cw-elevated shadow-[var(--cw-shadow)]">
    <header className="flex items-start gap-3 border-b border-cw-border bg-cw-panel px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cw-accent-soft text-cw-accent">
        <CoworkIcon name={proposal.icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-cw-warning">Necesita tu aprobación</p>
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">{proposal.title}</h3>
        {label && <p className="mt-0.5 break-words text-[13px] text-cw-muted">{label}</p>}
      </div>
    </header>
    <div className="px-4 py-4">{body}</div>
  </section>;
}
