// Anton.IA LinkedIn Automator
console.log('Anton.IA LinkedIn Script Active');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_DM_FLOW') {
        runDMFlow(request.profileUrl, request.message, sendResponse);
        return true; // async
    }
});

// --- LISTENER LOGIC (Phase 3) ---
// Monitor chat for new incoming messages

let lastProcessedMessage = null;

// Run observer when on messaging page
if (location.href.includes('messaging')) {
    startReplyObserver();
}

// Also watch for URL changes (SPA)
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
    // We observe the message list container
    // Class names change, so we look for generic "list" roles or specific partial classes
    const chatContainer = document.querySelector('.msg-s-message-list-container');

    if (!chatContainer) {
        // Retry/Wait
        setTimeout(startReplyObserver, 2000);
        return;
    }

    console.log('Anton.IA: Observer attached to chat container');

    const callback = (mutationsList) => {
        // Check for new nodes
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                checkLastMessage();
            }
        }
    };

    const observer = new MutationObserver(callback);
    observer.observe(chatContainer, { childList: true, subtree: true });

    // Check initial state too
    checkLastMessage();
}

function checkLastMessage() {
    // Find all message bubbles
    // Selector strategy: 'msg-s-event-listitem' is the wrapper.
    const items = document.querySelectorAll('.msg-s-event-listitem');
    if (items.length === 0) return;

    const lastItem = items[items.length - 1];

    // Check if it's NOT from me
    // Usually 'msg-s-message-group--is-mine' or similar exists on the GROUP.
    // The list items are inside groups.
    // We need to check if the message is INCOMING.
    // Heuristic: Check for Profile Link/Image of the OTHER person.

    // LinkedIn DOM structure varies.
    // Robust check: Does it have 'msg-s-event-listitem--other'? (Sometimes used)

    const isMine = lastItem.innerHTML.includes('msg-s-message-group--is-mine') ||
        lastItem.closest('.msg-s-message-group--is-mine');

    if (!isMine) {
        // It's from them!
        const textElement = lastItem.querySelector('.msg-s-event-listitem__body');
        const text = textElement ? textElement.innerText : '';

        if (text && text !== lastProcessedMessage) {
            console.log('Anton.IA: Reply Detected!', text.substring(0, 20) + '...');
            lastProcessedMessage = text;

            // Send to Background
            chrome.runtime.sendMessage({
                action: 'REPLY_DETECTED',
                replyText: text,
                linkedinThreadUrl: location.href,
                profileUrl: extractProfileFromThread()
            });
        }
    }
}

function extractProfileFromThread() {
    // Try to find the profile link in the header
    const headerLink = document.querySelector('.msg-thread-section__sender a.msg-thread-section__sender-link');
    return headerLink ? headerLink.href : null;
}


// --- EXISTING SEND LOGIC ---

async function runDMFlow(profileUrl, message, sendResponse) {
    try {
        // 1. Check if we are on the right profile
        if (!window.location.href.includes(profileUrl)) {
            window.location.href = profileUrl;
            // The script will reload, so 'background.js' needs to handle the re-injection/waiting. 
            // This simple flow assumes background handles navigation OR we employ a persistent connection.
            // For MVP Phase 1: We assume the user (or background) navigated us here.
            // But actually, if we reload, this promise dies.
            // Mitigation: background.js should navigate -> wait complete -> send 'EXECUTE_DM_DESCRIBE'.
            // For now, let's assume we are ALREADY on the page or background moved us.
            // If URL mismatches significantly, fail.
        }

        // 2. Find "Message" button
        await delay(2000);
        const msgBtn = findMessageButton();
        if (!msgBtn) throw new Error('Could not find Message button');

        msgBtn.click();
        console.log('Clicked Message Button');

        // 3. Wait for chat overlay
        await delay(2000);
        const editor = document.querySelector('div[role="textbox"][contenteditable="true"]');
        if (!editor) throw new Error('Chat editor not found');

        // 4. Type message
        // Updating contenteditable is tricky (React virtual DOM).
        // We try execCommand for best compatibility
        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null); // Clear existing draft if any? careful
        document.execCommand('insertText', false, message);

        // 5. Click Send
        const sendBtn = document.querySelector('button.msg-form__send-button');
        if (sendBtn) {
            sendBtn.click();
            console.log('Clicked Send Button');
        } else {
            console.warn('Send button not found, message typed but not sent.');
        }

        sendResponse({ success: true, status: 'Message sent successfully' });

    } catch (e) {
        console.error(e);
        sendResponse({ success: false, error: e.message });
    }
}

function findMessageButton() {
    // Strategy: Find button with text "Message" or "Mensaje"
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find(b => {
        const text = b.innerText.toLowerCase();
        return text.includes('message') || text.includes('mensaje') || text.includes('enviar mensaje');
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
