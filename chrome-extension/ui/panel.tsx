import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from 'framer-motion';
import {
  AlertTriangle, ArrowUpRight, Building2, Check, ChevronRight, Circle, Copy, Download, ExternalLink, Link2, Loader2, LogOut, Mail, RefreshCw, Search, Send,
  Sparkles, UserRound, Users, WifiOff,
} from 'lucide-react';
import { canonicalExtensionProfileUrl as normalizeLinkedinProfileUrl } from '../../src/lib/extension-profile-url';
import './panel.css';
import { downloadResearchPdf } from './research-pdf';
import { reportReady, reportPending, reportStatusLabel } from './research-state';
import { restoreProfileEdits } from './profile-cache';
import { researchFindings } from './research-findings';
import { blockLines } from './report-blocks';
import { personChips, personNextStep, researchSteps, type ChipTone, type NextStep } from './person-status';
import { BATCH_LIMIT, availableResults, batchSummary, chosenProfiles, type ResultPresence, type SearchResult } from './search-batch';
import { companyFacts, companyRequest, contactsHeading, emptyCompanyText, type CompanyPage, type CompanyView } from './company-card';

declare const chrome: any;
type ProfileDetails = { headline?: string; city?: string; state?: string; country?: string; industry?: string; seniority?: string; departments?: string[]; companySize?: string };
type Profile = { linkedinUrl: string; fullName: string; title: string; companyName: string; email: string; companyDomain: string; primaryPhone: string; emailStatus: string; details?: ProfileDetails };
type Connection = { origin: string; session: { userId: string; organizationId: string; organizationName: string; email: string; researchEnabled: boolean; sequencesEnabled: boolean } };
type Credits = { used: number; limit: number; remaining: number };
type View = 'summary' | 'research' | 'message' | 'more';
const empty: Profile = { linkedinUrl: '', fullName: '', title: '', companyName: '', email: '', companyDomain: '', primaryPhone: '', emailStatus: 'unknown' };
const fromRow = (row: any): Profile => ({ linkedinUrl: normalizeLinkedinProfileUrl(row.linkedin_url), fullName: row.full_name || '', title: row.title || '', companyName: row.company_name || '', email: row.email || '', companyDomain: row.organization_domain || row.data?.companyDomain || '', primaryPhone: row.primary_phone || '', emailStatus: row.email_status || 'unknown', details: row.data?.extensionDetails });
const TABS: Array<{ id: View; label: string }> = [{ id: 'summary', label: 'Resumen' }, { id: 'research', label: 'Investigación' }, { id: 'message', label: 'Mensaje' }, { id: 'more', label: 'Más' }];
const LOOKUP = 'Buscando en tu organización…';
// The panel was updated or reloaded while open: its messages no longer reach the extension.
const STALE = /Extension context invalidated|Receiving end does not exist|message port closed/i;
async function rpc(action: string, extra: Record<string, unknown> = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.ok) throw new Error(response?.error || 'La extensión no respondió. Recarga el panel.');
  return response.result;
}

