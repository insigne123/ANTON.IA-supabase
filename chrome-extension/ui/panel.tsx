import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, ChevronRight, Copy, ExternalLink, Link2, Loader2, LogOut, Mail, Search, Send, Sparkles, UserRound } from 'lucide-react';
import { canonicalExtensionProfileUrl as normalizeLinkedinProfileUrl } from '../../src/lib/extension-profile-url';
import './panel.css';
import { downloadResearchPdf } from './research-pdf';
import { reportReady, reportPending, reportStatusLabel } from './research-state';
import { restoreProfileEdits } from './profile-cache';
import { researchFindings } from './research-findings';
import { blockLines } from './report-blocks';

declare const chrome: any;
type ProfileDetails = { headline?: string; city?: string; state?: string; country?: string; industry?: string; seniority?: string; departments?: string[]; companySize?: string };
type Profile = { linkedinUrl: string; fullName: string; title: string; companyName: string; email: string; companyDomain: string; primaryPhone: string; emailStatus: string; details?: ProfileDetails };
type Connection = { origin: string; session: { userId: string; organizationId: string; organizationName: string; email: string; researchEnabled: boolean; sequencesEnabled: boolean } };
const empty: Profile = { linkedinUrl: '', fullName: '', title: '', companyName: '', email: '', companyDomain: '', primaryPhone: '', emailStatus: 'unknown' };
const labels: Record<string, string> = { queued: 'En cola', running: 'Investigando…', completed: 'Investigación lista', partial: 'Investigación parcial', insufficient_data: 'Faltan datos para investigar', failed: 'No se pudo completar', cancelled: 'Investigación cancelada' };
const fromRow = (row: any): Profile => ({ linkedinUrl: normalizeLinkedinProfileUrl(row.linkedin_url), fullName: row.full_name || '', title: row.title || '', companyName: row.company_name || '', email: row.email || '', companyDomain: row.organization_domain || row.data?.companyDomain || '', primaryPhone: row.primary_phone || '', emailStatus: row.email_status || 'unknown', details: row.data?.extensionDetails });
async function rpc(action: string, extra: Record<string, unknown> = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'La extensión no respondió. Recarga el panel.');
  return response.result;
}

