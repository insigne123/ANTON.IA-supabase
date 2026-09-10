import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Check, ChevronRight, Copy, ExternalLink, Link2, Loader2, LogOut, Mail, Search, Sparkles, UserRound } from 'lucide-react';
import { canonicalExtensionProfileUrl as normalizeLinkedinProfileUrl } from '../../src/lib/extension-profile-url';
import './panel.css';

declare const chrome: any;
type Profile = { linkedinUrl: string; fullName: string; title: string; companyName: string; email: string; companyDomain: string; primaryPhone: string; emailStatus: string };
type Connection = { origin: string; session: { userId: string; organizationId: string; organizationName: string; email: string; researchEnabled: boolean; sequencesEnabled: boolean } };
const empty: Profile = { linkedinUrl: '', fullName: '', title: '', companyName: '', email: '', companyDomain: '', primaryPhone: '', emailStatus: 'unknown' };
const labels: Record<string, string> = { queued: 'En cola', running: 'Investigando…', completed: 'Investigación lista', partial: 'Investigación parcial', insufficient_data: 'Faltan datos para investigar', failed: 'No se pudo completar', cancelled: 'Investigación cancelada' };
const fromRow = (row: any): Profile => ({ linkedinUrl: normalizeLinkedinProfileUrl(row.linkedin_url), fullName: row.full_name || '', title: row.title || '', companyName: row.company_name || '', email: row.email || '', companyDomain: row.organization_domain || row.data?.companyDomain || '', primaryPhone: row.primary_phone || '', emailStatus: row.email_status || 'unknown' });
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
  const [sources, setSources] = useState<any[]>([]);
  const [instruction, setInstruction] = useState('Iniciar una conversación y proponer una reunión breve.');
  const [language, setLanguage] = useState('es');
  const [tone, setTone] = useState('profesional');
  const [offsets, setOffsets] = useState('3, 7');
  const [revealEmail, setRevealEmail] = useState(true);
  const [revealPhone, setRevealPhone] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [composeUrl, setComposeUrl] = useState('');
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
    setEnrichedReady(false);
    setCampaigns(null); setCampaignId('');
    epoch.current++; setProfile(empty); setUrl(''); setSaved(null); setResearch(null); setMessage(''); setSources([]); setComposeUrl(''); setNotice(''); setError('');
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
    const listener = (changes: any, area: string) => { if (area === 'session' && changes.prospectConnection) void refreshConnection(); };
    chrome.storage.onChanged.addListener(listener);
    const timer = setInterval(refreshConnection, 10000);
    return () => { mounted = false; clearInterval(timer); chrome.storage.onChanged.removeListener(listener); };
  }, []);
  useEffect(() => { reset(); }, [scope]);
  useEffect(() => {
    let alive = true;
    const detect = async () => {
      try { const value = await rpc('PROSPECT_PROFILE'); if (alive) setCandidate(value?.linkedinUrl ? value : null); }
      catch { if (alive) setCandidate(null); }
    };
    void detect();
    chrome.tabs.onActivated.addListener(detect);
    const update = (_id: number, change: any) => { if (change.url || change.status === 'complete') void detect(); };
    chrome.tabs.onUpdated.addListener(update);
    return () => { alive = false; chrome.tabs.onActivated.removeListener(detect); chrome.tabs.onUpdated.removeListener(update); };
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
    if (locked.current) return;
    const linkedinUrl = normalizeLinkedinProfileUrl(input.linkedinUrl);
    if (!linkedinUrl) { setError('Introduce una URL de perfil como linkedin.com/in/nombre.'); return; }
    epoch.current++; setEnrichedReady(false); setSaved(null); setResearch(null); setMessage(''); setSources([]); setComposeUrl(''); setCampaigns(null); setCampaignId('');
    const selected = { ...empty, ...input, linkedinUrl };
    setProfile(selected); profileRef.current = selected; setUrl(linkedinUrl);
    await run('Buscando en tu organización…', async valid => {
      const result = await api('lookup', {}, selected);
      if (!valid()) return;
      if (result.lead) { setSaved(result.lead); setProfile(fromRow(result.lead)); profileRef.current = fromRow(result.lead); }
      const key = `prospect-draft:${scope}:${linkedinUrl}`;
      const storage = await chrome.storage.session.get(key);
      if (valid()) { setMessage(storage[key]?.message || ''); setSources(storage[key]?.sources || []); }
      if (result.lead) {
        const status = await api('research-status', {}, selected);
        if (valid()) setResearch(status.research);
      }
    });
  };
  useEffect(() => {
    if (connection && candidate && !profile.linkedinUrl && !busy) {
      const { tabId: _tabId, ...selected } = candidate;
      void selectProfile(selected);
    }
  }, [connection, candidate, profile.linkedinUrl, busy]);
  // Save immediately on edits (not in an effect that could erase a restored draft).
  const writeMessage = (text: string, evidence = sources) => {
    setMessage(text); setSources(evidence);
    if (draftKey) void chrome.storage.session.set({ [draftKey]: { message: text, sources: evidence } });
  };
  useEffect(() => {
    if (!saved || !['queued', 'running'].includes(research?.status)) return;
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
  }, [saved?.id, research?.status, api]);

  const save = () => run('Guardando lead…', async valid => {
    const result = await api('save'); if (!valid()) return;
    setSaved(result.lead); setCampaigns(null); setCampaignId(''); setNotice('Lead guardado en tu organización.');
  });
  const enrich = () => run('Consultando datos…', async valid => {
    const key = `${scope}:${profile.linkedinUrl}:${revealEmail}:${revealPhone}`;
    if (enrichmentOperation.current.key !== key) enrichmentOperation.current = { key, id: crypto.randomUUID() };
    const result = await api('enrich', { revealEmail, revealPhone, operationId: enrichmentOperation.current.id });
    if (!valid()) return;
    const item = result.enriched?.find((item: any) => normalizeLinkedinProfileUrl(item.linkedinUrl || '').toLowerCase() === profile.linkedinUrl.toLowerCase());
    const lead = item ? { ...item, name: item.fullName, org_name: item.companyName, organization_domain: item.companyDomain, primary_phone: item.primaryPhone, email_status: item.emailStatus } : null;
    if (!lead) { setNotice('No encontramos una coincidencia confirmada. Puedes guardar los datos del perfil.'); return; }
    const enriched = { ...profile, fullName: lead.name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || profile.fullName,
      title: lead.title || profile.title, companyName: lead.organization?.name || lead.org_name || profile.companyName,
      email: lead.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) ? lead.email : profile.email,
      companyDomain: lead.organization_domain || lead.organization?.domain || profile.companyDomain,
      primaryPhone: lead.primary_phone || profile.primaryPhone, emailStatus: lead.email_status || 'unknown' };
    setEnrichedReady(true); setProfile(enriched); profileRef.current = enriched;
    setNotice([lead.primary_phone ? `Teléfono: ${lead.primary_phone}.` : '', 'Datos encontrados. Guarda para actualizar el lead.',
      ...(result.warnings || []).filter((item: unknown) => typeof item === 'string')].filter(Boolean).join(' '));
  });
  const investigate = () => run('Solicitando investigación…', async valid => {
    await api('research', { language }); if (!valid()) return;
    setResearch({ status: 'queued' }); setNotice('La investigación continuará aunque cierres el panel.');
  });
  const generate = (adjustment = '') => run('Redactando mensaje…', async valid => {
    const result = await api('message', { instruction: adjustment ? `${instruction}\nAjuste: ${adjustment}` : instruction, tone, language, previousMessage: message });
    if (valid()) { writeMessage(result.message, result.sources); setNotice(result.personalized ? 'Borrador basado en los hechos de la investigación.' : 'Borrador basado en el perfil. Investiga para añadir más contexto.'); }
  });
  const prepare = () => run('Preparando en LinkedIn…', async valid => {
    if (!candidate || normalizeLinkedinProfileUrl(candidate.linkedinUrl).toLowerCase() !== profile.linkedinUrl.toLowerCase()) throw new Error('Abre el perfil de este lead en LinkedIn antes de preparar el mensaje.');
    const result = await rpc('PROSPECT_PREPARE', { tabId: candidate.tabId, profileUrl: profile.linkedinUrl, message });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo preparar. Usa Copiar mensaje.');
    if (valid()) setNotice(result.message);
  });
  const email = (sequence: boolean) => run(sequence ? 'Creando secuencia y borradores…' : 'Creando primer correo…', async valid => {
    const days = offsets.split(',').map(value => Number(value.trim()));
    if (sequence && (days.length > 4 || days.some((n, i) => !Number.isInteger(n) || n < 1 || n > 365 || (i > 0 && n <= days[i - 1])))) throw new Error('Escribe de 1 a 4 días crecientes, por ejemplo: 3, 7.');
    const result = await api(sequence ? 'sequence' : 'email-draft', { instruction, ...(sequence ? { offsets: days } : {}) });
    if (valid()) { setComposeUrl(result.composeUrl); setNotice(sequence ? 'Secuencia guardada. Revisa los correos en la app antes de activarla.' : 'Primer correo guardado. Puedes revisarlo en la app.'); }
  });
  const field = (key: keyof Profile, label: string, type = 'text') => <label className="field">{label}<input type={type} value={profile[key]} maxLength={key === 'title' ? 500 : key === 'primaryPhone' ? 100 : 300} onChange={event => setProfile(p => ({ ...p, [key]: event.target.value, ...(key === 'email' ? { emailStatus: 'unknown' } : {}) }))} /></label>;
  const differentProfile = candidate && candidate.linkedinUrl.toLowerCase() !== profile.linkedinUrl.toLowerCase();
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
        {differentProfile && <button className="context-switch" disabled={!!busy} onClick={() => { const { tabId: _tabId, ...selected } = candidate; void selectProfile(selected); }}>Usar perfil abierto: {candidate.fullName || 'LinkedIn'}<ChevronRight size={16} /></button>}
        <form className="url-form" onSubmit={event => { event.preventDefault(); void selectProfile({ ...empty, linkedinUrl: url }); }}>
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
              <button className="primary full" onClick={save}>{saved ? 'Guardar cambios' : 'Guardar lead'}<Check size={16} /></button>
              <div className="enrichment"><h2>Completar datos</h2><p>Busca datos profesionales asociados a esta URL.</p><div className="checks"><label><input type="checkbox" checked={revealEmail} onChange={e => setRevealEmail(e.target.checked)} />Email</label><label><input type="checkbox" checked={revealPhone} onChange={e => setRevealPhone(e.target.checked)} />Teléfono</label></div>
                <button className="secondary full" onClick={enrich}><Sparkles size={16} />Enriquecer perfil</button><p className="helper">Esta consulta puede consumir créditos de tu cuenta. El teléfono puede quedar pendiente.</p></div>
            </>} </section>}
            {view === 'research' && <section aria-label="Investigación del lead">
              <div className="section-heading"><h2>Un motivo para conectar.</h2><Search size={16} aria-hidden="true" /></div>
              {!research ? <div className="research-intro"><p>Descubre señales de negocio y hechos que te ayuden a iniciar una conversación relevante.</p><ul><li>Contexto de la empresa</li><li>Hallazgos con fuentes</li><li>Ángulos de contacto</li></ul></div> : <>
                <p className="research-state">{['queued', 'running'].includes(research.status) && <Loader2 size={16} className="spin" />} {labels[research.status] || research.status}</p>
                {research.result?.angle && <p className="angle">{research.result.angle}</p>}
                <div className="evidence">{research.result?.evidence?.slice(0, 8).map((item: any, i: number) => <article key={item.id || i}><small>{item.kind === 'hypothesis' ? 'Hipótesis' : item.kind === 'signal' ? 'Señal' : 'Hallazgo'}</small><p>{item.statement}</p>{/^https?:\/\//.test(item.sourceUrl || '') && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Ver fuente<ArrowUpRight size={13} /></a>}</article>)}</div>
                {research.errorCode && <p className="helper">{research.errorCode}</p>}
              </>}
              <button className="primary full" disabled={!saved || !connection.session.researchEnabled || ['queued', 'running'].includes(research?.status)} onClick={investigate}><Sparkles size={16} />{research ? 'Consultar investigación' : 'Investigar lead'}</button>
              {!saved && <p className="helper">Guarda el lead para iniciar la investigación.</p>}{!connection.session.researchEnabled && <p className="helper">La investigación no está habilitada en esta cuenta.</p>}
              {research && <button className="text-button" onClick={() => void run('Actualizando…', async valid => { const result = await api('research-status'); if (valid()) setResearch(result.research); })}>Actualizar estado</button>}
            </section>}
            {view === 'contact' && <section aria-label="Contactar al lead">
              <div className="section-heading"><h2>Abre una conversación.</h2><Sparkles size={16} aria-hidden="true" /></div>
              <label className="field">¿Qué quieres conseguir?<textarea rows={3} value={instruction} maxLength={900} onChange={event => setInstruction(event.target.value)} /></label>
              <div className="columns"><label className="field">Tono<select value={tone} onChange={e => setTone(e.target.value)}><option value="profesional">Profesional</option><option value="cercano">Cercano</option><option value="directo">Directo</option></select></label><label className="field">Idioma<select value={language} onChange={e => setLanguage(e.target.value)}><option value="es">Español</option><option value="en">English</option><option value="pt">Português</option></select></label></div>
              <button className={message ? 'secondary full' : 'primary full'} disabled={!saved || !instruction.trim()} onClick={() => void generate()}><Sparkles size={16} />{message ? 'Generar otra versión' : 'Redactar mensaje de LinkedIn'}</button>
              {!saved && <p className="helper">Guarda el lead antes de redactar.</p>}
              {message && <div className="message-editor"><label className="field">Mensaje de LinkedIn<textarea rows={9} maxLength={1200} value={message} onChange={event => writeMessage(event.target.value)} /></label><div className="editor-meta"><span>{message.length}/1200</span><button className="text-button" onClick={() => void generate('Hazlo más breve.')}>Más breve</button><button className="text-button" onClick={() => void generate('Usa un tono más cercano.')}>Más cercano</button></div>
                <button className="primary full" disabled={!message.trim()} onClick={prepare}>Preparar en LinkedIn<ArrowUpRight size={16} /></button><button className="secondary full" onClick={() => void run('Copiando…', async valid => { await navigator.clipboard.writeText(message); if (valid()) setNotice('Mensaje copiado.'); })}><Copy size={16} />Copiar mensaje</button><p className="helper">Tú revisas el destinatario y pulsas Enviar en LinkedIn.</p>
                {sources.length > 0 && <details><summary>Fuentes de personalización</summary>{sources.map((source, i) => <p key={i} className="helper">{source.statement}</p>)}</details>}
              </div>}
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
