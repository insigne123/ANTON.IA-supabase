// Anton.IA LinkedIn Automator
console.log('Anton.IA LinkedIn Script Active');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Anton.IA Content] Received message:', request.action);

    if (request.action === 'PING') {
        sendResponse({ status: 'ready' });
        return false; // synchronous
    }

    if (request.action === 'EXECUTE_DM_FLOW') {
        const requestId = request.requestId;

        // Acknowledge receipt immediately so the channel closes cleanly
        console.log('[Anton.IA Content] Acknowledging receipt for request:', requestId);
        sendResponse({ received: true });

        // Execute async logic detached from the message channel
        runDMFlow(request.profileUrl, request.message)
            .then(result => {
                console.log('[Anton.IA Content] Sending success result back to background:', result);
                chrome.runtime.sendMessage({
                    action: 'DM_RESULT',
                    requestId: requestId,
                    result: result
                });
            })
            .catch(error => {
                console.error('[Anton.IA Content] Sending error result back to background:', error);
                chrome.runtime.sendMessage({
                    action: 'DM_RESULT',
                    requestId: requestId,
                    result: { success: false, error: error.message }
                });
            });

        return false; // Close channel immediately
    }

    return false;
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

/*
async function runDMFlow(profileUrl, message) {
    console.log('[Anton.IA Content] Starting runDMFlow...');

    // 1. Check if we are on the right profile
    const normalizePath = (urlStr) => {
        try {
            // Basic fix for protocol-less URLs or partials if needed, though profileUrl should be full
            if (!urlStr.startsWith('http')) urlStr = 'https://' + urlStr;
            const u = new URL(urlStr);
            return u.pathname.toLowerCase().replace(/\/$/, '');
        } catch (e) {
            console.error('URL parse error:', e);
            // Fallback to simple string cleaning
            return urlStr.toLowerCase().split('?')[0].replace(/\/$/, '');
        }
    };

    const currentPath = normalizePath(window.location.href);
    const targetPath = normalizePath(profileUrl);

    console.log('[Anton.IA Content] URL Check:', {
        currentUrl: window.location.href,
        targetUrl: profileUrl,
        currentPath,
        targetPath
    });

    // Check if paths match (robust check)
    // We check if currentPath includes targetPath to handle cases where LinkedIn appends IDs
    if (!currentPath.includes(targetPath)) {
        console.log('[Anton.IA Content] URL mismatch. Redirecting...');
        window.location.href = profileUrl;
        return { success: false, error: `Redirecting to profile... (Expected: ${targetPath}, Got: ${currentPath})` };
    }

    // 2. Find "Message" button
    console.log('[Anton.IA Content] Step 2: Finding Message button...');
    await delay(2000);
    const msgBtn = findMessageButton();
    if (!msgBtn) {
        console.error('[Anton.IA Content] Message button NOT found');
        throw new Error('Could not find Message button');
    }

    console.log('[Anton.IA Content] Clicking Message Button...');
    msgBtn.click();

    // 3. Wait for chat overlay
    console.log('[Anton.IA Content] Step 3: Waiting for chat overlay...');
    await delay(3000); // Increased wait

    // Try multiple selectors for the message editor (LinkedIn changes these frequently)
    console.log('[Anton.IA Content] Searching for editor...');
    const editor = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
        document.querySelector('.msg-form__contenteditable') ||
        document.querySelector('[data-artdeco-is-focused="true"]') ||
        document.querySelector('.msg-form__msg-content-container [contenteditable="true"]');

    if (!editor) {
        console.error('[Anton.IA Content] Chat editor not found. Dumping body for debug (truncated)...');
        // console.log(document.body.innerHTML.substring(0, 500));
        throw new Error('Chat editor not found - LinkedIn UI may have changed');
    }

    console.log('[Anton.IA Content] Found editor:', editor.className);

    // 4. Type message
    console.log('[Anton.IA Content] Step 4: Typing message...');
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, message);

    // Verify text insertion
    if (!editor.innerText.includes(message.substring(0, 10))) {
        console.warn('[Anton.IA Content] execCommand might have failed, trying fallback...');
        editor.innerText = message;
    }

    // 5. Click Send
    console.log('[Anton.IA Content] Step 5: Finding Send button...');
    await delay(1000);

    const sendBtn = document.querySelector('button.msg-form__send-button') ||
        document.querySelector('button[type="submit"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
            (b.innerText.toLowerCase().includes('send') ||
                b.innerText.toLowerCase().includes('enviar')) &&
            !b.disabled // Important check
        );

    if (sendBtn) {
        console.log('[Anton.IA Content] Clicking Send Button...');
        sendBtn.click();
        console.log('[Anton.IA Content] Sent!');
    } else {
        console.error('[Anton.IA Content] Send button not found or disabled.');
        throw new Error('Send button not found or disabled');
    }

    return { success: true, status: 'Message sent successfully' };
}

function findMessageButton() {
    // Strategy: Find button with text "Message" or "Mensaje"
    const buttons = Array.from(document.querySelectorAll('button'));
    const messageBtn = buttons.find(b => {
        const text = b.innerText.toLowerCase();
        return text.includes('message') || text.includes('mensaje') || text.includes('enviar mensaje');
    });

    if (!messageBtn) {
        console.error('[Anton.IA] Message button not found. Available buttons:',
            buttons.slice(0, 5).map(b => b.innerText.substring(0, 20)));
    }

    return messageBtn;
}
*/