function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [candidate, setCandidate] = useState<(Profile & { tabId: number }) | null>(null);
  const [profile, setProfile] = useState<Profile>(empty);
  const [url, setUrl] = useState('');
  const [view, setView] = useState('profile');
  const [saved, setSaved] = useState<any>(null);
  const [enrichedReady, setEnrichedReady] = useState(false);
  const enrichmentOperation = useRef({ key: '', id: '' });
  const [research, setResearch] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [messageOptions, setMessageOptions] = useState<string[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [instruction, setInstruction] = useState('Abrir una conversación relevante con una pregunta fácil de responder.');
  const [language, setLanguage] = useState('es');
  const [tone, setTone] = useState('profesional');
  const [offsets, setOffsets] = useState('3, 7');
  const [revealEmail, setRevealEmail] = useState(true);
  const [revealPhone, setRevealPhone] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmSend, setConfirmSend] = useState(false);
  const [followProfile, setFollowProfile] = useState(true);
  const dirty = useRef(false);
  const selecting = useRef(false);
  const [cachedEdits, setCachedEdits] = useState<Profile | null>(null);
  const [phoneJob, setPhoneJob] = useState<any>(null);
  const [sendState, setSendState] = useState('');
  const sendConfirmRef = useRef<HTMLElement>(null);
  const sendTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmSend) sendConfirmRef.current?.focus(); }, [confirmSend]);
  const [composeUrl, setComposeUrl] = useState('');
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [origin, setOrigin] = useState('https://studio--leadflowai-3yjcy.us-central1.hosted.app');
  const [connecting, setConnecting] = useState(false);
  const [booting, setBooting] = useState(true);
  const epoch = useRef(0);
  const locked = useRef(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const scope = connection ? `${connection.session.userId}:${connection.session.organizationId}` : '';
  const draftKey = scope && profile.linkedinUrl ? `prospect-draft:${scope}:${profile.linkedinUrl}` : '';

  const reset = () => {
    dirty.current = false; setCachedEdits(null); setPhoneJob(null);
    setEnrichedReady(false); setConfirmSend(false); setSendState('');
    setCampaigns(null); setCampaignId(''); setJobs(null);
    epoch.current++; setProfile(empty); setUrl(''); setSaved(null); setResearch(null); setMessage(''); setMessageOptions([]); setSources([]); setComposeUrl(''); setNotice(''); setError('');
  };
  useEffect(() => {
    let mounted = true;
    const refreshConnection = async () => {
      try {
        const current = await rpc('PROSPECT_SESSION');
        if (!mounted) return;
        setConnection(previous => {
          if (JSON.stringify(previous) === JSON.stringify(current)) return previous;
          return current;
        });
        if (current) setConnecting(false);
      } catch (err: any) { if (mounted) setError(err.message); }
      finally { if (mounted) setBooting(false); }
    };
    void refreshConnection();
    const listener = (changes: any, area: string) => { if ((area === 'local' || area === 'session') && changes.prospectConnection) void refreshConnection(); };
    chrome.storage.onChanged.addListener(listener);
    const timer = setInterval(refreshConnection, 10000);
    return () => { mounted = false; clearInterval(timer); chrome.storage.onChanged.removeListener(listener); };
  }, []);
  useEffect(() => { reset(); }, [scope]);
  useEffect(() => {
    let alive = true;
    const detect = async () => {
      try { const value = await rpc('PROSPECT_PROFILE'); if (alive) setCandidate(value?.linkedinUrl ? { ...value, linkedinUrl: normalizeLinkedinProfileUrl(value.linkedinUrl) } : null); }
      catch { if (alive) setCandidate(null); }
    };
    void detect();
    const timer = setInterval(detect, 1500); // LinkedIn may render the heading after its SPA URL changes.
    chrome.tabs.onActivated.addListener(detect);
    const update = (_id: number, change: any) => { if (change.url || change.status === 'complete') void detect(); };
    chrome.tabs.onUpdated.addListener(update);
    return () => { alive = false; clearInterval(timer); chrome.tabs.onActivated.removeListener(detect); chrome.tabs.onUpdated.removeListener(update); };
  }, []);

  const api = useCallback((action: string, extra: Record<string, unknown> = {}, selected = profileRef.current) => {
    if (!connection) return Promise.reject(new Error('Conecta tu cuenta para continuar.'));
    return rpc('PROSPECT_API', { organizationId: connection.session.organizationId, userId: connection.session.userId,
      body: { action, profile: selected, ...extra } });
  }, [connection]);

  const run = async (label: string, work: (valid: () => boolean) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(label); setError(''); setNotice('');
    const generation = epoch.current;
    const valid = () => generation === epoch.current;
    try { await work(valid); }
    catch (err: any) { if (valid()) setError(err.message); }
    finally { locked.current = false; setBusy(''); }
  };
  const selectProfile = async (input: Profile) => {
    if (locked.current || selecting.current) return;
    const linkedinUrl = normalizeLinkedinProfileUrl(input.linkedinUrl);
    if (!linkedinUrl) { setError('Introduce una URL de perfil como linkedin.com/in/nombre.'); return; }
    selecting.current = true;
    try {
    if (scope && profileRef.current.linkedinUrl) await chrome.storage.session.set({ [`prospect-profile:${scope}:${profileRef.current.linkedinUrl}`]: { profile: profileRef.current, dirty: dirty.current, baseUpdatedAt: saved?.updated_at } });
    dirty.current = false; setCachedEdits(null); setPhoneJob(null);
    epoch.current++; setEnrichedReady(false); setSaved(null); setResearch(null); setMessage(''); setSources([]); setComposeUrl(''); setCampaigns(null); setCampaignId(''); setConfirmSend(false); setSendState('');
    const selected = { ...empty, ...input, linkedinUrl };
    setProfile(selected); profileRef.current = selected; setUrl(linkedinUrl);
    setMessageOptions([]);
    const key = `prospect-draft:${scope}:${linkedinUrl.toLowerCase()}`;
    const localDraft = await chrome.storage.local.get(key);
    const legacyKey = `prospect-draft:${scope}:${linkedinUrl}`;
    const legacyDraft = await chrome.storage.session.get(legacyKey);
    const draft = localDraft[key] || legacyDraft[legacyKey];
    setMessage(draft?.message || ''); setSources(draft?.sources || []);
    setMessageOptions(draft?.options || (draft?.message ? [draft.message] : []));
    if (draft && !localDraft[key]) await chrome.storage.local.set({ [key]: draft });
    await run('Buscando en tu organización…', async valid => {
      const result = await api('lookup', {}, selected);
      if (!valid()) return;
      if (result.lead) { setSaved(result.lead); setProfile(fromRow(result.lead)); profileRef.current = fromRow(result.lead); }
      const cachedProfile = await chrome.storage.session.get(`prospect-profile:${scope}:${linkedinUrl}`);
      const cached = cachedProfile[`prospect-profile:${scope}:${linkedinUrl}`];
      const restored = restoreProfileEdits(result.lead, cached);
      if (valid() && restored.restored) { setProfile(restored.profile); profileRef.current = restored.profile; dirty.current = true; setEnrichedReady(true); }
      if (valid() && restored.conflict) setCachedEdits(cached.profile);
      const pending = await chrome.storage.local.get(`prospect-phone:${scope}:${linkedinUrl}`);
      if (valid()) setPhoneJob(pending[`prospect-phone:${scope}:${linkedinUrl}`] || null);
      if (result.lead) {
        const status = await api('research-status', {}, selected);
        if (valid()) setResearch(status.research);
      }
    });
    } catch (err: any) { setError(err.message || 'No pudimos recuperar el borrador guardado.'); } finally { selecting.current = false; }
  };
  useEffect(() => {
    if (connection && candidate && !busy && (!profile.linkedinUrl || (followProfile && candidate.linkedinUrl.toLowerCase() !== profile.linkedinUrl.toLowerCase()))) {
      const { tabId: _tabId, ...selected } = candidate;
      void selectProfile(selected);
    }
  }, [connection, candidate, profile.linkedinUrl, busy, followProfile]);
  // Save immediately on edits (not in an effect that could erase a restored draft).
  // Any edit closes the send confirmation so the user always confirms the final text.
  const writeMessage = (text: string, evidence = sources, options = messageOptions) => {
    setMessage(text); setSources(evidence); setConfirmSend(false); setSendState(''); setNotice(''); setError('');
    setMessageOptions(options);
    if (draftKey) void chrome.storage.local.set({ [draftKey.toLowerCase()]: { message: text, sources: evidence, options } });
  };
  useEffect(() => {
    if (!saved || !reportPending(research)) return;
    const generation = epoch.current;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || locked.current) return;
      polling = true;
      try { const result = await api('research-status'); if (epoch.current === generation) setResearch(result.research); }
      catch (err: any) { if (epoch.current === generation) setError(err.message); }
      finally { polling = false; }
    }, 6000);
    return () => clearInterval(timer);
  }, [saved?.id, research?.status, research?.researchSnapshotId, research?.reportSynthesisV2?.status, research?.reportVersion, api]);
  useEffect(() => {
    if (!phoneJob || !scope) return;
    let alive = true, polling = false;
    const generation = epoch.current;
    const poll = async () => {
      if (polling || locked.current) return;
      polling = true;
      try {
        const result = await api('phone-status', { enrichmentId: phoneJob.id });
        if (!alive || generation !== epoch.current) return;
        if (result.phone) {
          setProfile(previous => { const next = { ...previous, primaryPhone: previous.primaryPhone || result.phone }; profileRef.current = next; return next; });
          dirty.current = true; setNotice('Teléfono encontrado. Guarda los cambios del contacto.');
        }
        if (result.phone || !['pending_phone', 'pending', 'queued', 'processing'].includes(result.status)) {
          setPhoneJob(null); await chrome.storage.local.remove(`prospect-phone:${scope}:${phoneJob.profileUrl}`);
          if (!result.phone) setNotice('La consulta terminó sin un teléfono disponible.');
        }
      } catch (error: any) { if (alive) setError('No pudimos actualizar el teléfono pendiente. Conservamos la consulta para volver a comprobarla.'); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [phoneJob, scope, api]);

  const save = () => run('Guardando lead…', async valid => {
    const result = await api('save', { replaceFields: true }); if (!valid()) return;
    setProfile(fromRow(result.lead)); profileRef.current = fromRow(result.lead);
    dirty.current = false; setCachedEdits(null);
    await chrome.storage.session.remove(`prospect-profile:${scope}:${profile.linkedinUrl}`);
    setSaved(result.lead); setCampaigns(null); setCampaignId(''); setNotice('Lead guardado en tu organización.');
  });
  const enrich = () => run('Consultando datos…', async valid => {
    const wantsEmail = !profile.email && revealEmail;
    const wantsPhone = !profile.primaryPhone && (profile.email ? true : revealPhone);
    const key = `${scope}:${profile.linkedinUrl}:${wantsEmail}:${wantsPhone}`;
    if (enrichmentOperation.current.key !== key) enrichmentOperation.current = { key, id: crypto.randomUUID() };
    const result = await api('enrich', { revealEmail: wantsEmail, revealPhone: wantsPhone, operationId: enrichmentOperation.current.id });
    if (!valid()) return;
    const item = result.enriched?.find((item: any) => normalizeLinkedinProfileUrl(item.linkedinUrl || '').toLowerCase() === profile.linkedinUrl.toLowerCase());
    const lead = item ? { ...item, name: item.fullName, org_name: item.companyName, organization_domain: item.companyDomain, primary_phone: item.primaryPhone, email_status: item.emailStatus } : null;
    if (!lead) { setNotice('No encontramos una coincidencia confirmada. Puedes guardar los datos del perfil.'); return; }
    const enriched = { ...profile, fullName: lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || profile.fullName,
      title: lead.title || profile.title, companyName: lead.organization?.name || lead.org_name || profile.companyName,
      email: lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) ? lead.email : profile.email,
      companyDomain: lead.organization_domain || lead.organization?.domain || profile.companyDomain,
      primaryPhone: lead.primary_phone || profile.primaryPhone, emailStatus: wantsEmail ? lead.email_status || 'unknown' : profile.emailStatus,
      details: { ...profile.details, ...Object.fromEntries(Object.entries({ headline: item.headline, city: item.city, state: item.state, country: item.country, industry: item.industry, seniority: item.seniority, departments: item.departments, companySize: item.companySize }).filter(([, value]) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim())) } };
    setEnrichedReady(true); setProfile(enriched); profileRef.current = enriched; dirty.current = true;
    if (wantsPhone && !enriched.primaryPhone && ['pending_phone', 'pending', 'queued', 'processing'].includes(item.enrichmentStatus)) {
      const job = { id: item.id, profileUrl: profile.linkedinUrl };
      setPhoneJob(job); await chrome.storage.local.set({ [`prospect-phone:${scope}:${profile.linkedinUrl}`]: job });
    }
    setNotice([lead.primary_phone ? `Teléfono: ${lead.primary_phone}.` : '', 'Datos encontrados. Guarda para actualizar el lead.',
      ...(result.warnings || []).filter((item: unknown) => typeof item === 'string')].filter(Boolean).join(' '));
  });
  const investigate = () => run('Solicitando investigación…', async valid => {
    await api('research', { language, refreshResearch: ['insufficient_data', 'failed', 'partial'].includes(research?.status) }); if (!valid()) return;
    setResearch({ status: 'queued' }); setNotice('La investigación continuará aunque cierres el panel.');
  });
  const generate = (adjustment = '') => run('Redactando mensaje…', async valid => {
    const result = await api('message', { instruction: adjustment ? `${instruction}\nAjuste: ${adjustment}` : instruction, tone, language, previousMessage: message });
    if (valid()) { writeMessage(result.message, result.sources, [...new Set([...messageOptions, ...(message ? [message] : []), result.message])].slice(-8)); setNotice(result.sellerProfileIncomplete
      ? 'Borrador conversacional listo. Completa tu empresa y propuesta de valor en el perfil de Anton.IA para personalizar mejor lo que ofreces.'
      : result.personalized ? 'Mensaje breve para LinkedIn, basado en el análisis del contacto.' : 'Mensaje basado en el perfil. Investiga para añadir un motivo más específico.'); }
  });
  const generateOptions = () => run('Creando opciones de mensaje…', async valid => {
    let options = [...new Set([...messageOptions, ...(message ? [message] : [])])];
    for (const angle of ['Una pregunta breve sobre sus prioridades.', 'Un enfoque consultivo sobre un reto de su rol.', 'Un inicio cercano basado en un hecho verificable.']) {
      const result = await api('message', { instruction: `${instruction}\nEnfoque: ${angle}\nEvita repetir estas opciones: ${options.join('\n')}`, tone, language, previousMessage: message });
      options = [...new Set([...options, result.message])].slice(-8);
      if (valid()) writeMessage(result.message, result.sources, options);
    }
    if (valid()) setNotice('Opciones guardadas. Puedes alternar entre ellas sin volver a usar IA.');
  });
  const prepare = () => run('Preparando en LinkedIn…', async valid => {
    if (!candidate || normalizeLinkedinProfileUrl(candidate.linkedinUrl).toLowerCase() !== profile.linkedinUrl.toLowerCase()) throw new Error('Abre el perfil de este lead en LinkedIn antes de preparar el mensaje.');
    const result = await rpc('PROSPECT_PREPARE', { tabId: candidate.tabId, profileUrl: profile.linkedinUrl, fullName: candidate.fullName || profile.fullName, message });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo preparar. Usa Copiar mensaje.');
    if (valid()) setNotice(result.message);
  });
  const sendAutomatically = () => run('Enviando en LinkedIn…', async valid => {
    if (!candidate || normalizeLinkedinProfileUrl(candidate.linkedinUrl).toLowerCase() !== profile.linkedinUrl.toLowerCase()) throw new Error('Abre el perfil de este lead en LinkedIn antes de enviar el mensaje.');
    const text = message.trim();
    if (!text) throw new Error('Redacta un mensaje antes de enviarlo.');
    if (text.length > 1200) throw new Error('El mensaje admite hasta 1200 caracteres.');
    setConfirmSend(false);
    const response = await rpc('PROSPECT_SEND', { confirmed: true, tabId: candidate.tabId,
      organizationId: connection!.session.organizationId, userId: connection!.session.userId, profileUrl: profile.linkedinUrl, fullName: candidate.fullName || profile.fullName, message: text });
    if (valid()) setSendState(response.status);
    if (response.status !== 'confirmed') throw new Error(response.error || 'Envío por comprobar. Revisa LinkedIn; no se reenviará automáticamente.');
    if (valid()) setNotice(response.duplicate ? 'Este mensaje ya está registrado como enviado. No lo reenviamos.' : response.synced
      ? 'Mensaje confirmado en LinkedIn y guardado en el historial del contacto.'
      : 'Mensaje confirmado en LinkedIn. Pulsa Sincronizar historial para guardar el resultado en Anton.IA.');
  });
  const email = (sequence: boolean) => run(sequence ? 'Creando secuencia y borradores…' : 'Creando primer correo…', async valid => {
    const days = offsets.split(',').map(value => Number(value.trim()));
    if (sequence && (days.length > 4 || days.some((n, i) => !Number.isInteger(n) || n < 1 || n > 365 || (i > 0 && n <= days[i - 1])))) throw new Error('Escribe de 1 a 4 días crecientes, por ejemplo: 3, 7.');
    const result = await api(sequence ? 'sequence' : 'email-draft', { instruction, ...(sequence ? { offsets: days } : {}) });
    if (valid()) { setComposeUrl(result.composeUrl); setNotice(sequence ? 'Secuencia guardada. Revisa los correos en la app antes de activarla.' : 'Primer correo guardado. Puedes revisarlo en la app.'); }
  });
  const field = (key: Exclude<keyof Profile, 'details'>, label: string, type = 'text') => <label className="field">{label}<input type={type} value={profile[key]} maxLength={key === 'title' ? 500 : key === 'primaryPhone' ? 100 : 300} onChange={event => { dirty.current = true; setProfile(p => ({ ...p, [key]: event.target.value, ...(key === 'email' ? { emailStatus: 'unknown' } : {}) })); }} /></label>;
  const differentProfile = candidate && candidate.linkedinUrl.toLowerCase() !== profile.linkedinUrl.toLowerCase();
  const professionalRows = [
    ['Ubicación', [profile.details?.city, profile.details?.state, profile.details?.country].filter(Boolean).join(', ')],
    ['Titular', profile.details?.headline], ['Nivel de responsabilidad', profile.details?.seniority],
    ['Departamentos', profile.details?.departments?.join(', ')], ['Industria', profile.details?.industry], ['Tamaño de empresa', profile.details?.companySize],
  ].filter(([, value]) => value?.trim());
  const loadJobs = () => run('Consultando trabajos…', async valid => {
    const result = await api('linkedin-jobs-pending', {}, profileRef.current);
    if (valid()) setJobs(result.jobs || []);
  });
  const executeJob = (job: any) => run(job.kind === 'invite' ? 'Enviando invitación…' : 'Enviando mensaje…', async valid => {
    if (!candidate || normalizeLinkedinProfileUrl(candidate.linkedinUrl).toLowerCase() !== normalizeLinkedinProfileUrl(profile.linkedinUrl).toLowerCase()) throw new Error('Abre el perfil del trabajo en LinkedIn antes de ejecutarlo.');
    const result = await rpc('PROSPECT_EXECUTE_JOB', { jobId: job.id, tabId: candidate.tabId });
    if (valid()) {
      setJobs(items => (items || []).filter(item => item.id !== job.id));
      setNotice(result?.status === 'confirmed' ? 'Trabajo confirmado en LinkedIn.' : 'Resultado por comprobar en LinkedIn; no se reintentará solo.');
    }
    if (result?.status !== 'confirmed') throw new Error(result?.error || 'Revisa LinkedIn antes de continuar.');
  });
  const loadCampaigns = () => run('Consultando campañas…', async valid => {
    const result = await api('campaigns');
    if (valid()) { setCampaigns(result.campaigns); setCampaignId(''); }
  });
  const addToCampaign = () => run('Añadiendo a la campaña…', async valid => {
    const selected = campaigns?.find(item => item.id === campaignId);
    if (!selected) throw new Error('Selecciona una campaña.');
    const result = await api('campaign-add', { campaignId, campaignRevision: selected.revision });
    if (!valid()) return;
    setCampaigns(items => items?.map(item => item.id === campaignId ? { ...item, alreadyAdded: true, revision: result.revision } : item) || null);
    setNotice(result.alreadyAdded ? 'Este lead ya está en la campaña.' : 'Lead añadido. Revisa y aprueba la campaña desde la app para iniciar los envíos.');
  });

  return <div className="shell">
    <header className="brand"><img className="brand-logo" src="icon.png" alt="Logo de Anton.IA" /><div><strong>Anton.IA</strong><span className="eyebrow">LINKEDIN WORKSPACE</span></div>
      {connection && <button className="icon-button" aria-label="Desconectar cuenta" title="Desconectar cuenta" disabled={!!busy} onClick={() => void run('Desconectando…', async () => { await rpc('PROSPECT_DISCONNECT'); setConnection(null); reset(); })}><LogOut size={17} /></button>}
    </header>
    <main>
      {booting ? <div className="empty"><Loader2 className="spin" aria-hidden="true" /><h1>Abriendo tu espacio…</h1></div> : !connection ? <section className="welcome">
        <div className="welcome-symbol"><Sparkles size={30} aria-hidden="true" /></div><p className="eyebrow accent">MENOS PESTAÑAS. MÁS CONTEXTO.</p>
        <h1>Tu próximo contacto,<br />con una ventaja.</h1><p>Guarda perfiles, descubre qué les importa y encuentra las palabras para empezar.</p>
        <div className="welcome-list"><span><UserRound size={17} />Leads conectados a tu app</span><span><Search size={17} />Investigación con fuentes</span><span><Sparkles size={17} />Mensajes con contexto</span></div>
        <button className="primary full" disabled={!!busy} onClick={() => void run('Abriendo Anton.IA…', async () => { await rpc('PROSPECT_CONNECT', { origin }); setConnecting(true); })}>Conectar Anton.IA<ArrowUpRight size={17} /></button>
        {connecting && <p role="status" className="helper">Confirma «Conectar mi cuenta» en la pestaña de la app.</p>}
        <details className="connection-options"><summary>Dirección de la app</summary><label className="field">Servidor<select value={origin} onChange={event => setOrigin(event.target.value)}>
          <option value="https://studio--leadflowai-3yjcy.us-central1.hosted.app">Anton.IA · producción</option><option value="https://app.antonia.ai">app.antonia.ai</option>
          {chrome.runtime.getManifest().host_permissions.some((item: string) => item.includes('localhost')) && <><option value="http://localhost:9003">Local · puerto 9003</option><option value="http://localhost:3000">Local · puerto 3000</option></>}
        </select></label></details>
      </section> : <>
        <div className="workspace"><span className="dot" /><span>{connection.session.organizationName}</span><span className="account" title={connection.session.email}>{connection.session.email}</span></div>
        <label className="helper"><input type="checkbox" checked={followProfile} onChange={event => setFollowProfile(event.target.checked)} /> Seguir el perfil abierto en LinkedIn</label>
        {differentProfile && <button className="context-switch" disabled={!!busy} onClick={() => { const { tabId: _tabId, ...selected } = candidate; void selectProfile(selected); }}>Usar perfil abierto: {candidate.fullName || 'LinkedIn'}<ChevronRight size={16} /></button>}
        <form className="url-form" onSubmit={event => { event.preventDefault(); setFollowProfile(false); void selectProfile({ ...empty, linkedinUrl: url }); }}>
          <label htmlFor="profile-url">URL de LinkedIn</label><div className="input-action"><Link2 size={16} aria-hidden="true" /><input id="profile-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="linkedin.com/in/nombre" disabled={!!busy} /><button className="icon-button" disabled={!!busy || !url.trim()} aria-label="Buscar perfil"><ArrowUpRight size={18} /></button></div>
        </form>
        {!profile.linkedinUrl ? <section className="empty"><UserRound size={30} aria-hidden="true" /><h1>Empieza por una persona.</h1><p>Abre su perfil de LinkedIn o pega su URL aquí arriba.</p></section> : <>
          <section className="identity"><div className="avatar" aria-hidden="true">{profile.fullName ? profile.fullName.split(/\s+/).slice(0, 2).map(n => n[0]).join('') : <UserRound size={24} />}</div><div><h1>{profile.fullName || 'Perfil de LinkedIn'}</h1><p>{profile.title || 'Completa el cargo o enriquece el perfil'}</p>{profile.companyName && <span>{profile.companyName}</span>}</div></section>
          <div className="saved-state">{saved ? <><Check size={14} />Guardado en tu organización<button onClick={() => void run('Abriendo app…', async () => { await rpc('PROSPECT_OPEN', { path: '/saved/leads/enriched' }); })} aria-label="Abrir leads en la app"><ExternalLink size={14} /></button></> : 'Aún no guardado'}</div>
          <nav className="tabs" aria-label="Vistas del lead">{[['profile', 'Perfil'], ['research', 'Investigación'], ['contact', 'Contactar']].map(([id, name]) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{name}</button>)}</nav>
          <fieldset className="content" disabled={!!busy}>
            {view === 'profile' && <section aria-label="Datos del lead">
              {!saved && !enrichedReady ? <div className="enrichment-first"><h2>Descubre los datos de este perfil</h2><p>Enriquece el perfil para obtener sus datos profesionales y guardarlo en Anton.IA.</p><div className="checks"><label><input type="checkbox" checked={revealEmail} onChange={e => setRevealEmail(e.target.checked)} />Email</label><label><input type="checkbox" checked={revealPhone} onChange={e => setRevealPhone(e.target.checked)} />Teléfono</label></div><button className="primary full" onClick={enrich}><Sparkles size={16} />Enriquecer perfil</button><p className="helper">La consulta utiliza los créditos disponibles de tu cuenta.</p><button className="text-button" onClick={() => setEnrichedReady(true)}>Completar datos manualmente</button></div> : <>
              <div className="section-heading"><h2>Información de contacto</h2><UserRound size={16} aria-hidden="true" /></div>
              {field('fullName', 'Nombre')}{field('title', 'Cargo')}{field('companyName', 'Empresa')}{field('email', 'Email profesional', 'email')}{field('primaryPhone', 'Teléfono', 'tel')}{field('companyDomain', 'Dominio de empresa')}
              {cachedEdits && <div className="helper"><p>Este contacto cambió en Anton.IA. Se muestran los datos actuales; tus ediciones anteriores siguen disponibles.</p><button className="text-button" onClick={() => { setProfile(cachedEdits); profileRef.current = cachedEdits; dirty.current = true; setCachedEdits(null); }}>Recuperar mis ediciones para revisarlas</button><button className="text-button" onClick={() => { setCachedEdits(null); void chrome.storage.session.remove(`prospect-profile:${scope}:${profile.linkedinUrl}`); }}>Conservar datos actuales</button></div>}
              <p className="helper">Estado del correo: {profile.emailStatus === 'verified' ? 'Verificado por proveedor' : profile.emailStatus === 'unknown' ? 'Sin verificación confirmada' : profile.emailStatus}</p>
              {professionalRows.length > 0 && <details><summary>Más información profesional</summary><dl className="profile-details">{professionalRows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></details>}
              <button className="primary full" onClick={save}>{saved ? 'Guardar cambios' : 'Guardar lead'}<Check size={16} /></button>
              {(!profile.email || !profile.primaryPhone) && <div className="enrichment"><h2>{profile.email ? 'Completar teléfono' : 'Completar datos faltantes'}</h2>
                {!profile.email && <div className="checks"><label><input type="checkbox" checked={revealEmail} onChange={e => setRevealEmail(e.target.checked)} />Email</label>{!profile.primaryPhone && <label><input type="checkbox" checked={revealPhone} onChange={e => setRevealPhone(e.target.checked)} />Teléfono</label>}</div>}
                <button className="secondary full" disabled={!!phoneJob || (!profile.email && !revealEmail && (!revealPhone || !!profile.primaryPhone))} onClick={enrich}><Sparkles size={16} />{phoneJob ? 'Teléfono pendiente…' : profile.email ? 'Buscar teléfono' : 'Buscar datos faltantes'}</button><p className="helper">{phoneJob ? 'Actualizaremos el resultado sin repetir la consulta. Puedes cerrar y volver a este contacto.' : 'La consulta puede consumir créditos. La disponibilidad del teléfono depende del proveedor.'}</p></div>}
            </>} </section>}
            {view === 'research' && <section aria-label="Investigación del lead">
              <div className="section-heading"><h2>Un motivo para conectar.</h2><Search size={16} aria-hidden="true" /></div>
              {!research ? <div className="research-intro"><p>Descubre señales de negocio y hechos que te ayuden a iniciar una conversación relevante.</p><ul><li>Contexto de la empresa</li><li>Hallazgos con fuentes</li><li>Ángulos de contacto</li></ul></div> : <>
                <p className="research-state">{reportPending(research) && <Loader2 size={16} className="spin" />} {reportStatusLabel(research)}</p>
                {reportReady(research) && <div className="evidence">{research.reportDocumentV2.sections.map((section: any) => <article key={section.key}><h3>{section.title}</h3>{section.paragraphs.map((paragraph: any, i: number) => <p key={i}>{paragraph.text}</p>)}{(section.blocks || []).map((block: any, i: number) => <div key={i}>{blockLines(block).map((line: string, j: number) => <p key={j}>{line}</p>)}</div>)}</article>)}</div>}
                {!reportReady(research) && researchFindings(research).length > 0 && <div className="evidence"><h3>Información recopilada</h3><p className="helper">Extractos de las fuentes encontradas. Pueden incluir empleos anteriores u otras personas; el informe comercial aún no ha sido validado.</p>{researchFindings(research).map((finding: any, i: number) => <article key={i}><p>{finding.text}</p>{finding.url && <a href={finding.url} target="_blank" rel="noopener noreferrer">Consultar fuente <ExternalLink size={14} /></a>}</article>)}</div>}
                {research.errorCode && <p className="helper">{research.errorCode}</p>}
              </>}
              {research && !reportReady(research) && <p className="helper">Puedes leer lo recopilado aquí sin investigar de nuevo. El informe y su PDF estarán disponibles cuando termine la revisión de las fuentes.</p>}
              {research?.reportSynthesisV2?.retryable && <button className="secondary full" onClick={() => void run('Retomando informe…', async valid => { await api('research-retry'); if (valid()) setResearch((previous: any) => ({ ...previous, reportSynthesisV2: { status: 'queued' } })); })}>Reintentar preparación del informe</button>}
              <p className="helper">La investigación se conserva en Anton.IA. Descarga el PDF cuando lo necesites.</p>
              {reportReady(research) && <button className="primary full" onClick={() => void run('Preparando PDF…', async () => { downloadResearchPdf(profile, research); setNotice('Descarga del PDF iniciada.'); })}>Descargar PDF</button>}
              <button className={reportReady(research) ? 'secondary full' : 'primary full'} disabled={!saved || !connection.session.researchEnabled || reportPending(research)} onClick={investigate}><Sparkles size={16} />{research ? 'Investigar de nuevo' : 'Investigar lead'}</button>
              {!saved && <p className="helper">Guarda el lead para iniciar la investigación.</p>}{!connection.session.researchEnabled && <p className="helper">La investigación no está habilitada en esta cuenta.</p>}
              {research && <button className="text-button" onClick={() => void run('Actualizando…', async valid => { const result = await api('research-status'); if (valid()) setResearch(result.research); })}>Actualizar estado</button>}
            </section>}
            {view === 'contact' && <section aria-label="Contactar al lead">
              <div className="section-heading"><h2>Abre una conversación.</h2><Sparkles size={16} aria-hidden="true" /></div>
              <label className="field">¿Qué quieres conseguir?<textarea rows={3} value={instruction} maxLength={900} onChange={event => setInstruction(event.target.value)} /></label>
              <div className="columns"><label className="field">Tono<select value={tone} onChange={e => setTone(e.target.value)}><option value="profesional">Profesional</option><option value="cercano">Cercano</option><option value="directo">Directo</option></select></label><label className="field">Idioma<select value={language} onChange={e => setLanguage(e.target.value)}><option value="es">Español</option><option value="en">English</option><option value="pt">Português</option></select></label></div>
              <button className={message ? 'secondary full' : 'primary full'} disabled={!saved || !instruction.trim()} onClick={() => void generate()}><Sparkles size={16} />{message ? 'Generar otra versión' : 'Redactar mensaje de LinkedIn'}</button>
              {!saved && <p className="helper">Guarda el lead antes de redactar.</p>}
              <button className="secondary full" disabled={!saved || !instruction.trim()} onClick={() => void generateOptions()}>Crear 3 opciones con IA</button>
              {messageOptions.length > 1 && <label className="field">Opciones guardadas<select value={messageOptions.indexOf(message)} onChange={event => { const next = messageOptions[Number(event.target.value)]; if (next) writeMessage(next, sources, [...new Set([...messageOptions, message])].slice(-8)); }}><option value={-1} disabled>Borrador editado</option>{messageOptions.map((text, index) => <option key={index} value={index}>Opción {index + 1} · {text.slice(0, 65)}…</option>)}</select></label>}
              {message && <div className="message-editor"><label className="field">Mensaje de LinkedIn<textarea rows={9} maxLength={1200} value={message} onChange={event => writeMessage(event.target.value)} /></label><div className="editor-meta"><span>{message.length}/1200</span><button className="text-button" onClick={() => void generate('Hazlo más breve.')}>Más breve</button><button className="text-button" onClick={() => void generate('Usa un tono más cercano.')}>Más cercano</button></div>
                <button className="secondary full" disabled={!message.trim()} onClick={prepare}>Preparar en LinkedIn<ArrowUpRight size={16} /></button><button className="secondary full" onClick={() => void run('Copiando…', async valid => { await navigator.clipboard.writeText(message); if (valid()) setNotice('Mensaje copiado.'); })}><Copy size={16} />Copiar mensaje</button><p className="helper">Preparar deja el texto en LinkedIn para que lo envíes tú.</p>
                {!confirmSend
                  ? <button ref={sendTriggerRef} className="primary full" disabled={!message.trim() || !!sendState} onClick={() => setConfirmSend(true)}><Send size={16} />{sendState === 'confirmed' ? 'Mensaje enviado' : sendState ? 'Revisa el intento en LinkedIn' : 'Revisar y enviar'}</button>
                  : <section ref={sendConfirmRef} tabIndex={-1} className="send-confirm" aria-label="Confirmar envío automático" onKeyDown={event => { if (event.key === 'Escape') { setConfirmSend(false); setTimeout(() => sendTriggerRef.current?.focus(), 0); } }}>
                      <p><strong>{profile.fullName || 'Este perfil'}</strong></p>
                      <p className="helper">{profile.linkedinUrl}</p>
                      <p className="send-preview">{message.trim()}</p>
                      <p className="helper">Se enviará ahora desde la sesión abierta en LinkedIn ({message.trim().length}/1200). Comprueba tu cuenta en LinkedIn antes de confirmar.</p>
                      <button className="primary full" disabled={!message.trim() || message.trim().length > 1200} onClick={() => void sendAutomatically()}>Confirmar envío<Send size={16} /></button>
                      <button className="text-button" onClick={() => { setConfirmSend(false); setTimeout(() => sendTriggerRef.current?.focus(), 0); }}>Volver</button>
                    </section>}
                {sources.length > 0 && <details><summary>Fuentes de personalización</summary>{sources.map((source, i) => <p key={i} className="helper">{source.statement}</p>)}</details>}
              </div>}
              <button className="text-button" onClick={() => void run('Sincronizando historial…', async valid => {
                const result = await rpc('PROSPECT_SYNC_SENDS', { organizationId: connection.session.organizationId, userId: connection.session.userId });
                if (valid()) setNotice(result.count ? 'Historial actualizado. Los envíos interrumpidos quedan por comprobar; no se reenvían.' : 'No hay resultados pendientes de sincronizar.');
              })}>Sincronizar historial de LinkedIn</button>
              <div className="email-section"><div className="section-heading"><h2>Trabajos de Cowork</h2><ChevronRight size={16} /></div>
                <p>Invitaciones y mensajes aprobados en el chat para este perfil. Se ejecutan aquí, ante el perfil verificado.</p>
                <button className="secondary full" disabled={!saved} onClick={loadJobs}>{jobs ? 'Actualizar trabajos' : 'Ver trabajos pendientes'}</button>
                {!saved && <p className="helper">Guarda el lead para ver sus trabajos.</p>}
                {!!jobs?.length && jobs.filter(item => !item.expired).map(item => <div key={item.id} className="helper">
                  <p><strong>{item.kind === 'invite' ? 'Invitación sin nota' : 'Mensaje'}</strong> · en cola desde {String(item.created_at || '').slice(0, 10)}</p>
                  <button className="secondary full" disabled={!candidate} onClick={() => void executeJob(item)}>Ejecutar ante este perfil</button>
                </div>)}
                {jobs && !jobs.filter(item => !item.expired).length && <p className="helper">Sin trabajos pendientes para este perfil.</p>}
              </div>
              <div className="email-section"><div className="section-heading"><h2>Seguimiento por email</h2><Mail size={16} /></div><p>Prepara el primer correo y una secuencia personalizada en Anton.IA.</p>
                <details><summary>Añadir a una campaña existente</summary>
                  <button className="secondary full" disabled={!saved?.email} onClick={loadCampaigns}>{campaigns ? 'Actualizar campañas' : 'Buscar mis campañas'}</button>
                  {!saved?.email && <p className="helper">Guarda un email válido para añadir este lead.</p>}
                  {campaigns?.length === 0 && <p className="helper">Todavía no tienes campañas. Crea una en la app o prepara una secuencia personalizada aquí.</p>}
                  {!!campaigns?.length && <>
                    <label className="field" htmlFor="existing-campaign">Campaña</label><select id="existing-campaign" value={campaignId} onChange={event => setCampaignId(event.target.value)}><option value="">Selecciona una campaña</option>{campaigns.map(item => <option key={item.id} value={item.id} disabled={!item.editable && !item.alreadyAdded}>{item.name} · {item.alreadyAdded ? 'Lead incluido' : item.editable ? `${item.recipientCount} contactos` : 'Aprobada o pausada'}</option>)}</select>
                    <button className="secondary full" disabled={!campaignId || campaigns.find(item => item.id === campaignId)?.alreadyAdded} onClick={addToCampaign}>Añadir lead a la campaña<ChevronRight size={16} /></button>
                    <p className="helper">Solo se pueden ampliar campañas pendientes de aprobación. Se mantienen sus filtros y mensajes.</p>
                  </>}
                </details>
                <label className="field">Días de seguimiento<input value={offsets} onChange={e => setOffsets(e.target.value)} placeholder="3, 7" /><span className="helper">Días después del primer envío. Hasta 4 seguimientos.</span></label>
                <button className="secondary full" disabled={!saved || !saved.email || !research?.researchSnapshotId || !connection.session.sequencesEnabled || !instruction.trim()} onClick={() => void email(true)}>Crear secuencia de email<ChevronRight size={16} /></button>
                <button className="text-button" disabled={!saved?.email || !research?.researchSnapshotId} onClick={() => void email(false)}>Crear solo el primer correo</button>
                {(!saved?.email || !research?.researchSnapshotId) && <p className="helper">Necesitas un email guardado y una investigación lista para generar los correos.</p>}
                {!connection.session.sequencesEnabled && <p className="helper">Las secuencias de seguimiento no están habilitadas en esta organización.</p>}
                {composeUrl && <button className="primary full" onClick={() => void run('Abriendo correo…', async () => { await rpc('PROSPECT_OPEN', { path: composeUrl }); })}>Revisar correos en la app<ExternalLink size={16} /></button>}
              </div>
            </section>}
          </fieldset>
        </>}
      </>}
    </main>
    {(busy || error || notice) && <footer className="feedback" aria-live="polite" aria-atomic="true">{busy ? <p><Loader2 size={16} className="spin" />{busy}</p> : error ? <p className="error" role="alert">{error}</p> : <p><Check size={16} />{notice}</p>}</footer>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
