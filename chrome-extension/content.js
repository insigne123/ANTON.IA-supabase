console.log('Anton.IA LinkedIn Script Active');

const MESSAGE_BUTTON_TEXTS = ['message', 'mensaje', 'send message', 'enviar mensaje'];
const CONNECT_BUTTON_TEXTS = ['connect', 'conectar'];
const MORE_BUTTON_TEXTS = ['more', 'mas'];
const ADD_NOTE_TEXTS = ['add a note', 'anadir una nota', 'agregar una nota', 'personalize', 'personalizar'];
const SEND_BUTTON_TEXTS = ['send', 'enviar', 'done', 'listo', 'connect', 'conectar'];
const DISMISS_BUTTON_TEXTS = ['dismiss', 'cerrar', 'close', 'cancel', 'cancelar', 'no thanks', 'no, gracias', 'got it'];
const PENDING_BUTTON_TEXTS = ['pending', 'pendiente', 'invitation sent', 'invitacion enviada', 'request sent', 'solicitud enviada'];
const FLOW_WAIT_MS = 12000;
const FLOW_POLL_MS = 350;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Anton.IA Content] Received message:', request.action);

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

let lastProcessedMessage = null;
let replyObserver = null;
let observedChatContainer = null;

if (location.href.includes('messaging')) {
    startReplyObserver();
}

let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        if (url.includes('messaging/thread')) {
            console.log('Anton.IA: Thread detected, starting observer...');
            startReplyObserver();
        }
    }
}).observe(document, { subtree: true, childList: true });

function startReplyObserver() {
    const chatContainer = document.querySelector('.msg-s-message-list-container');

    if (!chatContainer) {
        setTimeout(startReplyObserver, 2000);
        return;
    }

    if (observedChatContainer === chatContainer && replyObserver) {
        return;
    }

    if (replyObserver) {
        replyObserver.disconnect();
    }

    console.log('Anton.IA: Observer attached to chat container');

    observedChatContainer = chatContainer;
    replyObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                checkLastMessage();
            }
        }
    });

    replyObserver.observe(chatContainer, { childList: true, subtree: true });
    checkLastMessage();
}

function checkLastMessage() {
    const items = document.querySelectorAll('.msg-s-event-listitem');
    if (items.length === 0) return;

    const lastItem = items[items.length - 1];
    const isMine = lastItem.innerHTML.includes('msg-s-message-group--is-mine') ||
        lastItem.closest('.msg-s-message-group--is-mine');

    if (!isMine) {
        const textElement = lastItem.querySelector('.msg-s-event-listitem__body');
        const text = textElement ? textElement.innerText : '';

        if (text && text !== lastProcessedMessage) {
            console.log('Anton.IA: Reply Detected!', text.substring(0, 20) + '...');
            lastProcessedMessage = text;

            chrome.runtime.sendMessage({
                action: 'REPLY_DETECTED',
                replyText: text,
                linkedinThreadUrl: location.href,
                profileUrl: extractProfileFromThread(),
            });
        }
    }
}

function extractProfileFromThread() {
    const headerLink = document.querySelector('.msg-thread-section__sender a.msg-thread-section__sender-link');
    return headerLink ? headerLink.href : null;
}

async function runDMFlow(profileUrl, message) {
    console.log('[Anton.IA Content] Starting runDMFlow...');

    if (!isOnRequestedProfile(profileUrl)) {
        console.log('[Anton.IA Content] URL/Path mismatch. Redirecting...', {
            current: normalizePath(window.location.href),
            target: normalizePath(profileUrl),
        });
        window.location.href = profileUrl;
        return { success: false, error: 'Redirecting to profile...' };
    }

    await delay(1500);
    await closeBlockingDialog();

    console.log('[Anton.IA Content] Strategy 1: Attempting Direct Message...');
    const directMessageResult = await tryDirectMessage(message);
    if (directMessageResult) {
        return directMessageResult;
    }

    console.log('[Anton.IA Content] Strategy 2: Attempting Connect + Note...');
    return handleConnectFlow(message);
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
        console.warn('[Anton.IA Content] Message flow opened a blocking dialog. Falling back to Connect flow.', {
            kind: state.kind,
            text: (state.text || '').slice(0, 160),
        });
        await closeBlockingDialog();
        return null;
    }

    console.warn('[Anton.IA Content] Message flow did not produce an editor. Falling back.', getStateSnapshot());
    return null;
}

