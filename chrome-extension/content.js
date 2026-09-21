// Shared DOM helpers. This file does not send messages or listen to legacy DM commands.
function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isElementVisible(node) {
  if (!(node instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
}
function isElementDisabled(node) {
  return !(node instanceof HTMLElement) || node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true';
}
function safeClick(node) {
  if (!(node instanceof HTMLElement)) return false;
  node.scrollIntoView({ block: 'center', inline: 'center' });
  node.focus({ preventScroll: true });
  node.click();
  return true;
}
function findMessageButton(root) {
  if (!root) return null;
  const labels = ['message', 'mensaje', 'send message', 'enviar mensaje', 'inmail', 'enviar inmail', 'send inmail'];
  return Array.from(root.querySelectorAll('button, a, [role="button"]'))
    .find(node => isElementVisible(node) && !isElementDisabled(node)
      && [node.textContent, node.getAttribute('aria-label'), ...Array.from(node.querySelectorAll('span[aria-hidden="true"], .artdeco-button__text')).map(span => span.textContent)].some(value => labels.includes(normalizeText(value)) || /^(?:send message|enviar mensaje|message|mensaje|send inmail|enviar inmail) (?:to|a) .+$/.test(normalizeText(value)))) || null;
}
function linkedinProfileHeader(expectedName = '') {
  const roots = [...document.querySelectorAll('main, [role="main"]')];
  if (!roots.length) roots.push(document.body);
  const headings = roots.flatMap(root => [...root.querySelectorAll('h1, h2, [role="heading"]')])
    .filter(node => isElementVisible(node) && !node.closest('aside, [role="dialog"], .msg-overlay-conversation-bubble'));
  const titleName = document.title.replace(/^\(\d+\)\s*/, '').split(/\s[|–]\s/)[0];
  const expected = normalizeText(expectedName || titleName);
  // Some profile headers render the name as a paragraph/span rather than a heading.
  if (expected) {
    const names = roots.flatMap(root => [...root.querySelectorAll('p, span')]).filter(node =>
      isElementVisible(node) && normalizeText(node.textContent) === expected
      && !node.closest('aside, [role="dialog"], .msg-overlay-conversation-bubble')
      && ![...node.children].some(child => normalizeText(child.textContent) === expected));
    if (names.length === 1 && !headings.includes(names[0])) headings.push(names[0]);
  }
  const named = expected && headings.filter(node => normalizeText(node.textContent) === expected);
  const h1s = [...new Set(headings.filter(node => node.tagName === 'H1' || node.getAttribute('aria-level') === '1'))];
  const heading = named?.length === 1 ? named[0] : h1s.length === 1 ? h1s[0] : null;
  if (!heading) return null;
  // Ascend the actual layout rather than depending on section/artdeco class names.
  // Stop before unrelated profile sections, recommendations or the entire page.
  let card = heading.parentElement;
  let actionCard = card;
  for (let depth = 0; card && depth < 16; depth++, card = card.parentElement) {
    if (card.matches('body, html') || card.querySelector('aside')) break;
    const unrelated = [...card.querySelectorAll('h1, h2, [role="heading"]')]
      .some(node => node !== heading && isElementVisible(node) && normalizeText(node.textContent) !== normalizeText(heading.textContent));
    if (unrelated) break;
    actionCard = card;
    const button = findMessageButton(card);
    if (button) return { heading, card, button };
    if (card.matches('main, [role="main"]')) break;
  }
  return { heading, card: actionCard, button: null };
}
function linkedinContactRequirement(header) {
  const actions = [...(header?.card?.querySelectorAll('button, a, [role="button"]') || [])].filter(isElementVisible);
  const has = pattern => actions.some(node => pattern.test(normalizeText(node.textContent)) || pattern.test(normalizeText(node.getAttribute('aria-label'))));
  if (has(/^(conectar|connect)(\b|$)/)) return 'Este perfil no ofrece un mensaje directo. En LinkedIn gratuito, solicita Conectar y espera la aceptación. Seguir no equivale a conectar. Si tienes Premium, abre InMail cuando LinkedIn lo ofrezca.';
  if (has(/^(seguir|follow)(\b|$)/)) return 'Este perfil ofrece Seguir, pero no encontramos un mensaje disponible. Puedes pulsar Seguir en LinkedIn; seguirlo no garantiza poder escribirle. Para una cuenta gratuita, busca Conectar en Más; con Premium, utiliza InMail si está disponible.';
  return 'No pudimos localizar una acción de mensaje en la cabecera. Abre Enviar mensaje o InMail manualmente y vuelve a Preparar. Si LinkedIn pide conectar o contratar Premium, conserva el borrador hasta tener acceso.';
}
function linkedinMessagingGate() {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(isElementVisible);
  return dialogs.some(node => /(?:prueba|probar|reactivar|try|reactivate|upgrade|suscrib|abonate).{0,50}premium|(?:creditos|credits).{0,30}inmail|(?:sin|no|0) creditos/i.test(normalizeText(node.textContent)))
    ? 'LinkedIn está pidiendo Premium o créditos de InMail. Con una cuenta gratuita, solicita conectar y espera la aceptación, salvo que el perfil permita mensajes abiertos. Con Premium, revisa tu acceso y créditos en LinkedIn. Conservamos el mensaje; seguir al perfil no elimina este requisito.' : '';
}
function linkedinIsInMail(bubble) {
  return Boolean(bubble.querySelector('.msg-form__subject, input[name="subject"], input[placeholder*="Asunto"], input[placeholder*="Subject"]'))
    || /\binmail\b/i.test(bubble.querySelector('.msg-overlay-bubble-header, [data-view-name="message-recipient"]')?.textContent || '');
}
async function waitLinkedinProfileHeader(profileUrl, expectedName) {
  const path = value => { try { return decodeURIComponent(new URL(value).pathname).normalize('NFC').replace(/\/+$/, '').toLowerCase(); } catch { return ''; } };
  for (let attempt = 0; attempt < 20; attempt++) {
    if (path(location.href) !== path(profileUrl)) throw new Error('El perfil cambió. Vuelve al destinatario para continuar.');
    const header = linkedinProfileHeader(expectedName);
    if (header?.button) return header;
    await delay(250);
  }
  throw new Error(linkedinContactRequirement(linkedinProfileHeader(expectedName)));
}
function linkedinConversationRecipient(bubble, target, canonical) {
  const links = [...bubble.querySelectorAll('.msg-overlay-bubble-header a[href*="/in/"], .msg-entity-lockup a[href*="/in/"], [data-view-name="message-recipient"] a[href*="/in/"]')];
  return links.length > 0 && links.every(link => canonical(link.href) === target);
}
function linkedinMessageEditor(bubble) {
  const editors = [...bubble.querySelectorAll('.msg-form__contenteditable[contenteditable="true"], [role="textbox"][contenteditable="true"], textarea[name="message"]')].filter(isElementVisible);
  return editors.length === 1 ? editors[0] : null;
}
function linkedinEditorText(editor) { return editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent || ''; }
function setElementText(node, value) {
  const text = String(value || '').trim();
  if (!(node instanceof HTMLElement) || !text) return;
  node.focus({ preventScroll: true });
  if (node instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(node, text);
    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges(); selection?.addRange(range);
  // Insert in the scoped contenteditable. Never select or delete the entire page.
  const inserted = document.execCommand?.('insertText', false, text);
  if (!inserted) node.textContent = text;
  node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
}
function textLooksApplied(node, value) {
  const normalized = text => String(text || '').replace(/\s+/g, ' ').trim();
  return normalized(linkedinEditorText(node)) === normalized(value);
}
