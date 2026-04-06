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
        console.log('[Anton.IA Ext] Received message from web app:', event.data.payload?.action);
        const requestId = event.data.payload?.requestId || null;

        // Forward to Background Script
        chrome.runtime.sendMessage(event.data.payload, (response) => {
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

// 1b. Listen for messages from the Extension (background -> this content script)
// and forward them to the web app via window.postMessage.
chrome.runtime.onMessage.addListener((message) => {
    try {
        if (message && message.action === 'REPLY_DETECTED') {
            console.log('[Anton.IA Ext] Forwarding REPLY_DETECTED to web app');
            postToPage('ANTON_REPLY_DETECTED', message.payload || {});
        }
    } catch (e) {
        console.error('[Anton.IA Ext] Failed to forward extension message:', e);
    }
    return false;
});

// 2. Announce presence
// We set a flag in sessionStorage or DOM so the Web App knows we are installed immediately
document.body.setAttribute('data-anton-extension-installed', 'true');
console.log('[Anton.IA Ext] Set data-anton-extension-installed attribute');

postToPage('ANTON_EXTENSION_READY');
console.log('[Anton.IA Ext] Sent ANTON_EXTENSION_READY message');
