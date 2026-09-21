// Auto-send is isolated from legacy helpers and only reachable through the workspace worker.
(() => {
  if (globalThis.__antoniaProspectingSendLoaded) return;
  globalThis.__antoniaProspectingSendLoaded = true;
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
  const recipient = (bubble, target) => {
    const links = Array.from(bubble.querySelectorAll('.msg-overlay-bubble-header a[href*="/in/"], .msg-thread a[href*="/in/"], .msg-entity-lockup a[href*="/in/"]'));
    return links.length > 0 && links.every(link => canonical(link.href) === target);
  };
  const outgoing = bubble => Array.from(bubble.querySelectorAll('.msg-s-message-group--is-mine .msg-s-event-listitem'));
  // Generic DOM ids (e.g. Ember ids) change when old history is re-rendered.
  const eventId = node => node.getAttribute('data-event-urn') || node.getAttribute('data-urn');
  async function send(request) {
    if (attempts.has(request.operationId)) return attempts.get(request.operationId);
    if (busy) return { status: 'not_sent', error: 'Hay un envío en curso en esta pestaña.' };
    const target = canonical(request.profileUrl);
    if (!target || canonical(location.href) !== target || typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200) {
      return { status: 'not_sent', error: 'Revisa el perfil y el mensaje antes de enviar.' };
    }
    busy = true;
    let clicked = false;
    let result;
    try {
      const { button } = await waitLinkedinProfileHeader(request.profileUrl, request.fullName);
      safeClick(button);
      let bubble;
      for (let i = 0; i < 40; i++) {
        if (canonical(location.href) !== target) throw new Error('El perfil cambió. No enviamos el mensaje.');
        const gate = linkedinMessagingGate();
        if (gate) throw new Error(gate);
        const matches = Array.from(document.querySelectorAll('.msg-overlay-conversation-bubble')).filter(node => isElementVisible(node) && recipient(node, target));
        if (matches.length === 1) { bubble = matches[0]; break; }
        await delay(300);
      }
      if (!bubble) throw new Error('No pudimos verificar el destinatario. Usa Preparar o Copiar mensaje.');
      if (linkedinIsInMail(bubble)) throw new Error('Este contacto usa InMail. Usa Preparar en LinkedIn y revisa el asunto y los créditos antes de enviarlo manualmente.');
      const editor = linkedinMessageEditor(bubble);
      const verify = () => {
        if (canonical(location.href) !== target || !bubble.isConnected || !recipient(bubble, target) || !editor?.isConnected || !isElementVisible(editor)) throw new Error('La conversación cambió. Revisa LinkedIn.');
      };
      verify();
      if (text(linkedinEditorText(editor))) throw new Error('Hay un borrador en esta conversación. Consérvalo; puedes enviarlo directamente en LinkedIn.');
      if (bubble.querySelector('.msg-form__attachment, .msg-form__attachments, .msg-form__subject')) throw new Error('Revisa los adjuntos o el asunto directamente en LinkedIn.');
      setElementText(editor, request.message);
      await delay(300);
      verify();
      if (text(linkedinEditorText(editor)) !== text(request.message)) throw new Error('LinkedIn no aceptó el texto completo. Revisa el borrador.');
      const sendButton = bubble.querySelector('button.msg-form__send-button');
      if (!sendButton || !isElementVisible(sendButton) || isElementDisabled(sendButton)) throw new Error('LinkedIn no permite enviar ahora. Conservamos el borrador.');
      const before = new Set(outgoing(bubble));
      const beforeIds = new Set([...before].map(eventId).filter(Boolean));
      verify();
      clicked = true; // From this point every failure is uncertain, never safe to retry automatically.
      safeClick(sendButton);
      for (let i = 0; i < 40; i++) {
        verify();
        const fresh = outgoing(bubble).find(node => {
          const id = eventId(node);
          const body = node.querySelector('.msg-s-event-listitem__body');
          return id && !beforeIds.has(id) && !before.has(node) && body && text(body.textContent) === text(request.message);
        });
        if (fresh) {
          result = { status: 'confirmed', eventId: eventId(fresh) };
          const thread = bubble.querySelector('a[href*="/messaging/thread/"]');
          if (thread && new URL(thread.href).origin === 'https://www.linkedin.com') result.threadUrl = thread.href;
          break;
        }
        await delay(300);
      }
      if (!result) result = { status: 'uncertain', error: 'No pudimos confirmar el envío. Revisa la conversación; no volveremos a enviarlo automáticamente.' };
    } catch (error) {
      result = { status: clicked ? 'uncertain' : 'not_sent', error: error.message };
    } finally { busy = false; }
    attempts.set(request.operationId, result);
    return result;
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || request?.action !== 'PROSPECT_EXECUTE_SEND' || !request.operationId) return false;
    send(request).then(respond).catch(() => respond({ status: 'uncertain', error: 'Revisa la conversación antes de continuar.' }));
    return true;
  });
})();
