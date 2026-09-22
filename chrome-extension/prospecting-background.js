/* global isAllowedAppUrl */
const PROSPECT_DEFAULT_ORIGIN = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const panelSender = sender => sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('panel.html');
const sendTabs = new Set();
async function syncSend(connection, key, record) {
  if (!record?.result) return record;
  await prospectRequest(connection, { action: 'send-result', organizationId: connection.session.organizationId,
    userId: connection.session.userId, profile: { linkedinUrl: record.profileUrl }, sendResult: { id: record.id, claimToken: record.claimToken, ...record.result } });
  await chrome.storage.local.remove(key);
  return { ...record, synced: true };
}

async function prospectConnection() {
  const stored = await chrome.storage.local.get('prospectConnection');
  if (stored.prospectConnection) return stored.prospectConnection;
  const { prospectConnection: connection } = await chrome.storage.session.get('prospectConnection');
  if (connection) await chrome.storage.local.set({ prospectConnection: connection });
  return connection || null;
}

async function prospectRequest(connection, body) {
  if (connection.session) {
    const response = await fetch(`${connection.origin}/api/extension/workspace`, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Antonia-Extension': '1' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove('prospectConnection');
        await chrome.storage.session.remove('prospectConnection');
      }
      throw new Error(result.message || result.error || 'No pudimos consultar Anton.IA. Vuelve a intentarlo.');
    }
    return result;
  }
  const response = await chrome.tabs.sendMessage(connection.tabId, { action: 'PROSPECT_APP_REQUEST', body });
  if (!response?.ok) throw new Error(response?.error || 'Recarga la pestaña de conexión y vuelve a conectar.');
  return response.result;
}

// Probe before any mutation. Never replay prepare/send after a lost response.
async function ensureLinkedinScripts(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'PROSPECT_PING' });
    if (response?.ready) return;
  } catch { /* Tabs opened before installation/update have no receiver. */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js', 'prospecting-content.js', 'prospecting-send.js', 'prospecting-invite.js'] });
  const response = await chrome.tabs.sendMessage(tabId, { action: 'PROSPECT_PING' });
  if (!response?.ready) throw new Error('Recarga LinkedIn para activar la extensión y vuelve a preparar el mensaje.');
}

