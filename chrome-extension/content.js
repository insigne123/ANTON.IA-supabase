// Anton.IA LinkedIn Automator
console.log('Anton.IA LinkedIn Script Active');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_DM_FLOW') {
        runDMFlow(request.profileUrl, request.message, sendResponse);
        return true; // async
    }
});

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

            // If we are NOT on the page, we tell background "Please move me".
            // But let's keep it simple: Background does the nav.
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

        // 5. Click Send (Simulated for Phase 1 - we leave it typed)
        // const sendBtn = document.querySelector('button.msg-form__send-button');
        // if (sendBtn) sendBtn.click();

        sendResponse({ success: true, status: 'Typed, waiting for manual send (Safety Mode)' });

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
