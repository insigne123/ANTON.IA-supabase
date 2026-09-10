/* global isAllowedAppUrl */
const PROSPECT_DEFAULT_ORIGIN = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const panelSender = sender => sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('panel.html');

async function prospectConnection() {
  const { prospectConnection: connection } = await chrome.storage.session.get('prospectConnection');
  if (!connection) return null;
  try {
    const tab = await chrome.tabs.get(connection.tabId);
    if (new URL(tab.url).origin === connection.origin && new URL(tab.url).pathname === '/extension/connect') return connection;
  } catch { /* Closed tab. */ }
  await chrome.storage.session.remove('prospectConnection');
  return null;
}

async function prospectRequest(connection, body) {
  const response = await chrome.tabs.sendMessage(connection.tabId, { action: 'PROSPECT_APP_REQUEST', body });
  if (!response?.ok) throw new Error(response?.error || 'Recarga la pestaña de conexión y vuelve a conectar.');
  return response.result;
}

async function prospectHandle(request, sender) {
  if (request.action === 'PROSPECT_APPROVE') {
    const { prospectPending: pending } = await chrome.storage.session.get('prospectPending');
    if (!pending || pending.expires < Date.now() || sender.tab?.id !== pending.tabId || sender.frameId !== 0
      || !isAllowedAppUrl(sender.url) || new URL(sender.url).pathname !== '/extension/connect'
      || new URL(sender.url).origin !== pending.origin || request.nonce !== pending.nonce) throw new Error('Vuelve a iniciar la conexión desde la extensión.');
    const session = await prospectRequest(pending, { action: 'session' });
    await chrome.storage.session.set({ prospectConnection: { tabId: pending.tabId, origin: pending.origin, session } });
    await chrome.storage.session.remove('prospectPending');
    return { connected: true };
  }
  if (!panelSender(sender)) throw new Error('Origen no autorizado.');
  if (request.action === 'PROSPECT_CONNECT') {
    const origin = request.origin || PROSPECT_DEFAULT_ORIGIN;
    if (!isAllowedAppUrl(origin) || new URL(origin).origin !== origin) throw new Error('Selecciona una dirección de Anton.IA válida.');
    await chrome.storage.session.remove('prospectConnection');
    const nonce = crypto.randomUUID();
    const tab = await chrome.tabs.create({ url: `${origin}/extension/connect#${nonce}` });
    await chrome.storage.session.set({ prospectPending: { tabId: tab.id, origin, nonce, expires: Date.now() + 600000 } });
    return { pending: true };
  }
  if (request.action === 'PROSPECT_DISCONNECT') {
    await chrome.storage.session.clear();
    return { disconnected: true };
  }
  if (request.action === 'PROSPECT_SESSION') return prospectConnection();
  if (request.action === 'PROSPECT_PROFILE') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://www.linkedin.com/in/')) return null;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_READ_PROFILE' });
    return { ...response, tabId: tab.id };
  }
  if (request.action === 'PROSPECT_PREPARE') {
    if (typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200) throw new Error('Escribe un mensaje de hasta 1200 caracteres.');
    const tab = await chrome.tabs.get(request.tabId);
    if (!tab.url?.startsWith('https://www.linkedin.com/in/')) throw new Error('Abre el perfil del destinatario en LinkedIn.');
    return chrome.tabs.sendMessage(tab.id, { action: 'PROSPECT_PREPARE_MESSAGE', profileUrl: request.profileUrl, message: request.message });
  }
  const connection = await prospectConnection();
  if (!connection) throw new Error('Conecta tu cuenta de Anton.IA para continuar.');
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
chrome.tabs.onRemoved.addListener(async tabId => {
  const connection = await prospectConnection();
  if (connection?.tabId === tabId) await chrome.storage.session.remove('prospectConnection');
});