async function sendMessageInEditor(editor, message) {
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
        console.error('[Anton.IA Content] Send button not found in DM editor.', getStateSnapshot());
        throw new Error('Send button not found in DM editor');
    }

    if (isElementDisabled(sendBtn)) {
        console.error('[Anton.IA Content] Send button is disabled.', describeElement(sendBtn));
        throw new Error('Send button is disabled after writing the message');
    }

    console.log('[Anton.IA Content] Clicking Send button:', describeElement(sendBtn));
    safeClick(sendBtn);
    await delay(1200);

    return { success: true, status: 'Message sent via DM' };
}

async function handleConnectFlow(message) {
    await closeBlockingDialog();

    const profileRoot = getPrimaryProfileRoot();
    let connectBtn = findConnectButton(profileRoot);

    if (!connectBtn) {
        console.log('[Anton.IA Content] Connect button not visible. Checking More menu...');
        const moreBtn = findMoreButton(profileRoot);
        if (moreBtn) {
            console.log('[Anton.IA Content] Opening More menu:', describeElement(moreBtn));
            safeClick(moreBtn);
            await delay(900);
            connectBtn = findConnectButton(document);
        }
    }

    if (!connectBtn) {
        throw new Error('Could not find Connect button on this profile');
    }

    if (isPendingButton(connectBtn)) {
        console.log('[Anton.IA Content] Connection request already pending on action button.');
        return { success: false, error: 'Connection request already pending' };
    }

    console.log('[Anton.IA Content] Clicking Connect button:', describeElement(connectBtn));
    safeClick(connectBtn);

    let state = await waitForState(() => getConnectState({ profileRoot }), FLOW_WAIT_MS, FLOW_POLL_MS);
    if (state.kind === 'idle') {
        console.warn('[Anton.IA Content] No recognizable state after first Connect click. Retrying once.', getStateSnapshot());
        await delay(900);
        const retryBtn = findConnectButton(profileRoot) || findConnectButton(document);
        if (retryBtn) {
            safeClick(retryBtn);
            state = await waitForState(() => getConnectState({ profileRoot }), 8000, FLOW_POLL_MS);
        }
    }

    if (state.kind === 'quick-success') {
        return { success: true, status: 'Connection request sent (Quick Connect)' };
    }

    if (state.kind === 'pending') {
        return { success: false, error: 'Connection request already pending' };
    }

    if (state.kind === 'limit') {
        throw new Error('Weekly invitation limit reached');
    }

    if (state.kind === 'note-prompt') {
        console.log('[Anton.IA Content] Add note prompt detected. Clicking Add note.');
        safeClick(state.addNoteBtn);
        state = await waitForState(() => getConnectState({ profileRoot }), 6000, 250);
    }

    if (state.kind === 'send-prompt') {
        console.log('[Anton.IA Content] Connect dialog has direct send action. Submitting without note.');
        safeClick(state.sendBtn);
        await delay(1200);
        if (findPendingIndicator(profileRoot) || findSuccessToast()) {
            return { success: true, status: 'Connection request sent' };
        }
        return { success: true, status: 'Connection request submitted' };
    }

    if (state.kind === 'note-editor') {
        console.log('[Anton.IA Content] Note editor detected. Typing custom note.');
        setElementText(state.editor, message);
        await delay(700);

        if (!textLooksApplied(state.editor, message)) {
            setElementText(state.editor, message);
            await delay(600);
        }

        const sendBtn = findSendButton(state.dialog || document);
        if (!sendBtn) {
            throw new Error('Could not find Send button in LinkedIn connect dialog');
        }

        if (isElementDisabled(sendBtn)) {
            throw new Error('Connect dialog send button stayed disabled');
        }

        safeClick(sendBtn);
        await delay(1200);

        if (findPendingIndicator(profileRoot) || findSuccessToast()) {
            return { success: true, status: 'Connection request sent with note' };
        }
        return { success: true, status: 'Connection request submitted with note' };
    }

    console.error('[Anton.IA Content] Connect flow ended in an unknown state.', getStateSnapshot());
    throw new Error('Connect click did not produce a recognizable LinkedIn state');
}

