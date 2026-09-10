// Isolated-world bridge: no credentials and no API responses are exposed to page scripts.
(() => {
  const path = '/api/extension/workspace';
  async function workspace(body) {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Antonia-Extension': '1' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(290000) });
    const payload = await response.json().catch(() => ({ error: 'La app no devolvió una respuesta válida. Comprueba que esté actualizada.' }));
    if (!response.ok) throw new Error(payload.message || payload.error || `Error ${response.status}`);
    return payload;
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || location.pathname !== '/extension/connect') return;
    if (event.data?.type !== 'ANTON_PROSPECT_APPROVE' || event.data.nonce !== location.hash.slice(1)) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'PROSPECT_APPROVE', nonce: event.data.nonce });
      window.postMessage({ type: 'ANTON_PROSPECT_CONNECTED', ok: response?.ok, error: response?.error }, location.origin);
    } catch { window.postMessage({ type: 'ANTON_PROSPECT_CONNECTED', ok: false, error: 'Recarga la extensión y esta pestaña.' }, location.origin); }
  });
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || request?.action !== 'PROSPECT_APP_REQUEST') return false;
    // Fixed endpoint; the bridge cannot become an arbitrary authenticated fetch proxy.
    workspace(request.body).then(result => respond({ ok: true, result }))
      .catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
