// Invite without a note, isolated like auto-send. Only reachable through the
// workspace worker. Never infers success from a click: a confirmed invite
// requires the Pending state observed in the DOM; anything else is uncertain
// at most, and pre-click failures never send.
(() => {
  if (globalThis.__antoniaProspectingInviteLoaded) return;
  globalThis.__antoniaProspectingInviteLoaded = true;
  const canonical = value => {
    try {
      const url = new URL(value);
      const path = decodeURIComponent(url.pathname).normalize('NFC').replace(/\/+$/, '').toLowerCase();
      if (url.hostname !== 'www.linkedin.com' || !/^\/in\/[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(path)) return '';
      const result = new URL('https://www.linkedin.com'); result.pathname = path; return result.href;
    } catch { return ''; }
  };
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  const attempts = new Map();
  let busy = false;
  const byText = (root, pattern) => Array.from(root.querySelectorAll('button'))
    .filter(button => pattern.test(text(button.textContent)) && !button.disabled);
  const CONNECT = /^(conectar|connect)$/i;
  const SEND_WITHOUT_NOTE = /^(enviar sin nota|send without a note)$/i;
  const PENDING = /(pendiente|pending)/i;
  const MESSAGE_ONLY = /^(mensaje|message)$/i;
  function headerButtons() {
    const header = document.querySelector('main section, .pv-top-card, .ph5');
    return header ? Array.from(header.querySelectorAll('button')) : [];
  }
  async function invite(request) {
    if (attempts.has(request.operationId)) return attempts.get(request.operationId);
    if (busy) return { status: 'not_sent', error: 'Hay una acción en curso en esta pestaña.' };
    const target = canonical(request.profileUrl);
    if (!target || canonical(location.href) !== target) {
      return { status: 'not_sent', error: 'Abre el perfil verificado en LinkedIn antes de invitar.' };
    }
    busy = true;
    let sent = false;
    let result;
    try {
      const header = headerButtons();
      if (header.some(button => PENDING.test(text(button.textContent)) || PENDING.test(button.getAttribute('aria-label') || ''))) {
        result = { status: 'confirmed', alreadyPending: true };
      } else {
        const connect = header.filter(button => CONNECT.test(text(button.textContent)));
        const messageOnly = header.filter(button => MESSAGE_ONLY.test(text(button.textContent)));
        if (!connect.length) {
          throw new Error(messageOnly.length
            ? 'Ya es contacto de primer grado: no corresponde invitar.'
            : 'Este perfil no ofrece invitación directa. Revisa LinkedIn.');
        }
        if (connect.length !== 1) throw new Error('Hay varias acciones de conexión. Revisa LinkedIn.');
        if (typeof safeClick !== 'function') throw new Error('La extensión no está lista. Recarga LinkedIn.');
        safeClick(connect[0]);
        let dialog = null;
        for (let i = 0; i < 40; i++) {
          if (canonical(location.href) !== target) throw new Error('El perfil cambió. No enviamos la invitación.');
          dialog = document.querySelector('[role="dialog"]');
          if (dialog && byText(dialog, SEND_WITHOUT_NOTE).length === 1) break;
          dialog = null;
          await delay(300);
        }
        if (!dialog) throw new Error('LinkedIn no mostró el diálogo de invitación. Revisa el perfil.');
        const sendButton = byText(dialog, SEND_WITHOUT_NOTE)[0];
        if (canonical(location.href) !== target || !dialog.isConnected) throw new Error('El perfil cambió. No enviamos la invitación.');
        sent = true; // From this point every failure is uncertain, never safe to retry automatically.
        safeClick(sendButton);
        let confirmed = false;
        for (let i = 0; i < 40; i++) {
          if (canonical(location.href) !== target) break;
          const pending = headerButtons().filter(button => PENDING.test(text(button.textContent)) || PENDING.test(button.getAttribute('aria-label') || ''));
          if (pending.length > 0) { confirmed = true; break; }
          await delay(300);
        }
        result = confirmed
          ? { status: 'confirmed' }
          : { status: 'uncertain', error: 'No pudimos confirmar la invitación. Revisa el perfil; no la reenviaremos automáticamente.' };
      }
    } catch (error) {
      result = { status: sent ? 'uncertain' : 'not_sent', error: error.message };
    } finally { busy = false; }
    attempts.set(request.operationId, result);
    return result;
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || request?.action !== 'PROSPECT_EXECUTE_INVITE' || !request.operationId) return false;
    invite(request).then(respond).catch(() => respond({ status: 'uncertain', error: 'Revisa el perfil antes de continuar.' }));
    return true;
  });
})();
