console.log('[Anton.IA Ext] Web Injector Loaded');

// 1. Listen for messages from the Web App (React)
window.addEventListener('message', function (event) {
    // We only accept messages from ourselves
    if (event.source !== window) return;

    if (event.data.type && event.data.type === 'ANTON_TO_EXTENSION') {
        // Forward to Background Script
        chrome.runtime.sendMessage(event.data.payload, (response) => {
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
window.postMessage({ type: 'ANTON_EXTENSION_READY' }, '*');
