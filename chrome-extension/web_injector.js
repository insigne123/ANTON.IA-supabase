console.log('[Anton.IA Ext] Web Injector Loaded on:', window.location.href);

// 1. Listen for messages from the Web App (React)
window.addEventListener('message', function (event) {
    // We only accept messages from ourselves
    if (event.source !== window) return;

    if (event.data.type && event.data.type === 'ANTON_TO_EXTENSION') {
        console.log('[Anton.IA Ext] Received message from web app:', event.data.payload?.action);

        // Forward to Background Script
        chrome.runtime.sendMessage(event.data.payload, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Anton.IA Ext] Runtime error:', chrome.runtime.lastError.message);
                window.postMessage({
                    type: 'EXTENSION_Response',
                    payload: { success: false, error: chrome.runtime.lastError.message }
                }, '*');
                return;
            }

            console.log('[Anton.IA Ext] Sending response back to web app:', response);
            // Send response back to Web App
            window.postMessage({
                type: 'EXTENSION_Response',
                payload: response
            }, '*');
        });
    }
});

// 2. Announce presence
// We set a flag in sessionStorage or DOM so the Web App knows we are installed immediately
document.body.setAttribute('data-anton-extension-installed', 'true');
console.log('[Anton.IA Ext] Set data-anton-extension-installed attribute');

window.postMessage({ type: 'ANTON_EXTENSION_READY' }, '*');
console.log('[Anton.IA Ext] Sent ANTON_EXTENSION_READY message');
