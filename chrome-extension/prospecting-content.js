// Deliberately separate from the legacy automatic-DM flow: this file never clicks Send.
(() => {
  if (globalThis.__antoniaProspectingLoaded) return;
  globalThis.__antoniaProspectingLoaded = true;
  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request?.action === 'PROSPECT_PING') { respond({ ready: true }); return false; }
    return false;
  });
  const canonical = value => {
    try {
      const url = new URL(value);
      const path = decodeURIComponent(url.pathname).normalize('NFC').replace(/\/+$/, '');
      if (url.hostname !== 'www.linkedin.com' || !/^\/in\/[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(path)) return '';
      const normalized = new URL('https://www.linkedin.com'); normalized.pathname = path.toLowerCase();
      return normalized.href;
    } catch { return ''; }
  };
  let preparing = false;
  async function prepare(request) {
    if (preparing) throw new Error('Ya estamos preparando un mensaje.');
    if (!canonical(request.profileUrl) || canonical(location.href) !== canonical(request.profileUrl)) throw new Error('El perfil cambió. Vuelve al destinatario antes de preparar el mensaje.');
    if (typeof request.message !== 'string' || !request.message.trim() || request.message.length > 1200) throw new Error('Mensaje inválido.');
    preparing = true;
    try {
      const existing = Array.from(document.querySelectorAll('.msg-overlay-conversation-bubble, [role="dialog"]')).filter(node => isElementVisible(node) && linkedinConversationRecipient(node, canonical(request.profileUrl), canonical));
      if (existing.length !== 1 || !linkedinMessageEditor(existing[0])) {
        const { button } = await waitLinkedinProfileHeader(request.profileUrl, request.fullName);
        safeClick(button);
      }
      const started = Date.now();
      while (Date.now() - started < 12000) {
        if (canonical(location.href) !== canonical(request.profileUrl)) throw new Error('Cambiaste de perfil. No insertamos el mensaje.');
        const gate = linkedinMessagingGate();
        if (gate) throw new Error(gate);
        const bubbles = Array.from(document.querySelectorAll('.msg-overlay-conversation-bubble, [role="dialog"]')).filter(isElementVisible);
        // Match recipient identity, including already-open conversations. Never choose a global textbox.
        const matches = bubbles.filter(node => linkedinConversationRecipient(node, canonical(request.profileUrl), canonical));
        const bubble = matches.length === 1 ? matches[0] : null;
        const editor = bubble && linkedinMessageEditor(bubble);
        if (editor && isElementVisible(editor)) {
          if (linkedinEditorText(editor).trim()) throw new Error('Hay un borrador en esta conversación. Consérvalo o bórralo antes de continuar.');
          setElementText(editor, request.message);
          await delay(250);
          if (canonical(location.href) !== canonical(request.profileUrl) || !editor.isConnected || !linkedinConversationRecipient(bubble, canonical(request.profileUrl), canonical)) throw new Error('La conversación cambió. Revisa LinkedIn antes de continuar.');
          if (!textLooksApplied(editor, request.message)) throw new Error('LinkedIn no aceptó el texto. Usa Copiar mensaje.');
          return { status: 'prepared', message: linkedinIsInMail(bubble)
            ? 'InMail preparado. Revisa el asunto, destinatario y los créditos que indique LinkedIn antes de enviarlo manualmente.'
            : 'Mensaje preparado. Revísalo y pulsa Enviar en LinkedIn.' };
        }
        await delay(300);
      }
      throw new Error('No pudimos confirmar el destinatario del chat. Usa Copiar mensaje.');
    } finally { preparing = false; }
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (request.action === 'PROSPECT_READ_PROFILE') {
      const header = linkedinProfileHeader(request.fullName);
      const heading = header?.heading;
      const card = header?.card;
      respond({ linkedinUrl: canonical(location.href), fullName: heading?.textContent?.trim().slice(0, 300) || '',
        title: card?.querySelector('.text-body-medium')?.textContent?.trim().slice(0, 500) || '', companyName: '', email: '', companyDomain: '' });
      return false;
    }
    if (request.action !== 'PROSPECT_PREPARE_MESSAGE') return false;
    prepare(request).then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
