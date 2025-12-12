const API_BASE = 'http://localhost:3000'; // Make sure this matches user env or use production URL

// Setup polling
chrome.alarms.create('check_schedule', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'check_schedule') {
        checkAndExecuteSchedule();
    }
});

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

    if (request.action === 'REPLY_DETECTED') {
        handleReplyDetected(request);
        sendResponse({ received: true });
        return true;
    }
});

async function handleReplyDetected(payload) {
    try {
        console.log('[Anton.IA] Sending reply to API:', payload);
        const res = await fetch(`${API_BASE}/api/scheduler/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        console.log('[Anton.IA] API Response:', json);
    } catch (e) {
        console.error('[Anton.IA] Failed to send reply to API:', e);
    }
}

async function checkAndExecuteSchedule() {
    try {
        const res = await fetch(`${API_BASE}/api/scheduler/poll`);
        const data = await res.json();

        if (data.tasks && data.tasks.length > 0) {
            console.log(`[Anton.IA] Found ${data.tasks.length} scheduled tasks.`);
            processBatch(data.tasks);
        }
    } catch (e) {
        console.error('[Anton.IA] Polling error:', e);
    }
}

async function processBatch(tasks) {
    for (const task of tasks) {
        // Execute one by one
        console.log('[Anton.IA] Processing:', task.id, task.name);
        // ... (Using same logic as previously discussed)

        const messageToContext = task.subject || "Hola, me gustaría conectar.";

        const result = await new Promise(resolve => {
            handleSendDM({
                profileUrl: task.linkedin_thread_url, // We stored this in planner-service
                message: messageToContext
            }, resolve);
        });

        // Report status
        const status = result.success ? 'sent' : 'failed'; // or retry logic
        await fetch(`${API_BASE}/api/scheduler/complete`, {
            method: 'POST',
            body: JSON.stringify({ id: task.id, status, error: result.error })
        });

        // Wait random time between actions
        await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000));
    }
}

async function handleSendDM(payload, sendResponse) {
    try {
        // 1. Find or active LinkedIn Tab
        let tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
        let activeTab = tabs.length > 0 ? tabs[0] : null;

        if (!activeTab) {
            activeTab = await chrome.tabs.create({ url: 'https://www.linkedin.com', active: false });
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
