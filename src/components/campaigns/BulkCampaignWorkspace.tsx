'use client';

import { useEffect, useState } from 'react';
import { CampaignSequenceEditor } from './CampaignSequenceEditor';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignReviewInbox } from '@/components/campaigns-v2/CampaignReviewInbox';
import { campaignAttemptAllowsRetry, describeCampaignFailure, withSentAttemptsAsDeliveries, type CampaignAttempt } from '@/lib/bulk-campaign-attempts';
import { AudienceCriteriaSchema, CampaignInputSchema, defaultAudience, isCampaignMessageLocked, nextCampaignMessage, type AudiencePerson, type AudienceProfile, type BulkCampaign, type CampaignDelivery, type CampaignHistoryEvent, type CampaignInput, type CampaignMessage } from '@/lib/bulk-campaigns';

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
const stateLabels = { draft: 'Borrador', rejected: 'Cambios solicitados', approved: 'Aprobada', paused: 'En pausa' };

export function BulkCampaignWorkspace() {
  const [items, setItems] = useState<BulkCampaign[]>([]);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [definition, setDefinition] = useState(initial);
  const [campaign, setCampaign] = useState<BulkCampaign | null>(null);
  const [deliveries, setDeliveries] = useState<CampaignDelivery[]>([]);
  const [attempts, setAttempts] = useState<CampaignAttempt[]>([]);
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
  const [rankMeta, setRankMeta] = useState<{ rankedCount: number; candidateCount: number; truncated: boolean; ineligibleCount: number } | null>(null);
  const [recipientIndex, setRecipientIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [individual, setIndividual] = useState<{ email: string; messageIndex: number; subject: string; body: string } | null>(null);
  const [individualInstruction, setIndividualInstruction] = useState('');
  const [individualProposal, setIndividualProposal] = useState<CampaignMessage | null>(null);
  const frozen = campaign?.status === 'approved' || campaign?.status === 'paused';

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setFeedback('');
    try { await work(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  const refresh = async () => { const result = await request(''); setItems(result.campaigns); setAutomationEnabled(result.automationEnabled === true); };
  useEffect(() => { void run(refresh); }, []);
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
  async function open(id: string) {
    const result = await request(`/${id}`);
    setCampaign(result.campaign); setDefinition(result.campaign.definition);
    setDeliveries(withSentAttemptsAsDeliveries(result.deliveries || [], result.attempts || [])); setAttempts(result.attempts || []);
    setStep(2); setEditing(true); setDirty(false); setRecipientIndex(0); setMessageIndex(0); setReviseMode(false); setHistory({}); setIndividual(null);
  }
  async function save(input = definition) {
    const parsed = CampaignInputSchema.safeParse(input);
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
    setRankMeta({ rankedCount: result.rankedCount, candidateCount: result.candidateCount, truncated: result.truncated, ineligibleCount: result.ineligibleCount });
  }
  function selectAllResults(select: boolean) {
    const eligible = people.filter(person => !person.blockedReason).map(person => person.email);
    change({ emails: select ? [...new Set([...definition.emails, ...eligible])].slice(0, 100) : definition.emails.filter(email => !eligible.includes(email)) });
  }
  async function loadProfiles() {
    try { setProfiles((await request('/profiles', undefined, 'GET')).profiles || []); } catch { setProfiles([]); }
  }
  async function decide(action: 'approve' | 'reject' | 'pause' | 'resume') {
    if (!campaign) return;
    const result = await request(`/${campaign.id}`, { action, revision: campaign.revision, reviewHash: campaign.review_hash });
    setCampaign(result.campaign); await refresh();
    if (action === 'reject') { setStep(1); setFeedback('Puedes editar el mensaje o pedir cambios a la IA y volver a revisar.'); }
    if (action === 'approve') setFeedback('Contenido y audiencia aprobados. Ya puedes iniciar los envíos disponibles.');
  }
  async function sendAvailable() {
    if (!campaign?.approved_at) return;
    let sent = 0;
    let failed = 0;
    for (const recipient of campaign.recipients) {
      const next = nextCampaignMessage(recipient, deliveries, campaign.approved_at);
      if (next?.state !== 'ready' || !campaignAttemptAllowsRetry(attempts.find(value => value.draft_id === next.message.draftId))) continue;
      setFeedback(`Enviando a ${recipient.email}…`);
      try {
        const result = await request(`/${campaign.id}/process`, { email: recipient.email, reviewHash: campaign.review_hash });
        if (result.sent) sent++;
      } catch { failed++; }
    }
    await open(campaign.id); setFeedback(`${sent} correos enviados.${failed ? ` ${failed} no se pudieron completar; revisa el estado de cada persona.` : ''} Los seguimientos respetan el tiempo desde el envío confirmado.`);
  }
  const selectedPreview = campaign?.recipients[recipientIndex];
  const reviseLocked = (index: number) => reviseMode && campaign
    ? campaign.recipients.some(person => isCampaignMessageLocked(person.messages[index]?.draftId || '', deliveries))
    : false;

  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6 [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2 [&_select]:min-w-0">
    <header><h1 className="text-3xl font-semibold tracking-tight">Campañas</h1><p className="mt-2 text-muted-foreground">Contacta a un grupo o continúa una conversación.</p></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}<Button className="ml-3" size="sm" variant="outline" disabled={busy} onClick={() => void run(refresh)}>Actualizar</Button></div>}
    {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
    <Tabs defaultValue="campaigns">
      <TabsList className="grid h-auto w-full grid-cols-2 sm:w-fit"><TabsTrigger value="campaigns">Campañas masivas</TabsTrigger><TabsTrigger value="followups">Seguimientos individuales</TabsTrigger></TabsList>
      <TabsContent value="followups"><CampaignReviewInbox /></TabsContent>
      <TabsContent value="campaigns" className="space-y-5">
        {!editing ? <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">Tus campañas</h2><Button disabled={busy} onClick={() => { setDefinition(initial()); setCampaign(null); setPeople([]); setSearched(false); setEditing(true); setStep(0); setDirty(false); setAudienceMode('ai'); setRankMeta(null); setMessageIndex(0); setError(''); setReviseMode(false); setHistory({}); setAudiencePage(0); setAudienceTotal(0); setAudienceQuery(''); setProfileName(''); void loadProfiles(); }}>Nueva campaña</Button></div>
          {busy && <p role="status">Cargando campañas…</p>}
          {!busy && !items.length && !error && <div className="rounded-2xl border bg-card p-8"><h3 className="font-medium">Tu próxima conversación empieza aquí</h3><p className="mt-2 text-sm text-muted-foreground">Crea una campaña para tus leads nuevos o vuelve a contactar a quienes ya conoces.</p></div>}
          <div className="divide-y rounded-2xl border bg-card">{items.map(item => <button key={item.id} disabled={busy} onClick={() => void run(() => open(item.id))} className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><span><span className="block font-medium">{item.definition.name}</span><span className="text-sm text-muted-foreground">{item.definition.emails.length} destinatarios · {item.definition.messages.length} correos por persona</span></span><span className="text-sm">{stateLabels[item.status]}</span></button>)}</div>
          <Link className="inline-block text-sm text-muted-foreground underline underline-offset-4" href="/campaigns/history">Ver campañas anteriores</Link>
        </> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={busy} onClick={() => { if ((!dirty && !individual) || window.confirm('Tienes cambios sin guardar. ¿Quieres salir?')) { setEditing(false); setDirty(false); setIndividual(null); void run(refresh); } }}>← Tus campañas</Button><span className="text-sm text-muted-foreground">{campaign ? stateLabels[campaign.status] : 'Nueva campaña'}{dirty ? ' · Sin guardar' : ''}</span></div>
          <ol className="flex gap-3 text-sm" aria-label="Progreso">{['Audiencia', 'Correos', 'Revisión'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step === index ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{index + 1}. {label}</li>)}</ol>
          <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-7" aria-busy={busy}>
            {step === 0 && <>
              <h2 className="text-xl font-semibold">¿A quién quieres contactar?</h2>
              <p className="text-sm text-muted-foreground">Las campañas usan tus leads guardados enriquecidos, con los datos de cargo, empresa e industria de Apollo.</p>
              <div className="space-y-2"><Label htmlFor="campaign-name">Nombre de campaña</Label><Input id="campaign-name" value={definition.name} disabled={busy} onChange={event => change({ name: event.target.value })} placeholder="Primer contacto · Logística" /></div>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Modo de búsqueda de audiencia">
                {(['ai', 'manual'] as const).map(mode => <Button key={mode} variant={audienceMode === mode ? 'secondary' : 'ghost'} disabled={busy} onClick={() => { setAudienceMode(mode); setSearched(false); setPeople([]); setRankMeta(null); }}>{mode === 'ai' ? 'Describir lead ideal con IA' : 'Filtros manuales'}</Button>)}
              </div>
              {audienceMode === 'ai' ? <>
                <div className="space-y-2"><Label htmlFor="audience-description">Describe tu lead ideal</Label><Textarea id="audience-description" disabled={busy} value={definition.description} onChange={event => change({ description: event.target.value })} placeholder="Necesito contactar leads con cargo suficiente para decidir una compra, de empresas de seguridad en Chile" /><Button variant="outline" disabled={busy || definition.description.trim().length < 10} onClick={() => void run(rankAudience)}>Buscar leads ideales</Button></div>
                {rankMeta && <p className="text-sm text-muted-foreground" role="status">La IA evaluó {rankMeta.candidateCount} leads enriquecidos{rankMeta.truncated ? ' (los más recientes)' : ''} y propuso {rankMeta.rankedCount}.{rankMeta.ineligibleCount > 0 ? ` ${rankMeta.ineligibleCount} propuestos no están disponibles para contactar.` : ''}</p>}
              </> : <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['titles', 'industries', 'countries', 'sizes', 'seniorities'] as const).map((field, index) => <div key={field} className="space-y-2"><Label htmlFor={field}>{['Cargos', 'Industrias', 'Países', 'Tamaño de empresa', 'Antigüedad'][index]} (separados por comas)</Label><Input id={field} disabled={busy} value={definition.criteria[field].join(',')} onChange={event => { change({ criteria: { ...definition.criteria, [field]: event.target.value.split(',') } }); setSearched(false); }} /></div>)}
                </div>
                <details onToggle={event => { if ((event.target as HTMLDetailsElement).open) void loadProfiles(); }}>
                  <summary className="cursor-pointer text-sm">Perfiles de audiencia guardados ({profiles.length})</summary>
                  <div className="mt-2 flex flex-wrap gap-2"><Input className="max-w-64" disabled={busy} value={profileName} onChange={event => setProfileName(event.target.value)} placeholder="Nombre del perfil" aria-label="Nombre del perfil" /><Button variant="outline" disabled={busy || !profileName.trim()} onClick={() => void run(async () => { await request('/profiles', { name: profileName.trim(), criteria: definition.criteria }); setProfileName(''); await loadProfiles(); setFeedback('Perfil guardado.'); })}>Guardar criterios actuales</Button></div>
                  {profiles.map(profile => <div key={profile.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span className="font-medium">{profile.name}</span><span className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { change({ criteria: AudienceCriteriaSchema.parse(profile.criteria) }); setSearched(false); setFeedback(`Perfil «${profile.name}» aplicado. Busca para ver resultados.`); }}>Aplicar</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { await fetch(`/api/campaigns/bulk/profiles/${profile.id}`, { method: 'DELETE' }); await loadProfiles(); })}>Eliminar</Button></span></div>)}
                </details>
                <div className="flex flex-wrap gap-2"><Input className="max-w-72" disabled={busy} value={audienceQuery} onChange={event => setAudienceQuery(event.target.value)} placeholder="Buscar por nombre, empresa o correo" aria-label="Buscar en resultados" /><Button disabled={busy} onClick={() => void run(() => searchAudience(0))}>{busy ? 'Buscando…' : 'Buscar con filtros'}</Button></div>
              </>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="relationship">Contacto previo</Label><select id="relationship" className="h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-ring" disabled={busy} value={definition.criteria.relationship} onChange={event => { change({ criteria: { ...definition.criteria, relationship: event.target.value as typeof definition.criteria.relationship } }); setSearched(false); }}><option value="never_contacted">Nunca contactados</option><option value="previously_contacted">Contactados anteriormente</option></select></div>
                {definition.criteria.relationship === 'previously_contacted' && <div className="space-y-2"><Label htmlFor="days">Días mínimos desde el último envío</Label><Input id="days" type="number" min={0} max={3650} disabled={busy} value={definition.criteria.minimumDaysSinceSent} onChange={event => { change({ criteria: { ...definition.criteria, minimumDaysSinceSent: Number(event.target.value) } }); setSearched(false); }} /></div>}
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={busy} checked={definition.criteria.excludeReplied} onChange={event => { change({ criteria: { ...definition.criteria, excludeReplied: event.target.checked } }); setSearched(false); }} />Excluir personas que ya respondieron</label>
              {searched && <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm" role="status">{audienceTotal} resultados · {definition.emails.length} seleccionados (máximo 100)</p><span className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => selectAllResults(true)}>Seleccionar todos</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => selectAllResults(false)}>Quitar todos</Button></span></div>{!people.length && <p className="text-sm text-muted-foreground">No encontramos leads para esta búsqueda. Prueba describirlo de otra forma, con menos filtros, o revisa tus leads enriquecidos.</p>}<div className="max-h-80 space-y-1 overflow-y-auto">{people.map(person => <label key={person.email} className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted/50"><input className="mt-1" type="checkbox" disabled={busy || Boolean(person.blockedReason) || (!definition.emails.includes(person.email) && definition.emails.length >= 100)} checked={definition.emails.includes(person.email)} onChange={event => change({ emails: event.target.checked ? [...definition.emails, person.email] : definition.emails.filter(email => email !== person.email) })} /><span className="min-w-0 text-sm"><span className="block font-medium">{person.name || person.email} · {person.company}</span><span className="block break-all text-muted-foreground">{person.email}</span><span className="text-muted-foreground">{[person.title, person.seniority].filter(Boolean).join(' · ')}{[person.title, person.seniority].filter(Boolean).length > 0 && (person.blockedReason || person.reasons.length > 0) ? ' — ' : ''}{person.blockedReason || person.reasons.join(' · ')}</span></span></label>)}</div>{audienceMode === 'manual' && audienceTotal > 25 && <div className="flex items-center justify-between gap-2 text-sm"><Button variant="outline" size="sm" disabled={busy || audiencePage === 0} onClick={() => void run(() => searchAudience(audiencePage - 1))}>Anterior</Button><span>Página {audiencePage + 1} de {Math.max(1, Math.ceil(audienceTotal / 25))}</span><Button variant="outline" size="sm" disabled={busy || (audiencePage + 1) * 25 >= audienceTotal} onClick={() => void run(() => searchAudience(audiencePage + 1))}>Siguiente</Button></div>}</>}
              {definition.emails.length > 0 && <details><summary className="cursor-pointer text-sm">Revisar selección guardada ({definition.emails.length})</summary><p className="my-2 text-sm text-muted-foreground">Al guardar verificaremos que todos sigan cumpliendo los criterios.</p>{definition.emails.map(email => <div key={email} className="flex items-center justify-between gap-2 text-sm"><span className="break-all">{email}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => change({ emails: definition.emails.filter(value => value !== email) })}>Quitar</Button></div>)}</details>}
              <div className="flex justify-end"><Button disabled={busy || !definition.name.trim() || !definition.emails.length} onClick={() => setStep(1)}>Continuar a correos</Button></div>
            </>}
            {step === 1 && <CampaignSequenceEditor definition={definition} messageIndex={messageIndex} busy={busy} reviseMode={reviseMode}
              isLocked={reviseLocked} onSelect={setMessageIndex} onChange={change} onBusyChange={setBusy}
              onAssist={input => request('/assist', input)} onSave={() => void run(() => save())}
              onBack={() => { if (reviseMode) { setReviseMode(false); setStep(2); } else setStep(0); }} />}
            {step === 2 && campaign && <>
              <h2 className="text-xl font-semibold">{campaign.definition.name}</h2><p className="text-sm text-muted-foreground">{campaign.recipients.length} destinatarios · {campaign.definition.messages.length} mensajes por persona. Revisa la plantilla personalizada antes de aprobar el conjunto.</p>
              <Button variant="outline" disabled={busy || Boolean(individual)} onClick={() => {
                setDefinition({ ...campaign.definition, name: `${campaign.definition.name} · Copia`, emails: [], overrides: [] });
                setCampaign(null); setPeople([]); setSearched(false); setStep(0); setDirty(true); setMessageIndex(0);
              }}>Reutilizar perfil y mensajes</Button>
              {!frozen && selectedPreview && <div className="space-y-3">
                <div className="flex flex-wrap gap-2">{selectedPreview.messages.map((value, index) => <Button key={value.draftId} variant="outline" disabled={busy || Boolean(individual)} onClick={() => {
                  setIndividual({ email: selectedPreview.email, messageIndex: index, subject: value.subject, body: value.body });
                  setIndividualInstruction(''); setIndividualProposal(null);
                }}>Editar {index === 0 ? 'correo inicial' : `seguimiento ${index}`} de esta persona</Button>)}</div>
                {individual && <div className="space-y-3 rounded-xl border p-4">
                  <h3 className="font-medium">Editar solo para {individual.email}</h3>
                  <Label htmlFor="individual-subject">Asunto individual</Label><Input id="individual-subject" disabled={busy} value={individual.subject} onChange={event => { setIndividual({ ...individual, subject: event.target.value }); setIndividualProposal(null); }} />
                  <Label htmlFor="individual-body">Correo individual</Label><Textarea id="individual-body" disabled={busy} className="min-h-48" value={individual.body} onChange={event => { setIndividual({ ...individual, body: event.target.value }); setIndividualProposal(null); }} />
                  <Label htmlFor="individual-instruction">Cambio con IA para esta persona</Label><Input id="individual-instruction" disabled={busy} value={individualInstruction} onChange={event => setIndividualInstruction(event.target.value)} />
                  <Button variant="outline" disabled={busy || individualInstruction.trim().length < 5} onClick={() => void run(async () => {
                    const result = await request('/assist', { mode: 'message', instruction: individualInstruction, objective: definition.objective, relationship: definition.criteria.relationship,
                      current: { subject: individual.subject, body: individual.body, delayDays: definition.messages[individual.messageIndex].delayDays } });
                    setIndividualProposal(result.proposal);
                  })}>Proponer cambio individual</Button>
                  {individualProposal && <div className="space-y-2 rounded-lg bg-muted/40 p-3"><p className="font-medium">{individualProposal.subject}</p><p className="whitespace-pre-wrap text-sm">{individualProposal.body}</p><Button variant="secondary" disabled={busy} onClick={() => { setIndividual({ ...individual, subject: individualProposal.subject, body: individualProposal.body }); setIndividualProposal(null); }}>Aplicar propuesta</Button><Button variant="ghost" disabled={busy} onClick={() => setIndividualProposal(null)}>Descartar</Button></div>}
                  <div className="flex gap-2"><Button disabled={busy} onClick={() => void run(async () => {
                    const overrides = [...(definition.overrides || []).filter(value => value.email !== individual.email || value.messageIndex !== individual.messageIndex), individual];
                    await save({ ...definition, overrides }); setIndividual(null); setIndividualProposal(null);
                  })}>Guardar edición individual</Button><Button variant="ghost" disabled={busy} onClick={() => { setIndividual(null); setIndividualProposal(null); }}>Cancelar</Button></div>
                </div>}
              </div>}
              <div className="space-y-2"><Label htmlFor="preview-person">Vista previa por destinatario</Label><select id="preview-person" className="h-11 w-full rounded-md border bg-background px-3 focus-visible:outline-ring" value={recipientIndex} onChange={event => setRecipientIndex(Number(event.target.value))}>{campaign.recipients.map((person, index) => <option key={person.email} value={index}>{person.name || person.email} · {person.email}</option>)}</select></div>
              {selectedPreview?.messages.map((value, index) => <article key={value.draftId} className="space-y-3 rounded-xl border bg-background p-5"><p className="text-xs text-muted-foreground">{index === 0 ? 'Primer correo' : `Seguimiento ${index} · ${value.delayDays} días después del anterior`}</p><h3 className="font-semibold">{value.subject}</h3><p className="whitespace-pre-wrap break-words text-sm leading-7">{value.body}</p><p className="border-t pt-3 text-xs text-muted-foreground">El envío incluye el enlace para darse de baja.</p></article>)}
              {!frozen ? <><p className="text-sm text-muted-foreground">Aprobar autoriza estos mensajes para toda la audiencia seleccionada. {automationEnabled ? 'Los envíos comenzarán automáticamente tras aprobar.' : 'Después podrás iniciar los envíos desde esta página.'} Los seguimientos se detienen si la persona responde.</p><div className="flex flex-wrap justify-end gap-3"><Button variant="ghost" disabled={busy || Boolean(individual)} onClick={() => setStep(0)}>Editar audiencia</Button><Button variant="outline" disabled={busy || Boolean(individual)} onClick={() => void run(() => decide('reject'))}>Rechazar y editar</Button><Button disabled={busy || dirty || Boolean(individual)} onClick={() => void run(() => decide('approve'))}>Aprobar campaña</Button></div></> : <>
                <p className="text-sm text-muted-foreground">{deliveries.filter(value => value.status === 'sent').length} envíos confirmados. {automationEnabled ? 'Los correos aprobados se procesan automáticamente, incluso con esta página cerrada. Los seguimientos esperan su fecha y se detienen ante una respuesta.' : 'Inicia los disponibles desde aquí; mantén esta página abierta mientras se procesan. Los seguimientos futuros se inician al volver, cuando corresponda su fecha.'}</p>
                <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => void run(() => decide(campaign.status === 'paused' ? 'resume' : 'pause'))}>{campaign.status === 'paused' ? 'Reanudar campaña' : 'Pausar campaña'}</Button><Button variant="ghost" disabled={busy} onClick={() => void run(() => open(campaign.id))}>Actualizar estado</Button><Button disabled={busy || campaign.status !== 'approved'} onClick={() => void run(sendAvailable)}>{busy ? 'Procesando…' : 'Enviar correos disponibles'}</Button>{campaign.recipients.some(person => person.messages.some(message => !isCampaignMessageLocked(message.draftId, deliveries))) && <Button variant="outline" disabled={busy} onClick={() => { setDefinition({ ...campaign.definition }); setReviseMode(true); setStep(1); setMessageIndex(0); setDirty(false); setFeedback('Edita solo los mensajes pendientes. Los enviados o en curso están bloqueados.'); }}>Editar mensajes pendientes</Button>}</div>
                <section aria-label="Estado por destinatario" className="divide-y rounded-xl border">
                  {campaign.recipients.map(person => {
                    const next = nextCampaignMessage(person, deliveries, campaign.approved_at!);
                    const attempt = attempts.find(value => value.draft_id === next?.message.draftId);
                    const confirmed = person.messages.filter(message => deliveries.some(value => value.draft_id === message.draftId && value.status === 'sent')).length;
                    const labels: Record<string, string> = { ready: 'Listo para enviar', waiting: 'Esperando su fecha', failed: 'Requiere atención', unknown: 'Por confirmar', sending: 'Enviando', pending: 'Envío pendiente' };
                    return <div key={person.email} className="space-y-1 p-4 text-sm">
                      <p className="break-words font-medium">{person.name || person.email}</p><p className="break-all text-muted-foreground">{person.email} · {confirmed}/{person.messages.length} enviados</p>
                      <p>{!next ? 'Secuencia finalizada' : attempt && attempt.state !== 'sent' ? attempt.message : labels[next.state] || 'Pendiente'}</p>
                      {next?.dueAt && next.state === 'waiting' && <p className="text-muted-foreground">Próximo correo: {new Date(next.dueAt).toLocaleString('es-CL')}</p>}
                      {attempt?.retry_at && <p className="text-muted-foreground">Próxima comprobación: {new Date(attempt.retry_at).toLocaleString('es-CL')}</p>}
                      {attempt && attempt.state !== 'sent' && next?.state === 'ready' && describeCampaignFailure(attempt.code).retryable && <Button variant="outline" size="sm" disabled={busy || campaign.status !== 'approved'} onClick={() => void run(async () => {
                        await request(`/${campaign.id}/retry`, { draftId: attempt.draft_id }); await open(campaign.id);
                        setFeedback('Se volverá a comprobar el contacto antes de enviar.');
                      })}>Volver a comprobar</Button>}
                      <details onToggle={event => {
                        if (!(event.target as HTMLDetailsElement).open || history[person.email] || historyLoading) return;
                        setHistoryLoading(person.email);
                        fetch(`/api/campaigns/bulk/${campaign.id}/history?email=${encodeURIComponent(person.email)}`, { cache: 'no-store' })
                          .then(response => response.json()).then(result => {
                            if (Array.isArray(result.events)) setHistory(value => ({ ...value, [person.email]: result.events }));
                          }).catch(() => {}).finally(() => setHistoryLoading(''));
                      }}>
                        <summary className="cursor-pointer text-sm underline underline-offset-4">Ver historial unificado</summary>
                        <div className="mt-2 space-y-2">{historyLoading === person.email && <p>Cargando historial…</p>}{(history[person.email] || []).map((event, index) => <div key={index} className="rounded-lg bg-muted/40 p-3"><p className="font-medium">{event.label}</p>{event.at && <p>{new Date(event.at).toLocaleString('es-CL')}</p>}{event.detail && <p className="break-words">{event.detail}</p>}</div>)}{history[person.email] && !history[person.email].length && <p>Sin actividad registrada.</p>}</div>
                      </details>
                    </div>;
                  })}
                </section>
              </>}
            </>}
          </section>
        </>}
      </TabsContent>
    </Tabs>
  </div>;
}
