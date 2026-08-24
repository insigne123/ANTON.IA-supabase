console.log('Anton.IA LinkedIn Script Active');

const MESSAGE_BUTTON_TEXTS = ['message', 'mensaje', 'send message', 'enviar mensaje'];
const SEND_BUTTON_TEXTS = ['send', 'enviar'];
const DISMISS_BUTTON_TEXTS = ['dismiss', 'cerrar', 'close', 'cancel', 'cancelar', 'no thanks', 'no, gracias', 'got it'];
const FLOW_POLL_MS = 350;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
        sendResponse({ status: 'ready' });
        return false;
    }

    if (request.action === 'EXECUTE_DM_FLOW') {
        const requestId = request.requestId;

        console.log('[Anton.IA Content] Acknowledging receipt for request:', requestId);
        sendResponse({ received: true, requestId });

        runDMFlow(request.profileUrl, request.message)
            .then((result) => {
                console.log('[Anton.IA Content] Sending success result back to background:', result);
                chrome.runtime.sendMessage({
                    action: 'DM_RESULT',
                    requestId,
                    result,
                });
            })
            .catch((error) => {
                console.error('[Anton.IA Content] Sending error result back to background:', error);
                chrome.runtime.sendMessage({
                    action: 'DM_RESULT',
                    requestId,
                    result: { success: false, error: error.message },
                });
            });

        return false;
    }

    return false;
});

async function runDMFlow(profileUrl, message) {
    if (!isOnRequestedProfile(profileUrl)) {
        return { success: false, error: 'LinkedIn no abrió el perfil solicitado. Reintenta desde el lead.' };
    }

    await delay(1500);
    await closeBlockingDialog();

    const directMessageResult = await tryDirectMessage(message);
    if (directMessageResult) {
        return directMessageResult;
    }

    // Never turn a requested DM into a connection request without a separate user action.
    return { success: false, error: 'No se pudo abrir el mensaje directo. No enviamos una solicitud de conexión automáticamente.' };
}

async function tryDirectMessage(message) {
    const profileRoot = getPrimaryProfileRoot();
    const msgBtn = findMessageButton(profileRoot);
    if (!msgBtn) {
        console.log('[Anton.IA Content] No Message button found.');
        return null;
    }

    console.log('[Anton.IA Content] Clicking Message button:', describeElement(msgBtn));
    safeClick(msgBtn);

    const state = await waitForState(() => {
        const editor = getMessageEditor();
        if (editor) return { kind: 'editor', editor };

        const dialog = getDialogRoot();
        if (dialog) {
            const text = normalizeText(dialog.innerText || '');
            if (isUpsellText(text)) return { kind: 'upsell', dialog, text };
            return { kind: 'dialog', dialog, text };
        }

        return { kind: 'idle' };
    }, 14000, FLOW_POLL_MS);

    if (state.kind === 'editor') {
        console.log('[Anton.IA Content] Message editor detected.');
        return sendMessageInEditor(state.editor, message);
    }

    if (state.kind === 'upsell' || state.kind === 'dialog') {
        console.warn('[Anton.IA Content] Message flow opened a blocking dialog.', {
            kind: state.kind,
            text: (state.text || '').slice(0, 160),
        });
        await closeBlockingDialog();
        return null;
    }

    console.warn('[Anton.IA Content] Message flow did not produce an editor.');
    return null;
}

async function sendMessageInEditor(editor, message) {
    const outgoingCountBefore = getOutgoingMessageCount();
    setElementText(editor, message);
    await delay(900);

    if (!textLooksApplied(editor, message)) {
        console.warn('[Anton.IA Content] Message text did not stick on first attempt. Retrying insertion.');
        setElementText(editor, message);
        await delay(700);
    }

    if (!textLooksApplied(editor, message)) {
        throw new Error('Message editor did not accept the text');
    }

    const sendBtn = findSendButton(editor.closest('form') || editor.closest('.msg-overlay-conversation-bubble') || document);
    if (!sendBtn) {
        console.error('[Anton.IA Content] Send button not found in DM editor.');
        throw new Error('Send button not found in DM editor');
    }

    if (isElementDisabled(sendBtn)) {
        console.error('[Anton.IA Content] Send button is disabled.', describeElement(sendBtn));
        throw new Error('Send button is disabled after writing the message');
    }

    safeClick(sendBtn);
    const confirmed = await waitForOutgoingMessage(message, outgoingCountBefore);
    if (!confirmed) {
        return { success: false, error: 'LinkedIn no confirmó el mensaje enviado. Revisa la conversación antes de reintentar.' };
    }

    return { success: true, status: 'confirmed_dm', linkedinThreadUrl: location.href };
}

function isOnRequestedProfile(profileUrl) {
    try {
        const current = new URL(window.location.href);
        const target = new URL(profileUrl);
        return current.hostname.replace(/^www\./i, '').toLowerCase() === 'linkedin.com'
            && target.hostname.replace(/^www\./i, '').toLowerCase() === 'linkedin.com'
            && normalizePath(current.href) === normalizePath(target.href);
    } catch {
        return false;
    }
}

