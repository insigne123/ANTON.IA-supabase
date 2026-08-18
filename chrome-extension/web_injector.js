console.log('[Anton.IA Ext] Web Injector Loaded on:', window.location.href);

const APP_ORIGIN = window.location.origin;

function postToPage(type, payload) {
    window.postMessage({ type, payload }, APP_ORIGIN);
}

// 1. Listen for messages from the Web App (React)
window.addEventListener('message', function (event) {
    // We only accept messages from ourselves
    if (event.source !== window) return;
    if (event.origin !== APP_ORIGIN) return;
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type && event.data.type === 'ANTON_TO_EXTENSION') {
        const payload = event.data.payload || {};
        const requestId = typeof payload.requestId === 'string' ? payload.requestId : null;

        if (
            payload.action !== 'SEND_DM' ||
            !requestId ||
            typeof payload.profileUrl !== 'string' ||
            typeof payload.message !== 'string' ||
            payload.message.trim().length === 0 ||
            payload.message.length > 500
        ) {
            postToPage('EXTENSION_Response', { requestId, success: false, error: 'Solicitud de LinkedIn inválida.' });
            return;
        }

        // Forward to Background Script
        chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Anton.IA Ext] Runtime error:', chrome.runtime.lastError.message);
                postToPage('EXTENSION_Response', { requestId, success: false, error: chrome.runtime.lastError.message });
                return;
            }

            console.log('[Anton.IA Ext] Sending response back to web app:', response);
            // Send response back to Web App
            postToPage('EXTENSION_Response', {
                requestId,
                ...(response || {})
            });
        });
    }
});

// Announce only after the service worker responds, not merely because this script was injected.
chrome.runtime.sendMessage({ action: 'CHECK_STATUS' }, (response) => {
    if (chrome.runtime.lastError || response?.status !== 'active') return;
    document.body.setAttribute('data-anton-extension-installed', 'true');
    postToPage('ANTON_EXTENSION_READY');
});
