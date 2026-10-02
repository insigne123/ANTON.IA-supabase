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
    // Something was saved or sent: the marks on this page ask again.
    if (request.action === 'ANTONIA_PRESENCE_REFRESH') { scheduleDecorate(); return false; }
    if (request.action === 'PROSPECT_SWEEP_NETWORK' || request.action === 'PROSPECT_SWEEP_INBOX') {
      try {
        respond({ ok: true, ...(request.action === 'PROSPECT_SWEEP_NETWORK' ? sweepNetwork() : sweepInbox()) });
      } catch (error) { respond({ ok: false, error: error.message }); }
      return false;
    }
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

  // Barrido de red y bandeja: solo lectura del DOM visible, sin clics ni
  // envíos. Lo que no está renderizado no se declara: el reporte indica si se
  // alcanzó el tope y el usuario marca cuando llegó al final.
  const SWEEP_NETWORK_CAP = 200;
  const SWEEP_INBOX_CAP = 50;
  function resolveCanonicalLinkedin(href) {
    try {
      const url = new URL(href, location.href);
      return canonical(url.href);
    } catch { return ''; }
  }
  function sweepNetwork() {
    if (!/linkedin\.com$|linkedin\.com\//.test(location.hostname + location.pathname)) throw new Error('Abre LinkedIn para recolectar.');
    const seen = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/in/"]')) {
      if (seen.size >= SWEEP_NETWORK_CAP) break;
      const url = resolveCanonicalLinkedin(anchor.getAttribute('href') || '');
      if (!url || seen.has(url)) continue;
      const name = (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!name) continue;
      seen.set(url, name);
    }
    return { entries: Array.from(seen, ([url, name]) => ({ url, name })), reachedCap: seen.size >= SWEEP_NETWORK_CAP };
  }
  function sweepInbox() {
    if (!/linkedin\.com$|linkedin\.com\//.test(location.hostname + location.pathname)) throw new Error('Abre LinkedIn para recolectar.');
    const threads = [];
    for (const item of document.querySelectorAll('li.msg-conversation-listitem')) {
      if (threads.length >= SWEEP_INBOX_CAP) break;
      const link = item.querySelector('a[href*="/messaging/thread/"]');
      const path = (() => { try { return new URL(link?.getAttribute('href') || '', location.href).pathname; } catch { return ''; } })();
      const name = (item.querySelector('.msg-conversation-card__participant-names')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const snippet = (item.querySelector('.msg-conversation-card__message-snippet-body')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!name && !snippet) continue;
      const unread = !!item.querySelector('.msg-conversation-card__unread-count-notification-badge, [aria-label*="sin leer"], [aria-label*="unread"]');
      threads.push({
        key: path || `fila-${threads.length + 1}`,
        url: path ? `https://www.linkedin.com${path}` : '',
        name,
        direction: /^\s*you\s*:/i.test(snippet) ? 'out' : 'in',
        at: null,
        snippet,
        replyNeeded: unread,
      });
    }
    return { threads, reachedCap: threads.length >= SWEEP_INBOX_CAP };
  }

  // The panel follows the profile on screen without asking on a timer: LinkedIn changes pages without reloading and renders the
  // name after the URL, so this page says when either changed. Only a hint: the panel reads the profile through the worker.
  let announced = '';
  let pending = 0;
  const announce = () => {
    pending = 0;
    const profile = canonical(location.href);
    const name = profile ? (linkedinProfileHeader('')?.heading?.textContent || '').trim().slice(0, 300) : '';
    const key = `${profile || location.pathname}|${name}`;
    if (key === announced) return;
    announced = key;
    try { chrome.runtime.sendMessage({ action: 'ANTONIA_PROFILE_CHANGED' })?.catch?.(() => {}); } catch { /* The extension was reloaded. */ }
  };
  const schedule = () => { if (!pending) pending = setTimeout(announce, 300); };

  // What the organization knows of each person on screen (PR-4b): a mark next to the profile's name and next to each visible
  // search result. Read-only: nothing is clicked or scrolled. The mark lives in a closed shadow root, so LinkedIn's styles and
  // the name's text stay untouched; its own insertions are recognized and never trigger another round.
  const MARK = 'data-antonia-presence';
  const TONES = {
    success: ['#047857', '#ecfdf5'],
    info: ['hsl(217.2 91.2% 40%)', 'hsl(217.2 91.2% 45% / 0.1)'],
    warning: ['#b45309', '#fffbeb'],
  };
  const markFor = (url, presence) => {
    const host = document.createElement('span');
    host.setAttribute(MARK, `${url}|${presence.label}`);
    const root = host.attachShadow({ mode: 'closed' });
    const [ink, soft] = TONES[presence.tone] || TONES.info;
    const style = document.createElement('style');
    style.textContent = `:host{display:inline-flex;vertical-align:middle;margin:2px 0 2px 8px}
      span{display:inline-flex;align-items:center;gap:5px;max-width:260px;font:600 12px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
      color:${ink};background:${soft};border-radius:999px;padding:2px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      i{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}`;
    const pill = document.createElement('span');
    pill.title = `Anton.IA: ${presence.label}`;
    pill.append(document.createElement('i'), document.createTextNode(presence.label));
    root.append(style, pill);
    return host;
  };
  const place = (anchor, url, presence) => {
    const next = anchor.nextElementSibling;
    const current = next?.hasAttribute?.(MARK) ? next : null;
    if (!presence) { current?.remove(); return; }
    if (current?.getAttribute(MARK) === `${url}|${presence.label}`) return;
    current?.remove();
    anchor.after(markFor(url, presence));
  };
  const presenceOf = async urls => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'PROSPECT_PRESENCE', urls });
      return response?.ok ? response.result || {} : {};
    } catch { return {}; }
  };
  // The visible people of a results page: one link per result item, to a public profile, with a name.
  const visibleResults = () => {
    if (!/^\/search\/results\/(people|all)/.test(location.pathname)) return [];
    const seen = new Set();
    const found = [];
    for (const item of document.querySelectorAll('main li')) {
      const link = [...item.querySelectorAll('a[href*="/in/"]')].find(node => canonical(node.href) && node.textContent.trim() && !node.closest(`[${MARK}]`));
      const url = link && canonical(link.href);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      found.push({ url, anchor: link });
      if (found.length >= 50) break;
    }
    return found;
  };
  let decorating = 0;
  let generation = 0;
  const decorate = async () => {
    decorating = 0;
    const round = ++generation;
    const profile = canonical(location.href);
    const heading = profile ? linkedinProfileHeader('')?.heading : null;
    const results = visibleResults();
    const urls = [...new Set([...(heading ? [profile] : []), ...results.map(item => item.url)])];
    if (!urls.length) return;
    const presence = await presenceOf(urls);
    if (round !== generation) return;
    if (heading && canonical(location.href) === profile) place(heading, profile, presence[profile]);
    for (const item of results) if (item.anchor.isConnected) place(item.anchor, item.url, presence[item.url]);
  };
  const scheduleDecorate = () => { if (!decorating) decorating = setTimeout(decorate, 600); };
  // A change that is only one of our own marks is not a change of the page.
  const ours = records => records.every(record => [...record.addedNodes, ...record.removedNodes]
    .every(node => node.nodeType === 1 && node.hasAttribute?.(MARK)));
  if (typeof MutationObserver === 'function' && document.documentElement) {
    new MutationObserver(records => { if (ours(records)) return; schedule(); scheduleDecorate(); })
      .observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('popstate', () => { schedule(); scheduleDecorate(); });
    schedule();
    scheduleDecorate();
  }
})();
