// Background Service Worker
// Manages the queue and communication between Web App and LinkedIn Tabs

let linkedinTabId = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Anton.IA Background] Received:', request);

    if (request.action === 'CHECK_STATUS') {
        sendResponse({ status: 'active' });
        return true;
    }

    if (request.action === 'SEND_DM') {
        handleSendDM(request, sendResponse);
        return true; // async response
    }
});

async function handleSendDM(payload, sendResponse) {
    try {
        // 1. Find or active LinkedIn Tab
        // We check if we already have a focused LinkedIn tab or try to find one
        let tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
        let activeTab = tabs.length > 0 ? tabs[0] : null;

        if (!activeTab) {
            // Create new tab but don't focus it to keep user workflow smooth (unless manual action requires it)
            // For a manual "Send DM" click, we probably WANT to switch to it or open it.
            // Let's create it in background first.
            activeTab = await chrome.tabs.create({ url: 'https://www.linkedin.com', active: false });

            // Wait for it to load... (simplified for now)
            await new Promise(r => setTimeout(r, 5000));
        }

        // 2. Inject/Send messsage to that tab
        chrome.tabs.sendMessage(activeTab.id, {
            action: 'EXECUTE_DM_FLOW',
            profileUrl: payload.profileUrl,
            message: payload.message
        }, (response) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse(response);
            }
        });

    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}