// The app's palette in light and dark (design-tokens.css reads `html.dark`), following the system like the app does.
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => document.documentElement.classList.toggle('dark', darkScheme.matches);
applyScheme();
darkScheme.addEventListener('change', applyScheme);

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [candidate, setCandidate] = useState<(Profile & { tabId: number }) | null>(null);
  const [profile, setProfile] = useState<Profile>(empty);
  const [url, setUrl] = useState('');
  const [view, setView] = useState<View>('summary');
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
  const [sweepNetwork, setSweepNetwork] = useState<any[] | null>(null);
  const [sweepInbox, setSweepInbox] = useState<any[] | null>(null);
  const [sweepComplete, setSweepComplete] = useState(false);
  const [campaigns, setCampaigns] = useState<any[] | null>(null);
  const [campaignId, setCampaignId] = useState('');
  const [origin, setOrigin] = useState('https://studio--leadflowai-3yjcy.us-central1.hosted.app');
  const [connecting, setConnecting] = useState(false);
  const [booting, setBooting] = useState(true);
  const [credits, setCredits] = useState<Credits | null>(null);
  // What the organization knows of the open person (PR-4b), the same line the mark on LinkedIn shows.
  const [presence, setPresence] = useState<{ label: string; tone: ChipTone; blocks: boolean } | null>(null);
  // The LinkedIn search open in the active tab (PR-4c): its visible people, what the organization knows of each, the choice.
  const [searchPage, setSearchPage] = useState<{ results: SearchResult[]; salesNavigator: boolean } | null>(null);
  const [resultPresence, setResultPresence] = useState<Record<string, ResultPresence>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [presenceRound, setPresenceRound] = useState(0);
  // The LinkedIn company open in the active tab (PR-4d): what its page shows, and what the organization has of it, per request.
  const [companyPage, setCompanyPage] = useState<CompanyPage | null>(null);
  const [companyRead, setCompanyRead] = useState<{ ask: string; view: CompanyView | null; error: string } | null>(null);
  // The session ended without «Desconectar» (it expired or the account changed): the welcome says so.
  const [sessionLost, setSessionLost] = useState(false);
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const disconnecting = useRef(false);
  const tabRefs = useRef<Partial<Record<View, HTMLButtonElement | null>>>({});
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
    setSweepNetwork(null); setSweepInbox(null); setSweepComplete(false);
    epoch.current++; setPresence(null); setProfile(empty); setUrl(''); setSaved(null); setResearch(null); setMessage(''); setMessageOptions([]); setSources([]); setComposeUrl(''); setNotice(''); setError('');
  };
  // The last connection seen: one that disappears without «Desconectar» expired or changed account.
  const known = useRef<Connection | null>(null);
  useEffect(() => {
    let mounted = true;
    const refreshConnection = async () => {
      try {
        const current = await rpc('PROSPECT_SESSION');
        if (!mounted) return;
        setStale(false);
        if (known.current && !current) setSessionLost(true);
        if (current) { setConnecting(false); setSessionLost(false); }
        known.current = current;
        setConnection(previous => (JSON.stringify(previous) === JSON.stringify(current) ? previous : current));
      } catch (err: any) {
        if (!mounted) return;
        if (STALE.test(err?.message || '')) setStale(true); else setError(err.message);
      } finally { if (mounted) setBooting(false); }
    };
    void refreshConnection();
    // The connection lives in storage: connecting, disconnecting or a session the server ended all change it. No polling.
    const listener = (changes: any, area: string) => { if ((area === 'local' || area === 'session') && changes.prospectConnection) void refreshConnection(); };
    chrome.storage.onChanged.addListener(listener);
    const visible = () => { if (document.visibilityState === 'visible') void refreshConnection(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted = false; chrome.storage.onChanged.removeListener(listener); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => { reset(); }, [scope]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    let alive = true;
    const detect = async () => {
      try { const value = await rpc('PROSPECT_PROFILE'); if (alive) setCandidate(value?.linkedinUrl ? { ...value, linkedinUrl: normalizeLinkedinProfileUrl(value.linkedinUrl) } : null); }
      catch (err: any) { if (alive) { setCandidate(null); if (STALE.test(err?.message || '')) setStale(true); } }
      try {
        const page = await rpc('PROSPECT_SEARCH_RESULTS');
        if (alive) setSearchPage(page && (page.salesNavigator || page.results?.length) ? page : null);
      } catch { if (alive) setSearchPage(null); }
      try {
        const company = await rpc('PROSPECT_COMPANY');
        const next: CompanyPage | null = company?.linkedinUrl ? company : null;
        if (alive) setCompanyPage(previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
      } catch { if (alive) setCompanyPage(null); }
    };
    void detect();
    // LinkedIn swaps profiles without reloading: its page says when the profile on screen changes (the URL, or the name once it
    // renders) and the browser says when the tab changes. Nothing is asked on a timer.
    const announced = (request: any, sender: any) => {
      if (request?.action === 'ANTONIA_PROFILE_CHANGED' && sender?.id === chrome.runtime.id && sender.tab?.active !== false
        && String(sender.tab?.url || '').startsWith('https://www.linkedin.com/')) void detect();
      return false;
    };
    chrome.runtime.onMessage.addListener(announced);
    chrome.tabs.onActivated.addListener(detect);
    const update = (_id: number, change: any) => { if (change.url || change.status === 'complete') void detect(); };
    chrome.tabs.onUpdated.addListener(update);
    const visible = () => { if (document.visibilityState === 'visible') void detect(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false; chrome.runtime.onMessage.removeListener(announced); chrome.tabs.onActivated.removeListener(detect);
      chrome.tabs.onUpdated.removeListener(update); document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  const resultUrls = searchPage?.results.map(result => result.linkedinUrl).join('\n') || '';
  useEffect(() => {
    const urls = resultUrls ? resultUrls.split('\n') : [];
    setChosen(previous => previous.filter(url => urls.includes(url)));
    if (!connection || !urls.length) { setResultPresence({}); return; }
    let alive = true;
    rpc('PROSPECT_PRESENCE', { urls }).then(result => { if (alive) setResultPresence(result || {}); }).catch(() => { if (alive) setResultPresence({}); });
    return () => { alive = false; };
  }, [connection, resultUrls, presenceRound]);
  // The company is asked for once its name is on screen, and again after a batch save; another company starts over.
  const companyAsk = JSON.stringify(companyRequest(companyPage));
  useEffect(() => {
    const company = JSON.parse(companyAsk);
    if (!connection || !company) return;
    let alive = true;
    rpc('PROSPECT_API', { organizationId: connection.session.organizationId, userId: connection.session.userId, body: { action: 'company', company } })
      .then(view => { if (alive) setCompanyRead({ ask: companyAsk, view, error: '' }); })
      .catch((err: any) => { if (alive) setCompanyRead({ ask: companyAsk, view: null, error: err?.message || 'No se pudo leer la empresa.' }); });
    return () => { alive = false; };
  }, [connection, companyAsk, presenceRound]);
  const company = companyRead?.ask === companyAsk ? companyRead : null;
  // The day's credits of the account, the same the app shows: read when connecting and after anything that may use them.
  const refreshCredits = useCallback(async () => {
    if (!connection) { setCredits(null); return; }
    try {
      const result = await rpc('PROSPECT_API', { organizationId: connection.session.organizationId, userId: connection.session.userId, body: { action: 'quota' } });
      setCredits(result?.credits && Number.isFinite(result.credits.remaining) ? result.credits : null);
    } catch { setCredits(null); }
  }, [connection]);
  useEffect(() => { void refreshCredits(); }, [refreshCredits]);

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
    void refreshPresence(linkedinUrl);
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

  const refreshPresence = async (url = profileRef.current.linkedinUrl) => {
    if (!url) return;
    try {
      const result = await rpc('PROSPECT_PRESENCE', { urls: [url] });
      if (profileRef.current.linkedinUrl === url) setPresence((Object.values(result || {})[0] as any) || null);
    } catch { if (profileRef.current.linkedinUrl === url) setPresence(null); }
  };
  const save = () => run('Guardando lead…', async valid => {
    const result = await api('save', { replaceFields: true }); if (!valid()) return;
    setProfile(fromRow(result.lead)); profileRef.current = fromRow(result.lead);
    dirty.current = false; setCachedEdits(null);
    await chrome.storage.session.remove(`prospect-profile:${scope}:${profile.linkedinUrl}`);
    setSaved(result.lead); setCampaigns(null); setCampaignId(''); setNotice('Lead guardado en tu organización.');
  }).then(() => refreshPresence());
  // Without a choice, what the options of «Enriquecer perfil» say; «Buscar correo» and «Buscar teléfono» ask for one thing.
  const enrich = (wants?: { email: boolean; phone: boolean }) => run('Consultando datos…', async valid => {
    const wantsEmail = !profile.email && (wants ? wants.email : revealEmail);
    const wantsPhone = !profile.primaryPhone && (wants ? wants.phone : profile.email ? true : revealPhone);
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
  }).then(refreshCredits);
  const investigate = () => run('Solicitando investigación…', async valid => {
    await api('research', { language, refreshResearch: ['insufficient_data', 'failed', 'partial'].includes(research?.status) }); if (!valid()) return;
    setResearch({ status: 'queued' }); setNotice('La investigación continuará aunque cierres el panel.');
  }).then(refreshCredits);
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
  }).then(() => refreshPresence());
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
  const collectSweep = (kind: 'network' | 'inbox') => run(kind === 'network' ? 'Recolectando red visible…' : 'Recolectando bandeja visible…', async valid => {
    const result = await rpc('PROSPECT_SWEEP_COLLECT', { kind });
    if (!valid()) return;
    if (kind === 'network') setSweepNetwork(result.entries || []);
    else setSweepInbox(result.threads || []);
    setNotice(result.reachedCap
      ? 'Se alcanzó el tope por página. Envía este reporte, desplázate para cargar más y repite.'
      : 'Página recolectada. Si ya no queda más por cargar, marca barrido completo antes de enviar.');
  });
  const sendSweep = (kind: 'network' | 'inbox') => run('Enviando reporte…', async valid => {
    const payload = kind === 'network'
      ? { action: 'network-report', networkEntries: (sweepNetwork || []).map((entry: any) => ({ url: entry.url, name: entry.name })), networkHasMore: !sweepComplete }
      : { action: 'inbox-report', inboxThreads: (sweepInbox || []).map((thread: any) => ({ key: thread.key, url: thread.url, name: thread.name, direction: thread.direction, at: thread.at, snippet: thread.snippet, replyNeeded: thread.replyNeeded })), inboxHasMore: !sweepComplete };
    const result = await api(payload.action, payload);
    if (!valid()) return;
    if (kind === 'network') setSweepNetwork(null); else setSweepInbox(null);
    setNotice(`Reporte guardado: ${result.observed} observados${result.hasMore ? ', quedan más por cargar.' : ', barrido completo.'}`);
  });


  const personState = {
    saved: !!saved, enrichedReady, email: profile.email, emailStatus: profile.emailStatus, research, researchEnabled: !!connection?.session.researchEnabled,
    phonePending: !!phoneJob, sent: sendState === 'confirmed', hasMessage: !!message.trim(), presence,
  };
  const chips = personChips(personState);
  const step = personNextStep(personState);
  // The tabs never repeat the card's button: what the card offers, the tab leaves out.
  const offered = (id: NextStep['id']) => step?.id === id;
  const showStep = step && !(step.id === 'write' && view === 'message');
  const steps = researchSteps(research);
  const runStep = (next: NextStep) => {
    if (next.id === 'enrich') void enrich();
    else if (next.id === 'save') void save();
    else if (next.id === 'find-email') void enrich({ email: true, phone: false });
    else if (next.id === 'research') { setView('research'); void investigate(); }
    else setView('message');
  };
  const onTabKey = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex(tab => tab.id === view);
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setView(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };
  const saveChosen = () => void run(`Guardando ${chosen.length === 1 ? '1 contacto' : `${chosen.length} contactos`}…`, async valid => {
    const profiles = chosenProfiles(searchPage?.results || [], chosen);
    const result = await rpc('PROSPECT_API', { organizationId: connection!.session.organizationId, userId: connection!.session.userId, body: { action: 'save-batch', profiles } });
    if (!valid()) return;
    setChosen([]);
    setNotice(batchSummary(result));
    setPresenceRound(round => round + 1);
  });
  const toggleChosen = (url: string, on: boolean) => setChosen(previous => on ? [...new Set([...previous, url])].slice(0, BATCH_LIMIT) : previous.filter(item => item !== url));
  const searchCard = searchPage && <section className="panel-card" aria-labelledby="search-heading">
    <div className="section-heading"><h2 id="search-heading">{searchPage.salesNavigator ? 'Búsqueda de Sales Navigator'
      : `${searchPage.results.length} ${searchPage.results.length === 1 ? 'persona' : 'personas'} ${companyPage?.people && companyPage.name ? `de ${companyPage.name} en pantalla` : 'en esta búsqueda'}`}</h2><Users size={16} aria-hidden="true" /></div>
    {searchPage.salesNavigator ? <p>Sales Navigator no muestra el perfil público de cada persona. Abre su perfil de LinkedIn para guardarla desde aquí.</p> : <>
      <div className="row-actions">
        <button className="text-button" onClick={() => setChosen(availableResults(searchPage.results, resultPresence))}>Seleccionar disponibles</button>
        {chosen.length > 0 && <button className="text-button" onClick={() => setChosen([])}>Quitar selección</button>}
      </div>
      <ul className="result-list">{searchPage.results.map(result => {
        const known = resultPresence[result.linkedinUrl];
        const checked = chosen.includes(result.linkedinUrl);
        return <li key={result.linkedinUrl}><label className="result-row">
          <input type="checkbox" checked={checked} disabled={!!known?.blocks || (!checked && chosen.length >= BATCH_LIMIT)} onChange={event => toggleChosen(result.linkedinUrl, event.target.checked)} />
          <span className="result-text"><strong>{result.fullName || 'Perfil de LinkedIn'}</strong>{result.headline && <span>{result.headline}</span>}
            {known && <span className={`chip chip-${known.tone}`}>{known.label}</span>}</span>
        </label></li>;
      })}</ul>
      <button className="primary full" disabled={!chosen.length || !!busy} onClick={saveChosen}><Check size={16} aria-hidden="true" />{chosen.length ? `Guardar ${chosen.length} en Anton.IA` : 'Elige a quiénes guardar'}</button>
      <p className="helper">Se guardan con lo que muestra LinkedIn: nombre, cargo y empresa, hasta {BATCH_LIMIT} por vez. Los que trabaja otra persona del equipo no se guardan. Después puedes buscar su correo o prepararlos en Cowork.</p>
    </>}
  </section>;
  const openApp = (path: string) => void run('Abriendo Anton.IA…', async () => { await rpc('PROSPECT_OPEN', { path }); });
  const facts = companyPage ? companyFacts(companyPage) : '';
  const companyView = company?.view;
  const companyCard = companyPage && <section className="panel-card" aria-labelledby="company-heading" aria-busy={!company}>
    <div className="section-heading"><h2 id="company-heading">{companyPage.name || 'Empresa de LinkedIn'}</h2><Building2 size={16} aria-hidden="true" /></div>
    {facts && <p>{facts}</p>}
    {!companyPage.name ? <p role="status">Leyendo la página de la empresa…</p>
      : !company ? <p role="status">{LOOKUP}</p>
      : !companyView ? <p className="callout callout-warning"><AlertTriangle size={16} aria-hidden="true" />{company.error}</p> : <>
        {companyView.opportunity && <div className="callout">
          <strong>Está contratando</strong><span>{companyView.opportunity.signal}</span>
          <button className="text-button" disabled={!!busy} onClick={() => openApp(companyView.opportunity!.page)}>Ver en Oportunidades<ExternalLink size={14} aria-hidden="true" /></button>
        </div>}
        <h3>{contactsHeading(companyView)}</h3>
        {companyView.contacts.length ? <ul className="result-list">{companyView.contacts.map((contact, index) => <li key={contact.linkedinUrl || `${contact.name}-${index}`}>
          <div className="result-row is-static"><span className="result-text">
            <strong>{contact.linkedinUrl ? <a href={contact.linkedinUrl} target="_blank" rel="noreferrer">{contact.name}</a> : contact.name}</strong>
            {contact.title && <span>{contact.title}</span>}
            {contact.presence && <span className={`chip chip-${contact.presence.tone}`}>{contact.presence.label}</span>}
          </span></div>
        </li>)}</ul> : <p className="helper">{emptyCompanyText(companyPage)}</p>}
        <button className="primary full" disabled={!!busy} onClick={() => openApp(companyView.searchHref)}><Search size={16} aria-hidden="true" />Buscar decisores en Anton.IA</button>
        <p className="helper">Abre la Búsqueda de la app con esta empresa y los cargos de tu «Perfil». Revisas y buscas ahí, con su costo de siempre.</p>
        {!companyPage.people && <a className="text-button" href={`${companyPage.linkedinUrl}/people/`} target="_blank" rel="noreferrer">Ver sus personas en LinkedIn<ArrowUpRight size={14} aria-hidden="true" /></a>}
      </>}
  </section>;
  const disconnect = () => void run('Desconectando…', async () => {
    known.current = null;
    await rpc('PROSPECT_DISCONNECT'); setConnection(null); setCredits(null); setSessionLost(false); reset();
  });

  const summary = <section aria-label="Datos del contacto" className="stack">
    {!saved && !enrichedReady ? <div className="panel-card">
      <h2>Qué buscar</h2>
      <p>«Enriquecer perfil» trae sus datos profesionales y lo que marques aquí. La consulta usa los créditos disponibles de tu cuenta.</p>
      <div className="checks"><label><input type="checkbox" checked={revealEmail} onChange={e => setRevealEmail(e.target.checked)} />Email</label><label><input type="checkbox" checked={revealPhone} onChange={e => setRevealPhone(e.target.checked)} />Teléfono</label></div>
      <button className="text-button" onClick={() => setEnrichedReady(true)}>Completar datos manualmente</button>
    </div> : <>
      <div className="section-heading"><h2>Información de contacto</h2></div>
      {field('fullName', 'Nombre')}{field('title', 'Cargo')}{field('companyName', 'Empresa')}{field('email', 'Email profesional', 'email')}{field('primaryPhone', 'Teléfono', 'tel')}{field('companyDomain', 'Dominio de empresa')}
      {cachedEdits && <div className="callout"><p>Este contacto cambió en Anton.IA. Se muestran los datos actuales; tus ediciones anteriores siguen disponibles.</p><div className="row-actions"><button className="text-button" onClick={() => { setProfile(cachedEdits); profileRef.current = cachedEdits; dirty.current = true; setCachedEdits(null); }}>Recuperar mis ediciones para revisarlas</button><button className="text-button" onClick={() => { setCachedEdits(null); void chrome.storage.session.remove(`prospect-profile:${scope}:${profile.linkedinUrl}`); }}>Conservar datos actuales</button></div></div>}
      <p className="helper">Estado del correo: {profile.emailStatus === 'verified' ? 'Verificado por proveedor' : profile.emailStatus === 'unknown' ? 'Sin verificación confirmada' : profile.emailStatus}</p>
      {professionalRows.length > 0 && <details className="disclosure"><summary>Más información profesional</summary><dl className="profile-details">{professionalRows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></details>}
      {saved && <button className="secondary full" onClick={save}><Check size={16} aria-hidden="true" />Guardar cambios</button>}
      {saved && profile.email && !profile.primaryPhone && <div className="panel-card">
        <h2>Completar teléfono</h2>
        <button className="secondary full" disabled={!!phoneJob} onClick={() => void enrich({ email: false, phone: true })}><Sparkles size={16} aria-hidden="true" />{phoneJob ? 'Teléfono pendiente…' : 'Buscar teléfono'}</button>
        <p className="helper">{phoneJob ? 'Actualizaremos el resultado sin repetir la consulta. Puedes cerrar y volver a este contacto.' : 'La consulta puede consumir créditos. La disponibilidad del teléfono depende del proveedor.'}</p>
      </div>}
    </>}
  </section>;

  const researchView = <section aria-labelledby="research-heading" className="stack">
    <div className="section-heading"><h2 id="research-heading">Un motivo para conectar</h2></div>
    {!research ? <div className="panel-card">
      <p>Busca señales de negocio y hechos verificables para iniciar una conversación relevante.</p>
      <ul className="ticks"><li><Check size={14} aria-hidden="true" />Contexto de la empresa</li><li><Check size={14} aria-hidden="true" />Hallazgos con fuentes</li><li><Check size={14} aria-hidden="true" />Ángulos de contacto</li></ul>
      {!offered('research') && <button className="primary full" disabled={!saved || !connection?.session.researchEnabled} onClick={investigate}><Sparkles size={16} aria-hidden="true" />Investigar lead</button>}
      {!saved && <p className="helper">Guarda el lead para iniciar la investigación.</p>}
      {!connection?.session.researchEnabled && <p className="helper">La investigación no está habilitada en esta cuenta.</p>}
    </div> : <>
      <p className="research-state">{reportPending(research) && <Loader2 size={16} className="spin" aria-hidden="true" />}{reportStatusLabel(research)}</p>
      {steps && !reportReady(research) && <ol className="steps" aria-label="Pasos de la investigación">{steps.map(item => <li key={item.key} data-state={item.state}>
        <span className="step-mark" aria-hidden="true">{item.state === 'done' ? <Check size={13} /> : item.state === 'current' ? <Loader2 size={13} className="spin" /> : <Circle size={9} />}</span>
        {item.label}<span className="sr-only">{item.state === 'done' ? ' (hecho)' : item.state === 'current' ? ' (en curso)' : ' (pendiente)'}</span>
      </li>)}</ol>}
      {reportReady(research) && <div className="evidence">{research.reportDocumentV2.sections.map((section: any) => <article key={section.key}><h3>{section.title}</h3>{section.paragraphs.map((paragraph: any, i: number) => <p key={i}>{paragraph.text}</p>)}{(section.blocks || []).map((block: any, i: number) => <div key={i}>{blockLines(block).map((line: string, j: number) => <p key={j}>{line}</p>)}</div>)}</article>)}</div>}
      {!reportReady(research) && researchFindings(research).length > 0 && <div className="evidence"><h3>Información recopilada</h3><p className="helper">Extractos de las fuentes encontradas. Pueden incluir empleos anteriores u otras personas; el informe comercial aún no ha sido validado.</p>{researchFindings(research).map((finding: any, i: number) => <article key={i}><p>{finding.text}</p>{finding.url && <a href={finding.url} target="_blank" rel="noreferrer">{finding.label}<span className="sr-only"> (se abre en otra pestaña)</span></a>}</article>)}</div>}
      {research.errorCode && <p className="helper">{research.errorCode}</p>}
      {!reportReady(research) && <p className="helper">Puedes leer lo recopilado aquí sin investigar de nuevo. El informe y su PDF estarán disponibles cuando termine la revisión de las fuentes.</p>}
      {research?.reportSynthesisV2?.retryable && <button className="secondary full" onClick={() => void run('Retomando informe…', async valid => { await api('research-retry'); if (valid()) setResearch((previous: any) => ({ ...previous, reportSynthesisV2: { status: 'queued' } })); })}><RefreshCw size={16} aria-hidden="true" />Reintentar preparación del informe</button>}
      {reportReady(research) && <button className="primary full" onClick={() => void run('Preparando PDF…', async () => { downloadResearchPdf(profile, research); setNotice('Descarga del PDF iniciada.'); })}><Download size={16} aria-hidden="true" />Descargar PDF</button>}
      <div className="row-actions">
        <button className="secondary" disabled={!saved || !connection?.session.researchEnabled || reportPending(research)} onClick={investigate}><Sparkles size={16} aria-hidden="true" />Investigar de nuevo</button>
        <button className="text-button" onClick={() => void run('Actualizando…', async valid => { const result = await api('research-status'); if (valid()) setResearch(result.research); })}>Actualizar estado</button>
      </div>
      <p className="helper">La investigación se conserva en Anton.IA; sigue aunque cierres el panel.</p>
    </>}
  </section>;

  const messageView = <section aria-label="Mensaje al contacto" className="stack">
    <div className="section-heading"><h2>Mensaje de LinkedIn</h2></div>
    <label className="field">¿Qué quieres conseguir?<textarea rows={3} value={instruction} maxLength={900} onChange={event => setInstruction(event.target.value)} /></label>
    <div className="columns"><label className="field">Tono<select value={tone} onChange={e => setTone(e.target.value)}><option value="profesional">Profesional</option><option value="cercano">Cercano</option><option value="directo">Directo</option></select></label><label className="field">Idioma<select value={language} onChange={e => setLanguage(e.target.value)}><option value="es">Español</option><option value="en">English</option><option value="pt">Português</option></select></label></div>
    <button className={message ? 'secondary full' : 'primary full'} disabled={!saved || !instruction.trim()} onClick={() => void generate()}><Sparkles size={16} aria-hidden="true" />{message ? 'Generar otra versión' : 'Redactar mensaje de LinkedIn'}</button>
    {!saved && <p className="helper">Guarda el lead antes de redactar.</p>}
    <button className="text-button" disabled={!saved || !instruction.trim()} onClick={() => void generateOptions()}>Crear 3 opciones con IA</button>
    {messageOptions.length > 1 && <label className="field">Opciones guardadas<select value={messageOptions.indexOf(message)} onChange={event => { const next = messageOptions[Number(event.target.value)]; if (next) writeMessage(next, sources, [...new Set([...messageOptions, message])].slice(-8)); }}><option value={-1} disabled>Borrador editado</option>{messageOptions.map((text, index) => <option key={index} value={index}>Opción {index + 1} · {text.slice(0, 65)}…</option>)}</select></label>}
    {message && <div className="message-editor">
      <label className="field">Mensaje de LinkedIn<textarea rows={9} maxLength={1200} value={message} onChange={event => writeMessage(event.target.value)} /></label>
      <div className="editor-meta"><span>{message.length}/1200</span><button className="text-button" onClick={() => void generate('Hazlo más breve.')}>Más breve</button><button className="text-button" onClick={() => void generate('Usa un tono más cercano.')}>Más cercano</button></div>
      <div className="columns">
        <button className="secondary full" disabled={!message.trim()} onClick={prepare}>Preparar en LinkedIn<ArrowUpRight size={16} aria-hidden="true" /></button>
        <button className="secondary full" onClick={() => void run('Copiando…', async valid => { await navigator.clipboard.writeText(message); if (valid()) setNotice('Mensaje copiado.'); })}><Copy size={16} aria-hidden="true" />Copiar mensaje</button>
      </div>
      <p className="helper">Preparar deja el texto en LinkedIn para que lo envíes tú.</p>
      {!confirmSend
        ? <button ref={sendTriggerRef} className="primary full" disabled={!message.trim() || !!sendState} onClick={() => setConfirmSend(true)}><Send size={16} aria-hidden="true" />{sendState === 'confirmed' ? 'Mensaje enviado' : sendState ? 'Revisa el intento en LinkedIn' : 'Revisar y enviar'}</button>
        : <section ref={sendConfirmRef} tabIndex={-1} className="send-confirm" aria-label="Confirmar envío automático" onKeyDown={event => { if (event.key === 'Escape') { setConfirmSend(false); setTimeout(() => sendTriggerRef.current?.focus(), 0); } }}>
            <p><strong>{profile.fullName || 'Este perfil'}</strong></p>
            <p className="helper">{profile.linkedinUrl}</p>
            <p className="send-preview">{message.trim()}</p>
            <p className="helper">Se enviará ahora desde la sesión abierta en LinkedIn ({message.trim().length}/1200). Comprueba tu cuenta en LinkedIn antes de confirmar.</p>
            <button className="primary full" disabled={!message.trim() || message.trim().length > 1200} onClick={() => void sendAutomatically()}>Confirmar envío<Send size={16} aria-hidden="true" /></button>
            <button className="text-button" onClick={() => { setConfirmSend(false); setTimeout(() => sendTriggerRef.current?.focus(), 0); }}>Volver</button>
          </section>}
      {sources.length > 0 && <details className="disclosure"><summary>Fuentes de personalización</summary>{sources.map((source, i) => <p key={i} className="helper">{source.statement}</p>)}</details>}
    </div>}
    <div className="panel-card">
      <div className="section-heading"><h2>Correo</h2><Mail size={16} aria-hidden="true" /></div>
      <p>Prepara el primer correo y una secuencia personalizada en Anton.IA, o suma el contacto a una campaña.</p>
      <details className="disclosure"><summary>Añadir a una campaña existente</summary>
        <button className="secondary full" disabled={!saved?.email} onClick={loadCampaigns}>{campaigns ? 'Actualizar campañas' : 'Buscar mis campañas'}</button>
        {!saved?.email && <p className="helper">Guarda un email válido para añadir este lead.</p>}
        {campaigns?.length === 0 && <p className="helper">Todavía no tienes campañas. Crea una en la app o prepara una secuencia personalizada aquí.</p>}
        {!!campaigns?.length && <>
          <label className="field" htmlFor="existing-campaign">Campaña</label><select id="existing-campaign" value={campaignId} onChange={event => setCampaignId(event.target.value)}><option value="">Selecciona una campaña</option>{campaigns.map(item => <option key={item.id} value={item.id} disabled={!item.editable && !item.alreadyAdded}>{item.name} · {item.alreadyAdded ? 'Lead incluido' : item.editable ? `${item.recipientCount} contactos` : 'Aprobada o pausada'}</option>)}</select>
          <button className="secondary full" disabled={!campaignId || campaigns.find(item => item.id === campaignId)?.alreadyAdded} onClick={addToCampaign}>Añadir lead a la campaña<ChevronRight size={16} aria-hidden="true" /></button>
          <p className="helper">Solo se pueden ampliar campañas pendientes de aprobación. Se mantienen sus filtros y mensajes.</p>
        </>}
      </details>
      <label className="field">Días de seguimiento<input value={offsets} onChange={e => setOffsets(e.target.value)} placeholder="3, 7" /><span className="helper">Días después del primer envío. Hasta 4 seguimientos.</span></label>
      <button className="secondary full" disabled={!saved || !saved.email || !research?.researchSnapshotId || !connection?.session.sequencesEnabled || !instruction.trim()} onClick={() => void email(true)}>Crear secuencia de email<ChevronRight size={16} aria-hidden="true" /></button>
      <button className="text-button" disabled={!saved?.email || !research?.researchSnapshotId} onClick={() => void email(false)}>Crear solo el primer correo</button>
      {(!saved?.email || !research?.researchSnapshotId) && <p className="helper">Necesitas un email guardado y una investigación lista para generar los correos.</p>}
      {!connection?.session.sequencesEnabled && <p className="helper">Las secuencias de seguimiento no están habilitadas en esta organización.</p>}
      {composeUrl && <button className="primary full" onClick={() => void run('Abriendo correo…', async () => { await rpc('PROSPECT_OPEN', { path: composeUrl }); })}>Revisar correos en la app<ExternalLink size={16} aria-hidden="true" /></button>}
    </div>
  </section>;

  const moreView = <section aria-label="Más herramientas de LinkedIn" className="stack">
    <div className="panel-card">
      <div className="section-heading"><h2>Trabajos de Cowork</h2></div>
      <p>Invitaciones y mensajes aprobados en el chat para este perfil. Se ejecutan aquí, ante el perfil verificado.</p>
      <button className="secondary full" disabled={!saved} onClick={loadJobs}>{jobs ? 'Actualizar trabajos' : 'Ver trabajos pendientes'}</button>
      {!saved && <p className="helper">Guarda el lead para ver sus trabajos.</p>}
      {!!jobs?.length && jobs.filter(item => !item.expired).map(item => <div key={item.id} className="callout">
        <p><strong>{item.kind === 'invite' ? 'Invitación sin nota' : 'Mensaje'}</strong> · en cola desde {String(item.created_at || '').slice(0, 10)}</p>
        <button className="secondary full" disabled={!candidate} onClick={() => void executeJob(item)}>Ejecutar ante este perfil</button>
      </div>)}
      {jobs && !jobs.filter(item => !item.expired).length && <p className="helper">Sin trabajos pendientes para este perfil.</p>}
    </div>
    <div className="panel-card">
      <div className="section-heading"><h2>Barrido de red y bandeja</h2></div>
      <p>Solo se registra lo visible en tu LinkedIn abierto; nada se infiere. Recolecta cada página y envía su reporte.</p>
      <div className="columns"><div><button className="secondary full" disabled={!!busy} onClick={() => void collectSweep('network')}>Recolectar red visible</button>
        {sweepNetwork && <p className="helper">{sweepNetwork.length} contactos en esta página.</p>}</div>
        <div><button className="secondary full" disabled={!!busy} onClick={() => void collectSweep('inbox')}>Recolectar bandeja visible</button>
        {sweepInbox && <p className="helper">{sweepInbox.length} hilos en esta página.</p>}</div></div>
      <label className="check-line"><input type="checkbox" checked={sweepComplete} onChange={event => setSweepComplete(event.target.checked)} /> Llegué al final, no queda más por cargar</label>
      <div className="columns">
        <button className="secondary full" disabled={!!busy || !sweepNetwork?.length} onClick={() => void sendSweep('network')}>Enviar reporte de red</button>
        <button className="secondary full" disabled={!!busy || !sweepInbox?.length} onClick={() => void sendSweep('inbox')}>Enviar reporte de bandeja</button>
      </div>
      <p className="helper">Abre tu red (linkedin.com/mynetwork) o Mensajes antes de recolectar. Desplázate para cargar más y repite hasta completar.</p>
    </div>
    <div className="panel-card">
      <div className="section-heading"><h2>Historial de LinkedIn</h2></div>
      <p>Guarda en Anton.IA el resultado de los envíos que se interrumpieron. Nunca se reenvían.</p>
      <button className="secondary full" onClick={() => void run('Sincronizando historial…', async valid => {
        const result = await rpc('PROSPECT_SYNC_SENDS', { organizationId: connection!.session.organizationId, userId: connection!.session.userId });
        if (valid()) setNotice(result.count ? 'Historial actualizado. Los envíos interrumpidos quedan por comprobar; no se reenvían.' : 'No hay resultados pendientes de sincronizar.');
      })}><RefreshCw size={16} aria-hidden="true" />Sincronizar historial de LinkedIn</button>
    </div>
  </section>;

  const panels: Record<View, React.ReactNode> = { summary, research: researchView, message: messageView, more: moreView };

  return <LazyMotion features={domAnimation} strict><MotionConfig reducedMotion="user"><div className="shell">
    <header className="topbar">
      <div className="brand"><img className="brand-logo" src="icon.png" alt="" /><div className="brand-text"><strong>Anton.IA</strong><span>{connection ? connection.session.organizationName : 'LinkedIn Workspace'}</span></div></div>
      {connection && <div className="topbar-tools">
        {credits && <span className={credits.remaining === 0 ? 'credits credits-empty' : 'credits'} title={`Créditos de hoy para buscar correos y teléfonos e investigar: usaste ${credits.used} de ${credits.limit}.`}>
          {credits.remaining === 0 ? 'Sin créditos hoy' : `${credits.remaining.toLocaleString('es-CL')} ${credits.remaining === 1 ? 'crédito' : 'créditos'} hoy`}
        </span>}
        <button className="icon-button" aria-label="Desconectar cuenta" title="Desconectar cuenta" disabled={!!busy} onClick={disconnect}><LogOut size={17} aria-hidden="true" /></button>
      </div>}
    </header>
    {connection && <div className="account-bar"><span className="dot" aria-hidden="true" /><span className="account" title={connection.session.email}>{connection.session.email}</span></div>}
    {!online && <p className="banner banner-warning" role="status"><WifiOff size={15} aria-hidden="true" />Sin conexión a internet. Lo que hagas se reanuda al volver la conexión.</p>}
    <main>
      {stale ? <section className="state-card" role="alert">
        <AlertTriangle size={26} aria-hidden="true" /><h1>La extensión se actualizó</h1>
        <p>Este panel quedó de la versión anterior. Recárgalo para seguir; tus borradores se conservan.</p>
        <button className="primary full" onClick={() => location.reload()}><RefreshCw size={16} aria-hidden="true" />Recargar panel</button>
      </section> : booting ? <div className="skeleton-stack" aria-busy="true" aria-label="Abriendo tu espacio"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /></div> : !connection ? <section className="welcome">
        {sessionLost && <p className="callout callout-warning" role="alert"><AlertTriangle size={16} aria-hidden="true" />Tu sesión de Anton.IA terminó o cambió de cuenta. Vuelve a conectar para seguir.</p>}
        <div className="welcome-symbol"><Sparkles size={28} aria-hidden="true" /></div>
        <h1>Tu próximo contacto, con contexto.</h1><p>Guarda perfiles de LinkedIn, investiga qué les importa y escríbeles con tu oferta, sin salir de LinkedIn.</p>
        <ul className="welcome-list"><li><UserRound size={16} aria-hidden="true" />Contactos guardados en tu organización</li><li><Search size={16} aria-hidden="true" />Investigación con fuentes</li><li><Sparkles size={16} aria-hidden="true" />Mensajes con contexto</li></ul>
        <button className="primary full" disabled={!!busy} onClick={() => void run('Abriendo Anton.IA…', async () => { await rpc('PROSPECT_CONNECT', { origin }); setConnecting(true); })}>Conectar Anton.IA<ArrowUpRight size={17} aria-hidden="true" /></button>
        {connecting && <p role="status" className="helper">Confirma «Conectar mi cuenta» en la pestaña de la app.</p>}
        <details className="disclosure"><summary>Dirección de la app</summary><label className="field">Servidor<select value={origin} onChange={event => setOrigin(event.target.value)}>
          <option value="https://studio--leadflowai-3yjcy.us-central1.hosted.app">Anton.IA · producción</option><option value="https://app.antonia.ai">app.antonia.ai</option>
          {chrome.runtime.getManifest().host_permissions.some((item: string) => item.includes('localhost')) && <><option value="http://localhost:9003">Local · puerto 9003</option><option value="http://localhost:3000">Local · puerto 3000</option></>}
        </select></label></details>
      </section> : <>
        <div className="source">
          <label className="check-line"><input type="checkbox" checked={followProfile} onChange={event => setFollowProfile(event.target.checked)} /> Seguir el perfil abierto en LinkedIn</label>
          {differentProfile && <button className="context-switch" disabled={!!busy} onClick={() => { const { tabId: _tabId, ...selected } = candidate; void selectProfile(selected); }}>Usar perfil abierto: {candidate.fullName || 'LinkedIn'}<ChevronRight size={16} aria-hidden="true" /></button>}
          <form className="url-form" onSubmit={event => { event.preventDefault(); setFollowProfile(false); void selectProfile({ ...empty, linkedinUrl: url }); }}>
            <label htmlFor="profile-url">URL de LinkedIn</label>
            <div className="input-action"><Link2 size={16} aria-hidden="true" /><input id="profile-url" value={url} onChange={event => setUrl(event.target.value)} placeholder="linkedin.com/in/nombre" disabled={!!busy} /><button className="icon-button" disabled={!!busy || !url.trim()} aria-label="Buscar perfil"><ArrowUpRight size={18} aria-hidden="true" /></button></div>
          </form>
        </div>
        {companyCard}
        {searchCard}
        {!profile.linkedinUrl ? searchPage || companyPage ? null : <section className="state-card">
          <UserRound size={28} aria-hidden="true" /><h1>Empieza por una persona</h1>
          <p>Abre su perfil de LinkedIn y el panel lo sigue solo, o pega su URL aquí arriba.</p>
        </section> : <>
          <section className="person-card" aria-labelledby="person-name">
            <div className="person-head">
              <div className="avatar" aria-hidden="true">{profile.fullName ? initials(profile.fullName) : <UserRound size={22} />}</div>
              <div className="person-id"><h1 id="person-name">{profile.fullName || 'Perfil de LinkedIn'}</h1><p>{profile.title || 'Completa el cargo o enriquece el perfil'}</p>{profile.companyName && <p className="company">{profile.companyName}</p>}</div>
              {saved && <button className="icon-button" aria-label="Abrir leads en la app" title="Abrir en Anton.IA" onClick={() => void run('Abriendo app…', async () => { await rpc('PROSPECT_OPEN', { path: '/saved/leads/enriched' }); })}><ExternalLink size={16} aria-hidden="true" /></button>}
            </div>
            {busy === LOOKUP && !saved ? <div className="chips" aria-hidden="true"><span className="chip skeleton" /><span className="chip skeleton" /></div>
              : <ul className="chips" aria-label="Estado del contacto">{chips.map(chip => <li key={chip.key} className={`chip chip-${chip.tone}`}>{chip.label}</li>)}</ul>}
            {presence?.blocks && <p className="callout callout-warning"><AlertTriangle size={16} aria-hidden="true" />{presence.label}. Coordina con tu equipo antes de escribirle.</p>}
            {showStep && step && <div className="next-step">
              <button className="primary full" disabled={!!busy} onClick={() => runStep(step)}>{step.id === 'save' ? <Check size={16} aria-hidden="true" /> : step.id === 'write' ? <Send size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}{step.label}</button>
              <p className="helper">{step.hint}</p>
            </div>}
          </section>
          <div className="tabs" role="tablist" aria-label="Vistas del contacto" onKeyDown={onTabKey}>{TABS.map(tab => <button key={tab.id} ref={node => { tabRefs.current[tab.id] = node; }} role="tab" id={`tab-${tab.id}`} aria-controls={view === tab.id ? `panel-${tab.id}` : undefined} aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)}>{tab.label}</button>)}</div>
          <fieldset key={view} className="content tab-panel" role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`} disabled={!!busy}>{panels[view]}</fieldset>
        </>}
      </>}
    </main>
    {/* One live region that is always there, so what appears in it is announced; the bar itself enters and leaves. */}
    <div className="feedback-live" aria-live="polite" aria-atomic="true"><AnimatePresence initial={false}>
      {(busy || error || notice) && <m.footer key="feedback" className="feedback" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.2 } }} exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}>
        {busy ? <p><Loader2 size={16} className="spin" aria-hidden="true" />{busy}</p> : error ? <p className="error" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : <p><Check size={16} aria-hidden="true" />{notice}</p>}
      </m.footer>}
    </AnimatePresence></div>
  </div></MotionConfig></LazyMotion>;
}

createRoot(document.getElementById('root')!).render(<App />);
