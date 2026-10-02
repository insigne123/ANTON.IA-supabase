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
    if (request.action === 'PROSPECT_READ_RESULTS') { respond({ ok: true, results: readResults() }); return false; }
    if (request.action === 'PROSPECT_READ_COMPANY') { respond({ ok: true, company: readCompany() }); return false; }
    if (request.action === 'PROSPECT_READ_ACTIVITY') { respond({ ok: true, posts: readActivity() }); return false; }
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
    const key = profile ? `${profile}|${name}` : `${location.pathname}${location.search}|${visibleResults().length}|${companyHeading()}`;
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
  // A LinkedIn people search, or the «Personas» tab of a company page (PR-4d): the people it shows, the same way.
  const RESULTS_PAGE = /^\/(search\/results\/(people|all)|company\/[^/]+\/people)/;
  // The company page on screen (PR-4d): its handle, and its name once rendered.
  const canonicalCompany = value => {
    try {
      const url = new URL(value);
      const match = decodeURIComponent(url.pathname).normalize('NFC').match(/^\/company\/([\p{L}\p{N}][\p{L}\p{N}._-]*)(?:\/|$)/u);
      return url.hostname === 'www.linkedin.com' && match ? `https://www.linkedin.com/company/${match[1].toLowerCase()}` : '';
    } catch { return ''; }
  };
  const companyHeading = () => canonicalCompany(location.href)
    ? (document.querySelector('main h1')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  // The visible people of a results page: one link per result item, to a public profile, with a name.
  const visibleResults = () => {
    if (!RESULTS_PAGE.test(location.pathname)) return [];
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
  // The people of the results page for the panel's batch save (PR-4c): what the page shows, nothing more.
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const NOT_A_HEADLINE = /^(•|·)|^(conectar|mensaje|seguir|pendiente|connect|message|follow|pending|ver perfil|view profile)\b|\b(1st|2nd|3rd|1er|2º|3er)\b|grado/i;
  const readResults = () => {
    const pageCompany = companyHeading();
    return visibleResults().map(({ url, anchor }) => {
      const item = anchor.closest('li');
      const fullName = clean(anchor.querySelector('span[aria-hidden="true"]')?.textContent || anchor.textContent).slice(0, 300);
      const lines = [...(item?.querySelectorAll('[class*="subtitle"], [class*="headline"], div, p') || [])]
        .filter(node => /subtitle|headline/i.test(String(node.className)) || node.childElementCount === 0)
        .map(node => clean(node.textContent))
        .filter(text => text && text !== fullName && !fullName.includes(text) && text.length >= 3 && text.length <= 220 && !NOT_A_HEADLINE.test(text));
      const headline = (lines[0] || '').slice(0, 200);
      const split = headline.match(/^(.*?)\s+(?:en|at|@|\|)\s+(.+)$/i);
      return { linkedinUrl: url, fullName, headline, title: clean(split ? split[1] : headline).slice(0, 200), companyName: clean(split ? split[2] : pageCompany).slice(0, 200) };
    });
  };
  // What the company page shows (PR-4d), read from the page as it is: its name, and the facts of its header or of its «Acerca de»
  // tab when they are on screen. Nothing is clicked; LinkedIn's links out are unwrapped to the company's own site.
  const readCompany = () => {
    const linkedinUrl = canonicalCompany(location.href);
    if (!linkedinUrl) return null;
    const main = document.querySelector('main') || document.body;
    const facts = [...main.querySelectorAll('[class*="org-top-card-summary-info-list__info-item"], [class*="org-top-card-summary__info-item"]')]
      .map(node => clean(node.textContent)).filter(Boolean);
    const about = {};
    for (const term of main.querySelectorAll('dt')) {
      const label = clean(term.textContent).toLowerCase();
      const value = term.nextElementSibling?.tagName === 'DD' ? term.nextElementSibling : null;
      if (!value) continue;
      if (/sitio web|website/.test(label)) about.website = value.querySelector('a[href]')?.href || clean(value.textContent);
      else if (/sector|industria|industry/.test(label)) about.industry = clean(value.textContent);
      else if (/tamaño|company size/.test(label)) about.size = clean(value.firstElementChild?.textContent || value.textContent);
      else if (/sede|headquarters/.test(label)) about.headquarters = clean(value.textContent);
    }
    const visit = [...main.querySelectorAll('a[href]')].find(link => /sitio web|website/i.test(`${link.textContent} ${link.getAttribute('aria-label') || ''}`)
      && !/^https:\/\/www\.linkedin\.com\/(company|in|school)\//.test(link.href));
    let website = about.website || visit?.href || '';
    try {
      const url = new URL(website, location.href);
      website = /(^|\.)linkedin\.com$/.test(url.hostname) ? url.searchParams.get('url') || '' : url.href;
    } catch { website = ''; }
    const counts = /seguidores|followers|empleados|employees/i;
    const other = facts.filter(text => !counts.test(text));
    return { linkedinUrl, name: companyHeading(), industry: (about.industry || other[0] || '').slice(0, 160),
      headquarters: (about.headquarters || other[1] || '').slice(0, 200),
      size: (about.size || facts.find(text => /empleados|employees/i.test(text)) || '').slice(0, 100), website: website.slice(0, 300) };
  };
  // The person's latest posts (PR-4e): the «Actividad» section of their profile, or the feed of their activity page. Only what is
  // rendered, up to 3, with LinkedIn's own relative date and whether they posted, shared or commented it; nothing is clicked,
  // expanded or scrolled.
  const ACTIVITY_PAGE = /^\/in\/[^/]+\/?(recent-activity(\/.*)?)?$/;
  const POST = '[data-urn*="urn:li:activity"], .feed-shared-update-v2, .profile-creator-shared-feed-update__container';
  const POST_TEXT = '.update-components-text, .feed-shared-update-v2__description, .feed-shared-inline-show-more-text, [class*="commentary"]';
  const POST_WHEN = '.update-components-actor__sub-description, .feed-shared-actor__sub-description, [class*="actor__sub-description"]';
  const visibleText = node => clean([...(node?.querySelectorAll('span[aria-hidden="true"]') || [])].map(item => item.textContent).join(' ') || node?.textContent);
  const readActivity = () => {
    if (!ACTIVITY_PAGE.test(location.pathname)) return [];
    const recent = /\/recent-activity/.test(location.pathname);
    const scope = recent ? document.querySelector('main') : [...document.querySelectorAll('main section')]
      .find(section => /^(actividad|activity)/i.test(visibleText(section.querySelector('h2'))));
    if (!scope) return [];
    const containers = [...scope.querySelectorAll(POST)];
    const posts = [];
    for (const item of containers.filter(node => !containers.some(other => other !== node && other.contains(node)))) {
      const text = clean(item.querySelector(POST_TEXT)?.textContent).replace(/…?\s*(ver más|see more|más)$/i, '').trim().slice(0, 600);
      if (!text) continue;
      const header = clean(item.querySelector('.update-components-header, .feed-shared-header, [class*="header__text"]')?.textContent);
      const kind = /coment|comment/i.test(header) ? 'comment' : /compart|repost|shared/i.test(header) ? 'repost' : 'post';
      const when = visibleText(item.querySelector(POST_WHEN)).split('•')[0].trim().slice(0, 40);
      posts.push({ text, when, kind });
      if (posts.length >= 3) break;
    }
    return posts;
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