function getConnectState(context = {}) {
    const pending = findPendingIndicator(context.profileRoot);
    if (pending) return { kind: 'pending', pending };

    const toast = findSuccessToast();
    if (toast) return { kind: 'quick-success', toast };

    if (context.profileRoot) {
        const connectButton = findConnectButton(context.profileRoot);
        const messageButton = findMessageButton(context.profileRoot);
        if (!connectButton && messageButton) return { kind: 'quick-success', messageButton };
    }

    const dialog = getDialogRoot();
    const editor = findNoteEditor(dialog || document);
    if (editor) return { kind: 'note-editor', editor, dialog };

    if (!dialog) return { kind: 'idle' };

    const dialogText = normalizeText(dialog.innerText || '');
    if (isInvitationLimitText(dialogText)) return { kind: 'limit', dialog, dialogText };

    const addNoteBtn = findActionElement(ADD_NOTE_TEXTS, { root: dialog });
    if (addNoteBtn) return { kind: 'note-prompt', dialog, addNoteBtn, dialogText };

    const sendBtn = findSendButton(dialog);
    if (sendBtn) return { kind: 'send-prompt', dialog, sendBtn, dialogText };

    return { kind: 'dialog', dialog, dialogText };
}

function isOnRequestedProfile(profileUrl) {
    const currentPath = normalizePath(window.location.href);
    const targetPath = normalizePath(profileUrl);
    return currentPath.includes(targetPath) || targetPath.includes(currentPath);
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
        const main = document.querySelector('main');
        if (main && isElementVisible(main)) roots.push(main);
    }

    return roots;
}

function getPrimaryProfileRoot() {
    return getProfileActionRoots()[0] || document;
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

function findNoteEditor(root) {
    const scope = root || document;
    const selectors = [
        'textarea[name="message"]',
        '#custom-message',
        '.artdeco-modal textarea',
        '[role="dialog"] textarea',
        '.artdeco-modal [contenteditable="true"][role="textbox"]',
        '[role="dialog"] [contenteditable="true"]',
    ];

    for (const selector of selectors) {
        const element = Array.from(scope.querySelectorAll(selector)).find(isElementVisible);
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

function findConnectButton(root) {
    return findActionElement(CONNECT_BUTTON_TEXTS, {
        root: root || getPrimaryProfileRoot() || document,
        excludeTexts: ['connected', 'connections', 'pending', 'message', 'mensaje'],
    }) || (!root ? findActionElement(CONNECT_BUTTON_TEXTS, {
        excludeTexts: ['connected', 'connections', 'pending', 'message', 'mensaje'],
    }) : null);
}

function findMoreButton(root) {
    return findActionElement(MORE_BUTTON_TEXTS, {
        root: root || getPrimaryProfileRoot() || document,
        excludeTexts: ['more relevant', 'more filters'],
    }) || (!root ? findActionElement(MORE_BUTTON_TEXTS, {
        excludeTexts: ['more relevant', 'more filters'],
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

function findPendingIndicator(root) {
    const roots = root ? [root] : getProfileActionRoots();

    for (const scope of roots) {
        const candidates = getActionCandidates(scope, {
            includeDisabled: true,
            selectors: ['button', '[role="button"]', 'a[role="button"]', 'span'],
        });

        for (const node of candidates) {
            if (isPendingButton(node)) return node;
        }
    }

    return null;
}

function findSuccessToast() {
    const toast = Array.from(document.querySelectorAll('.artdeco-toast-item, .artdeco-toast, [role="alert"]')).find(isElementVisible);
    if (!toast) return null;

    const text = normalizeText(toast.innerText || '');
    if (!text) return toast;

    const successHints = ['sent', 'enviado', 'pending', 'pendiente', 'invitation', 'invitacion', 'request'];
    return successHints.some((hint) => text.includes(hint)) ? toast : null;
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

function isInvitationLimitText(text) {
    return [
        'weekly invitation limit',
        'invitation limit',
        'reach the invitation limit',
        'reach your invitation limit',
        'limite de invitaciones',
        'llegaste al limite',
    ].some((token) => text.includes(token));
}

function isPendingButton(node) {
    if (!(node instanceof HTMLElement)) return false;
    const label = normalizeText(getElementLabel(node));
    if (!label) return false;

    return PENDING_BUTTON_TEXTS.some((token) => {
        return label === token || label.startsWith(`${token} `) || label.includes(` ${token}`);
    });
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

function getStateSnapshot() {
    const dialog = getDialogRoot();
    return {
        url: location.href,
        hasMessageEditor: !!getMessageEditor(),
        hasNoteEditor: !!findNoteEditor(dialog || document),
        hasPending: !!findPendingIndicator(getPrimaryProfileRoot()),
        dialogText: dialog ? normalizeText(dialog.innerText || '').slice(0, 180) : '',
        visibleButtons: getActionCandidates(document, { includeDisabled: true })
            .slice(0, 10)
            .map((node) => describeElement(node)),
    };
}
