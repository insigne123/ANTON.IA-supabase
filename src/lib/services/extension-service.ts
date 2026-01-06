// Defines the interface for communicating with the Anton.IA Chrome Extension

export const extensionService = {
    isInstalled: false,

    initListener() {
        if (typeof window === 'undefined') return;

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data.type === 'ANTON_EXTENSION_READY') {
                this.isInstalled = true;
                console.log('[App] ✅ Extension detected via ANTON_EXTENSION_READY message!');
            }
        });

        // Proactive check
        // We send a ping, if extension is there, it might respond (handled by listener above if we add a PONG)
        // For now, rely on the content script's initial broadcast or 'data-' attribute.
        if (document.body.getAttribute('data-anton-extension-installed')) {
            this.isInstalled = true;
            console.log('[App] ✅ Extension detected via data-anton-extension-installed attribute!');
        }

        // Log status after initialization
        setTimeout(() => {
            console.log('[App] Extension Service Status:', {
                isInstalled: this.isInstalled,
                hasDataAttribute: !!document.body.getAttribute('data-anton-extension-installed'),
                currentUrl: window.location.href
            });
        }, 1000);
    },

    async sendLinkedinDM(profileUrl: string, message: string): Promise<{ success: boolean; error?: string }> {
        if (!this.isInstalled) {
            console.error('[App] ❌ Cannot send LinkedIn DM: Extension not installed');
            return { success: false, error: 'Extension not installed' };
        }

        console.log('[App] 📤 Sending LinkedIn DM request:', { profileUrl, messageLength: message.length });

        return new Promise((resolve) => {
            const handler = (event: MessageEvent) => {
                if (event.source !== window) return;
                if (event.data.type === 'EXTENSION_Response') {
                    // We might need an ID to match request/response if concurrent, but for now simple 1-1
                    window.removeEventListener('message', handler);
                    console.log('[App] 📥 Received extension response:', event.data.payload);

                    if (event.data.payload.success) {
                        resolve({ success: true });
                    } else {
                        resolve({ success: false, error: event.data.payload.error });
                    }
                }
            };

            window.addEventListener('message', handler);

            window.postMessage({
                type: 'ANTON_TO_EXTENSION',
                payload: {
                    action: 'SEND_DM',
                    profileUrl,
                    message
                }
            }, '*');

            // Timeout safety
            setTimeout(() => {
                window.removeEventListener('message', handler);
                console.error('[App] ⏱️ Timeout waiting for extension response');
                resolve({ success: false, error: 'Timeout waiting for extension (30s)' });
            }, 30000);
        });
    }
};

// Start listening immediately
if (typeof window !== 'undefined') {
    extensionService.initListener();
}
