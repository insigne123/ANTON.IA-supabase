// Deliberately separate from the legacy automatic-DM flow: this file never clicks Send.
(() => {
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
      const root = document.querySelector('main');
      const heading = root?.querySelector('h1');
      const card = heading?.closest('section, .artdeco-card');
      if (!card) throw new Error('No pudimos identificar la cabecera del perfil. Copia el mensaje.');
      const expectedName = normalizeText(heading.textContent);
      const before = new Set(document.querySelectorAll('.msg-overlay-conversation-bubble'));
      const button = findMessageButton(card);
      if (!button) throw new Error('LinkedIn no ofrece un mensaje directo en este perfil. Puedes copiar el texto.');
      safeClick(button);
      const started = Date.now();
      while (Date.now() - started < 12000) {
        if (canonical(location.href) !== canonical(request.profileUrl)) throw new Error('Cambiaste de perfil. No insertamos el mensaje.');
        const bubbles = Array.from(document.querySelectorAll('.msg-overlay-conversation-bubble')).filter(isElementVisible);
        // Match recipient identity, including already-open conversations. Never choose a global textbox.
        const bubble = bubbles.find(node => {
          const links = Array.from(node.querySelectorAll('a[href*="/in/"]'));
          const exact = links.some(link => canonical(link.href) === canonical(request.profileUrl));
          const title = normalizeText(node.querySelector('.msg-overlay-bubble-header__title, .msg-entity-lockup__entity-title')?.textContent);
          return exact || (!before.has(node) && expectedName && title === expectedName);
        });
        const editor = bubble?.querySelector('.msg-form__contenteditable[contenteditable="true"]');
        if (editor && isElementVisible(editor)) {
          if ((editor.textContent || '').trim()) throw new Error('Hay un borrador en esta conversación. Consérvalo o bórralo antes de continuar.');
          setElementText(editor, request.message);
          if (!textLooksApplied(editor, request.message)) throw new Error('LinkedIn no aceptó el texto. Usa Copiar mensaje.');
          return { status: 'prepared', message: 'Mensaje preparado. Revísalo y pulsa Enviar en LinkedIn.' };
        }
        await delay(300);
      }
      throw new Error('No pudimos confirmar el destinatario del chat. Usa Copiar mensaje.');
    } finally { preparing = false; }
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (request.action === 'PROSPECT_READ_PROFILE') {
      const root = document.querySelector('main');
      const heading = root?.querySelector('h1');
      const card = heading?.closest('section, .artdeco-card');
      respond({ linkedinUrl: canonical(location.href), fullName: heading?.textContent?.trim().slice(0, 300) || '',
        title: card?.querySelector('.text-body-medium')?.textContent?.trim().slice(0, 500) || '', companyName: '', email: '', companyDomain: '' });
      return false;
    }
    if (request.action !== 'PROSPECT_PREPARE_MESSAGE') return false;
    prepare(request).then(result => respond({ ok: true, ...result })).catch(error => respond({ ok: false, error: error.message }));
    return true;
  });
})();