async function prospectHandle(request, sender) {
  if (request.action === 'PROSPECT_APPROVE') {
    const { prospectPending: pending } = await chrome.storage.session.get('prospectPending');
    if (!pending || pending.expires < Date.now() || sender.tab?.id !== pending.tabId || sender.frameId !== 0
      || !isAllowedAppUrl(sender.url) || new URL(sender.url).pathname !== '/extension/connect'
      || new URL(sender.url).origin !== pending.origin || request.nonce !== pending.nonce) throw new Error('Vuelve a iniciar la conexión desde la extensión.');
    const session = await prospectRequest(pending, { action: 'session' });
    await chrome.storage.local.set({ prospectConnection: { origin: pending.origin, session } });
    await chrome.storage.session.remove('prospectPending');
    return { connected: true };
  }
  if (!panelSender(sender)) throw new Error('Origen no autorizado.');
  if (request.action === 'PROSPECT_CONNECT') {
    const origin = request.origin || PROSPECT_DEFAULT_ORIGIN;
    if (!isAllowedAppUrl(origin) || new URL(origin).origin !== origin) throw new Error('Selecciona una dirección de Anton.IA válida.');
    await chrome.storage.session.remove('prospectConnection');
    await chrome.storage.local.remove('prospectConnection');
    const nonce = crypto.randomUUID();
    const tab = await chrome.tabs.create({ url: `${origin}/extension/connect#${nonce}` });
    await chrome.storage.session.set({ prospectPending: { tabId: tab.id, origin, nonce, expires: Date.now() + 600000 } });
    return { pending: true };
  }
  if (request.action === 'PROSPECT_DISCONNECT') {
    await chrome.storage.local.remove('prospectConnection');
    await chrome.storage.session.clear();
    return { disconnected: true };
  }
  if (request.action === 'PROSPECT_SESSION') return prospectConnection();
  if (request.action === 'PROSPECT_PROFILE') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://www.linkedin.com/in/')) return null;
    try {
      await ensureLinkedinScripts(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_READ_PROFILE' });
      return { ...response, linkedinUrl: tab.url.split(/[?#]/)[0].replace(/\/+$/, ''), tabId: tab.id };
    } catch {
      return { linkedinUrl: tab.url.split(/[?#]/)[0].replace(/\/+$/, ''), fullName: '', title: '', companyName: '', tabId: tab.id };
    }
  }
  if (request.action === 'PROSPECT_PREPARE') {
    if (typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200) throw new Error('Escribe un mensaje de hasta 1200 caracteres.');
    const tab = await chrome.tabs.get(request.tabId);
    if (!tab.url?.startsWith('https://www.linkedin.com/in/')) throw new Error('Abre el perfil del destinatario en LinkedIn.');
    await ensureLinkedinScripts(tab.id);
    return chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_PREPARE_MESSAGE', profileUrl: request.profileUrl, fullName: String(request.fullName || '').slice(0, 300), message: request.message });
  }
  const connection = await prospectConnection();
  if (!connection) throw new Error('Conecta tu cuenta de Anton.IA para continuar.');
  if (request.action === 'PROSPECT_SEND' || request.action === 'PROSPECT_SYNC_SENDS') {
    const session = await prospectRequest(connection, { action: 'session' });
    if (session.userId !== connection.session.userId || session.organizationId !== connection.session.organizationId
      || request.organizationId !== session.organizationId || request.userId !== session.userId) throw new Error('La cuenta cambió. Vuelve a conectar.');
    if (request.action === 'PROSPECT_SYNC_SENDS') {
      const entries = await chrome.storage.local.get(null);
      let count = 0;
      for (const [key, entry] of Object.entries(entries)) {
        if (!key.startsWith(`prospect-send:${session.organizationId}:${session.userId}:`) || entry.synced) continue;
        if (sendTabs.has(entry.tabId)) continue;
        if (!entry.result) entry.result = { status: 'uncertain', error: 'El navegador interrumpió el envío. Revisa LinkedIn; no se reintentará.' };
        await syncSend(connection, key, entry); count++;
      }
      return { count };
    }
    if (request.confirmed !== true || typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200) throw new Error('Confirma un mensaje de hasta 1200 caracteres.');
    const tab = await chrome.tabs.get(request.tabId);
    // The content script repeats canonical recipient verification before inserting and sending.
    if (!tab.url?.startsWith('https://www.linkedin.com/in/')) throw new Error('Abre el perfil en LinkedIn.');
    if (sendTabs.has(tab.id)) throw new Error('Ya hay un envío en curso en esta pestaña.');
    sendTabs.add(tab.id);
    try {
      await ensureLinkedinScripts(tab.id);
      const claim = await prospectRequest(connection, { action: 'send-claim', organizationId: session.organizationId,
        userId: session.userId, profile: { linkedinUrl: request.profileUrl }, sendMessage: request.message });
      if (!claim.claimed) return { status: claim.status, duplicate: true, error: 'Este mensaje ya tiene un intento registrado. Revisa el historial y LinkedIn; no lo reenviamos.' };
      const key = `prospect-send:${session.organizationId}:${session.userId}:${claim.id}`;
      let record = { id: claim.id, claimToken: claim.claimToken, profileUrl: request.profileUrl, tabId: tab.id, synced: false };
      await chrome.storage.local.set({ [key]: record });
      let result;
      try {
        result = await chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_EXECUTE_SEND', operationId: claim.id, profileUrl: request.profileUrl, fullName: String(request.fullName || '').slice(0, 300), message: request.message.trim() });
        if (!['confirmed', 'uncertain', 'not_sent'].includes(result?.status) || (result.status === 'confirmed' && !result.eventId)) throw new Error('Respuesta no confirmada.');
      } catch { result = { status: 'uncertain', error: 'Se interrumpió la comunicación. Revisa LinkedIn; no reenviaremos este mensaje.' }; }
      record = { ...record, result };
      await chrome.storage.local.set({ [key]: record });
      try { await syncSend(connection, key, record); return { ...result, synced: true }; }
      catch { return { ...result, synced: false }; }
    } finally { sendTabs.delete(tab.id); }
  }
  // Cowork bridge: claim a queued LinkedIn job, execute it against the verified
  // profile tab, then report the destination-confirmed result. Uncertain
  // results are never retried automatically; expiry is enforced server-side.
  if (request.action === 'PROSPECT_EXECUTE_JOB') {
    const session = await prospectRequest(connection, { action: 'session' });
    if (session.userId !== connection.session.userId || session.organizationId !== connection.session.organizationId) throw new Error('La cuenta cambió. Vuelve a conectar.');
    if (typeof request.jobId !== 'string' || !request.jobId) throw new Error('Selecciona el trabajo de LinkedIn.');
    const tab = await chrome.tabs.get(request.tabId);
    if (!tab.url?.startsWith('https://www.linkedin.com/in/')) throw new Error('Abre el perfil en LinkedIn.');
    if (sendTabs.has(tab.id)) throw new Error('Ya hay una acción en curso en esta pestaña.');
    const claim = await prospectRequest(connection, { action: 'linkedin-job-claim', organizationId: session.organizationId,
      userId: session.userId, jobId: request.jobId });
    if (!claim.job || claim.job.status !== 'claimed' || !claim.job.claim_token) throw new Error('No se pudo reclamar el trabajo. Recarga la lista.');
    const job = claim.job;
    const canonical = String(job.canonical_url || '').replace(/\/+$/, '').toLowerCase();
    if (canonical !== String(tab.url.split(/[?#]/)[0]).replace(/\/+$/, '').toLowerCase()) {
      throw new Error('La pestaña no muestra el perfil del trabajo. Abre el perfil verificado.');
    }
    sendTabs.add(tab.id);
    try {
      await ensureLinkedinScripts(tab.id);
      let result;
      if (job.kind === 'invite') {
        result = await chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_EXECUTE_INVITE', operationId: job.id, profileUrl: job.profile_url, fullName: job.display_name });
      } else if (job.kind === 'message' && typeof job.message === 'string' && job.message.trim()) {
        result = await chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_EXECUTE_SEND', operationId: job.id, profileUrl: job.profile_url, fullName: job.display_name, message: job.message });
      } else throw new Error('El trabajo no trae contenido ejecutable.');
      if (!['confirmed', 'uncertain', 'not_sent', 'failed'].includes(result?.status)) throw new Error('Respuesta no confirmada.');
      const finalStatus = result.status === 'not_sent' || result.status === 'failed' ? 'failed' : result.status;
      try {
        return await prospectRequest(connection, { action: 'linkedin-job-result', organizationId: session.organizationId,
          userId: session.userId, jobResult: { jobId: job.id, claimToken: job.claim_token, status: finalStatus,
            eventId: result.eventId, threadUrl: result.threadUrl, error: result.error } });
      } catch { return { ...result, synced: false }; }
    } finally { sendTabs.delete(tab.id); }
  }
  if (request.action === 'PROSPECT_OPEN') {
    if (typeof request.path !== 'string' || !/^\/(saved\/leads\/enriched|contact\/compose)(\?|$)/.test(request.path)) throw new Error('Destino inválido.');
    await chrome.tabs.create({ url: new URL(request.path, connection.origin).href });
    return true;
  }
  if (request.action === 'PROSPECT_API') {
    const { organizationId, userId } = connection.session;
    if (request.organizationId !== organizationId || request.userId !== userId) throw new Error('La sesión cambió. Actualiza el panel.');
    return prospectRequest(connection, { ...request.body, organizationId, userId });
  }
  throw new Error('Acción no disponible.');
}

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!request?.action?.startsWith('PROSPECT_')) return false;
  prospectHandle(request, sender).then(result => respond({ ok: true, result }))
    .catch(error => respond({ ok: false, error: error.message || 'No se pudo completar la acción.' }));
  return true;
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