function getOutgoingMessageCount() {
    return document.querySelectorAll('.msg-s-message-group--is-mine, .msg-s-event-listitem .msg-s-message-group--is-mine').length;
}

async function waitForOutgoingMessage(message, countBefore) {
    const expected = normalizeText(message);
    const startedAt = Date.now();

    while (Date.now() - startedAt < 8000) {
        const outgoing = Array.from(document.querySelectorAll('.msg-s-message-group--is-mine, .msg-s-event-listitem'))
            .filter((node) => node.classList.contains('msg-s-message-group--is-mine') || node.querySelector('.msg-s-message-group--is-mine'));
        const hasNewMessage = outgoing.length > countBefore;
        const hasExpectedText = outgoing.some((node) => normalizeText(node.innerText || '').includes(expected));
        if (hasNewMessage && hasExpectedText) return true;
        await delay(350);
    }

    return false;
}

function normalizePath(urlStr) {
    try {
        const value = String(urlStr || '').startsWith('http') ? String(urlStr || '') : `https://${String(urlStr || '')}`;
        const url = new URL(value);
        return url.pathname.toLowerCase().replace(/\/$/, '');
    } catch {
        return String(urlStr || '').toLowerCase().split('?')[0].replace(/\/$/, '');
    }
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForState(reader, timeoutMs, intervalMs) {
    const startedAt = Date.now();
    let lastState = { kind: 'idle' };

    while (Date.now() - startedAt < timeoutMs) {
        lastState = reader() || { kind: 'idle' };
        if (lastState.kind !== 'idle') {
            return lastState;
        }
        await delay(intervalMs);
    }

    return lastState;
}

function getProfileActionRoots() {
    const selectors = [
        '.pv-top-card-v2-ctas',
        '.pv-top-card-profile-actions',
        '.top-card-layout__actions',
        '.profile-topcard-person-entity__actions',
        '.pv-top-card',
    ];

    const roots = [];
    for (const selector of selectors) {
        const matches = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
        for (const match of matches) {
            if (!roots.includes(match)) roots.push(match);
        }
    }

    if (!roots.length) {
        const messageBtn = findActionElement(MESSAGE_BUTTON_TEXTS, {
            root: document,
            excludeTexts: ['message ads', 'messaging'],
        });
        for (const button of [messageBtn]) {
            const container = getActionContainerForButton(button);
            if (container && !roots.includes(container)) roots.push(container);
        }
    }

    return roots;
}

function getPrimaryProfileRoot() {
    return getProfileActionRoots()[0] || null;
}

function getActionContainerForButton(button) {
    if (!(button instanceof HTMLElement)) return null;
    return button.closest('.pv-top-card-v2-ctas, .pv-top-card-profile-actions, .top-card-layout__actions, .profile-topcard-person-entity__actions, .artdeco-card')
        || button.parentElement
        || null;
}

function getActionCandidates(root, options) {
    const scope = root || document;
    const selectors = options && options.selectors
        ? options.selectors
        : ['button', 'a[role="button"]', 'a.artdeco-button', 'div[role="button"]', 'li[role="menuitem"]'];

    const nodes = Array.from(scope.querySelectorAll(selectors.join(',')))
        .map((node) => resolveClickableTarget(node))
        .filter(Boolean);

    return nodes
        .filter((node, index) => nodes.indexOf(node) === index)
        .filter((node) => isElementVisible(node))
        .filter((node) => (options && options.includeDisabled) || !isElementDisabled(node));
}

function findActionElement(texts, options) {
    const normalizedTexts = texts.map(normalizeText).filter(Boolean);
    const excluded = (options && options.excludeTexts ? options.excludeTexts : []).map(normalizeText);
    const candidates = getActionCandidates(options && options.root, options);
    let best = null;
    let bestScore = 0;

    for (const node of candidates) {
        const label = normalizeText(getElementLabel(node));
        if (!label) continue;
        if (excluded.some((token) => token && label.includes(token))) continue;

        let score = 0;
        for (const token of normalizedTexts) {
            const currentScore = scoreActionLabel(label, token);
            if (currentScore > score) score = currentScore;
        }

        if (!score) continue;
        if (String(node.className || '').includes('artdeco-button--primary')) score += 10;
        if (node.closest('.pv-top-card-v2-ctas, .pv-top-card-profile-actions, .top-card-layout__actions')) score += 20;
        if (node.closest('.artdeco-dropdown__content-inner')) score += 4;
        if (node.closest('main')) score += 6;
        if (node.closest('aside')) score -= 60;

        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.55) score += 8;
        if (rect.left < window.innerWidth * 0.75) score += 6;

        if (score > bestScore) {
            best = node;
            bestScore = score;
        }
    }

    return best;
}

function scoreActionLabel(label, token) {
    if (!label || !token) return 0;
    if (label === token) return 150;

    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordMatch = new RegExp(`(^|\\b)${escaped}(\\b|$)`).test(label);
    if (wordMatch) return 120;
    if (label.includes(token)) return 90;
    return 0;
}

