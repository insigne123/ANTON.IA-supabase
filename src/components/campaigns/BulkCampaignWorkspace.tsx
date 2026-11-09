'use client';

import { PageHeader } from '@/components/page-header';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, RefreshCw } from 'lucide-react';
import { CampaignSequenceEditor } from './CampaignSequenceEditor';
import { CampaignAudienceTable } from './CampaignAudienceTable';
import { CampaignSteps } from './CampaignSteps';
import { CampaignList, type CampaignListItem } from './CampaignList';
import { CampaignPreview } from './CampaignPreview';
import { CampaignProgressTiles, CampaignRecipientsStatus } from './CampaignProgressPanel';
import { campaignStatusBadge, providerName } from './campaign-status';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignReviewInbox } from '@/components/campaigns-v2/CampaignReviewInbox';
import { withSentAttemptsAsDeliveries, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';
import { campaignProgress } from '@/lib/bulk-campaign-progress';
import { firstSelection } from '@/lib/campaign-audience-selection';
import { campaignObjectiveFromProfile } from '@/lib/campaign-objective';
import { formatDate, formatDateTime } from '@/lib/dates';
import { mapProfileToForm } from '@/lib/profile/profile-mappings';
import { companyProfileService } from '@/lib/services/company-profile-service';
import { AudienceCriteriaSchema, CampaignInputSchema, SENIORITY_LEVELS, audienceExclusionSummary, defaultAudience, isCampaignMessageLocked, type AudienceExclusions, type AudiencePerson, type AudienceProfile, type BulkCampaign, type CampaignDelivery, type CampaignHistoryEvent, type CampaignInput, type CampaignMessage } from '@/lib/bulk-campaigns';
import { SEGMENT_TRACK, segmentClass } from '@/components/ui/chip';

/** Below this many proposals, the campaign offers finding new people with Cowork. */
const FEW_RESULTS = 10;
/** Below this many contacts of your own, the base is said to be small (6 Nov 2026: a seller with 5). */
const SMALL_OWN_BASE = 20;

/** «Buscar personas nuevas con Cowork»: the description, written in a new conversation; the person sends it (src/components/cowork/CoworkWorkspace.tsx). */
function coworkSearchHref(description: string) {
  const asked = description.trim().replace(/\s+/g, ' ').slice(0, 1500);
  return `/cowork?pregunta=${encodeURIComponent(`Busca personas nuevas para una campaña: ${asked}. Muéstrame quiénes calzan y, cuando elija, guárdalas con su correo y arma la campaña.`)}`;
}

/**
 * A campaign without a name takes one from what was described (9 Nov 2026): «Continuar a correos» stayed grey without saying
 * why. The name can be changed in the first step at any time.
 */
function suggestedCampaignName(definition: Pick<CampaignInput, 'description' | 'criteria'>) {
  const described = definition.description.trim().replace(/\s+/g, ' ');
  if (described) return described.length > 60 ? `${described.slice(0, 59).trimEnd()}…` : described;
  const filters = [definition.criteria.titles[0], definition.criteria.industries[0]].map(value => String(value || '').trim()).filter(Boolean);
  return filters.length ? filters.join(' · ') : `Campaña del ${new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}`;
}

async function request(path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`/api/campaigns/bulk${path}`, body === undefined ? { cache: 'no-store' } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    ...(path === '/assist' ? { signal: AbortSignal.timeout(90_000) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}
const initial = (): CampaignInput => ({ name: '', description: '', objective: '', criteria: { ...defaultAudience }, emails: [], overrides: [], provider: 'google', messages: [{ subject: '', body: '', delayDays: 0 }] });
const STEPS = [
  { label: 'Audiencia', hint: 'A quién le escribes' },
  { label: 'Correos', hint: 'El primer correo y los seguimientos' },
  { label: 'Revisión', hint: 'Cómo le llega a cada persona' },
];
const MAX_RECIPIENTS = 100;
/** Server batches one click may chain (each sends up to 25), so 100 recipients go out in one click. */
const SEND_BATCHES_PER_CLICK = 4;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;
const RELATIONSHIPS = [
  { value: 'never_contacted', label: 'Nunca contactados' },
  { value: 'previously_contacted', label: 'Contactados anteriormente' },
] as const;

export function BulkCampaignWorkspace({ initialCampaignId }: { initialCampaignId?: string } = {}) {
  // «Ver seguimientos» from Por escribir opens on the follow-ups (?vista=seguimientos, audit K1).
  const [tab, setTab] = useState('campaigns');
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get('vista') === 'seguimientos') setTab('followups'); } catch { /* stays on campaigns */ }
  }, []);
  const confirm = useConfirm();
  const [items, setItems] = useState<CampaignListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [definition, setDefinition] = useState(initial);
  const [campaign, setCampaign] = useState<BulkCampaign | null>(null);
  const [deliveries, setDeliveries] = useState<CampaignDelivery[]>([]);
  const [attempts, setAttempts] = useState<CampaignAttempt[]>([]);
  const [replied, setReplied] = useState<string[] | null>(null);
  const [view, setView] = useState<'people' | 'emails'>('people');
  const [people, setPeople] = useState<AudiencePerson[]>([]);
  const [searched, setSearched] = useState(false);
  const [audienceTotal, setAudienceTotal] = useState(0);
  const [audiencePage, setAudiencePage] = useState(0);
  const [audienceQuery, setAudienceQuery] = useState('');
  const [profiles, setProfiles] = useState<AudienceProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [reviseMode, setReviseMode] = useState(false);
  const [history, setHistory] = useState<Record<string, CampaignHistoryEvent[]>>({});
  const [historyLoading, setHistoryLoading] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [messageIndex, setMessageIndex] = useState(0);
  const [audienceMode, setAudienceMode] = useState<'ai' | 'manual'>('ai');
  const [rankMeta, setRankMeta] = useState<{ rankedCount: number; candidateCount: number; truncated: boolean; ineligibleCount: number; poolCount: number; excluded: AudienceExclusions; ownCount: number | null } | null>(null);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [individual, setIndividual] = useState<{ email: string; messageIndex: number; subject: string; body: string } | null>(null);
  const [individualInstruction, setIndividualInstruction] = useState('');
  const [individualProposal, setIndividualProposal] = useState<CampaignMessage | null>(null);
  const frozen = campaign?.status === 'approved' || campaign?.status === 'paused';
  // The mailbox chosen in Conexiones (or the only connected one) starts every new campaign.
  const [defaultProvider, setDefaultProvider] = useState<'google' | 'outlook' | null>(null);
  useEffect(() => {
    let disposed = false;
    fetch('/api/integrations/default-sender', { cache: 'no-store' }).then(response => response.ok ? response.json() : null)
      .then(data => { if (!disposed && (data?.resolved === 'google' || data?.resolved === 'outlook')) setDefaultProvider(data.resolved); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  // What «Perfil» says the company offers starts the objective of every new campaign (the AI only knows the offer from it).
  const [profileObjective, setProfileObjective] = useState('');
  const objectivePending = useRef(false);
  useEffect(() => {
    let disposed = false;
    companyProfileService.getSellingProfile().then(profile => { if (!disposed) setProfileObjective(campaignObjectiveFromProfile(mapProfileToForm(profile))); })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  // A campaign started before «Perfil» loaded gets the objective when it arrives, unless the person already wrote one.
  useEffect(() => {
    if (!objectivePending.current || !profileObjective) return;
    objectivePending.current = false;
    if (!editing || campaign) return;
    setDefinition(value => value.objective.trim() ? value : { ...value, objective: profileObjective });
    // Only the arrival of «Perfil» matters here; editing and campaign are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileObjective]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setFeedback('');
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  const refresh = async () => {
    try {
      const result = await request('');
      setItems(result.campaigns); setAutomationEnabled(result.automationEnabled === true);
    } finally { setLoaded(true); }
  };
  useEffect(() => { void run(async () => { await refresh(); if (initialCampaignId) await open(initialCampaignId); }); }, [initialCampaignId]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy || individual) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, individual]);
  function change(patch: Partial<CampaignInput>) {
    setDefinition(value => ({ ...value, ...patch,
      overrides: patch.overrides ?? (patch.messages ? [] : (value.overrides || []).filter(override => !patch.emails || patch.emails.includes(override.email))),
    })); setDirty(true);
  }
  /** A criterion of the audience changed: the results shown no longer answer it. */
  function changeCriteria(patch: Partial<CampaignInput['criteria']>) {
    change({ criteria: { ...definition.criteria, ...patch } }); setSearched(false);
  }
  async function open(id: string) {
    const result = await request(`/${id}`);
    setCampaign(result.campaign); setDefinition(result.campaign.definition);
    setDeliveries(withSentAttemptsAsDeliveries(result.deliveries || [], result.attempts || [])); setAttempts(result.attempts || []);
    setReplied(Array.isArray(result.replied) ? result.replied : null);
    setStep(2); setEditing(true); setDirty(false); setRecipientIndex(0); setMessageIndex(0); setReviseMode(false); setHistory({}); setIndividual(null);
  }
  function startNew() {
    objectivePending.current = !profileObjective;
    setDefinition({ ...initial(), objective: profileObjective, provider: defaultProvider ?? 'google' }); setCampaign(null); setPeople([]); setSearched(false);
    setEditing(true); setStep(0); setDirty(false); setAudienceMode('ai'); setRankMeta(null); setMessageIndex(0); setError(''); setFeedback(''); setReviseMode(false);
    setHistory({}); setAudiencePage(0); setAudienceTotal(0); setAudienceQuery(''); setProfileName(''); setReplied(null); void loadProfiles();
  }
  /** «Duplicar»: the audience profile and the e-mails of this campaign start a new one; the people are chosen again. */
  function duplicate() {
    if (!campaign) return;
    setDefinition({ ...campaign.definition, name: `${campaign.definition.name} · Copia`, emails: [], overrides: [] });
    setCampaign(null); setPeople([]); setSearched(false); setStep(0); setDirty(true); setMessageIndex(0); setRankMeta(null); setReplied(null);
    setFeedback('Copiamos el perfil de la audiencia y los correos. Elige a quién escribir esta vez.');
  }
  async function leave() {
    if ((dirty || individual) && !(await confirm({ title: '¿Salir sin guardar?', description: 'Tienes cambios sin guardar en esta campaña.', confirmLabel: 'Salir sin guardar', tone: 'danger' }))) return;
    setEditing(false); setDirty(false); setIndividual(null); setFeedback(''); void run(refresh);
  }
  async function save(input = definition) {
    // Reached through the steps above without a name, it takes the same one «Continuar a correos» gives.
    const parsed = CampaignInputSchema.safeParse(input.name.trim() ? input : { ...input, name: suggestedCampaignName(input) });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const result = campaign && !reviseMode
      ? await request(`/${campaign.id}`, { revision: campaign.revision, definition: parsed.data }, 'PUT')
      : campaign && reviseMode
        ? await request(`/${campaign.id}/revise`, { revision: campaign.revision, reviewHash: campaign.review_hash, definition: parsed.data })
        : await request('', parsed.data);
    setCampaign(result.campaign); setDefinition(result.campaign.definition); setDirty(false); setReviseMode(false); setStep(2); setRecipientIndex(0); await refresh();
    if (campaign && reviseMode) setFeedback('Pendientes actualizados. Revisa y vuelve a aprobar para continuar los envíos.');
  }
  async function searchAudience(page: number) {
    const criteria = AudienceCriteriaSchema.parse({ ...definition.criteria, ...Object.fromEntries(['titles', 'industries', 'countries', 'sizes', 'seniorities'].map(field => [field, definition.criteria[field as 'titles'].map(value => value.trim()).filter(Boolean)])) });
    change({ criteria });
    const result = await request('/audience', { criteria, search: audienceQuery, page, pageSize: 25 });
    setPeople(result.people); setAudienceTotal(result.total); setAudiencePage(result.page); setSearched(true); setRankMeta(null);
    if (page === 0) preselect(result.people);
  }
  // The first results come selected, so «Continuar» is the next step; «Quitar todos» or each checkbox undoes it. Nothing
  // is sent before the review and the approval. A selection the person already made is never replaced.
  function preselect(found: AudiencePerson[]) {
    setDefinition(value => {
      const emails = firstSelection(value.emails, found, MAX_RECIPIENTS);
      return emails ? { ...value, emails } : value;
    });
  }
  async function rankAudience() {
    const result = await request('/audience/rank', {
      description: definition.description,
      relationship: definition.criteria.relationship,
      minimumDaysSinceSent: definition.criteria.minimumDaysSinceSent,
      excludeReplied: definition.criteria.excludeReplied,
      maxResults: 100,
    });
    setPeople(result.people); setAudienceTotal(result.people.length); setAudiencePage(0); setSearched(true);
    setRankMeta({ rankedCount: result.rankedCount, candidateCount: result.candidateCount, truncated: result.truncated, ineligibleCount: result.ineligibleCount,
      poolCount: Number(result.poolCount ?? result.candidateCount) || 0, excluded: result.excluded ?? {},
      ownCount: typeof result.ownCount === 'number' ? result.ownCount : null });
    preselect(result.people);
  }
  function selectAllResults(select: boolean) {
    const eligible = people.filter(person => !person.blockedReason).map(person => person.email);
    change({ emails: select ? [...new Set([...definition.emails, ...eligible])].slice(0, MAX_RECIPIENTS) : definition.emails.filter(email => !eligible.includes(email)) });
  }
  async function loadProfiles() {
    try { setProfiles((await request('/profiles', undefined, 'GET')).profiles || []); } catch { setProfiles([]); }
  }
  async function decide(action: 'approve' | 'pause' | 'resume') {
    if (!campaign) return;
    const result = await request(`/${campaign.id}`, { action, revision: campaign.revision, reviewHash: campaign.review_hash });
    setCampaign(result.campaign); await refresh();
    if (action === 'approve') {
      setView('people');
      setFeedback(automationEnabled ? 'Campaña aprobada. Los primeros correos salen en el próximo envío automático.' : 'Campaña aprobada. Envía los primeros correos con «Enviar correos disponibles».');
    }
    if (action === 'pause') setFeedback('Campaña en pausa. No sale ningún correo hasta que la reanudes.');
    if (action === 'resume') setFeedback('Campaña reanudada. Los correos pendientes salen en su fecha.');
  }
  // The server sends what is due in batches (…/dispatch): one request per batch instead of one per person, with the same
  // checks and idempotency as the scheduled worker. A batch stops at its own limit; the next one continues.
  async function sendAvailable() {
    if (!campaign?.approved_at) return;
    const total = { sent: 0, held: 0, deferred: 0, attention: 0 };
    let ready = 0;
    try {
      for (let batch = 0; batch < SEND_BATCHES_PER_CLICK; batch++) {
        setFeedback(batch === 0 ? 'Enviando desde el servidor…' : `Enviando… ${plural(total.sent, 'correo enviado', 'correos enviados')} hasta ahora.`);
        const result = await request(`/${campaign.id}/dispatch`, { reviewHash: campaign.review_hash });
        total.sent += result.summary.sent; total.held += result.summary.held;
        total.deferred += result.summary.deferred; total.attention += result.summary.attention;
        ready = result.progress.ready;
        if (!ready || !result.summary.attempted) break;
      }
    } catch (error) {
      // The error shows above; say what already went out so nobody sends it again by hand.
      setFeedback(total.sent ? `${plural(total.sent, 'correo enviado', 'correos enviados')} antes de detenerse.` : '');
      throw error;
    } finally {
      await open(campaign.id);
    }
    const parts = [total.sent ? `${plural(total.sent, 'correo enviado', 'correos enviados')}.` : 'No había correos para enviar ahora.'];
    if (total.held) parts.push(`${plural(total.held, 'contacto quedó', 'contactos quedaron')} en revisión porque cambió, respondió o ya no cumple los criterios.`);
    if (total.deferred || total.attention) parts.push(`${plural(total.deferred + total.attention, 'envío espera', 'envíos esperan')}: revisa el estado de cada persona.`);
    if (ready) parts.push(`Quedan ${plural(ready, 'correo listo', 'correos listos')}: vuelve a pulsar «Enviar correos disponibles».`);
    if (total.sent) parts.push('Los seguimientos respetan el tiempo desde el envío confirmado.');
    setFeedback(parts.join(' '));
  }
  function loadHistory(email: string) {
    if (!campaign || history[email] || historyLoading) return;
    setHistoryLoading(email);
    fetch(`/api/campaigns/bulk/${campaign.id}/history?email=${encodeURIComponent(email)}`, { cache: 'no-store' })
      .then(response => response.json()).then(result => {
        if (Array.isArray(result.events)) setHistory(value => ({ ...value, [email]: result.events }));
      }).catch(() => {}).finally(() => setHistoryLoading(''));
  }
  const reviseLocked = (index: number) => reviseMode && campaign
    ? campaign.recipients.some(person => isCampaignMessageLocked(person.messages[index]?.draftId || '', deliveries))
    : false;
  const progress = useMemo(() => campaign && frozen
    ? campaignProgress({ campaign, deliveries, attempts, replied, automation: automationEnabled, paused: campaign.status === 'paused' })
    : null, [campaign, frozen, deliveries, attempts, replied, automationEnabled]);
  const badge = campaign ? campaignStatusBadge(campaign.status, progress?.finished) : null;
  const pendingEditable = Boolean(campaign && frozen && campaign.recipients.some(person => person.messages.some(message => !isCampaignMessageLocked(message.draftId, deliveries))));
  const individualName = individual ? (campaign?.recipients.find(person => person.email === individual.email)?.name || individual.email) : '';
  const blockedOnPage = people.filter(person => person.blockedReason).length;
  const selectionOutsideResults = definition.emails.filter(email => !people.some(person => person.email === email)).length;

  const individualEditor = individual ? (
    <div className="space-y-4 rounded-xl border border-primary/40 bg-background p-4 shadow-sm sm:p-5">
      <div className="space-y-1">
        <h4 className="font-semibold">Editar solo para {individualName}</h4>
        <p className="text-xs text-muted-foreground">{individual.messageIndex === 0 ? 'Primer correo' : `Seguimiento ${individual.messageIndex}`}. El resto de la audiencia recibe el correo de la campaña.</p>
      </div>
      <div className="space-y-2"><Label htmlFor="individual-subject">Asunto individual</Label><Input id="individual-subject" disabled={busy} value={individual.subject} onChange={event => { setIndividual({ ...individual, subject: event.target.value }); setIndividualProposal(null); }} /></div>
      <div className="space-y-2"><Label htmlFor="individual-body">Correo individual</Label><Textarea id="individual-body" disabled={busy} className="min-h-48" value={individual.body} onChange={event => { setIndividual({ ...individual, body: event.target.value }); setIndividualProposal(null); }} /></div>
      <div className="space-y-2">
        <Label htmlFor="individual-instruction">Cambio con IA para esta persona</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="individual-instruction" disabled={busy} value={individualInstruction} onChange={event => setIndividualInstruction(event.target.value)} placeholder="Menciona su última contratación masiva" />
          <Button variant="outline" className="shrink-0" disabled={busy || individualInstruction.trim().length < 5} onClick={() => void run(async () => {
            const result = await request('/assist', { mode: 'message', instruction: individualInstruction, objective: definition.objective, relationship: definition.criteria.relationship,
              current: { subject: individual.subject, body: individual.body, delayDays: definition.messages[individual.messageIndex].delayDays } });
            setIndividualProposal(result.proposal);
          })}>Proponer cambio individual</Button>
        </div>
      </div>
      {individualProposal && <div className="space-y-2 rounded-lg bg-muted/40 p-3"><p className="text-xs font-medium text-muted-foreground">Propuesta de IA</p><p className="font-medium">{individualProposal.subject}</p><p className="whitespace-pre-wrap text-sm leading-6">{individualProposal.body}</p><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={busy} onClick={() => { setIndividual({ ...individual, subject: individualProposal.subject, body: individualProposal.body }); setIndividualProposal(null); }}>Aplicar propuesta</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setIndividualProposal(null)}>Descartar</Button></div></div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => { setIndividual(null); setIndividualProposal(null); }}>Cancelar</Button>
        <Button disabled={busy} onClick={() => void run(async () => {
          const overrides = [...(definition.overrides || []).filter(value => value.email !== individual.email || value.messageIndex !== individual.messageIndex), individual];
          await save({ ...definition, overrides }); setIndividual(null); setIndividualProposal(null);
        })}>Guardar edición individual</Button>
      </div>
    </div>
  ) : null;

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6 [&_button:not([role=checkbox])]:h-auto [&_button:not([role=checkbox])]:min-h-11 [&_button:not([role=checkbox])]:max-w-full [&_button:not([role=checkbox])]:whitespace-normal [&_button:not([role=checkbox])]:py-2">
    <PageHeader title="Campañas" description="Escribe a un grupo con una sola aprobación o revisa los seguimientos uno por uno." />
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"><span className="min-w-0 flex-1">{error}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(campaign && editing && !dirty && !individual ? () => open(campaign.id) : refresh)}>Actualizar</Button></div>}
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList data-tour="campaigns-tabs" className="grid h-auto w-full grid-cols-2 sm:w-fit"><TabsTrigger value="campaigns">Campañas masivas</TabsTrigger><TabsTrigger value="followups">Seguimientos individuales</TabsTrigger></TabsList>
      <TabsContent value="followups"><CampaignReviewInbox /></TabsContent>
      <TabsContent value="campaigns" className="space-y-5">
        {feedback && <p role="status" className="rounded-xl bg-muted/50 px-4 py-3 text-sm">{feedback}</p>}
        {!editing ? <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Tus campañas</h2>
            {items.length > 0 && <Button disabled={busy} onClick={startNew}>Nueva campaña</Button>}
          </div>
          <CampaignList items={items} loading={!loaded} busy={busy} onOpen={id => void run(() => open(id))} onNew={startNew} />
          <Link className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href="/campaigns/history">Ver campañas anteriores</Link>
        </> : <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" className="-ml-3" disabled={busy} onClick={() => void leave()}><ArrowLeft aria-hidden="true" />Tus campañas</Button>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {dirty ? <span>Sin guardar</span> : null}
              {badge ? <Badge variant={badge.variant} className="font-medium">{badge.label}</Badge> : <Badge variant="outline" className="font-medium">Nueva campaña</Badge>}
            </span>
          </div>
          {!frozen && <CampaignSteps steps={STEPS} current={step} canGoTo={() => !busy && !individual && !reviseMode} onGo={index => { if (index === 2 && dirty) void run(() => save()); else setStep(index); }} />}
          <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-7" aria-busy={busy}>
            {step === 0 && <>
              <header className="space-y-1">
                <h2 className="text-xl font-semibold">¿A quién quieres contactar?</h2>
                <p className="text-sm text-muted-foreground">Eliges entre tus leads guardados con correo, con su cargo, empresa e industria.</p>
              </header>
              <div className="space-y-2"><Label htmlFor="campaign-name">Nombre de campaña</Label><Input id="campaign-name" value={definition.name} disabled={busy} onChange={event => change({ name: event.target.value })} placeholder="Si lo dejas vacío, lo tomamos de lo que describas" /></div>
              <div className={`${SEGMENT_TRACK} grid w-full grid-cols-2`} role="group" aria-label="Modo de búsqueda de audiencia">
                {(['ai', 'manual'] as const).map(mode => <button key={mode} type="button" className={segmentClass(audienceMode === mode)} aria-pressed={audienceMode === mode} disabled={busy} onClick={() => { setAudienceMode(mode); setSearched(false); setPeople([]); setRankMeta(null); }}>{mode === 'ai' ? 'Describir lead ideal con IA' : 'Filtros manuales'}</button>)}
              </div>
              {audienceMode === 'ai' ? (
                <div className="space-y-2"><Label htmlFor="audience-description">Describe tu lead ideal</Label><Textarea id="audience-description" disabled={busy} value={definition.description} onChange={event => change({ description: event.target.value })} placeholder="Necesito contactar leads con cargo suficiente para decidir una compra, de empresas de seguridad en Chile" /></div>
              ) : <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* «Tamaño de empresa» only shows to clear a value saved before: the search compares it as text and the
                      contacts carry the number of employees, so a range never matched (docs/ui-ux/sencillez.md). */}
                  {(['titles', 'industries', 'countries', ...(definition.criteria.sizes.some(Boolean) ? ['sizes' as const] : [])] as const).map(field => <div key={field} className="space-y-2"><Label htmlFor={field}>{({ titles: 'Cargos', industries: 'Industrias', countries: 'Países', sizes: 'Tamaño de empresa' })[field]} (separados por comas)</Label><Input id={field} disabled={busy} value={definition.criteria[field].join(',')} onChange={event => changeCriteria({ [field]: event.target.value.split(',') })} /></div>)}
                </div>
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="text-sm font-medium">Nivel del cargo <span className="font-normal text-muted-foreground">(opcional, uno o varios)</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {/* A level typed before the list existed stays visible, so it can be removed. */}
                    {[...SENIORITY_LEVELS, ...definition.criteria.seniorities.filter(code => code.trim() && !SENIORITY_LEVELS.some(level => level.code === code)).map(code => ({ code, label: code }))].map(level => {
                      const chosen = definition.criteria.seniorities.includes(level.code);
                      return <Button key={level.code} type="button" size="sm" variant={chosen ? 'default' : 'outline'} aria-pressed={chosen} className="h-8 rounded-full"
                        onClick={() => changeCriteria({ seniorities: chosen ? definition.criteria.seniorities.filter(code => code !== level.code) : [...definition.criteria.seniorities, level.code] })}>{level.label}</Button>;
                    })}
                  </div>
                </fieldset>
                <details className="rounded-xl border px-4 py-1" onToggle={event => { if ((event.target as HTMLDetailsElement).open) void loadProfiles(); }}>
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Perfiles de audiencia guardados ({profiles.length})</summary>
                  <div className="space-y-2 pb-3">
                    <div className="flex flex-wrap gap-2"><Input className="max-w-64" disabled={busy} value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="Nombre del perfil" aria-label="Nombre del perfil" /><Button variant="outline" disabled={busy || !profileName.trim()} onClick={() => void run(async () => { await request('/profiles', { name: profileName.trim(), criteria: definition.criteria }); setProfileName(''); await loadProfiles(); setFeedback('Perfil guardado.'); })}>Guardar criterios actuales</Button></div>
                    {profiles.map(profile => <div key={profile.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1 text-sm"><span className="font-medium">{profile.name}</span><span className="flex gap-1"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { change({ criteria: AudienceCriteriaSchema.parse(profile.criteria) }); setSearched(false); setFeedback(`Perfil «${profile.name}» aplicado. Busca para ver resultados.`); }}>Aplicar</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await fetch(`/api/campaigns/bulk/profiles/${profile.id}`, { method: 'DELETE' }); await loadProfiles(); })}>Eliminar</Button></span></div>)}
                  </div>
                </details>
              </>}
              {/* Who can be written to comes before the search, because the search answers it (9 Nov 2026 review). */}
              <div className="grid items-end gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="relationship">Contacto previo</Label>
                  <Select disabled={busy} value={definition.criteria.relationship} onValueChange={value => changeCriteria({ relationship: value as CampaignInput['criteria']['relationship'] })}>
                    <SelectTrigger id="relationship"><SelectValue /></SelectTrigger>
                    <SelectContent>{RELATIONSHIPS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {definition.criteria.relationship === 'previously_contacted' && <div className="space-y-2"><Label htmlFor="days">Días mínimos desde el último envío</Label><Input id="days" type="number" min={0} max={3650} disabled={busy} value={definition.criteria.minimumDaysSinceSent} onChange={event => changeCriteria({ minimumDaysSinceSent: Number(event.target.value) })} /></div>}
              </div>
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox id="exclude-replied" disabled={busy} checked={definition.criteria.excludeReplied} onCheckedChange={checked => changeCriteria({ excludeReplied: checked === true })} />
                <Label htmlFor="exclude-replied" className="font-normal">Excluir personas que ya respondieron</Label>
              </div>
              {audienceMode === 'ai'
                ? <Button variant={searched && definition.emails.length ? 'outline' : 'default'} disabled={busy || definition.description.trim().length < 10} onClick={() => void run(rankAudience)}>{busy ? 'Buscando…' : 'Buscar leads ideales'}</Button>
                : <div className="flex flex-wrap gap-2"><Input className="max-w-72" disabled={busy} value={audienceQuery} onChange={event => setAudienceQuery(event.target.value)} placeholder="Buscar por nombre, empresa o correo" aria-label="Buscar en resultados" /><Button variant={searched && definition.emails.length ? 'outline' : 'default'} disabled={busy} onClick={() => void run(() => searchAudience(0))}>{busy ? 'Buscando…' : 'Buscar con filtros'}</Button></div>}
              {rankMeta && <p className="text-sm text-muted-foreground" role="status">{rankMeta.candidateCount
                ? `La IA revisó ${plural(rankMeta.candidateCount, 'lead enriquecido que puedes contactar', 'leads enriquecidos que puedes contactar')}${rankMeta.truncated ? ' (los más recientes)' : ''} y propuso ${rankMeta.rankedCount.toLocaleString('es-CL')}.`
                : `De tus ${plural(rankMeta.poolCount, 'lead enriquecido', 'leads enriquecidos')}, ninguno se puede contactar con este criterio.`}
                {audienceExclusionSummary(rankMeta.excluded) ? ` ${audienceExclusionSummary(rankMeta.excluded)}` : ''}
                {rankMeta.ineligibleCount > 0 ? ` ${rankMeta.ineligibleCount === 1 ? '1 propuesto no está disponible' : `${rankMeta.ineligibleCount.toLocaleString('es-CL')} propuestos no están disponibles`} para contactar.` : ''}</p>}
              {/* The campaign picks from contacts already saved with an email: when they are few, the way to more is finding new ones. */}
              {rankMeta && (rankMeta.rankedCount < FEW_RESULTS || (rankMeta.ownCount !== null && rankMeta.ownCount < SMALL_OWN_BASE)) && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-4">
                <p className="min-w-0 flex-1 text-sm">{rankMeta.ownCount !== null && rankMeta.ownCount < SMALL_OWN_BASE
                  ? `Tienes ${plural(rankMeta.ownCount, 'lead propio', 'leads propios')} con correo: es una base chica para una campaña. Cowork busca personas nuevas en Apollo, las guarda con su correo y te arma la campaña.`
                  : '¿Necesitas más? Cowork busca personas nuevas en Apollo, las guarda con su correo y te arma la campaña.'}</p>
                <Button asChild variant="outline" size="sm"><Link href={coworkSearchHref(definition.description)}>Buscar personas nuevas con Cowork</Link></Button>
              </div>}
              {searched && <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm" role="status">{plural(audienceTotal, 'resultado', 'resultados')} · <span className="font-medium">{plural(definition.emails.length, 'seleccionado', 'seleccionados')}</span> <span className="text-muted-foreground">(máximo {MAX_RECIPIENTS})</span>{blockedOnPage ? <span className="text-muted-foreground"> · {plural(blockedOnPage, 'no disponible', 'no disponibles')} en esta página</span> : null}</p>
                  <span className="flex gap-1"><Button variant="ghost" size="sm" disabled={busy} onClick={() => selectAllResults(true)}>Seleccionar todos</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => selectAllResults(false)}>Quitar todos</Button></span>
                </div>
                {!people.length ? <p className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">No encontramos leads para esta búsqueda. Prueba describirlo de otra forma, con menos filtros, o revisa tus leads enriquecidos.</p> : <CampaignAudienceTable people={people} selected={definition.emails} max={MAX_RECIPIENTS} busy={busy} onToggle={(email, checked) => change({ emails: checked ? [...definition.emails, email] : definition.emails.filter(value => value !== email) })} />}
                {audienceMode === 'manual' && audienceTotal > 25 && <div className="flex items-center justify-between gap-2 text-sm"><Button variant="outline" size="sm" disabled={busy || audiencePage === 0} onClick={() => void run(() => searchAudience(audiencePage - 1))}>Anterior</Button><span>Página {audiencePage + 1} de {Math.max(1, Math.ceil(audienceTotal / 25))}</span><Button variant="outline" size="sm" disabled={busy || (audiencePage + 1) * 25 >= audienceTotal} onClick={() => void run(() => searchAudience(audiencePage + 1))}>Siguiente</Button></div>}
              </>}
              {/* The table already shows who is chosen; the list says who else is, from another page or an earlier search. */}
              {definition.emails.length > 0 && (!searched || selectionOutsideResults > 0) && <details className="rounded-xl border px-4 py-1"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Revisar selección guardada ({definition.emails.length})</summary><div className="space-y-1 pb-3"><p className="text-sm text-muted-foreground">Al guardar verificaremos que todos sigan cumpliendo los criterios.</p>{definition.emails.map(email => <div key={email} className="flex items-center justify-between gap-2 text-sm"><span className="break-all">{email}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => change({ emails: definition.emails.filter(value => value !== email) })}>Quitar</Button></div>)}</div></details>}
              <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-card/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                {!definition.emails.length && <p className="mr-auto text-sm text-muted-foreground">Elige al menos una persona para continuar.</p>}
                <Button disabled={busy || !definition.emails.length} onClick={() => { if (!definition.name.trim()) change({ name: suggestedCampaignName(definition) }); setStep(1); }}>Continuar a correos</Button>
              </div>
            </>}
            {step === 1 && <CampaignSequenceEditor definition={definition} messageIndex={messageIndex} busy={busy} reviseMode={reviseMode}
              isLocked={reviseLocked} onSelect={setMessageIndex} onChange={change} onBusyChange={setBusy}
              onAssist={input => request('/assist', input)} onSave={() => void run(() => save())} objectiveFromProfile={profileObjective}
              onBack={() => { if (reviseMode) { setReviseMode(false); setStep(2); } else setStep(0); }} />}
            {step === 2 && campaign && !frozen && <>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words text-xl font-semibold">{campaign.definition.name}</h2>
                  <p className="text-sm text-muted-foreground">{plural(campaign.recipients.length, 'persona', 'personas')} · {plural(campaign.definition.messages.length, 'correo', 'correos')} por persona · desde tu {providerName(campaign.definition.provider)}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={busy || Boolean(individual)} onClick={duplicate}><Copy aria-hidden="true" />Duplicar</Button>
              </header>
              <CampaignPreview recipients={campaign.recipients} overrides={definition.overrides || []} selected={recipientIndex} onSelect={setRecipientIndex}
                editable busy={busy} editing={individual} editor={individualEditor}
                onEdit={(email, index) => {
                  const message = campaign.recipients.find(person => person.email === email)?.messages[index];
                  if (!message) return;
                  setIndividual({ email, messageIndex: index, subject: message.subject, body: message.body }); setIndividualInstruction(''); setIndividualProposal(null);
                }} />
              <section aria-labelledby="campaign-approve-what" className="rounded-xl bg-muted/40 p-4">
                <h3 id="campaign-approve-what" className="text-sm font-semibold">Qué pasa al aprobar</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  {[
                    campaign.recipients.length === 1 ? 'Apruebas los correos de esta persona; antes de eso no sale nada.' : `Apruebas de una vez los correos de las ${campaign.recipients.length.toLocaleString('es-CL')} personas; antes de eso no sale nada.`,
                    automationEnabled ? 'Los primeros correos salen solos, también con esta página cerrada.' : 'Los primeros correos los envías desde aquí, con «Enviar correos disponibles».',
                    'Cada seguimiento sale en su fecha y se detiene si la persona responde. Puedes pausar cuando quieras.',
                    'Cada correo lleva tu firma y el enlace para darse de baja.',
                  ].map(line => <li key={line} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{line}</span></li>)}
                </ul>
              </section>
              <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-card/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                {dirty && <p className="mr-auto self-center text-sm text-muted-foreground" role="status">Hay cambios sin guardar: guárdalos para aprobar.</p>}
                <Button variant="ghost" disabled={busy || Boolean(individual)} onClick={() => setStep(0)}>Editar audiencia</Button>
                <Button variant="outline" disabled={busy || Boolean(individual)} onClick={() => setStep(1)}>Editar correos</Button>
                {dirty
                  ? <Button disabled={busy || Boolean(individual)} onClick={() => void run(() => save())}>Guardar cambios</Button>
                  : <Button disabled={busy || Boolean(individual)} onClick={() => void run(() => decide('approve'))}>Aprobar campaña</Button>}
              </div>
            </>}
            {step === 2 && campaign && frozen && progress && <>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words text-xl font-semibold">{campaign.definition.name}</h2>
                  <p className="text-sm text-muted-foreground">{[
                    campaign.approved_at ? `Aprobada el ${formatDate(campaign.approved_at)}` : null,
                    `desde tu ${providerName(campaign.definition.provider)}`,
                    campaign.status === 'approved' && progress.nextAt ? `próximo envío: ${formatDateTime(progress.nextAt)}` : null,
                  ].filter(Boolean).join(' · ')}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={busy} onClick={duplicate}><Copy aria-hidden="true" />Duplicar</Button>
              </header>
              <CampaignProgressTiles progress={progress} />
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  {campaign.status === 'paused'
                    ? <Button disabled={busy} onClick={() => void run(() => decide('resume'))}>Reanudar campaña</Button>
                    : <>
                      <Button variant={automationEnabled ? 'outline' : 'default'} disabled={busy} onClick={() => void run(sendAvailable)}>{busy ? 'Procesando…' : 'Enviar correos disponibles'}</Button>
                      <Button variant="outline" disabled={busy} onClick={() => void run(() => decide('pause'))}>Pausar campaña</Button>
                    </>}
                  {pendingEditable && <Button variant="ghost" disabled={busy} onClick={() => { setDefinition({ ...campaign.definition }); setReviseMode(true); setStep(1); setMessageIndex(0); setDirty(false); setFeedback('Edita solo los mensajes pendientes. Los enviados o en curso están bloqueados.'); }}>Editar mensajes pendientes</Button>}
                  <Button variant="ghost" disabled={busy} onClick={() => void run(() => open(campaign.id))}><RefreshCw aria-hidden="true" />Actualizar estado</Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{campaign.status === 'paused'
                  ? 'En pausa no sale ningún correo. Al reanudar, cada seguimiento sale en su fecha.'
                  : automationEnabled
                    ? 'Los correos salen solos, también con esta página cerrada; «Enviar correos disponibles» adelanta los que ya tocan. Cada seguimiento se detiene si la persona responde.'
                    : '«Enviar correos disponibles» envía los que ya tocan, por tandas. Vuelve a pulsarlo cuando llegue la fecha de cada seguimiento.'}</p>
              </div>
              <div className={`${SEGMENT_TRACK} max-w-full`} role="group" aria-label="Qué ver de la campaña">
                <button type="button" className={segmentClass(view === 'people')} aria-pressed={view === 'people'} onClick={() => setView('people')}>Estado por persona</button>
                <button type="button" className={segmentClass(view === 'emails')} aria-pressed={view === 'emails'} onClick={() => setView('emails')}>Correos aprobados</button>
              </div>
              {view === 'people'
                ? <CampaignRecipientsStatus progress={progress} busy={busy} canRetry={campaign.status === 'approved'} history={history} historyLoading={historyLoading}
                  onHistory={loadHistory}
                  onRetry={draftId => void run(async () => {
                    await request(`/${campaign.id}/retry`, { draftId }); await open(campaign.id);
                    setFeedback('Se volverá a comprobar el contacto antes de enviar.');
                  })} />
                : <CampaignPreview recipients={campaign.recipients} overrides={definition.overrides || []} selected={recipientIndex} onSelect={setRecipientIndex}
                  editable={false} busy={busy} editing={null} editor={null} onEdit={() => undefined} />}
            </>}
          </section>
        </>}
      </TabsContent>
    </Tabs>
  </div>;
}