async function runDMFlow(profileUrl, message) {
    console.log('[Anton.IA Content] Starting runDMFlow...');

    // 1. Check URL
    const normalizePath = (urlStr) => {
        try {
            if (!urlStr.startsWith('http')) urlStr = 'https://' + urlStr;
            const u = new URL(urlStr);
            return u.pathname.toLowerCase().replace(/\/$/, '');
        } catch (e) {
            return urlStr.toLowerCase().split('?')[0].replace(/\/$/, '');
        }
    };

    const currentPath = normalizePath(window.location.href);
    const targetPath = normalizePath(profileUrl);

    if (!currentPath.includes(targetPath)) {
        console.log('[Anton.IA Content] URL/Path mismatch. Redirecting...');
        window.location.href = profileUrl;
        return { success: false, error: `Redirecting to profile...` };
    }

    // --- STRATEGY 1: DIRECT MESSAGE ---
    console.log('[Anton.IA Content] Strategy 1: Attempting Direct Message...');
    try {
        await delay(2000);
        const msgBtn = findButtonByText(['message', 'mensaje', 'enviar mensaje']);

        if (msgBtn) {
            console.log('[Anton.IA Content] Clicked Message Button');
            msgBtn.click();

            // Wait for editor
            await delay(3000);
            const editor = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                document.querySelector('.msg-form__contenteditable') ||
                document.querySelector('[data-artdeco-is-focused="true"]');

            if (editor) {
                console.log('[Anton.IA Content] Editor found. Sending DM...');
                return await sendMessageInEditor(editor, message);
            } else {
                console.warn('[Anton.IA Content] Message button clicked but no editor found (Premium/InMail?). Trying fallback...');

                // CRITICAL: Close the Premium/Upsell modal if it appeared!
                console.log('[Anton.IA Content] Looking for modal to dismiss...');
                const dismissal = document.querySelector('button[aria-label="Dismiss"]') ||
                    document.querySelector('button[aria-label="Cerrar"]') ||
                    document.querySelector('.artdeco-modal__dismiss') ||
                    Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'No thanks' || b.innerText === 'No, gracias');

                if (dismissal) {
                    console.log('[Anton.IA Content] Closing Premium modal...');
                    dismissal.click();
                    await delay(1000); // Wait for animation
                } else {
                    console.log('[Anton.IA Content] No dismissal button found (maybe no modal or different selector).');
                }
            }
        } else {
            console.log('[Anton.IA Content] No Message button found.');
        }
    } catch (e) {
        console.warn('[Anton.IA Content] DM Strategy failed:', e);
    }

    // --- STRATEGY 2: CONNECT + NOTE ---
    console.log('[Anton.IA Content] Strategy 2: Attempting Connect + Note...');
    return await handleConnectFlow(message);
}

// --- HELPER: Send Message in Editor ---
async function sendMessageInEditor(editor, message) {
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, message);

    // Verify insertion
    if (!editor.innerText.includes(message.substring(0, 5))) {
        editor.innerText = message;
    }

    await delay(1000);

    // Improved Send Button Strategy:
    // 1. Look for the specific "Send" button class (usually the blue circle/pill)
    // 2. Look for type="submit" (standard forms)
    // 3. Fallback to text search (aria-label or innerText)
    const sendBtn = document.querySelector('.msg-form__send-button') ||
        document.querySelector('button[type="submit"]') ||
        document.querySelector('.msg-form__footer button.artdeco-button--primary') ||
        findButtonByText(['send', 'enviar', 'enviar mensaje']);

    if (sendBtn) {
        console.log('[Anton.IA Content] Found Send button:', sendBtn.className || sendBtn.innerText || 'Unknown');

        // Ensure it's not disabled
        if (sendBtn.disabled) {
            console.error('[Anton.IA Content] Send button found but DISABLED.');
            throw new Error('Send button is disabled (maybe message is empty?)');
        }

        sendBtn.click();
        console.log('[Anton.IA Content] DM Sent!');
        return { success: true, status: 'Message sent via DM' };
    }

    console.error('[Anton.IA Content] Send button NOT found. Visible buttons:',
        Array.from(document.querySelectorAll('button')).map(b => b.innerText || b.getAttribute('aria-label')).slice(0, 10));

    throw new Error('Send button not found in DM editor');
}