function getElementLabel(node) {
    return node.innerText || node.getAttribute('aria-label') || node.textContent || '';
}

function resolveClickableTarget(node) {
    if (!(node instanceof Element)) return null;
    return node.closest('button, a[role="button"], a.artdeco-button, div[role="button"], li[role="menuitem"]') || node;
}

function isElementVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isElementDisabled(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.hasAttribute('disabled')) return true;
    if (node.getAttribute('aria-disabled') === 'true') return true;
    return false;
}

function safeClick(node) {
    if (!(node instanceof HTMLElement)) return false;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    node.focus({ preventScroll: true });
    try {
        node.click();
    } catch {
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    return true;
}

function describeElement(node) {
    if (!(node instanceof HTMLElement)) return 'unknown-element';
    return {
        tag: node.tagName.toLowerCase(),
        text: getElementLabel(node).trim().slice(0, 80),
        ariaLabel: (node.getAttribute('aria-label') || '').trim().slice(0, 80),
        className: String(node.className || '').trim().slice(0, 120),
    };
}

function getMessageEditor() {
    const selectors = [
        'textarea[name="message"]',
        'textarea[aria-label*="message" i]',
        'textarea[placeholder*="message" i]',
        'div.msg-form__contenteditable[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"][aria-label*="message" i]',
        '[contenteditable="true"][data-placeholder*="message" i]',
        '.msg-form__msg-content-container [contenteditable="true"]',
        '.msg-overlay-conversation-bubble [contenteditable="true"]',
    ];

    for (const selector of selectors) {
        const element = Array.from(document.querySelectorAll(selector)).find(isElementVisible);
        if (element) return element;
    }

    return null;
}

function getDialogRoot() {
    const selectors = ['.artdeco-modal', '.artdeco-modal__content', '[role="dialog"]'];
    for (const selector of selectors) {
        const element = Array.from(document.querySelectorAll(selector)).find(isElementVisible);
        if (element) return element;
    }
    return null;
}

function findMessageButton(root) {
    return findActionElement(MESSAGE_BUTTON_TEXTS, {
        root: root || getPrimaryProfileRoot() || document,
        excludeTexts: ['message ads', 'messaging'],
    }) || (!root ? findActionElement(MESSAGE_BUTTON_TEXTS, {
        excludeTexts: ['message ads', 'messaging'],
    }) : null);
}

function findSendButton(root) {
    return findActionElement(SEND_BUTTON_TEXTS, {
        root,
        excludeTexts: DISMISS_BUTTON_TEXTS,
        selectors: [
            'button.msg-form__send-button',
            'button[type="submit"]',
            '.msg-form__footer button',
            '.artdeco-modal button',
            '[role="dialog"] button',
            'button',
        ],
    });
}

function findDismissButton() {
    const dialog = getDialogRoot();
    const scopedDismiss = findActionElement(DISMISS_BUTTON_TEXTS, {
        root: dialog || document,
        selectors: ['button', '[role="button"]', 'a[role="button"]'],
        includeDisabled: true,
    });
    if (scopedDismiss) return scopedDismiss;

    const hardSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
        'button[aria-label="Cerrar"]',
        '.artdeco-modal__dismiss',
    ];

    for (const selector of hardSelectors) {
        const element = Array.from(document.querySelectorAll(selector)).find(isElementVisible);
        if (element) return element;
    }

    return null;
}

async function closeBlockingDialog() {
    const dismissBtn = findDismissButton();
    if (!dismissBtn) return false;

    console.log('[Anton.IA Content] Closing blocking dialog:', describeElement(dismissBtn));
    safeClick(dismissBtn);
    await delay(700);
    return true;
}

function isUpsellText(text) {
    return ['premium', 'inmail', 'sales navigator', 'try premium', 'prueba premium', 'unlock'].some((token) => text.includes(token));
}

function setElementText(node, value) {
    const text = String(value || '').trim();
    if (!(node instanceof HTMLElement) || !text) return;

    node.focus({ preventScroll: true });

    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value');
        const nativeSetter = descriptor && descriptor.set ? descriptor.set.bind(node) : null;

        if (nativeSetter) {
            nativeSetter('');
        } else {
            node.value = '';
        }
        node.dispatchEvent(new Event('input', { bubbles: true }));

        if (nativeSetter) {
            nativeSetter(text);
        } else {
            node.value = text;
        }
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        return;
    }

    const selection = window.getSelection();
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    node.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
    const inserted = document.execCommand('insertText', false, text);

    if (!inserted || !textLooksApplied(node, text)) {
        node.textContent = '';
        node.appendChild(document.createTextNode(text));
    }

    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

function textLooksApplied(node, text) {
    const current = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
        ? node.value
        : (node.innerText || node.textContent || '');
    const expected = normalizeText(String(text || '').slice(0, 18));
    return !!expected && normalizeText(current).includes(expected);
}
