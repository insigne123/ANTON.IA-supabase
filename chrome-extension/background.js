// Simplified background script - v1.7
console.log('[Anton.IA Background] Service Worker Started!');

// Store pending DM requests
const pendingRequests = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Anton.IA Background] Received message:', request);

    if (request.action === 'CHECK_STATUS') {
        sendResponse({ status: 'active' });
        return true;
    }

    if (request.action === 'SEND_DM') {
        console.log('[Anton.IA Background] Processing SEND_DM request');
        handleSendDM(request, sendResponse);
        return true; // Keep channel open
    }

    // NEW: Relay LinkedIn reply events to the web app tab(s)
    if (request.action === 'REPLY_DETECTED') {
        console.log('[Anton.IA Background] Reply detected, relaying to app tabs...');
        relayReplyDetected(request).catch((err) => {
            console.error('[Anton.IA Background] Failed to relay reply:', err);
        });
        return false; // no response expected
    }

    // NEW: Handle response from content script
    if (request.action === 'DM_RESULT') {
        console.log('[Anton.IA Background] Received DM result:', request.result);
        const callback = pendingRequests.get(request.requestId);
        if (callback) {
            callback(request.result);
            pendingRequests.delete(request.requestId);
        }
        return false;
    }

    return false;
});

async function relayReplyDetected(payload) {
    const replyText = payload.replyText || '';
    const linkedinThreadUrl = payload.linkedinThreadUrl || '';
    const profileUrl = payload.profileUrl || '';

    // Find any open Anton.IA app tab(s)
    const appTabs = await chrome.tabs.query({
        url: [
            'http://localhost:3000/*',
            'https://*.vercel.app/*',
            'https://*.hosted.app/*',
            'https://*.us-central1.hosted.app/*',
            'https://studio--leadflowai-3yjcy.us-central1.hosted.app/*'
        ]
    });

    if (!appTabs || appTabs.length === 0) {
        console.log('[Anton.IA Background] No app tabs found. Dropping reply event.');
        return;
    }

    for (const tab of appTabs) {
        if (!tab?.id) continue;
        try {
            chrome.tabs.sendMessage(tab.id, {
                action: 'REPLY_DETECTED',
                payload: {
                    replyText,
                    linkedinThreadUrl,
                    profileUrl,
                }
            });
        } catch (e) {
            console.warn('[Anton.IA Background] Failed to send reply to tab', tab?.id, e);
        }
    }
}

async function handleSendDM(payload, sendResponse) {
    console.log('[Anton.IA Background] handleSendDM called with:', payload);

    try {
        const targetUrl = payload.profileUrl;
        const requestId = Date.now().toString(); // Unique ID for this request

        // Helper: Wait for tab to be completely ready
        const waitForTabLoad = (tabId) => {
            return new Promise((resolve) => {
                const listener = (tid, changeInfo, tab) => {
                    if (tid === tabId && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        // Give it an extra second for React hydration
                        setTimeout(resolve, 2000);
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        };

        // 1. Find ANY LinkedIn tab
        let tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
        let activeTab = tabs.length > 0 ? tabs[0] : null;
        let needNavigation = false;

        if (activeTab) {
            console.log('[Anton.IA Background] Found existing tab:', activeTab.id, activeTab.url);

            // Normalize for comparison
            const currentPath = new URL(activeTab.url).pathname.toLowerCase().replace(/\/$/, '');
            let targetPath = "";
            try {
                targetPath = new URL(targetUrl).pathname.toLowerCase().replace(/\/$/, '');
            } catch (e) { targetPath = targetUrl; }

            if (!currentPath.includes(targetPath)) {
                console.log('[Anton.IA Background] Tab is on wrong URL. Navigating...', { current: currentPath, target: targetPath });
                chrome.tabs.update(activeTab.id, { url: targetUrl, active: true });
                needNavigation = true;
            } else {
                console.log('[Anton.IA Background] Tab is already on correct URL.');
                chrome.tabs.update(activeTab.id, { active: true });
                // Still ping just to be safe it's ready
            }
        } else {
            console.log('[Anton.IA Background] No LinkedIn tab. Creating new one.');
            activeTab = await chrome.tabs.create({ url: targetUrl, active: true });
            needNavigation = true;
        }

        // Wait for navigation if needed
        if (needNavigation) {
            console.log('[Anton.IA Background] Waiting for tab to load...');
            await waitForTabLoad(activeTab.id);
            console.log('[Anton.IA Background] Tab loaded!');
        }

        // Store the sendResponse callback
        pendingRequests.set(requestId, sendResponse);

        // Send message to content script
        console.log('[Anton.IA Background] Sending EXECUTE_DM_FLOW to tab:', activeTab.id);

        // Retry logic for sending the message (in case content script needs a moment to initialize)
        const sendMessageWithRetry = async (retries = 3) => {
            chrome.tabs.sendMessage(
                activeTab.id,
                {
                    action: 'EXECUTE_DM_FLOW',
                    requestId: requestId,
                    profileUrl: payload.profileUrl,
                    message: payload.message
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Anton.IA Background] Send error:', chrome.runtime.lastError.message);
                        if (retries > 0) {
                            console.log(`[Anton.IA Background] Retrying... (${retries} left)`);
                            setTimeout(() => sendMessageWithRetry(retries - 1), 1000);
                        } else {
                            // If fails, try fallback injection
                            console.log('[Anton.IA Background] Injection fallback...');
                            chrome.scripting.executeScript({
                                target: { tabId: activeTab.id },
                                files: ['content.js']
                            }).then(() => {
                                // Try one last time after manual injection
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(activeTab.id, {
                                        action: 'EXECUTE_DM_FLOW',
                                        requestId: requestId,
                                        profileUrl: payload.profileUrl,
                                        message: payload.message
                                    });
                                }, 1000);
                            }).catch(err => {
                                console.error('Injection failed', err);
                                sendResponse({ success: false, error: 'Failed to connect to LinkedIn tab' });
                                pendingRequests.delete(requestId);
                            });
                        }
                    } else if (response) {
                        console.log('[Anton.IA Background] Got immediate acknowledgement:', response);
                    }
                }
            );
        };

        sendMessageWithRetry();

        // Timeout safety
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                console.error('[Anton.IA Background] Timeout for request:', requestId);
                sendResponse({ success: false, error: 'Timeout waiting for content script logic' });
                pendingRequests.delete(requestId);
            }
        }, 45000); // Increased to 45s for navigation

    } catch (error) {
        console.error('[Anton.IA Background] Exception:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

console.log('[Anton.IA Background] Initialization complete');