// --- HELPER: Connect Flow ---
async function handleConnectFlow(message) {
    // 1. Find Connect Button
    let connectBtn = findButtonByText(['connect', 'conectar']);

    // Check if we are already connected or pending
    const pendingBtn = findButtonByText(['pending', 'pendiente']);
    if (pendingBtn) {
        console.log('[Anton.IA Content] Connection request already pending or connected.');
        return { success: false, error: 'Connection request already pending' };
    }

    // Look in "More" menu if not found
    if (!connectBtn) {
        console.log('[Anton.IA Content] Connect button not visible. Checking "More"...');
        const moreBtn = findButtonByText(['more', 'más']);
        if (moreBtn) {
            moreBtn.click();
            await delay(1000);

            const dropdownItems = Array.from(document.querySelectorAll('.artdeco-dropdown__content-inner span, .artdeco-dropdown__content-inner div'));
            const connectItem = dropdownItems.find(el => {
                const tx = el.innerText.toLowerCase();
                return tx === 'connect' || tx === 'conectar';
            });

            if (connectItem) {
                console.log('[Anton.IA Content] Found Connect in dropdown');
                connectItem.click();
                connectBtn = true; // Mark as found
            } else {
                // Close dropdown if not found to avoid obscuring things
                moreBtn.click();
            }
        }
    }

    if (!connectBtn) {
        throw new Error('Could not find Connect button (even in More menu)');
    }

    if (connectBtn instanceof HTMLElement) connectBtn.click();

    // 2. Wait for Modal (Add a note)
    console.log('[Anton.IA Content] Waiting for Connect modal to appear...');
    await delay(2000);

    const modal = document.querySelector('.artdeco-modal');

    // CASE A: Modal Appeared -> Add Note
    if (modal) {
        console.log('[Anton.IA Content] Modal appeared. Looking for "Add a note"...');

        // 3. Find "Add a note" button
        const addNoteTexts = ['add a note', 'añadir una nota', 'agregar una nota', 'personalize', 'personalizar'];
        const addNoteBtn = findButtonByText(addNoteTexts);

        if (addNoteBtn) {
            console.log('[Anton.IA Content] Clicking "Add a note"...');
            addNoteBtn.click();

            await delay(1000);
            const noteEditor = document.querySelector('textarea[name="message"]') ||
                document.querySelector('#custom-message');

            if (noteEditor) {
                console.log('[Anton.IA Content] Typing note...');
                noteEditor.value = message;
                noteEditor.dispatchEvent(new Event('input', { bubbles: true }));

                await delay(1000);
                const sendInviteTexts = ['send', 'enviar', 'done', 'listo', 'connect', 'conectar'];
                const sendInviteBtn = findButtonByText(sendInviteTexts);

                if (sendInviteBtn) {
                    console.log('[Anton.IA Content] Sending Invitation...');
                    sendInviteBtn.click();
                    return { success: true, status: 'Connection request sent with note' };
                } else {
                    console.error('[Anton.IA Content] Send/Done button in note modal not found');
                }
            } else {
                console.error('[Anton.IA Content] Note textarea not found');
            }
        } else {
            console.warn('[Anton.IA Content] "Add a note" button not found within modal.');
            // Check if it's the "How do you do know this person?" modal or "You've reached the limit"
            const modalText = modal.innerText.toLowerCase();

            if (modalText.includes('limit') || modalText.includes('límite')) {
                throw new Error('Weekly invitation limit reached');
            }

            // If we can't add a note, maybe just send it?
            const sendWithoutNoteBtn = findButtonByText(['send', 'enviar', 'connect', 'conectar', 'done', 'listo']);
            if (sendWithoutNoteBtn) {
                console.log('[Anton.IA Content] Sending without note (Note button missing)...');
                sendWithoutNoteBtn.click();
                return { success: true, status: 'Connection request sent (No note option)' };
            }
        }
    }
    // CASE B: No Modal -> Check if it was a "Quick Connect"
    else {
        console.log('[Anton.IA Content] No modal appeared. Checking if request was sent instantly...');

        // Look for "Pending" status
        const pendingBtn = findButtonByText(['pending', 'pendiente']);
        const successToast = document.querySelector('.artdeco-toast');

        if (pendingBtn || successToast) {
            console.log('[Anton.IA Content] Request appears to have been sent instantly!');
            return { success: true, status: 'Connection request sent (Quick Connect)' };
        }

        console.error('[Anton.IA Content] No modal and no "Pending" status found.');
        throw new Error('Click appeared to fail: No modal and not pending.');
    }

    throw new Error('Failed to send Connection Request (Unknown final state)');
}

function findButtonByText(texts) {
    const buttons = Array.from(document.querySelectorAll('button, a.artdeco-button')); // Include links styled as buttons
    return buttons.find(b => {
        // Check text
        const t = b.innerText.toLowerCase();
        // Check accessibility label
        const l = (b.getAttribute('aria-label') || '').toLowerCase();
        return texts.some(txt => t.includes(txt) || l.includes(txt));
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
