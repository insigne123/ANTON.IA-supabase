// Simplified background script - v1.7
console.log('[Anton.IA Background] Service Worker Started!');

// Store pending DM requests
const pendingRequests = new Map();
const CONTENT_SCRIPT_TIMEOUT_MS = 55000;

function isAllowedAppUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:9003',
            'http://127.0.0.1:9003',
            'https://app.antonia.ai',
            'https://studio--leadflowai-3yjcy.us-central1.hosted.app',
        ].includes(url.origin);
    } catch {
        return false;
    }
}

function normalizeProfileUrl(value) {
    try {
        const url = new URL(String(value || ''));
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        const path = url.pathname.replace(/\/+$/, '');
        if (host !== 'linkedin.com' || !/^\/in\/[a-z0-9][a-z0-9-]*$/i.test(path)) return '';
        return `https://www.linkedin.com${path}`;
    } catch {
        return '';
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request?.action;

    if (action === 'CHECK_STATUS') {
        sendResponse({ status: 'active' });
        return true;
    }

    if (action === 'SEND_DM') {
        if (!isAllowedAppUrl(sender?.tab?.url)) {
            sendResponse({ requestId: request?.requestId || null, success: false, error: 'Origen no autorizado.' });
            return false;
        }
        handleSendDM(request, sendResponse);
        return true; // Keep channel open
    }

    // NEW: Handle response from content script
    if (action === 'DM_RESULT') {
        const callback = pendingRequests.get(request.requestId);
        if (callback) {
            callback({
                requestId: request.requestId,
                ...(request.result || {})
            });
            pendingRequests.delete(request.requestId);
        }
        return false;
    }

    return false;
});

async function handleSendDM(payload, sendResponse) {
    try {
        const targetUrl = normalizeProfileUrl(payload.profileUrl);
        const requestId = payload.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        if (!targetUrl || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 500) {
            sendResponse({ requestId, success: false, error: 'Perfil o mensaje de LinkedIn inválido.' });
            return;
        }

        // Wait for navigation without leaving a pending request if LinkedIn never settles.
        const waitForTabLoad = (tabId) => {
            return new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    chrome.tabs.onUpdated.removeListener(listener);
                    clearTimeout(timeout);
                    setTimeout(resolve, 1200);
                };
                const listener = (tid, changeInfo, tab) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        finish();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                const timeout = setTimeout(finish, 12000);
                chrome.tabs.get(tabId).then((tab) => {
                    if (tab.status === 'complete') finish();
                }).catch(finish);
            });
        };

        // Reuse only the exact profile tab; otherwise navigate the active LinkedIn tab.
        let tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
        let activeTab = tabs.find((tab) => normalizeProfileUrl(tab.url) === targetUrl)
            || tabs.find((tab) => tab.active)
            || tabs[0]
            || null;
        let needNavigation = false;

        if (activeTab) {
            if (normalizeProfileUrl(activeTab.url) !== targetUrl) {
                chrome.tabs.update(activeTab.id, { url: targetUrl, active: true });
                needNavigation = true;
            } else {
                chrome.tabs.update(activeTab.id, { active: true });
            }
        } else {
            activeTab = await chrome.tabs.create({ url: targetUrl, active: true });
            needNavigation = true;
        }

        // Wait for navigation if needed
        if (needNavigation) {
            await waitForTabLoad(activeTab.id);
        }

        // Store the sendResponse callback
        pendingRequests.set(requestId, sendResponse);

        // Send message to content script
        // Retry logic for sending the message (in case content script needs a moment to initialize)
        const sendMessageWithRetry = async (retries = 3) => {
            chrome.tabs.sendMessage(
                activeTab.id,
                {
                    action: 'EXECUTE_DM_FLOW',
                    requestId: requestId,
                    profileUrl: targetUrl,
                    message: payload.message
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Anton.IA Background] Send error:', chrome.runtime.lastError.message);
                        if (retries > 0) {
                            setTimeout(() => sendMessageWithRetry(retries - 1), 1000);
                        } else {
                            sendResponse({ requestId, success: false, error: 'No se pudo conectar con la pestaña de LinkedIn.' });
                            pendingRequests.delete(requestId);
                        }
                    }
                }
            );
        };

        sendMessageWithRetry();

        // Timeout safety
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                console.error('[Anton.IA Background] Timeout for request:', requestId);
                sendResponse({ requestId, success: false, error: 'Timeout waiting for content script logic' });
                pendingRequests.delete(requestId);
            }
        }, CONTENT_SCRIPT_TIMEOUT_MS);

    } catch (error) {
        console.error('[Anton.IA Background] Exception:', error);
        sendResponse({
            requestId: payload.requestId || null,
            success: false,
            error: error.message
        });
    }
}

console.log('[Anton.IA Background] Initialization complete');
