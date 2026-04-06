// Defines the interface for communicating with the Anton.IA Chrome Extension

export const extensionService = {
    isInstalled: false,
    _listenerInitialized: false,
    _lastReplyKey: null as null | string,
    _lastReplyAtMs: 0,
    _requestSeq: 0,

    initListener() {
        if (typeof window === 'undefined') return;
        if (this._listenerInitialized) return;
        this._listenerInitialized = true;

        const appOrigin = window.location.origin;

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.origin !== appOrigin) return;
            if (!event.data || typeof event.data !== 'object') return;
            if (event.data.type === 'ANTON_EXTENSION_READY') {
                this.isInstalled = true;
                console.log('[App] Extension detected via ANTON_EXTENSION_READY message!');
            }

            if (event.data.type === 'ANTON_REPLY_DETECTED') {
                const payload = event.data.payload || {};
                this.handleReplyDetected(payload).catch((err) => {
                    console.error('[App] Failed to handle reply detected:', err);
                });
            }
        });

        if (document.body.getAttribute('data-anton-extension-installed')) {
            this.isInstalled = true;
            console.log('[App] Extension detected via data-anton-extension-installed attribute!');
        }

        setTimeout(() => {
            console.log('[App] Extension Service Status:', {
                isInstalled: this.isInstalled,
                hasDataAttribute: !!document.body.getAttribute('data-anton-extension-installed'),
                currentUrl: window.location.href,
            });
        }, 1000);
    },

    async sendLinkedinDM(profileUrl: string, message: string): Promise<{ success: boolean; error?: string }> {
        if (!this.isInstalled) {
            console.error('[App] Cannot send LinkedIn DM: Extension not installed');
            return { success: false, error: 'Extension not installed' };
        }

        const requestId = `linkedin-${Date.now()}-${++this._requestSeq}`;
        const timeoutMs = 60000;

        console.log('[App] Sending LinkedIn DM request:', { requestId, profileUrl, messageLength: message.length });

        return new Promise((resolve) => {
            let settled = false;
            const appOrigin = window.location.origin;

            const handler = (event: MessageEvent) => {
                if (event.source !== window) return;
                if (event.origin !== appOrigin) return;
                if (!event.data || typeof event.data !== 'object') return;
                if (event.data.type !== 'EXTENSION_Response') return;

                const payload = event.data.payload || {};
                if (payload.requestId && payload.requestId !== requestId) return;
                if (settled) return;

                settled = true;
                window.clearTimeout(timeoutId);
                window.removeEventListener('message', handler);
                console.log('[App] Received extension response:', payload);

                if (payload.success) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: payload.error || 'Unknown extension error' });
                }
            };

            window.addEventListener('message', handler);

            const timeoutId = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                window.removeEventListener('message', handler);
                console.error('[App] Timeout waiting for extension response', { requestId, timeoutMs });
                resolve({ success: false, error: `Timeout waiting for extension (${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);

            window.postMessage({
                type: 'ANTON_TO_EXTENSION',
                payload: {
                    action: 'SEND_DM',
                    requestId,
                    profileUrl,
                    message,
                },
            }, appOrigin);
        });
    },

    async handleReplyDetected(payload: { linkedinThreadUrl?: string; replyText?: string; profileUrl?: string }) {
        const linkedinThreadUrl = payload?.linkedinThreadUrl || '';
        const replyText = payload?.replyText || '';
        const profileUrl = payload?.profileUrl || '';

        const replyKey = `${linkedinThreadUrl}::${profileUrl}::${replyText}`;
        const now = Date.now();
        if (this._lastReplyKey === replyKey && now - this._lastReplyAtMs < 5000) {
            return;
        }
        this._lastReplyKey = replyKey;
        this._lastReplyAtMs = now;

        try {
            const res = await fetch('/api/scheduler/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ linkedinThreadUrl, replyText, profileUrl }),
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error('[App] /api/scheduler/reply failed:', res.status, text);
                return;
            }

            const data = await res.json().catch(() => ({}));
            console.log('[App] Reply event saved:', data);
        } catch (e) {
            console.error('[App] Network error saving reply:', e);
        }
    },
};

if (typeof window !== 'undefined') {
    extensionService.initListener();
    (window as any).extensionService = extensionService;
}
